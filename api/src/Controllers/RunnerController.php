<?php
declare(strict_types=1);

namespace Cas\Controllers;

use Cas\App;
use Cas\Http\HttpError;
use Cas\Http\Request;

/**
 * Proxy to the Java sandbox runner (Run & Debug, Saxon transformations).
 * Browsers never talk to the runner; this checks the session, the plan and quotas first.
 */
final class RunnerController
{
    public function __construct(private App $app)
    {
    }

    private function configured(): bool
    {
        return (string) $this->app->config->get('runner.url') !== '' && (string) $this->app->config->get('runner.token') !== '';
    }

    /** Remaining runs today for the user, or null when unlimited. */
    private function quota(array $user): ?int
    {
        $limit = $this->app->config->get('runner.daily_runs.' . $user['plan']);
        return $limit === null ? null : (int) $limit;
    }

    public function status(): array
    {
        $user = $this->app->auth->user();
        return [
            'available' => $this->configured(),
            'signedIn' => $user !== null,
            'plan' => $user['plan'] ?? null,
            'dailyRuns' => $user ? $this->quota($user) : null,
        ];
    }

    private function guard(string $kind): array
    {
        $user = $this->app->auth->require();
        if (!$this->configured()) {
            throw new HttpError(503, 'runner_unavailable', 'The sandbox runner is not configured on this server.');
        }
        $quota = $this->quota($user);
        if ($quota === 0) {
            throw new HttpError(402, 'plan_required', 'Run & Debug is part of the Pro plan.');
        }
        if ($quota !== null) {
            $this->app->limiter->hit("runner-$kind:" . $user['id'], $quota, 86400);
        }
        $this->app->limiter->hit('runner-burst:' . $user['id'], 20, 60);
        return $user;
    }

    /** Returns the runner's JSON as objects so empty maps stay {} when re-encoded. */
    private function forward(string $path, array $body): object
    {
        $url = rtrim((string) $this->app->config->get('runner.url'), '/') . $path;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json', 'X-Runner-Token: ' . $this->app->config->get('runner.token')],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 25,
        ]);
        $res = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($res === false || $status === 0) {
            throw new HttpError(503, 'runner_unreachable', 'The sandbox runner is not reachable' . ($this->app->config->get('debug') ? ": $err" : '.'));
        }
        $data = json_decode((string) $res);
        if ($status !== 200 || !is_object($data)) {
            throw new HttpError(502, 'runner_error', "The sandbox runner failed (HTTP $status).");
        }
        return $data;
    }

    public function run(Request $req): object
    {
        $this->guard('run');
        $yaml = (string) $req->input('yaml', '');
        $input = $req->input('input', []);
        if ($yaml === '' || strlen($yaml) > 1000000 || !is_array($input)) {
            throw HttpError::validation(['yaml' => 'Routes are missing or too large.']);
        }
        return $this->forward('/run', [
            'yaml' => $yaml,
            'start' => (string) $req->input('start', 'direct:cas-start'),
            'input' => ['body' => (string) ($input['body'] ?? ''), 'headers' => is_array($input['headers'] ?? null) ? array_map('strval', $input['headers']) : (object) []],
            'timeoutMs' => min(15000, max(500, (int) $req->input('timeoutMs', 5000))),
        ]);
    }

    public function transform(Request $req): object
    {
        $this->guard('transform');
        $kind = $req->input('kind') === 'xquery' ? 'xquery' : 'xslt';
        $source = (string) $req->input('source', '');
        $input = (string) $req->input('input', '');
        if ($source === '' || strlen($source) > 1000000 || strlen($input) > 2000000) {
            throw HttpError::validation(['source' => 'Transformation or input is missing or too large.']);
        }
        $params = $req->input('params', []);
        return $this->forward('/transform', [
            'kind' => $kind,
            'source' => $source,
            'input' => $input,
            'params' => is_array($params) && $params ? array_map('strval', $params) : (object) [],
            'trace' => (bool) $req->input('trace', false),
        ]);
    }
}
