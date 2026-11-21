<?php
declare(strict_types=1);

namespace Cas\Controllers;

use Cas\App;
use Cas\Http\Request;
use Cas\Support;

use function Cas\now;

/**
 * Privacy-friendly telemetry: daily page-view counters per path (no cookies, no IP or user id
 * stored) and client-side error reports. Neither needs a cookie banner.
 */
final class TelemetryController
{
    public function __construct(private App $app)
    {
    }

    public static function normalizePath(string $path): string
    {
        $p = '/' . trim(preg_replace('~[?#].*$~', '', $path) ?? '', '/');
        // collapse ids and tokens so personal links are never stored
        $p = preg_replace('~^/(builder|s|reset|verify)/[^/]+~', '/$1/:id', $p) ?? $p;
        return substr($p, 0, 120);
    }

    public function pageview(Request $req): array
    {
        $this->app->limiter->hit('pv:' . $req->ip, 600, 3600);
        $path = self::normalizePath($req->string('path'));
        $day = gmdate('Y-m-d');
        $updated = $this->app->db->exec('UPDATE page_views SET views = views + 1 WHERE day = ? AND path = ?', [$day, $path]);
        if (!$updated) {
            try {
                $this->app->db->insert('page_views', ['day' => $day, 'path' => $path, 'views' => 1]);
            } catch (\PDOException) {
                $this->app->db->exec('UPDATE page_views SET views = views + 1 WHERE day = ? AND path = ?', [$day, $path]);
            }
        }
        return ['ok' => true];
    }

    public function error(Request $req): array
    {
        $this->app->limiter->hit('err:' . $req->ip, 30, 3600);
        $user = $this->app->auth->user();
        $this->app->db->insert('client_errors', [
            'id' => Support::id('e_'),
            'created_at' => now(),
            'message' => mb_substr($req->string('message') ?: 'Unknown error', 0, 500),
            'stack' => mb_substr((string) $req->input('stack', ''), 0, 4000) ?: null,
            'url' => mb_substr(self::normalizePath($req->string('url')), 0, 300) ?: null,
            'user_id' => $user['id'] ?? null,
            'user_agent' => mb_substr((string) ($req->header('user-agent') ?? ''), 0, 300) ?: null,
        ]);
        return ['ok' => true];
    }
}
