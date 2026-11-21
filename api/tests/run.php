<?php
declare(strict_types=1);

/*
 * End-to-end API tests against a real PHP built-in server and a temporary SQLite DB.
 *   php api/tests/run.php
 */

$root = dirname(__DIR__);
$tmp = sys_get_temp_dir() . '/cas-test-' . bin2hex(random_bytes(4));
mkdir($tmp, 0777, true);
$port = random_int(20000, 40000);
$configFile = "$tmp/config.php";
file_put_contents($configFile, '<?php return ' . var_export([
    'app_url' => "http://127.0.0.1:$port",
    'debug' => true,
    'db' => ['dsn' => "sqlite:$tmp/test.sqlite"],
    'mail' => ['driver' => 'log'],
    'session' => ['secure' => false],
    'storage' => "$tmp/storage",
    'setup_token' => 'setup-secret',
    'limits' => ['free' => ['projects' => 3, 'versions' => 2, 'project_bytes' => 20000]],
    'runner' => ['url' => 'http://127.0.0.1:' . ($port + 1), 'token' => 'test-runner-token-123', 'daily_runs' => ['free' => 2, 'pro' => null, 'team' => null]],
], true) . ';');
putenv("CAS_CONFIG=$configFile");

$router = "$tmp/router.php";
file_put_contents($router, '<?php $_SERVER["SCRIPT_NAME"] = "/api/index.php"; require ' . var_export("$root/index.php", true) . ';');
$cmd = sprintf('CAS_CONFIG=%s php -S 127.0.0.1:%d %s > %s 2>&1 & echo $!', escapeshellarg($configFile), $port, escapeshellarg($router), escapeshellarg("$tmp/server.log"));
$pid = (int) shell_exec($cmd);
register_shutdown_function(static function () use ($pid, $tmp) {
    if ($pid) {
        posix_kill($pid, SIGTERM);
    }
    shell_exec('rm -rf ' . escapeshellarg($tmp));
});
$rpid = (int) shell_exec(sprintf('php -S 127.0.0.1:%d %s > /dev/null 2>&1 & echo $!', $port + 1, escapeshellarg(__DIR__ . '/fake-runner.php')));
register_shutdown_function(static fn () => $rpid && posix_kill($rpid, SIGTERM));
usleep(400000);

$failures = 0;
$passed = 0;
function check(bool $cond, string $name, mixed $detail = null): void
{
    global $failures, $passed;
    if ($cond) {
        $passed++;
        echo "ok   $name\n";
    } else {
        $failures++;
        echo "FAIL $name" . ($detail !== null ? ' — ' . json_encode($detail) : '') . "\n";
    }
}

final class Client
{
    public string $csrf = '';
    private string $jar;

    public function __construct(private int $port, string $tmp)
    {
        $this->jar = "$tmp/cookies-" . bin2hex(random_bytes(3));
    }

    /** @return array{int, array} */
    public function call(string $method, string $path, ?array $body = null, array $headers = []): array
    {
        $ch = curl_init("http://127.0.0.1:{$this->port}/api$path");
        $h = array_merge(['Accept: application/json'], $headers);
        if ($this->csrf !== '') {
            $h[] = 'X-CSRF-Token: ' . $this->csrf;
        }
        if ($body !== null) {
            $h[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $h,
            CURLOPT_COOKIEJAR => $this->jar,
            CURLOPT_COOKIEFILE => $this->jar,
        ]);
        $res = (string) curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $json = json_decode($res, true) ?? ['raw' => $res];
        if (isset($json['csrf'])) {
            $this->csrf = $json['csrf'];
        }
        return [$status, $json];
    }

    public function init(): void
    {
        [, $r] = $this->call('GET', '/v1/auth/csrf');
        $this->csrf = $r['token'];
    }
}

function lastMailToken(string $tmp, string $kind): ?string
{
    $files = glob("$tmp/storage/mail/*.eml") ?: [];
    usort($files, fn ($a, $b) => filemtime($a) <=> filemtime($b) ?: strcmp($a, $b));
    foreach (array_reverse($files) as $f) {
        if (preg_match('~#/' . $kind . '/([A-Za-z0-9_-]+)~', (string) file_get_contents($f), $m)) {
            return $m[1];
        }
    }
    return null;
}

