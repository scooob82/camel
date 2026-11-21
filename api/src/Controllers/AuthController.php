<?php
declare(strict_types=1);

namespace Cas\Controllers;

use Cas\App;
use Cas\Auth;
use Cas\Http\HttpError;
use Cas\Http\Request;
use Cas\Support;

use function Cas\now;

final class AuthController
{
    private const VERIFY_TTL = 48 * 3600 * 1000;
    private const RESET_TTL = 3600 * 1000;

    public function __construct(private App $app)
    {
    }

    public function csrf(): array
    {
        return ['token' => $this->app->session->csrfToken()];
    }

    public function me(): array
    {
        $u = $this->app->auth->user();
        return ['user' => $u ? Auth::publicUser($u) : null, 'csrf' => $this->app->session->csrfToken()];
    }

    public function register(Request $req): array
    {
        $this->app->limiter->hit('register:' . $req->ip, 10, 3600);
        $email = Support::email($req->string('email'));
        $name = $req->string('name');
        $password = (string) $req->input('password', '');
        $errors = [];
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 191) {
            $errors['email'] = 'Enter a valid e-mail address.';
        }
        if (mb_strlen($name) > 80) {
            $errors['name'] = 'Name is too long.';
        }
        Support::checkPassword($password, 'password', $errors);
        if (!$errors && $this->app->db->value('SELECT 1 FROM users WHERE email = ?', [$email])) {
            $errors['email'] = 'An account with this e-mail already exists.';
        }
        if ($errors) {
            throw HttpError::validation($errors);
        }
        $now = now();
        $user = [
            'id' => Support::id('u_'),
            'email' => $email,
            'name' => $name,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'plan' => 'free',
            'role' => 'user',
            'email_verified_at' => null,
            'session_version' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $this->app->db->insert('users', $user);
        $this->sendVerification($user);
        $this->app->session->login($user);
        return ['user' => Auth::publicUser($user), 'csrf' => $this->app->session->csrfToken()];
    }

    public function login(Request $req): array
    {
        $email = Support::email($req->string('email'));
        $this->app->limiter->hit('login-ip:' . $req->ip, 30, 900);
        $this->app->limiter->hit('login:' . $email, 8, 900);
        $password = (string) $req->input('password', '');
        $user = $this->app->db->one('SELECT * FROM users WHERE email = ?', [$email]);
        // Always run password_verify to keep timing similar for unknown e-mails
        $hash = $user['password_hash'] ?? '$2y$10$usesomesillystringforsalt$';
        if (!password_verify($password, $hash) || !$user) {
            throw new HttpError(422, 'invalid_credentials', 'E-mail or password is incorrect.');
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $this->app->db->exec('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        $this->app->limiter->clear('login:' . $email);
        $this->app->session->login($user);
        return ['user' => Auth::publicUser($user), 'csrf' => $this->app->session->csrfToken()];
    }

    public function logout(): array
    {
        $this->app->session->logout();
        return ['ok' => true, 'csrf' => $this->app->session->csrfToken()];
    }

    public function verify(Request $req): array
    {
        $row = $this->consumeToken($req->string('token'), 'verify');
        $this->app->db->exec('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ? AND email_verified_at IS NULL', [now(), now(), $row['user_id']]);
        $this->app->auth->refresh();
        $u = $this->app->auth->user();
        return ['ok' => true, 'user' => $u ? Auth::publicUser($u) : null];
    }

    public function resendVerification(Request $req): array
    {
        $user = $this->app->auth->require();
        if ($user['email_verified_at'] !== null) {
            return ['ok' => true];
        }
        $this->app->limiter->hit('verify-mail:' . $user['id'], 3, 3600);
        $this->sendVerification($user);
        return ['ok' => true];
    }

    public function forgot(Request $req): array
    {
        $email = Support::email($req->string('email'));
        $this->app->limiter->hit('forgot-ip:' . $req->ip, 10, 3600);
        $this->app->limiter->hit('forgot:' . $email, 3, 3600);
        $user = $this->app->db->one('SELECT * FROM users WHERE email = ?', [$email]);
        if ($user) {
            $token = $this->createToken($user['id'], 'reset', self::RESET_TTL);
            $this->app->mailer->send($user['email'], 'Reset your password', implode("\n", [
                'Hi' . ($user['name'] !== '' ? ' ' . $user['name'] : '') . ',',
                '',
                'Someone (hopefully you) asked to reset the password for your ' . $this->app->config->get('app_name') . ' account.',
                'Open this link within 1 hour to choose a new password:',
                '',
                $this->app->link('/reset/' . $token),
                '',
                'If you did not ask for this, you can ignore this e-mail.',
            ]));
        }
        // Same answer whether the account exists or not
        return ['ok' => true];
    }

    public function reset(Request $req): array
    {
        $password = (string) $req->input('password', '');
        $errors = [];
        Support::checkPassword($password, 'password', $errors);
        if ($errors) {
            throw HttpError::validation($errors);
        }
        $row = $this->consumeToken($req->string('token'), 'reset');
        $now = now();
        $this->app->db->exec(
            'UPDATE users SET password_hash = ?, session_version = session_version + 1, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?',
            [password_hash($password, PASSWORD_DEFAULT), $now, $now, $row['user_id']],
        );
        $this->app->db->exec("DELETE FROM tokens WHERE user_id = ? AND type = 'reset'", [$row['user_id']]);
        $user = $this->app->db->one('SELECT * FROM users WHERE id = ?', [$row['user_id']]);
        $this->app->session->login($user);
        return ['user' => Auth::publicUser($user), 'csrf' => $this->app->session->csrfToken()];
    }

    // ------------------------------------------------------------ helpers

    private function sendVerification(array $user): void
    {
        $token = $this->createToken($user['id'], 'verify', self::VERIFY_TTL);
        $this->app->mailer->send($user['email'], 'Confirm your e-mail', implode("\n", [
            'Welcome to ' . $this->app->config->get('app_name') . '!',
            '',
            'Please confirm your e-mail address:',
            '',
            $this->app->link('/verify/' . $token),
            '',
            'The link is valid for 48 hours.',
        ]));
    }

    private function createToken(string $userId, string $type, int $ttl): string
    {
        $token = Support::token();
        $this->app->db->insert('tokens', [
            'id' => Support::id('t_'),
            'user_id' => $userId,
            'type' => $type,
            'token_hash' => Support::hash($token),
            'expires_at' => now() + $ttl,
            'used_at' => null,
            'created_at' => now(),
        ]);
        return $token;
    }

    private function consumeToken(string $token, string $type): array
    {
        $row = $token === '' ? null : $this->app->db->one('SELECT * FROM tokens WHERE token_hash = ? AND type = ?', [Support::hash($token), $type]);
        if (!$row || $row['used_at'] !== null || (int) $row['expires_at'] < now()) {
            throw new HttpError(422, 'invalid_token', 'This link is invalid or has expired.');
        }
        $this->app->db->exec('UPDATE tokens SET used_at = ? WHERE id = ?', [now(), $row['id']]);
        return $row;
    }
}
