<?php
declare(strict_types=1);

namespace Cas\Controllers;

use Cas\App;
use Cas\Auth;
use Cas\Http\HttpError;
use Cas\Http\Request;

use function Cas\now;

final class AdminController
{
    private const PLANS = ['free', 'pro', 'team'];
    private const ROLES = ['user', 'admin'];

    public function __construct(private App $app)
    {
    }

    private function admin(): array
    {
        $u = $this->app->auth->require();
        if ($u['role'] !== 'admin') {
            throw new HttpError(403, 'forbidden', 'Admins only.');
        }
        return $u;
    }

    public function stats(): array
    {
        $this->admin();
        $db = $this->app->db;
        $since = gmdate('Y-m-d', time() - 29 * 86400);
        $views = $db->all('SELECT day, SUM(views) AS views FROM page_views WHERE day >= ? GROUP BY day ORDER BY day', [$since]);
        $top = $db->all('SELECT path, SUM(views) AS views FROM page_views WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 10', [$since]);
        $plans = $db->all('SELECT plan, COUNT(*) AS n FROM users GROUP BY plan');
        return [
            'users' => (int) $db->value('SELECT COUNT(*) FROM users'),
            'verified' => (int) $db->value('SELECT COUNT(*) FROM users WHERE email_verified_at IS NOT NULL'),
            'newUsers7d' => (int) $db->value('SELECT COUNT(*) FROM users WHERE created_at >= ?', [now() - 7 * 86400000]),
            'projects' => (int) $db->value('SELECT COUNT(*) FROM projects'),
            'versions' => (int) $db->value('SELECT COUNT(*) FROM versions'),
            'shared' => (int) $db->value('SELECT COUNT(*) FROM projects WHERE share_token IS NOT NULL'),
            'plans' => array_map(fn ($r) => ['plan' => $r['plan'], 'users' => (int) $r['n']], $plans),
            'pageViews' => array_map(fn ($r) => ['day' => $r['day'], 'views' => (int) $r['views']], $views),
            'topPaths' => array_map(fn ($r) => ['path' => $r['path'], 'views' => (int) $r['views']], $top),
            'errors7d' => (int) $db->value('SELECT COUNT(*) FROM client_errors WHERE created_at >= ?', [now() - 7 * 86400000]),
        ];
    }

    public function users(Request $req): array
    {
        $this->admin();
        $q = trim((string) ($req->query['q'] ?? ''));
        $page = max(1, (int) ($req->query['page'] ?? 1));
        $per = 25;
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
        $where = $q !== '' ? "WHERE u.email LIKE :q1 ESCAPE '!' OR u.name LIKE :q2 ESCAPE '!'" : '';
        $params = $q !== '' ? ['q1' => $like, 'q2' => $like] : [];
        $total = (int) $this->app->db->value("SELECT COUNT(*) FROM users u $where", $params);
        $rows = $this->app->db->all(
            "SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS project_count FROM users u $where ORDER BY u.created_at DESC LIMIT $per OFFSET " . (($page - 1) * $per),
            $params,
        );
        return [
            'total' => $total,
            'page' => $page,
            'pages' => max(1, (int) ceil($total / $per)),
            'users' => array_map(fn ($u) => Auth::publicUser($u) + ['projects' => (int) $u['project_count']], $rows),
        ];
    }

    public function updateUser(Request $req): array
    {
        $me = $this->admin();
        $id = $req->params['id'];
        $user = $this->app->db->one('SELECT * FROM users WHERE id = ?', [$id]) ?? throw HttpError::notFound('User');
        $errors = [];
        $plan = $req->input('plan');
        $role = $req->input('role');
        if ($plan !== null && !in_array($plan, self::PLANS, true)) {
            $errors['plan'] = 'Unknown plan.';
        }
        if ($role !== null && !in_array($role, self::ROLES, true)) {
            $errors['role'] = 'Unknown role.';
        }
        if ($role === 'user' && $id === $me['id']) {
            $errors['role'] = 'You cannot remove your own admin role.';
        }
        if ($errors) {
            throw HttpError::validation($errors);
        }
        $this->app->db->exec('UPDATE users SET plan = ?, role = ?, updated_at = ? WHERE id = ?', [$plan ?? $user['plan'], $role ?? $user['role'], now(), $id]);
        $user = $this->app->db->one('SELECT * FROM users WHERE id = ?', [$id]);
        return ['user' => Auth::publicUser($user)];
    }

    public function deleteUser(Request $req): array
    {
        $me = $this->admin();
        $id = $req->params['id'];
        if ($id === $me['id']) {
            throw new HttpError(422, 'self_delete', 'Delete your own account from the account page.');
        }
        $this->app->db->transaction(function () use ($id) {
            $this->app->db->exec('DELETE FROM versions WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', [$id]);
            $this->app->db->exec('DELETE FROM projects WHERE user_id = ?', [$id]);
            $this->app->db->exec('DELETE FROM tokens WHERE user_id = ?', [$id]);
            $this->app->db->exec('DELETE FROM user_settings WHERE user_id = ?', [$id]);
            $n = $this->app->db->exec('DELETE FROM users WHERE id = ?', [$id]);
            if (!$n) {
                throw HttpError::notFound('User');
            }
        });
        return ['ok' => true];
    }

    public function errors(): array
    {
        $this->admin();
        $rows = $this->app->db->all('SELECT * FROM client_errors ORDER BY created_at DESC LIMIT 100');
        return ['errors' => array_map(fn ($e) => ['id' => $e['id'], 'at' => (int) $e['created_at'], 'message' => $e['message'], 'stack' => $e['stack'], 'url' => $e['url'], 'userAgent' => $e['user_agent']], $rows)];
    }
}