$file = ['routes' => [['id' => 'r1', 'kind' => 'route', 'routeId' => 'a', 'from' => ['uri' => 'timer:t'], 'steps' => []]], 'onExceptions' => []];

// ------------------------------------------------------------------ setup
$a = new Client($port, $tmp);
[$s, $r] = $a->call('POST', '/v1/setup/migrate', [], ['X-Setup-Token: wrong']);
check($s === 403, 'web migrate rejects wrong token', $r);
[$s, $r] = $a->call('POST', '/v1/setup/migrate', [], ['X-Setup-Token: setup-secret']);
check($s === 200 && $r['applied'] === ['001_init', '002_admin_telemetry'], 'web migrate applies schema', $r);
[$s, $r] = $a->call('GET', '/v1/health');
check($s === 200 && $r['ok'] === true, 'health');
[$s] = $a->call('GET', '/v1/nope');
check($s === 404, '404 for unknown endpoint');

// ------------------------------------------------------------------ auth
[$s, $r] = $a->call('GET', '/v1/auth/me');
check($s === 200 && $r['user'] === null, 'me: anonymous');
$a->csrf = '';
[$s] = $a->call('POST', '/v1/auth/register', ['email' => 'x@example.com', 'password' => 'long-enough-1']);
check($s === 419, 'register without CSRF is rejected');
$a->init();
[$s, $r] = $a->call('POST', '/v1/auth/register', ['email' => 'bad', 'password' => 'short']);
check($s === 422 && isset($r['error']['fields']['email'], $r['error']['fields']['password']), 'register validation', $r);
[$s, $r] = $a->call('POST', '/v1/auth/register', ['email' => 'Alice@Example.com', 'name' => 'Alice', 'password' => 'correct horse 1']);
check($s === 200 && $r['user']['email'] === 'alice@example.com' && $r['user']['emailVerified'] === false, 'register creates user and signs in', $r);
[$s, $r] = $a->call('POST', '/v1/auth/register', ['email' => 'alice@example.com', 'password' => 'correct horse 1']);
check($s === 422 && isset($r['error']['fields']['email']), 'duplicate e-mail rejected');
[$s, $r] = $a->call('GET', '/v1/auth/me');
check($r['user']['name'] === 'Alice', 'me: signed in');

$verify = lastMailToken($tmp, 'verify');
check($verify !== null, 'verification e-mail sent');
[$s, $r] = $a->call('POST', '/v1/auth/verify', ['token' => $verify]);
check($s === 200 && $r['user']['emailVerified'] === true, 'verify e-mail', $r);
[$s] = $a->call('POST', '/v1/auth/verify', ['token' => $verify]);
check($s === 422, 'verification token is single-use');

[$s, $r] = $a->call('POST', '/v1/auth/logout', []);
check($s === 200, 'logout');
[, $r] = $a->call('GET', '/v1/auth/me');
check($r['user'] === null, 'me after logout');
[$s, $r] = $a->call('POST', '/v1/auth/login', ['email' => 'alice@example.com', 'password' => 'wrong password']);
check($s === 422 && $r['error']['code'] === 'invalid_credentials', 'login with wrong password');
[$s, $r] = $a->call('POST', '/v1/auth/login', ['email' => 'ALICE@example.com', 'password' => 'correct horse 1']);
check($s === 200 && $r['user']['email'] === 'alice@example.com', 'login', $r);

// ------------------------------------------------------------------ projects
[$s, $r] = $a->call('POST', '/v1/projects', ['id' => 'p_local123', 'name' => 'Orders', 'file' => $file, 'createdAt' => 1700000000000, 'versions' => [['id' => 'v_old1', 'label' => 'first', 'file' => $file, 'at' => 1700000000001]]]);
check($s === 200 && $r['project']['id'] === 'p_local123' && count($r['project']['versions']) === 1 && $r['project']['createdAt'] === 1700000000000, 'create project with client id and versions (migration)', $r);
[$s, $r] = $a->call('POST', '/v1/projects', ['name' => '', 'file' => $file]);
check($s === 422, 'project name required');
[$s, $r] = $a->call('POST', '/v1/projects', ['name' => 'Bad', 'file' => ['nope' => 1]]);
check($s === 422 && isset($r['error']['fields']['file']), 'project file shape validated');
[$s, $r] = $a->call('POST', '/v1/projects', ['name' => 'Big', 'file' => $file + ['extras' => [str_repeat('x', 30000)]]]);
check($s === 413, 'project size limit');
[$s, $r] = $a->call('GET', '/v1/projects');
check($s === 200 && count($r['projects']) === 1 && $r['projects'][0]['file']['routes'][0]['routeId'] === 'a', 'list projects', $r);

