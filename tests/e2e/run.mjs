// End-to-end browser tests against the built app + PHP API on a temporary SQLite database.
//   npm run build && npm run test:e2e        (needs PHP 8.2+ and `npx playwright install chromium`)
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'cas-e2e-'));
const port = 18000 + Math.floor(Math.random() * 1000);
const config = join(tmp, 'config.php');
writeFileSync(
  config,
  `<?php return ['app_url' => 'http://127.0.0.1:${port}', 'debug' => true, 'db' => ['dsn' => 'sqlite:${tmp}/e2e.sqlite'], 'mail' => ['driver' => 'log'], 'session' => ['secure' => false], 'storage' => '${tmp}/storage',
  'runner' => ['url' => 'http://127.0.0.1:${port + 1}', 'token' => 'test-runner-token-123', 'daily_runs' => ['free' => 50, 'pro' => null, 'team' => null]]];`,
);
const env = { ...process.env, CAS_CONFIG: config, E2E_CONFIG: config, BASE_URL: `http://127.0.0.1:${port}/`, E2E_TMP: tmp, E2E_STORAGE: `${tmp}/storage` };

execFileSync('php', ['api/bin/migrate.php'], { env, stdio: 'inherit' });
const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'dist', 'scripts/dev-router.php'], { env, stdio: 'ignore' });
// test double of the Java runner (see api/tests/fake-runner.php)
const runner = spawn('php', ['-S', `127.0.0.1:${port + 1}`, 'api/tests/fake-runner.php'], { env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

let failed = 0;
for (const scenario of ['smoke', 'fullstack', 'b15', 'pro']) {
  console.log(`\n▶ ${scenario}`);
  try {
    execFileSync('node', [`tests/e2e/${scenario}.mjs`], { env, stdio: 'inherit' });
  } catch {
    failed++;
  }
}
server.kill();
runner.kill();
console.log(failed ? `\n${failed} scenario(s) failed — screenshots in ${tmp}` : '\nAll e2e scenarios passed');
process.exit(failed ? 1 : 0);
