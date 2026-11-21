import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8080/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/401|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/fs-fail-' + name.replace(/\W+/g,'_') + '.png' }); } };
const email = `u${Date.now()}@example.com`;

await step('anonymous: local project', async () => { await page.goto(base + '#/dashboard'); await page.getByRole('link', { name: 'Sign in' }).first().waitFor(); await page.getByRole('button', { name: '+ New project' }).first().click(); await page.locator('#np-name').fill('Local one'); await page.getByRole('button', { name: 'Create project' }).click(); await page.locator('.studio').waitFor(); await page.getByText('Saved in browser').waitFor(); await page.waitForTimeout(400); });
await step('register', async () => {
  await page.goto(base + '#/register');
  await page.locator('#name').fill('Tester');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.hint.c-err', { hasText: '10 characters' }).waitFor();
  await page.locator('#password').fill('a long password 1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('h1', { hasText: 'Projects' }).waitFor();
  await page.locator('.account-name', { hasText: 'Tester' }).waitFor();
});
await step('import banner for local projects', async () => { await page.getByRole('button', { name: 'Import to my account' }).click(); await page.locator('.project h3', { hasText: 'Local one' }).waitFor(); await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/fs-dashboard.png' }); });
await step('create remote project and edit', async () => {
  await page.getByRole('button', { name: '+ New project' }).first().click();
  await page.locator('.option', { hasText: 'Content-Based Router' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.locator('.studio').waitFor();
  await page.locator('.node.from').first().click();
  await page.locator('.palette .component', { hasText: /^≡ log$/ }).click();
  await page.getByText('Saved to cloud').waitFor({ timeout: 5000 });
});
await step('rename + version + share', async () => {
  const name = page.getByLabel('Project name'); await name.fill('Cloud router'); await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.locator('.canvas').click({ position: { x: 600, y: 700 } });
  await page.keyboard.press('Control+s'); await page.locator('.toast', { hasText: 'Version saved' }).waitFor();
  await page.getByRole('button', { name: /Share/ }).click();
  await page.getByRole('button', { name: 'Create read-only link' }).click();
  await page.locator('#share-url').waitFor();
  global.shareUrl = await page.locator('#share-url').inputValue();
  await page.keyboard.press('Escape');
  await page.getByText('Saved to cloud').waitFor({ timeout: 5000 });
  await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/fs-builder.png' });
});
await step('reload keeps cloud data', async () => {
  await page.reload(); await page.locator('.crumb input').waitFor();
  const v = await page.locator('.crumb input').inputValue(); if (v !== 'Cloud router') throw new Error('name ' + v);
  if (!(await page.locator('.node', { hasText: 'log' }).count())) throw new Error('log step lost');
  await page.getByRole('button', { name: /Versions \(1\)/ }).waitFor();
});
await step('anonymous can open shared link', async () => {
  const anon = await browser.newPage();
  await anon.goto(global.shareUrl.replace('localhost', '127.0.0.1'));
  await anon.locator('h1', { hasText: 'Cloud router' }).waitFor();
  await anon.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/fs-shared.png' });
  await anon.close();
});
await step('account page + logout', async () => {
  await page.goto(base + '#/account'); await page.locator('h1', { hasText: 'Tester' }).waitFor();
  await page.screenshot({ path: (process.env.E2E_TMP ?? '/tmp') + '/fs-account.png' });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(base + '#/dashboard'); await page.getByRole('link', { name: 'Sign in' }).first().waitFor();
  if (await page.locator('.project h3', { hasText: 'Cloud router' }).count()) throw new Error('cloud project visible after logout');
});
await step('login again', async () => {
  await page.goto(base + '#/login'); await page.locator('#email').fill(email); await page.locator('#password').fill('wrong password'); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('.form-error').waitFor();
  await page.locator('#password').fill('a long password 1'); await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('.project h3', { hasText: 'Cloud router' }).waitFor();
});
await step('second tab conflict handled', async () => {
  const id = (await page.locator('.project h3 a', { hasText: 'Cloud router' }).getAttribute('href')).split('/').pop();
  const p2 = await ctx.newPage();
  await p2.goto(base + '#/builder/' + id); await p2.locator('.studio').waitFor();
  await page.goto(base + '#/builder/' + id); await page.locator('.studio').waitFor();
  await p2.getByLabel('Project name').fill('Tab two'); await p2.waitForTimeout(1500);
  await page.getByLabel('Project name').fill('Tab one'); await page.waitForTimeout(1500);
  await page.locator('.toast', { hasText: 'changed in another tab' }).waitFor({ timeout: 4000 });
  await p2.close();
});
console.log('console errors:', errors.length ? errors : 'none');
const mails = (await import('node:fs')).readdirSync((process.env.E2E_STORAGE ?? 'api/storage') + '/mail');
console.log('mails:', mails.length, 'fails:', fails);
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
