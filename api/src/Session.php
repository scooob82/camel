<?php
declare(strict_types=1);

namespace Cas;

use Cas\Http\HttpError;
use Cas\Http\Request;

/** Native PHP sessions stored in api/storage/sessions + CSRF token. */
final class Session
{
    private bool $started = false;

    public function __construct(private Config $config)
    {
    }

    public function start(Request $req): void
    {
        if ($this->started || PHP_SAPI === 'cli' && !getenv('CAS_HTTP')) {
            $this->started = true;
            return;
        }
        $lifetime = (int) $this->config->get('session.lifetime');
        $secure = $this->config->get('session.secure');
        if ($secure === null) {
            $secure = ($req->header('x-forwarded-proto') === 'https') || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
        }
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string) $lifetime);
        session_save_path($this->config->storage('sessions'));
        session_name((string) $this->config->get('session.name'));
        session_set_cookie_params([
            'lifetime' => $lifetime,
            'path' => '/',
            'secure' => (bool) $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
        $this->started = true;
    }

    public function get(string $key): mixed
    {
        return $_SESSION[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        $_SESSION[$key] = $value;
    }

    public function login(array $user): void
    {
        session_regenerate_id(true);
        $_SESSION['uid'] = $user['id'];
        $_SESSION['sv'] = (int) $user['session_version'];
        $_SESSION['csrf'] = Support::token();
    }

    public function logout(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }
        $_SESSION['csrf'] = Support::token();
    }

    public function csrfToken(): string
    {
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = Support::token();
        }
        return $_SESSION['csrf'];
    }

    public function verifyCsrf(Request $req): void
    {
        $sent = $req->header('x-csrf-token') ?? '';
        $expected = $_SESSION['csrf'] ?? '';
        if ($expected === '' || !hash_equals($expected, $sent)) {
            throw new HttpError(419, 'csrf_mismatch', 'Your session expired. Please reload the page and try again.');
        }
    }
}