$file2 = $file;
$file2['routes'][0]['routeId'] = 'b';
[$s, $r] = $a->call('PUT', '/v1/projects/p_local123', ['file' => $file2, 'name' => 'Orders 2', 'baseRevision' => 1]);
check($s === 200 && $r['revision'] === 2, 'update project bumps revision', $r);
[$s, $r] = $a->call('PUT', '/v1/projects/p_local123', ['file' => $file, 'baseRevision' => 1]);
check($s === 409, 'stale revision → 409 conflict', $r);
[$s, $r] = $a->call('PUT', '/v1/projects/p_local123', ['openedAt' => 1700000000500]);
check($s === 200 && $r['revision'] === 2, 'touch openedAt does not bump revision', $r);
[, $r] = $a->call('GET', '/v1/projects/p_local123');
check($r['project']['name'] === 'Orders 2' && $r['project']['file']['routes'][0]['routeId'] === 'b', 'show project');

[$s, $r] = $a->call('POST', '/v1/projects/p_local123/versions', ['label' => 'v2', 'file' => $file2]);
check($s === 200 && $r['version']['label'] === 'v2', 'add version');
[$s, $r] = $a->call('POST', '/v1/projects/p_local123/versions', ['label' => 'v3', 'file' => $file2]);
[, $r] = $a->call('GET', '/v1/projects/p_local123');
check(count($r['project']['versions']) === 2 && $r['project']['versions'][0]['label'] === 'v3', 'versions capped to plan limit (newest kept)', array_column($r['project']['versions'], 'label'));
$vid = $r['project']['versions'][1]['id'];
[$s] = $a->call('DELETE', "/v1/projects/p_local123/versions/$vid");
check($s === 200, 'delete version');

[$s, $r] = $a->call('POST', '/v1/projects/p_local123/share', []);
check($s === 200 && str_contains($r['url'], '/#/s/'), 'share project', $r);
$token = $r['token'];
$anon = new Client($port, $tmp);
[$s, $r] = $anon->call('GET', "/v1/shared/$token");
check($s === 200 && $r['project']['name'] === 'Orders 2' && $r['project']['owner'] === 'Alice', 'anonymous can read shared project', $r);
[$s] = $anon->call('GET', '/v1/projects');
check($s === 401, 'anonymous cannot list projects');

// ------------------------------------------------------------------ isolation
$b = new Client($port, $tmp);
$b->init();
$b->call('POST', '/v1/auth/register', ['email' => 'bob@example.com', 'password' => 'another pass 2']);
[$s] = $b->call('GET', '/v1/projects/p_local123');
check($s === 404, 'other user cannot read the project');
[$s] = $b->call('PUT', '/v1/projects/p_local123', ['name' => 'hacked']);
check($s === 404, 'other user cannot update the project');
[$s, $r] = $b->call('POST', '/v1/projects', ['id' => 'p_local123', 'name' => 'Clash', 'file' => $file]);
check($s === 200 && $r['project']['id'] !== 'p_local123', 'taken client id is replaced');

[$s] = $a->call('DELETE', '/v1/projects/p_local123/share');
[$s] = $anon->call('GET', "/v1/shared/$token");
check($s === 404, 'unshared link stops working');

// ------------------------------------------------------------------ limits
$a->call('POST', '/v1/projects', ['name' => 'P2', 'file' => $file]);
$a->call('POST', '/v1/projects', ['name' => 'P3', 'file' => $file]);
[$s, $r] = $a->call('POST', '/v1/projects', ['name' => 'P4', 'file' => $file]);
check($s === 403 && $r['error']['code'] === 'limit_reached', 'plan project limit', $r);

