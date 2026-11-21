// Admin, Run & Debug (against the runner test double), beans/route configurations, Transformation Lab.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8080/';
const tmp = process.env.E2E_TMP ?? '/tmp';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/40[1-9]|Failed to load/.test(m.text())) errors.push(m.text()); });
let fails = 0;
const step = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: `${tmp}/pro-fail-${name.replace(/\W+/g, '_')}.png` }); }
};
const email = `admin${Date.now()}@example.com`;
const XSD1 = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="order"><xs:complexType><xs:sequence><xs:element name="id" type="xs:string"/><xs:element name="fax" type="xs:string" minOccurs="0"/></xs:sequence></xs:complexType></xs:element></xs:schema>`;
const XSD2 = XSD1.replace('<xs:element name="fax" type="xs:string" minOccurs="0"/>', '<xs:element name="email" type="xs:string"/>');

await step('register + become admin', async () => {
  await page.goto(base + '#/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('a long password 9');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('h1', { hasText: 'Projects' }).waitFor();
  execFileSync('php', ['api/bin/make-admin.php', email], { env: { ...process.env, CAS_CONFIG: process.env.E2E_CONFIG } });
  await page.reload();
  await page.goto(base + '#/admin');
  await page.locator('h1', { hasText: 'Admin' }).waitFor();
  await page.locator('.stat b').first().waitFor();
  await page.getByRole('tab', { name: 'Users' }).click();
  await page.locator('td b', { hasText: email }).waitFor();
  await page.screenshot({ path: `${tmp}/pro-admin.png` });
});
await step('run & debug with trace, coverage, replay, junit', async () => {
  await page.goto(base + '#/dashboard');
  await page.getByRole('button', { name: '+ New project' }).first().click();
  await page.locator('.option', { hasText: 'Content-Based Router' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.locator('.studio').waitFor();
  await page.getByRole('tab', { name: '▶ Run' }).click();
  await page.getByRole('button', { name: '▶ Run' }).click();
  await page.locator('.trace-item').first().waitFor();
  await page.locator('.node.visited').first().waitFor();
  await page.getByText(/Coverage \d+%/).waitFor();
  await page.locator('.trace-item').nth(1).click();
  await page.locator('.node.current, .box-head.current').first().waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Generate JUnit test/ }).click()]);
  if (!(await dl.suggestedFilename()).endsWith('RouteTest.java')) throw new Error('junit name ' + (await dl.suggestedFilename()));
  await page.screenshot({ path: `${tmp}/pro-run.png` });
});
await step('breakpoint + chaos fault', async () => {
  await page.locator('.node:not(.from)').first().click();
  await page.getByRole('button', { name: /Breakpoint on selected step/ }).click();
  await page.locator('.node.bp').first().waitFor();
  await page.getByRole('button', { name: /Fault before selected step/ }).click();
  await page.getByRole('button', { name: '▶ Run' }).click();
  await page.locator('.run-result .form-error', { hasText: 'Chaos' }).waitFor();
});
await step('beans + route configuration', async () => {
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.locator('.palette .component', { hasText: 'Route configuration' }).click();
  await page.locator('.lane-head .badge.cfg', { hasText: 'routeConfiguration' }).waitFor();
  await page.locator('.palette .component', { hasText: /^☕ Bean/ }).click();
  await page.locator('.bean-list').waitFor();
  await page.getByRole('tab', { name: 'route.yaml' }).click();
  await page.locator('.code-area pre', { hasText: 'routeConfiguration' }).waitFor();
  await page.locator('.code-area pre', { hasText: '- beans:' }).waitFor();
  await page.getByRole('tab', { name: 'route.xml' }).click();
  await page.locator('.code-area pre', { hasText: '<camel xmlns' }).waitFor();
});
await step('lab: transform + profile', async () => {
  await page.goto(base + '#/lab');
  const browserXslt = await page.evaluate(() => typeof XSLTProcessor !== 'undefined');
  if (browserXslt) {
    await page.getByLabel('Engine').selectOption('browser');
    await page.getByRole('button', { name: '▶ Run' }).click();
    await page.locator('.code-area pre', { hasText: '<invoice' }).first().waitFor();
    await page.getByRole('button', { name: /Profile/ }).click();
    await page.getByText(/25 runs · average/).waitFor();
  } else {
    // recent Chromium dropped XSLTProcessor: the lab must default to Saxon
    if ((await page.getByLabel('Engine').inputValue()) !== 'saxon-xslt') throw new Error('engine did not switch to Saxon');
    await page.getByRole('button', { name: /Profile/ }).click();
    await page.locator('.tbl th', { hasText: 'Instruction' }).waitFor();
  }
});
await step('lab: mapper → XSLT', async () => {
  await page.getByRole('tab', { name: 'Mapper' }).click();
  await page.getByRole('button', { name: /Generate XSLT/ }).click();
  await page.locator('.code-area pre', { hasText: 'xsl:for-each select="/order/line"' }).first().waitFor();
  await page.getByRole('button', { name: '▶ Run' }).click();
  await page.locator('.lab-pane .c-ok').first().waitFor();
});
await step('lab: Saxon engine + debugger (runner double)', async () => {
  await page.getByLabel('Engine').selectOption('saxon-xslt');
  await page.getByRole('button', { name: '▶ Run' }).click();
  await page.locator('.code-area pre', { hasText: 'fake-saxon' }).first().waitFor();
  await page.getByRole('button', { name: /Debug/ }).click();
  await page.getByText(/Continue to breakpoint/).waitFor();
  await page.locator('.gutter .active').waitFor();
});
await step('lab: JSON ⇄ XML', async () => {
  await page.getByRole('tab', { name: 'JSON ⇄ XML' }).click();
  await page.locator('.code-area pre', { hasText: '<order id="A-100">' }).waitFor();
});
await step('lab: schema diff + test data', async () => {
  await page.getByRole('tab', { name: 'Schemas' }).click();
  const tas = page.locator('.code-area textarea');
  await tas.nth(0).fill(XSD1);
  await tas.nth(1).fill(XSD2);
  await page.getByRole('button', { name: 'Compare schemas' }).click();
  await page.locator('.pill.err', { hasText: 'breaking' }).first().waitFor();
  await page.getByRole('button', { name: 'Generate test data' }).click();
  await page.locator('.code-area pre', { hasText: '<email>' }).waitFor();
  await page.screenshot({ path: `${tmp}/pro-lab.png`, fullPage: true });
});
await step('telemetry visible in admin', async () => {
  await page.goto(base + '#/admin');
  await page.locator('.bars .bar').first().waitFor();
});
console.log('errors', errors.length ? errors : 'none', 'fails', fails);
await b.close();
process.exit(fails || errors.length ? 1 : 0);
