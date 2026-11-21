// Czech UI screenshots into /tmp/shots: npm run build && node tests/e2e/screenshots.mjs
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
const tmp = mkdtempSync('/tmp/cas-shot-'); const port = 18900;
const config = tmp + '/config.php';
writeFileSync(config, `<?php return ['app_url' => 'http://127.0.0.1:${port}', 'debug' => true, 'db' => ['dsn' => 'sqlite:${tmp}/e2e.sqlite'], 'mail' => ['driver' => 'log'], 'session' => ['secure' => false], 'storage' => '${tmp}/storage', 'runner' => ['url' => 'http://127.0.0.1:${port + 1}', 'token' => 'test-runner-token-123', 'daily_runs' => ['free' => 50, 'pro' => null, 'team' => null]]];`);
const env = { ...process.env, CAS_CONFIG: config, E2E_CONFIG: config, BASE_URL: `http://127.0.0.1:${port}/` };
execFileSync('php', ['api/bin/migrate.php'], { env });
const s = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'dist', 'scripts/dev-router.php'], { env, stdio: 'ignore' });
const r = spawn('php', ['-S', `127.0.0.1:${port + 1}`, 'api/tests/fake-runner.php'], { env, stdio: 'ignore' });
await new Promise((x) => setTimeout(x, 600));
try { execFileSync('node', ['tests/e2e/screenshots-scenario.mjs'], { env, stdio: 'inherit' }); } finally { s.kill(); r.kill(); }
