// v2 端到端：我的网站 → PAC；弹窗当前网站一键设置；出口 IP；ZeroOmega 导入；v1 → v2 配置迁移与备份。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './launch.mjs';
import { TestProxy } from './testproxy.mjs';

const SHOTS = path.resolve(import.meta.dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const A = new TestProxy(18181);
await A.start();
const { context, sw, url } = await launch();
const log = (...a) => console.log('•', ...a);
const pac = async () => (await sw.evaluate(() => chrome.proxy.settings.get({}))).value.pacScript?.data ?? '';
const config = async () => (await sw.evaluate(() => chrome.storage.local.get('config'))).config;
const siteTable = async () => /var SITE = (\{[^}]*\})/.exec(await pac())?.[1].replace(/\s+/g, '');

try {
  const onboarding = context.pages().find((p) => p.url().includes('onboarding')) ?? (await context.waitForEvent('page', { predicate: (p) => p.url().includes('onboarding'), timeout: 10000 }));
  await onboarding.close();

  // 准备：一个测试客户端（HTTP，回 204）+ 本机 FlClash（若在线，用于出口 IP）
  const opts = await context.newPage();
  await opts.goto(url('options.html#clients'));
  const addClient = async (name, port, scheme) => {
    await opts.getByRole('button', { name: '手动添加' }).click();
    await opts.getByPlaceholder('如 FlClash').fill(name);
    await opts.getByPlaceholder('7890').fill(String(port));
    await opts.locator('form select').selectOption(scheme);
    await opts.getByRole('button', { name: '保存' }).click();
    await opts.getByText(`127.0.0.1:${port}`, { exact: true }).waitFor();
  };
  await addClient('FlClash', 7890, 'mixed');
  await addClient('Test-A', 18181, 'http');

  // 1. 我的网站：批量添加 → PAC 的 SITE 表
  await opts.goto(url('options.html#rules'));
  await opts.getByRole('heading', { name: '我的网站' }).waitFor();
  await opts.getByLabel('网站域名').fill('https://www.bank.com/login  corp.example , bad..domain');
  await opts.getByRole('button', { name: '添加', exact: true }).click();
  await opts.getByText('以下内容不是有效的域名，已忽略：bad..domain').waitFor();
  await opts.getByLabel('网站域名').fill('bilibili.com');
  await opts.getByLabel('动作', { exact: true }).selectOption('proxy');
  await opts.getByRole('button', { name: '添加', exact: true }).click();
  await opts.getByText('bilibili.com', { exact: true }).waitFor();
  await opts.getByLabel('网站域名').fill('*baidu.com');
  await opts.getByLabel('动作', { exact: true }).selectOption('direct');
  await opts.getByRole('button', { name: '添加', exact: true }).click();
  await opts.getByText(/已按 baidu\.com 及其所有子域名添加/).waitFor();
  assert.ok((await config()).siteRules.some((r) => r.domain === 'baidu.com' && r.action === 'direct'));
  log('*baidu.com → baidu.com（直连）OK');
  await opts.waitForTimeout(500);
  let t = await siteTable();
  log('智能分流 SITE =', t);
  assert.equal(t, '{"baidu.com":"D","bilibili.com":"P","corp.example":"D","www.bank.com":"D"}');
  await opts.screenshot({ path: path.join(SHOTS, 'v2-1-site-rules.png'), fullPage: true });

  // 2. 全部代理：只保留直连条目
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.goto(url('popup.html'));
  await popup.getByRole('radio', { name: '全部代理' }).click();
  await popup.waitForTimeout(500);
  t = await siteTable();
  log('全部代理 SITE =', t);
  assert.equal(t, '{"baidu.com":"D","corp.example":"D","www.bank.com":"D"}');
  await popup.getByRole('radio', { name: '智能分流' }).click();
  await popup.waitForTimeout(500);

  // 3. 弹窗当前网站。真正的工具栏弹窗 Playwright 无法接管，这里在弹窗页里模拟 activeTab 读到的当前标签页
  const sitePopup = await context.newPage();
  await sitePopup.setViewportSize({ width: 360, height: 600 });
  await sitePopup.addInitScript(() => {
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q) => (q && q.active ? Promise.resolve([{ url: 'https://www.example.com/page' }]) : orig(q));
  });
  await sitePopup.goto(url('popup.html'));
  await sitePopup.getByText('当前网站').waitFor();
  await sitePopup.getByText(/直连 · 未命中规则/).waitFor();
  await sitePopup.getByRole('button', { name: '设为走代理' }).click();
  await sitePopup.getByRole('button', { name: /已设为走代理/ }).waitFor();
  await sitePopup.getByText('走代理 · 我的网站：example.com').waitFor();
  assert.ok((await config()).siteRules.some((r) => r.domain === 'example.com' && r.action === 'proxy'));
  assert.match(await siteTable(), /"example\.com":"P"/);
  await sitePopup.locator('section[aria-label="当前网站"]').screenshot({ path: path.join(SHOTS, 'v2-2-popup-current-site.png') });
  await sitePopup.getByRole('button', { name: /已设为走代理/ }).click();
  await sitePopup.getByText(/直连 · 未命中规则/).waitFor();
  log('弹窗当前网站：设为走代理 → 取消 OK');
  await sitePopup.close();

  // 4. 出口 IP（经 FlClash；依赖其在线，失败只记录）
  await popup.goto(url('popup.html'));
  await popup.getByRole('radio', { name: /FlClash/ }).click();
  const ipText = await popup.locator('text=/\\d+\\.\\d+\\.\\d+\\.\\d+|查询失败/').first().textContent({ timeout: 20000 }).catch(() => '超时');
  log('出口 IP →', ipText);
  await popup.screenshot({ path: path.join(SHOTS, 'v2-3-popup-exit-ip.png') });

  // 5. ZeroOmega 导入
  const bak = path.join(os.tmpdir(), 'turnout-zo.bak');
  fs.writeFileSync(bak, JSON.stringify({
    schemaVersion: 2,
    '-startupProfileName': 'auto',
    '+clash': { name: 'clash', profileType: 'FixedProfile', fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7897 } },
    '+v2ray': { name: 'v2ray', profileType: 'FixedProfile', fallbackProxy: { scheme: 'socks5', host: '127.0.0.1', port: 10808 } },
    '+dup': { name: 'dup', profileType: 'FixedProfile', fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 18181 } },
    '+auto': { name: 'auto', profileType: 'SwitchProfile', defaultProfileName: '__ruleListOf_auto', rules: [{ condition: { conditionType: 'HostWildcardCondition', pattern: '*.corp.com' }, profileName: 'direct' }] },
    '+__ruleListOf_auto': { name: '__ruleListOf_auto', profileType: 'RuleListProfile', format: 'AutoProxy', sourceUrl: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt', matchProfileName: 'clash' },
  }));
  await opts.goto(url('options.html#backup'));
  await opts.locator('input[type=file][accept*=".bak"]').setInputFiles(bak);
  await opts.getByText('将导入的客户端').waitFor({ timeout: 10000 });
  await opts.screenshot({ path: path.join(SHOTS, 'v2-4-zeroomega-preview.png'), fullPage: true });
  await opts.getByRole('button', { name: '导入', exact: true }).click();
  await opts.getByText('已导入 2 个客户端。').waitFor();
  const c = await config();
  log('导入后客户端', c.clients.map((x) => `${x.name}:${x.port}:${x.source}`).join(', '), '出口', c.settings.exit, '规则', c.ruleSource.kind);
  assert.deepEqual(c.clients.filter((x) => x.source === 'imported').map((x) => x.name), ['clash', 'v2ray']);
  assert.equal(c.clients.find((x) => x.id === c.settings.exit.clientId)?.name, 'clash');
  assert.equal(c.ruleSource.kind, 'custom');
  const backups = await sw.evaluate(() => chrome.storage.local.get('backup.1'));
  assert.ok(backups['backup.1'], '导入前应写入备份');
  log('ZeroOmega 导入 OK（已备份）');

  // 6. v1 → v2 迁移：写入 0.1.0 格式的配置，重启 SW 触发 WXT 迁移
  const v1 = { version: 1, clients: [{ id: 'old1', name: 'Old', host: '127.0.0.1', port: 7890, scheme: 'mixed', source: 'manual' }], settings: { mode: 'smart', exit: { kind: 'client', clientId: 'old1' }, backupClientId: null, allowDirectWhenAllDown: false, autoSwitchBack: false }, ruleSource: { kind: 'builtin', updateInterval: 'daily' } };
  await sw.evaluate((v1) => chrome.storage.local.set({ config: v1, config$: { v: 1 }, 'backup.1': null, 'backup.2': null, 'backup.3': null }), v1);
  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await new Promise((r) => setTimeout(r, 800));
  await popup.goto(url('popup.html')); // 触发 SW 重新启动
  await popup.getByText('Old').first().waitFor({ timeout: 10000 });
  const after = await popup.evaluate(() => chrome.storage.local.get(['config', 'config$', 'backup.1']));
  log('迁移后 version', after.config.version, 'meta', JSON.stringify(after['config$']), 'siteRules', JSON.stringify(after.config.siteRules), '备份版本', after['backup.1']?.version);
  assert.equal(after.config.version, 2);
  assert.deepEqual(after.config.siteRules, []);
  assert.equal(after['config$'].v, 2);
  assert.equal(after['backup.1']?.version, 1, '迁移前应把 v1 写入备份槽');

  console.log('\nV2 OK');
} catch (e) {
  for (const [i, p] of context.pages().entries()) await p.screenshot({ path: path.join(SHOTS, `fail-${i}.png`) }).catch(() => undefined);
  throw e;
} finally {
  await context.close();
  await A.stop();
}
