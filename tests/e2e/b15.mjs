import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8080/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/401|404|Failed to load/.test(m.text())) errors.push(m.text()); });
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/b15-fail-' + name.replace(/\W+/g,'_') + '.png' }); } };
writeFileSync('/tmp/orders.openapi.yaml', `openapi: 3.0.0
info: { title: Orders }
paths:
  /orders:
    get: { operationId: listOrders }
    post: { operationId: createOrder }
`);

await step('contract import from dashboard', async () => {
  await page.goto(base + '#/dashboard');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Import routes/ }).click()]);
  await fc.setFiles('/tmp/orders.openapi.yaml');
  await page.locator('.rest-ops').waitFor();
  await page.locator('.lane-head b', { hasText: 'list-orders' }).waitFor();
});
await step('rest inspector add operation', async () => {
  await page.locator('.rest-ops').click();
  await page.getByRole('button', { name: '+ Operation' }).click();
  await page.locator('.rest-op', { hasText: '/new' }).waitFor();
  await page.locator('.issue, .validation-summary').first().waitFor();
});
await step('circuit breaker block + fallback', async () => {
  await page.locator('.lane').filter({ hasText: 'list-orders' }).locator('.node.from').click();
  await page.locator('.palette .component', { hasText: /circuitBreaker/ }).click();
  await page.locator('.branch-label', { hasText: 'fallback' }).waitFor();
  await page.getByRole('tab', { name: 'route.yaml' }).click();
  await page.locator('.code-area pre', { hasText: 'onFallback' }).waitFor();
  await page.getByRole('tab', { name: 'route.java' }).click();
  await page.locator('.code-area pre', { hasText: 'circuitBreaker' }).waitFor();
});
await step('collapse block', async () => {
  await page.locator('.collapse-btn').first().click();
  await page.locator('.box.collapsed').waitFor();
  await page.locator('.collapse-btn').first().click();
});
await step('multi-select + copy + paste', async () => {
  const lane = page.locator('.lane').filter({ hasText: 'create-order' });
  const nodes = lane.locator('.node:not(.from)');
  const before = await nodes.count();
  await nodes.nth(0).click();
  await nodes.nth(1).click({ modifiers: ['Shift'] });
  await page.locator('.inspector h3', { hasText: '2 steps selected' }).waitFor();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const after = await nodes.count();
  if (after !== before + 2) throw new Error(`${before} -> ${after}`);
});
await step('arrow navigation', async () => {
  const lane = page.locator('.lane').filter({ hasText: 'create-order' });
  await lane.locator('.node:not(.from)').first().click();
  await page.keyboard.press('ArrowRight');
  await lane.locator('.node.selected').nth(0).waitFor();
});
await step('save snippet and reuse', async () => {
  const lane = page.locator('.lane').filter({ hasText: 'create-order' });
  await lane.locator('.node', { hasText: 'setBody' }).first().click();
  await page.getByRole('button', { name: /Save as snippet/ }).click();
  await page.locator('.snippet-name').first().waitFor();
  const n = await page.locator('.node', { hasText: 'setBody' }).count();
  await page.locator('.palette .component', { has: page.locator('.snippet-name') }).first().click();
  await page.waitForTimeout(200);
  if ((await page.locator('.node', { hasText: 'setBody' }).count()) !== n + 1) throw new Error('snippet not inserted');
});
await step('error handler with backoff timeline', async () => {
  await page.locator('.palette .component', { hasText: 'Error handler' }).click();
  await page.getByLabel('Exponential back-off').check();
  await page.locator('.timeline-bar .tl-attempt').nth(3).waitFor();
  await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/b15-timeline.png' });
});
await step('version diff', async () => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await page.locator('.palette .component', { hasText: /^≡ log$/ }).click();
  await page.getByRole('button', { name: /Versions/ }).click();
  await page.getByRole('button', { name: 'Compare' }).first().click();
  await page.locator('.diff .add').first().waitFor();
  await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/b15-diff.png' });
  await page.keyboard.press('Escape');
});
await step('pan canvas', async () => {
  const c = page.locator('main.canvas');
  await c.evaluate((el) => { el.scrollLeft = 0; });
  const box = await c.boundingBox();
  await page.mouse.move(box.x + box.width - 40, box.y + box.height - 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 240, box.y + box.height - 40, { steps: 5 });
  await page.mouse.up();
  const left = await c.evaluate((el) => el.scrollLeft);
  if (left <= 0) throw new Error('no pan, scrollLeft=' + left);
});
await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/b15-builder.png' });
console.log('errors', errors.length ? errors : 'none', 'fails', fails);
await b.close();
process.exit(fails || errors.length ? 1 : 0);
