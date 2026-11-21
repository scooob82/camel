<?php
declare(strict_types=1);

namespace Cas;

use Cas\Controllers\AccountController;
use Cas\Controllers\AdminController;
use Cas\Controllers\SettingsController;
use Cas\Controllers\TelemetryController;
use Cas\Controllers\AuthController;
use Cas\Controllers\ProjectController;
use Cas\Controllers\RunnerController;
use Cas\Http\HttpError;
use Cas\Http\Request;
use Cas\Http\Router;

final class App
{
    public readonly Db $db;
    public readonly Session $session;
    public readonly Auth $auth;
    public readonly RateLimiter $limiter;
    public readonly Mailer $mailer;

    public function __construct(public readonly Config $config)
    {
        $this->db = new Db($config);
        $this->session = new Session($config);
        $this->auth = new Auth($this->db, $this->session);
        $this->limiter = new RateLimiter($this->db);
        $this->mailer = new Mailer($config);
    }

    private function routes(): Router
    {
        $r = new Router();
        $auth = new AuthController($this);
        $account = new AccountController($this);
        $projects = new ProjectController($this);
        $admin = new AdminController($this);
        $settings = new SettingsController($this);
        $telemetry = new TelemetryController($this);
        $runner = new RunnerController($this);

        $r->add('GET', '/v1/health', fn () => ['ok' => true, 'time' => now()]);
        $r->add('POST', '/v1/setup/migrate', [$this, 'webMigrate']);

        $r->add('GET', '/v1/auth/csrf', [$auth, 'csrf']);
        $r->add('GET', '/v1/auth/me', [$auth, 'me']);
        $r->add('POST', '/v1/auth/register', [$auth, 'register']);
        $r->add('POST', '/v1/auth/login', [$auth, 'login']);
        $r->add('POST', '/v1/auth/logout', [$auth, 'logout']);
        $r->add('POST', '/v1/auth/verify', [$auth, 'verify']);
        $r->add('POST', '/v1/auth/resend-verification', [$auth, 'resendVerification']);
        $r->add('POST', '/v1/auth/forgot', [$auth, 'forgot']);
        $r->add('POST', '/v1/auth/reset', [$auth, 'reset']);

        $r->add('PATCH', '/v1/account', [$account, 'update']);
        $r->add('POST', '/v1/account/password', [$account, 'password']);
        $r->add('GET', '/v1/account/export', [$account, 'export']);
        $r->add('DELETE', '/v1/account', [$account, 'delete']);

        $r->add('GET', '/v1/projects', [$projects, 'list']);
        $r->add('POST', '/v1/projects', [$projects, 'create']);
        $r->add('GET', '/v1/projects/{id}', [$projects, 'show']);
        $r->add('PUT', '/v1/projects/{id}', [$projects, 'update']);
        $r->add('DELETE', '/v1/projects/{id}', [$projects, 'delete']);
        $r->add('POST', '/v1/projects/{id}/versions', [$projects, 'addVersion']);
        $r->add('DELETE', '/v1/projects/{id}/versions/{vid}', [$projects, 'deleteVersion']);
        $r->add('POST', '/v1/projects/{id}/share', [$projects, 'share']);
        $r->add('DELETE', '/v1/projects/{id}/share', [$projects, 'unshare']);
        $r->add('GET', '/v1/shared/{token}', [$projects, 'shared']);

        $r->add('GET', '/v1/settings/snippets', [$settings, 'snippets']);
        $r->add('PUT', '/v1/settings/snippets', [$settings, 'saveSnippets']);

        $r->add('POST', '/v1/telemetry/pageview', [$telemetry, 'pageview']);
        $r->add('POST', '/v1/telemetry/error', [$telemetry, 'error']);

        $r->add('GET', '/v1/runner/status', [$runner, 'status']);
        $r->add('POST', '/v1/runner/run', [$runner, 'run']);
        $r->add('POST', '/v1/runner/transform', [$runner, 'transform']);

        $r->add('GET', '/v1/admin/stats', [$admin, 'stats']);
        $r->add('GET', '/v1/admin/users', [$admin, 'users']);
        $r->add('PATCH', '/v1/admin/users/{id}', [$admin, 'updateUser']);
        $r->add('DELETE', '/v1/admin/users/{id}', [$admin, 'deleteUser']);
        $r->add('GET', '/v1/admin/errors', [$admin, 'errors']);
        return $r;
    }

    /** @return array{int, array|object} */
    public function handle(Request $req): array
    {
        try {
            $match = $this->routes()->match($req);
            if (!$match) {
                throw HttpError::notFound('Endpoint');
            }
            [$handler] = $match;
            $this->session->start($req);
            if ($req->isMutating()) {
                $ct = strtolower($req->header('content-type') ?? '');
                if ($req->body !== '' && !str_starts_with($ct, 'application/json')) {
                    throw new HttpError(415, 'unsupported_media_type', 'Send JSON.');
                }
                if ($req->path !== '/v1/setup/migrate') {
                    $this->session->verifyCsrf($req);
                }
            }
            $result = $handler($req);
            return [200, $result ?? ['ok' => true]];
        } catch (HttpError $e) {
            $err = ['code' => $e->errorCode, 'message' => $e->getMessage()];
            if ($e->fields) {
                $err['fields'] = $e->fields;
            }
            return [$e->status, ['error' => $err]];
        } catch (\Throwable $e) {
            error_log('[api] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            $msg = $this->config->get('debug') ? $e->getMessage() : 'Something went wrong on our side.';
            return [500, ['error' => ['code' => 'server_error', 'message' => $msg]]];
        }
    }

    public function run(): void
    {
        $req = Request::fromGlobals();
        [$status, $body] = $this->handle($req);
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Run migrations over HTTP when the hosting has no usable shell: needs config setup_token. */
    public function webMigrate(Request $req): array
    {
        $token = (string) $this->config->get('setup_token');
        if ($token === '' || !hash_equals($token, (string) ($req->header('x-setup-token') ?? ''))) {
            throw new HttpError(403, 'forbidden', 'Setup is disabled or the token is wrong.');
        }
        return ['applied' => $this->db->migrate()];
    }

    public function limits(array $user): array
    {
        $plan = (string) $user['plan'];
        return (array) ($this->config->get("limits.$plan") ?? $this->config->get('limits.free'));
    }

    public function link(string $hashPath): string
    {
        return rtrim((string) $this->config->get('app_url'), '/') . '/#' . $hashPath;
    }
}
