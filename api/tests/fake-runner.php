<?php
// Test double for the Java runner (used by api/tests and the e2e tests).
// It does NOT execute Camel: it reports a trace of every step id found in the YAML, in order,
// echoes the input as output and counts one message per mock endpoint.
header('Content-Type: application/json');
if (($_SERVER['HTTP_X_RUNNER_TOKEN'] ?? '') !== 'test-runner-token-123') {
    http_response_code(401);
    echo '{}';
    return;
}
$req = json_decode((string) file_get_contents('php://input'), true) ?: [];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/transform') {
    $ok = !str_contains($req['source'] ?? '', 'BROKEN');
    echo json_encode([
        'ok' => $ok,
        'output' => $ok ? '<result engine="fake-saxon">' . htmlspecialchars(substr($req['input'] ?? '', 0, 50)) . '</result>' : '',
        'messages' => ['fake message'],
        'durationMs' => 3,
        'trace' => !empty($req['trace']) ? [['line' => 2, 'column' => 5, 'instruction' => 'xsl:template', 'depth' => 0, 'tookMs' => 1], ['line' => 3, 'column' => 7, 'instruction' => 'xsl:value-of', 'depth' => 1, 'tookMs' => 0]] : null,
        'error' => $ok ? null : ['message' => 'XTSE0010: broken stylesheet', 'line' => 1],
    ]);
    return;
}
$yaml = (string) ($req['yaml'] ?? '');
preg_match_all('/^\s*(?:-\s+)?(\w+):\n\s+id: (\S+)/m', $yaml, $m, PREG_SET_ORDER);
$trace = [];
$t = 0;
$body = $req['input']['body'] ?? '';
$failed = null;
$m = array_values(array_filter($m, fn ($x) => $x[1] !== 'route'));
foreach ($m as $i => [$all, $type, $id]) {
    if ($failed) break;
    $trace[] = ['seq' => $i, 'nodeId' => $id, 'routeId' => 'route', 'label' => $type, 'atMs' => $t, 'tookMs' => 1, 'body' => $body, 'headers' => $req['input']['headers'] ?: (object) [], 'properties' => (object) [], 'exception' => null];
    $t += 1;
}
if (str_contains($yaml, 'throwException')) {
    $failed = 'java.net.SocketTimeoutException: Chaos: simulated timeout';
}
preg_match_all('/uri: (mock:[\w-]+)/', $yaml, $mm);
$mocks = array_map(fn ($u) => ['uri' => $u, 'count' => 1, 'bodies' => [$body]], array_values(array_unique($mm[1])));
echo json_encode(['ok' => $failed === null, 'durationMs' => $t + 2, 'trace' => $trace, 'output' => ['body' => $body, 'headers' => (object) []], 'error' => $failed, 'mocks' => $mocks, 'logs' => ['fake log']]);