// ------------------------------------------------------------------ password reset
$c = new Client($port, $tmp);
$c->init();
[$s] = $c->call('POST', '/v1/auth/forgot', ['email' => 'nobody@example.com']);
check($s === 200, 'forgot: unknown e-mail gets the same answer');
[$s] = $c->call('POST', '/v1/auth/forgot', ['email' => 'alice@example.com']);
$reset = lastMailToken($tmp, 'reset');
check($s === 200 && $reset !== null, 'forgot: reset e-mail sent');
[$s, $r] = $c->call('POST', '/v1/auth/reset', ['token' => $reset, 'password' => 'brand new pass 3']);
check($s === 200 && $r['user']['email'] === 'alice@example.com', 'reset password signs in', $r);
[, $r] = $a->call('GET', '/v1/auth/me');
check($r['user'] === null, 'reset signs out other sessions');
[$s] = $c->call('POST', '/v1/auth/reset', ['token' => $reset, 'password' => 'brand new pass 4']);
check($s === 422, 'reset token is single-use');

// ------------------------------------------------------------------ account
[$s, $r] = $c->call('PATCH', '/v1/account', ['name' => 'Alice B.']);
check($s === 200 && $r['user']['name'] === 'Alice B.', 'update account name');
[$s, $r] = $c->call('POST', '/v1/account/password', ['current' => 'wrong', 'password' => 'x']);
check($s === 422 && isset($r['error']['fields']['current'], $r['error']['fields']['password']), 'change password validation');
[$s] = $c->call('POST', '/v1/account/password', ['current' => 'brand new pass 3', 'password' => 'final password 5']);
check($s === 200, 'change password');
[, $r] = $c->call('GET', '/v1/auth/me');
check($r['user'] !== null, 'session kept after own password change');
[$s, $r] = $c->call('GET', '/v1/account/export');
check($s === 200 && count($r['projects']) === 3, 'GDPR export', count($r['projects'] ?? []));
[$s] = $c->call('DELETE', '/v1/account', ['password' => 'nope']);
check($s === 422, 'delete account needs password');
[$s] = $c->call('DELETE', '/v1/account', ['password' => 'final password 5']);
check($s === 200, 'delete account');
[$s, $r] = $c->call('POST', '/v1/auth/login', ['email' => 'alice@example.com', 'password' => 'final password 5']);
check($s === 422, 'deleted account cannot log in');

// ------------------------------------------------------------------ rate limit & misc
$d = new Client($port, $tmp);
$d->init();
$codes = [];
for ($i = 0; $i < 9; $i++) {
    [$codes[]] = $d->call('POST', '/v1/auth/login', ['email' => 'bob@example.com', 'password' => 'wrong']);
}
check(end($codes) === 429, 'login rate limit', $codes);
$ch = curl_init("http://127.0.0.1:$port/api/v1/auth/logout");
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => 'a=b', CURLOPT_RETURNTRANSFER => true]);
curl_exec($ch);
check(curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 415, 'form-encoded body rejected (JSON only)');

// ------------------------------------------------------------------ admin, telemetry, settings
[$s] = $b->call('GET', '/v1/admin/stats');
check($s === 403, 'admin endpoints need admin role');
shell_exec(sprintf('CAS_CONFIG=%s php %s bob@example.com', escapeshellarg($configFile), escapeshellarg("$root/bin/make-admin.php")));
[$s, $r] = $b->call('GET', '/v1/admin/stats');
check($s === 200 && $r['users'] >= 1 && isset($r['plans'], $r['pageViews']), 'admin stats', $r);
[$s, $r] = $b->call('GET', '/v1/admin/users?q=bob');
check($s === 200 && $r['total'] === 1 && $r['users'][0]['email'] === 'bob@example.com' && $r['users'][0]['role'] === 'admin', 'admin user search', $r);
$bobId = $r['users'][0]['id'];
[$s, $r] = $b->call('PATCH', "/v1/admin/users/$bobId", ['plan' => 'pro']);
check($s === 200 && $r['user']['plan'] === 'pro', 'admin changes plan', $r);
[$s, $r] = $b->call('PATCH', "/v1/admin/users/$bobId", ['role' => 'user']);
check($s === 422, 'admin cannot remove own admin role');
[$s] = $b->call('PATCH', "/v1/admin/users/$bobId", ['plan' => 'gold']);
check($s === 422, 'unknown plan rejected');
[$s] = $b->call('DELETE', "/v1/admin/users/$bobId");
check($s === 422, 'admin cannot delete self via admin API');

