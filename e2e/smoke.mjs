// 冒烟测试：引导 → 应用 PAC → 弹窗切换模式 / 出口 → 设置页。截图输出到 e2e/shots/。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './launch.mjs';

const SHOTS = path.resolve(import.meta.dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const { context, sw, url } = await launch();
const proxy = () => sw.evaluate(() => chrome.proxy.settings.get({}));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const log = (...a) => console.log('•', ...a);

try {
  // 1. 安装后自动打开引导页
  const onboarding = await context.waitForEvent('page', { predicate: (p) => p.url().includes('onboarding.html'), timeout: 10000 }).catch(() => null)
    ?? context.pages().find((p) => p.url().includes('onboarding.html'));
  assert.ok(onboarding, '安装后应自动打开引导页');
  await onboarding.setViewportSize({ width: 960, height: 760 });
  await onboarding.getByRole('heading', { name: /发现 \d+ 个代理客户端|没有发现/ }).waitFor({ timeout: 10000 });
  await shot(onboarding, '1-onboarding-scan');
  const found = await onboarding.locator('input[type=checkbox]').count();
  log('扫描到候选', found);
  assert.ok(found >= 1, '本机应至少发现 1 个客户端（FlClash 7890）');
  const before = await proxy();
  log('引导完成前代理', before.value.mode, before.levelOfControl);

  await onboarding.getByRole('button', { name: '下一步' }).click();
  await shot(onboarding, '2-onboarding-rules');
  await onboarding.getByRole('button', { name: '下一步' }).click();
  await shot(onboarding, '3-onboarding-confirm');
  await onboarding.getByRole('button', { name: '完成' }).click();
  await onboarding.getByRole('heading', { name: '设置完成' }).waitFor();
  await shot(onboarding, '4-onboarding-done');

  // 2. 完成后应用智能分流 PAC
  let p = await proxy();
  assert.equal(p.value.mode, 'pac_script');
  assert.equal(p.levelOfControl, 'controlled_by_this_extension');
  const pac = p.value.pacScript.data;
  assert.match(pac, /^\/\/ Turnout /);
  assert.match(pac, /"google\.com":1/);
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(pac), 'PAC 只含 ASCII');
  log('PAC 首行', pac.split('\n')[0], '大小', pac.length);

  // 2b. 真实上网：命中规则的网站经客户端，其余直连（依赖本机 FlClash 在线，失败只记录不中断）
  const web = await context.newPage();
  for (const u of ['https://www.google.com/', 'https://www.baidu.com/']) {
    const t0 = Date.now();
    const status = await web.goto(u, { timeout: 20000 }).then((r) => r?.status()).catch((e) => 'ERR ' + e.message.split('\n')[0]);
    log('打开', u, '→', status, `${Date.now() - t0}ms`);
  }
  await web.close();

  // 3. 弹窗
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(url('popup.html'));
  await popup.getByText('智能分流 · 经').waitFor();
  // 等待第 2 级检测出结果（在线 + 延迟）
  await popup.getByText(/\d+ ms/).first().waitFor({ timeout: 15000 }).catch(() => log('15 秒内没有测到延迟'));
  await shot(popup, '5-popup-smart');

  await popup.getByRole('radio', { name: '全部代理' }).click();
  await popup.waitForFunction(() => document.querySelector('[aria-checked="true"]')?.textContent === '全部代理');
  p = await proxy();
  assert.equal(p.value.mode, 'pac_script');
  assert.ok(!/var MATCH/.test(p.value.pacScript.data), '全部代理的 PAC 不含规则表');
  log('全部代理 OK');
  await shot(popup, '6-popup-all');

  await popup.getByRole('radio', { name: '直连' }).click();
  await popup.getByText('直连，未使用代理').waitFor();
  p = await proxy();
  assert.equal(p.value.mode, 'direct');
  log('直连 OK');
  await shot(popup, '7-popup-direct');

  await popup.getByRole('radio', { name: '智能分流' }).click();
  await popup.getByRole('radio', { name: /跟随系统代理/ }).click();
  await popup.getByText('智能分流 · 跟随系统代理').waitFor();
  p = await proxy();
  assert.equal(p.value.mode, 'system');
  assert.equal(p.levelOfControl, 'controllable_by_this_extension', '跟随系统时应交还控制权');
  log('跟随系统 OK');
  await shot(popup, '8-popup-system');

  // 切回第一个客户端
  await popup.locator('button[role=radio]').filter({ hasText: '127.0.0.1' }).first().click();
  await popup.getByText('智能分流 · 经').waitFor();
  assert.equal((await proxy()).value.mode, 'pac_script');

  // 4. 设置页
  const opts = await context.newPage();
  await opts.goto(url('options.html#clients'));
  await opts.getByRole('heading', { name: '客户端' }).waitFor();
  await opts.waitForTimeout(1500);
  await shot(opts, '9-options-clients');
  await opts.goto(url('options.html#rules'));
  await opts.getByRole('heading', { name: '规则订阅' }).waitFor();
  await shot(opts, '10-options-rules');
  await opts.goto(url('options.html#backup'));
  await shot(opts, '11-options-backup');
  await opts.goto(url('options.html#about'));
  await shot(opts, '12-options-about');

  const runtime = await sw.evaluate(() => chrome.storage.session.get('runtime'));
  log('runtime', JSON.stringify(runtime.runtime, null, 0).slice(0, 600));
  console.log('\nSMOKE OK');
} catch (e) {
  for (const [i, pg] of context.pages().entries()) await pg.screenshot({ path: path.join(SHOTS, `fail-${i}.png`) }).catch(() => undefined);
  console.log('runtime', JSON.stringify((await sw.evaluate(() => chrome.storage.session.get('runtime'))).runtime));
  throw e;
} finally {
  await context.close();
}
