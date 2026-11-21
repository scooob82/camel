import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8080/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/fail-' + name.replace(/\W+/g,'_') + '.png' }); } };

await step('landing renders', async () => { await page.goto(base); await page.getByText('Not complexity.').waitFor(); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/landing.png', fullPage: false }); });
await step('open demo project', async () => { await page.getByRole('button', { name: 'Open the demo project' }).click(); await page.locator('.studio').waitFor(); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/builder.png' }); });
await step('select choice and see inspector', async () => { await page.locator('.box-head', { hasText: 'choice' }).first().click(); await page.locator('.inspector h3', { hasText: 'choice' }).waitFor(); });
await step('palette click adds log after selection', async () => {
  await page.locator('.node.from').first().click();
  const before = await page.locator('.node').count();
  await page.locator('.palette .component', { hasText: /^≡ log$/ }).click();
  const after = await page.locator('.node').count();
  if (after !== before + 1) throw new Error(`nodes ${before} -> ${after}`);
});
await step('edit log message in inspector', async () => {
  const input = page.locator('.inspector input').first();
  await input.fill('Hello ${body}');
  await page.locator('.node small', { hasText: 'Hello ${body}' }).waitFor();
});
await step('undo restores', async () => { await page.locator('body').click({ position: { x: 700, y: 870 } }).catch(()=>{}); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Undo' }).click(); });
await step('YAML tab shows route', async () => { await page.getByRole('tab', { name: 'route.yaml' }).click(); await page.locator('.code-area pre', { hasText: 'order-router' }).waitFor(); });
await step('edit YAML updates canvas', async () => {
  const ta = page.locator('.code-area textarea');
  const v = await ta.inputValue();
  await ta.fill(v.replace('id: order-router', 'id: renamed-router'));
  await page.locator('.lane-head b', { hasText: 'renamed-router' }).waitFor({ timeout: 3000 });
});
await step('invalid YAML shows error and keeps canvas', async () => {
  const ta = page.locator('.code-area textarea');
  await ta.fill('- route: [');
  await page.locator('.code-error').waitFor({ timeout: 3000 });
  if (!(await page.locator('.lane-head b', { hasText: 'renamed-router' }).count())) throw new Error('canvas lost');
});
await step('XML tab', async () => { await page.getByRole('tab', { name: 'route.xml' }).click(); await page.locator('.code-area pre', { hasText: '<choice>' }).waitFor(); });
await step('Java tab', async () => { await page.getByRole('tab', { name: 'route.java' }).click(); await page.locator('.code-area pre', { hasText: 'RouteBuilder' }).waitFor(); });
await step('Docs tab', async () => { await page.getByRole('tab', { name: 'Docs' }).click(); await page.locator('.docs-pane pre', { hasText: 'flowchart LR' }).waitFor(); });
await step('quick add via + connector', async () => {
  await page.locator('.lane').first().locator('.drop button').first().click({ force: true });
  await page.locator('.quick-add input').fill('split');
  await page.keyboard.press('Enter');
  await page.locator('.box-head', { hasText: 'split' }).waitFor();
});
await step('drag palette item into empty split', async () => {
  const src = page.locator('.palette .component', { hasText: /^ƒ setBody$/ });
  const dst = page.locator('.box', { hasText: 'split' }).locator('.drop.empty').first();
  await src.dragTo(dst);
  await page.locator('.box', { hasText: 'split' }).locator('.node', { hasText: 'setBody' }).waitFor({ timeout: 3000 });
});
await step('validation bar details', async () => { await page.mouse.up(); await page.locator('.validation-summary').click(); if (!(await page.locator('.issues').count())) await page.locator('.validation-summary').click(); await page.locator('.issue').first().waitFor(); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/builder2.png' }); });
await step('add error handler', async () => { await page.locator('.palette .component', { hasText: 'Error handler' }).click(); await page.locator('.lane-head .badge.ex').waitFor(); });
await step('export spring boot zip', async () => {
  await page.getByRole('button', { name: '↓ Export' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '↓ Download ZIP' }).click()]);
  await dl.saveAs(`${process.env.E2E_TMP ?? '/tmp'}/export.zip`);
});
await step('save version ctrl+s', async () => { await page.keyboard.press('Control+s'); await page.locator('.toast', { hasText: 'Version saved' }).waitFor(); });
await step('command palette', async () => { await page.keyboard.press('Control+k'); await page.locator('.palette-input').fill('projects'); await page.keyboard.press('Enter'); await page.locator('h1', { hasText: 'Projects' }).waitFor(); });
await step('dashboard lists project', async () => { await page.locator('.project h3', { hasText: 'Orders integration' }).waitFor(); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/dashboard.png' }); });
await step('persistence after reload', async () => { await page.reload(); await page.locator('.project h3', { hasText: 'Orders integration' }).waitFor(); });
await step('new project dialog from recipe', async () => {
  await page.getByRole('button', { name: '+ New project' }).first().click();
  await page.locator('.option', { hasText: 'Split & aggregate' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.locator('.lane-head b', { hasText: 'collect-prices' }).waitFor();
});
await step('kb list + recipe', async () => { await page.goto(base + '#/kb'); await page.locator('h1', { hasText: 'Knowledge Base' }).waitFor(); await page.goto(base + '#/kb/retry-and-redelivery'); await page.locator('h1', { hasText: 'Retry' }).waitFor(); await page.getByRole('tab', { name: 'Java DSL' }).click(); await page.locator('.code-area pre', { hasText: 'onException' }).waitFor(); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/recipe.png', fullPage: true }); });
await step('light theme', async () => { await page.goto(base + '#/dashboard'); await page.getByRole('button', { name: 'Switch to light mode' }).click(); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/light.png' }); });
await step('mobile landing', async () => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/mobile.png', fullPage: false }); });
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
