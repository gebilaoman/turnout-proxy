// 故障切换：主离线 → 备用接管 → 主恢复提示切回 → 全部离线。截图输出到 e2e/shots/。
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch } from './launch.mjs';
import { TestProxy } from './testproxy.mjs';

const SHOTS = path.resolve(import.meta.dirname, 'shots');
const A = new TestProxy(18181);
const B = new TestProxy(18182);
await A.start();
await B.start();
const { context, sw, url } = await launch();
const proxy = () => sw.evaluate(() => chrome.proxy.settings.get({}));
const route = async () => /var ROUTE = "([^"]*)"/.exec((await proxy()).value.pacScript?.data ?? '')?.[1];
const epoch = async () => /epoch=(\d+)/.exec((await proxy()).value.pacScript?.data ?? '')?.[1];
const log = (...a) => console.log('•', ...a);
const pageLogs = [];
context.on('console', (m) => pageLogs.push(`[${m.type()}] ${m.text()}`));
context.on('weberror', (e) => pageLogs.push(`[weberror] ${e.error().message}`));

try {
  // 安装后会自动打开引导页；本测试直接用设置页配置，先把它关掉
  const onboarding =
    context.pages().find((p) => p.url().includes('onboarding')) ??
    (await context.waitForEvent('page', { predicate: (p) => p.url().includes('onboarding'), timeout: 10000 }));
  await onboarding.close();

  // 通过设置页手动添加两个客户端
  const opts = await context.newPage();
  await opts.goto(url('options.html#clients'));
  for (const [name, port] of [['Test-A', 18181], ['Test-B', 18182]]) {
    await opts.getByRole('button', { name: '手动添加' }).click();
    await opts.getByPlaceholder('如 FlClash').fill(name);
    await opts.getByPlaceholder('7890').fill(String(port));
    await opts.locator('form select').selectOption('http');
    await opts.getByRole('button', { name: '保存' }).click();
    await opts.getByText(`127.0.0.1:${port}`, { exact: true }).waitFor();
  }
  await opts.locator('#backup').selectOption({ label: 'Test-B' });
  await opts.waitForTimeout(500);
  log('客户端已添加；route =', await route());
  assert.equal(await route(), 'PROXY 127.0.0.1:18181; PROXY 127.0.0.1:18182');

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  const openPopup = async () => { await popup.goto(url('popup.html')); await popup.waitForTimeout(2500); };

  await openPopup();
  await popup.getByText('智能分流 · 经 Test-A').waitFor();
  assert.ok(await popup.getByText('在线').count() >= 2, 'A、B 都应在线');
  await popup.screenshot({ path: path.join(SHOTS, 'f1-both-online.png') });
  log('A、B 在线');

  // 主离线
  await A.stop();
  await openPopup();
  await popup.getByText('Test-A 已离线，已自动切到 Test-B').waitFor({ timeout: 8000 });
  assert.equal(await route(), 'PROXY 127.0.0.1:18182; PROXY 127.0.0.1:18181');
  await popup.screenshot({ path: path.join(SHOTS, 'f2-on-backup.png') });
  log('A 离线 → 切到 B；route =', await route());

  // 主恢复（不自动切回）
  await A.start();
  await openPopup();
  await popup.getByText('Test-A 已恢复').waitFor({ timeout: 8000 });
  assert.equal(await route(), 'PROXY 127.0.0.1:18182; PROXY 127.0.0.1:18181', '不自动切回');
  await popup.screenshot({ path: path.join(SHOTS, 'f3-can-switch-back.png') });
  const e1 = await epoch();
  await popup.getByRole('button', { name: '切回 Test-A' }).click();
  await popup.waitForTimeout(800);
  assert.equal(await route(), 'PROXY 127.0.0.1:18181; PROXY 127.0.0.1:18182');
  assert.ok(Number(await epoch()) > Number(e1), '切回时 epoch 递增');
  log('切回 A；epoch', e1, '→', await epoch());

  // 全部离线：保持代理，不追加 DIRECT
  await A.stop();
  await B.stop();
  await openPopup();
  await popup.getByText('连不上任何代理客户端').waitFor({ timeout: 8000 });
  const r = await route();
  assert.ok(r && !r.includes('DIRECT'), '默认不追加 DIRECT');
  await popup.screenshot({ path: path.join(SHOTS, 'f4-all-down.png') });
  log('全部离线；route =', r);

  // 开启「全部离线时直连」后才追加 DIRECT
  await opts.bringToFront();
  await opts.locator('#direct').click();
  await opts.waitForFunction(() => document.querySelector('#direct')?.checked === true);
  await opts.waitForTimeout(800);
  assert.match(await route(), /; DIRECT$/);
  await openPopup();
  await popup.getByText('所有客户端都离线，已改为直连').waitFor({ timeout: 8000 });
  await popup.screenshot({ path: path.join(SHOTS, 'f5-all-down-direct.png') });
  await opts.screenshot({ path: path.join(SHOTS, 'f6-options.png'), fullPage: true });
  log('允许直连后 route =', await route());

  console.log('\nFAILOVER OK');
} catch (e) {
  for (const [i, p] of context.pages().entries()) await p.screenshot({ path: path.join(SHOTS, `fail-${i}.png`) }).catch(() => undefined);
  console.log(pageLogs.slice(-30).join('\n'));
  for (const p of context.pages()) console.log(p.url(), await p.evaluate(() => JSON.stringify([chrome.i18n?.getMessage('common_save'), chrome.i18n?.getMessage('@@extension_id'), chrome.i18n?.getMessage('@@ui_locale')])).catch((x) => 'ERR ' + x.message));
  throw e;
} finally {
  await context.close();
  await A.stop().catch(() => undefined);
  await B.stop().catch(() => undefined);
}
