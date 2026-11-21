<?php
declare(strict_types=1);

namespace Cas\Controllers;

use Cas\App;
use Cas\Auth;
use Cas\Http\HttpError;
use Cas\Http\Request;
use Cas\Support;

use function Cas\now;

final class AccountController
{
    public function __construct(private App $app)
    {
    }

    public function update(Request $req): array
    {
        $user = $this->app->auth->require();
        $name = $req->string('name');
        if (mb_strlen($name) > 80) {
            throw HttpError::validation(['name' => 'Name is too long.']);
        }
        $this->app->db->exec('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', [$name, now(), $user['id']]);
        $user['name'] = $name;
        return ['user' => Auth::publicUser($user)];
    }

    public function password(Request $req): array
    {
        $user = $this->app->auth->require();
        $this->app->limiter->hit('password:' . $user['id'], 10, 3600);
        $errors = [];
        if (!password_verify((string) $req->input('current', ''), $user['password_hash'])) {
            $errors['current'] = 'Current password is incorrect.';
        }
        Support::checkPassword((string) $req->input('password', ''), 'password', $errors);
        if ($errors) {
            throw HttpError::validation($errors);
        }
        $this->app->db->exec('UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?', [password_hash((string) $req->input('password'), PASSWORD_DEFAULT), now(), $user['id']]);
        // keep this session, sign out everywhere else
        $this->app->session->login($this->app->db->one('SELECT * FROM users WHERE id = ?', [$user['id']]));
        return ['ok' => true, 'csrf' => $this->app->session->csrfToken()];
    }

    public function export(): array
    {
        $user = $this->app->auth->require();
        $projects = $this->app->db->all('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at', [$user['id']]);
        $out = [];
        foreach ($projects as $p) {
            $versions = $this->app->db->all('SELECT id, label, data, created_at FROM versions WHERE project_id = ? ORDER BY created_at DESC', [$p['id']]);
            $out[] = [
                'id' => $p['id'],
                'name' => $p['name'],
                'description' => $p['description'],
                'createdAt' => (int) $p['created_at'],
                'updatedAt' => (int) $p['updated_at'],
                'file' => Support::decode($p['data']),
                'versions' => array_map(fn ($v) => ['id' => $v['id'], 'label' => $v['label'], 'at' => (int) $v['created_at'], 'file' => Support::decode($v['data'])], $versions),
            ];
        }
        return ['exportedAt' => now(), 'user' => Auth::publicUser($user), 'projects' => $out];
    }

    public function delete(Request $req): array
    {
        $user = $this->app->auth->require();
        if (!password_verify((string) $req->input('password', ''), $user['password_hash'])) {
            throw HttpError::validation(['password' => 'Password is incorrect.']);
        }
        $this->app->db->transaction(function () use ($user) {
            $this->app->db->exec('DELETE FROM versions WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', [$user['id']]);
            $this->app->db->exec('DELETE FROM projects WHERE user_id = ?', [$user['id']]);
            $this->app->db->exec('DELETE FROM tokens WHERE user_id = ?', [$user['id']]);
            $this->app->db->exec('DELETE FROM users WHERE id = ?', [$user['id']]);
        });
        $this->app->session->logout();
        return ['ok' => true, 'csrf' => $this->app->session->csrfToken()];
    }
}