[$s] = $anon->call('POST', '/v1/telemetry/pageview', ['path' => '/builder/p_secret123']);
check($s === 419, 'telemetry needs CSRF like any write');
$anon->init();
$anon->call('POST', '/v1/telemetry/pageview', ['path' => '/builder/p_secret123']);
$anon->call('POST', '/v1/telemetry/pageview', ['path' => '/builder/p_other']);
[$s] = $anon->call('POST', '/v1/telemetry/error', ['message' => 'TypeError: x is undefined', 'stack' => 'at foo', 'url' => '/s/sharetoken']);
check($s === 200, 'client error report');
[, $r] = $b->call('GET', '/v1/admin/stats');
$top = array_column($r['topPaths'], 'views', 'path');
check(($top['/builder/:id'] ?? 0) === 2 && !isset($top['/builder/p_secret123']), 'page views aggregated without ids', $r['topPaths']);
[, $r] = $b->call('GET', '/v1/admin/errors');
check($r['errors'][0]['message'] === 'TypeError: x is undefined' && $r['errors'][0]['url'] === '/s/:id', 'admin sees client errors (tokens stripped)', $r['errors'][0] ?? null);

[$s, $r] = $b->call('GET', '/v1/settings/snippets');
check($s === 200 && $r['snippets'] === [], 'snippets empty by default');
[$s] = $b->call('PUT', '/v1/settings/snippets', ['snippets' => [['id' => 'snip1', 'name' => 'log', 'createdAt' => 1, 'step' => ['id' => 's', 'type' => 'log', 'props' => ['message' => 'x']]]]]);
[, $r] = $b->call('GET', '/v1/settings/snippets');
check($s === 200 && $r['snippets'][0]['name'] === 'log', 'snippets saved to account');
[$s] = $b->call('PUT', '/v1/settings/snippets', ['snippets' => ['a' => 1]]);
check($s === 422, 'snippets must be a list');

// ------------------------------------------------------------------ runner proxy
[$s, $r] = $anon->call('GET', '/v1/runner/status');
check($s === 200 && $r['available'] === true && $r['signedIn'] === false, 'runner status (anonymous)', $r);
[$s] = $anon->call('POST', '/v1/runner/run', ['yaml' => 'x', 'input' => ['body' => '']]);
check($s === 401, 'runner needs sign-in');
$e = new Client($port, $tmp);
$e->init();
$e->call('POST', '/v1/auth/register', ['email' => 'eve@example.com', 'password' => 'eve password 77']);
$yaml = "- route:
    id: r
    from:
      uri: direct:cas-start
      steps:
        - log:
            id: s_1
            message: hi
        - to:
            id: s_2
            uri: mock:out
";
[$s, $r] = $e->call('POST', '/v1/runner/run', ['yaml' => $yaml, 'start' => 'direct:cas-start', 'input' => ['body' => 'hello', 'headers' => ['a' => 'b']]]);
check($s === 200 && $r['ok'] === true && array_column($r['trace'], 'nodeId') === ['s_1', 's_2'] && $r['mocks'][0]['uri'] === 'mock:out', 'run is forwarded to the runner', $r);
[$s, $r] = $e->call('POST', '/v1/runner/transform', ['kind' => 'xslt', 'source' => '<xsl:stylesheet/>', 'input' => '<a/>', 'trace' => true]);
check($s === 200 && $r['ok'] === true && count($r['trace']) === 2, 'transform is forwarded to the runner', $r);
[$s] = $e->call('POST', '/v1/runner/run', ['yaml' => $yaml, 'input' => ['body' => '']]);
[$s, $r] = $e->call('POST', '/v1/runner/run', ['yaml' => $yaml, 'input' => ['body' => '']]);
check($s === 429, 'free plan daily run quota', $r);

$log = (string) @file_get_contents("$tmp/server.log");
check(!preg_match('/PHP (Warning|Notice|Deprecated|Fatal)/', $log), 'no PHP warnings in server log', substr($log, 0, 500));

echo "\n$passed passed, $failures failed\n";
exit($failures ? 1 : 0);
