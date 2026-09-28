// 生成 Chrome 应用商店素材：docs/store/screenshots/*.png（1280×800）与 docs/store/promo/*.png。
// 演示数据：本地测试代理扮演客户端；出口 IP 使用文档保留地址（RFC 5737），不含任何真实网络信息。
// 用法：pnpm build && node e2e/store-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './launch.mjs';
import { TestProxy } from './testproxy.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'docs/store/screenshots');
const PROMO = path.join(ROOT, 'docs/store/promo');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PROMO, { recursive: true });
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'public/icon/128.png')).toString('base64')}`;

const A = new TestProxy(17890, 70);
const B = new TestProxy(17892, 130);
await A.start();
await B.start();
const { context, sw, url } = await launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CONFIG = {
  version: 2,
  clients: [
    { id: 'flclash', name: 'FlClash', host: '127.0.0.1', port: 17890, scheme: 'mixed', source: 'discovered' },
    { id: 'wanda', name: '万达云', host: '127.0.0.1', port: 17892, scheme: 'mixed', source: 'discovered' },
  ],
  settings: { mode: 'smart', exit: { kind: 'client', clientId: 'flclash' }, backupClientId: 'wanda', allowDirectWhenAllDown: false, autoSwitchBack: false },
  ruleSource: { kind: 'builtin', updateInterval: 'daily' },
  siteRules: [
    { domain: 'github.com', action: 'proxy' },
    { domain: 'notion.so', action: 'proxy' },
    { domain: 'icbc.com.cn', action: 'direct' },
    { domain: 'bilibili.com', action: 'direct' },
    { domain: 'corp.example.com', action: 'direct' },
  ],
};

// 把一张弹窗截图合成为 1280×800 的商店截图（左侧标题说明，右侧放大的弹窗）
async function compose(file, popupPng, title, subtitle) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const img = `data:image/png;base64,${popupPng.toString('base64')}`;
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:1280px;height:800px;display:flex;align-items:center;justify-content:center;gap:88px;
      background:linear-gradient(135deg,#f6f6f3 0%,#eaf0fc 100%);font-family:"PingFang SC","IBM Plex Sans","Noto Sans SC",system-ui,sans-serif;color:#1b1b18}
    .text{width:520px;display:flex;flex-direction:column;gap:20px}
    .brand{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:600}
    .brand img{width:40px;height:40px;border-radius:9px}
    h1{margin:0;font-size:46px;line-height:1.25;font-weight:700;letter-spacing:.5px}
    p{margin:0;font-size:22px;line-height:1.6;color:#5c5b55}
    .shot{width:432px;height:720px;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(27,27,24,.18),0 2px 6px rgba(27,27,24,.08);background:#fff}
    .shot img{width:432px;height:720px;display:block}
  </style></head><body>
    <div class="text"><div class="brand"><img src="${ICON}">Turnout</div><h1>${title}</h1><p>${subtitle}</p></div>
    <div class="shot"><img src="${img}"></div>
  </body></html>`);
  await page.screenshot({ path: path.join(SHOTS, file) });
  await page.close();
}

async function popupShot({ tabUrl, exitIp }) {
  const p = await context.newPage();
  await p.setViewportSize({ width: 360, height: 600 });
  if (tabUrl)
    await p.addInitScript((u) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (q) => (q && q.active ? Promise.resolve([{ url: u }]) : orig(q));
    }, tabUrl);
  await p.goto(url('popup.html'));
  await wait(3500); // 等健康检测与出口 IP 查询（测试代理无法转发 HTTPS，会失败）结束
  // 注入演示用出口 IP（文档保留地址）
  await sw.evaluate(async (ip) => {
    const { runtime } = await chrome.storage.session.get('runtime');
    await chrome.storage.session.set({ runtime: { ...runtime, exitIp: { ...ip, checkedAt: new Date().toISOString() } } });
  }, exitIp);
  await wait(600);
  const buf = await p.screenshot();
  await p.close();
  return buf;
}

try {
  const onboarding = context.pages().find((p) => p.url().includes('onboarding')) ?? (await context.waitForEvent('page', { predicate: (p) => p.url().includes('onboarding'), timeout: 10000 }));

  // 5. 首次引导（扫描的是本机真实端口，只显示端口号）
  await onboarding.setViewportSize({ width: 1280, height: 800 });
  await onboarding.getByRole('heading', { name: /发现|没有发现/ }).waitFor();
  await wait(500);
  await onboarding.screenshot({ path: path.join(SHOTS, '5-onboarding.png') });
  await onboarding.close();

  // 写入演示配置并触发一次检测（检测结束时会应用 PAC）
  await sw.evaluate(async (cfg) => {
    await chrome.storage.local.set({ config: cfg, 'config$': { v: 2 }, onboarded: true });
  }, CONFIG);

  // 预热：直接写入存储不会立即应用 PAC，先打开一次弹窗触发检测并应用，第二次检测才能经 PAC 探测
  const warm = await context.newPage();
  await warm.goto(url('popup.html'));
  await wait(3000);
  await warm.close();

  // 1. 弹窗：智能分流 + 当前网站
  const shot1 = await popupShot({ tabUrl: 'https://www.youtube.com/watch?v=demo', exitIp: { ip: '203.0.113.24', country: 'JP', via: 'flclash' } });
  await compose('1-popup.png', shot1, '一键切换<br>本机代理客户端', '智能分流、全部代理、直连，出口随时换。当前网站走哪条路、为什么，一眼看清。');

  // 2. 弹窗：默认客户端离线，已切到备用
  await A.stop();
  const shot2 = await popupShot({ exitIp: { ip: '198.51.100.7', country: 'SG', via: 'wanda' } });
  await compose('2-failover.png', shot2, '客户端掉线<br>立即切到备用', '浏览器马上改走备用客户端，并说明原因；全部连不上时，也不会悄悄直连暴露真实 IP。');
  await A.start();

  // 3. 设置页：客户端与备用
  const opts = await context.newPage();
  await opts.setViewportSize({ width: 1280, height: 800 });
  // FlClash 刚恢复：打开一次弹窗触发重新检测，等两个客户端都显示在线
  const recheck = await context.newPage();
  await recheck.goto(url('popup.html'));
  await wait(3000);
  await recheck.close();
  await opts.goto(url('options.html#clients'));
  await opts.getByText('离线', { exact: true }).waitFor({ state: 'detached', timeout: 15000 });
  await wait(800);
  await opts.screenshot({ path: path.join(SHOTS, '3-clients.png') });

  // 4. 设置页：我的网站
  await opts.goto(url('options.html#rules'));
  await opts.getByRole('heading', { name: '我的网站' }).waitFor();
  // 让「规则来源」面板顶端对齐到视口上方 32px，避免截到半行说明文字
  await opts.evaluate(() => {
    const panel = document.querySelector('main section > div[class*="panel"]');
    if (panel) window.scrollTo(0, panel.getBoundingClientRect().top + window.scrollY - 32);
  });
  await wait(400);
  await opts.screenshot({ path: path.join(SHOTS, '4-sites.png') });
  await opts.close();

  // 宣传图块
  const promo = await context.newPage();
  const tile = async (file, w, h, big) => {
    await promo.setViewportSize({ width: w, height: h });
    await promo.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;gap:${big ? 40 : 22}px;
        background:linear-gradient(135deg,#2b59c3 0%,#1e4296 100%);color:#fff;font-family:"PingFang SC","IBM Plex Sans",system-ui,sans-serif}
      img{width:${big ? 168 : 96}px;height:${big ? 168 : 96}px;border-radius:${big ? 36 : 22}px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
      .t{display:flex;flex-direction:column;gap:${big ? 14 : 8}px}
      .n{font-size:${big ? 64 : 38}px;font-weight:700;letter-spacing:.5px}
      .s{font-size:${big ? 28 : 17}px;opacity:.9}
    </style></head><body><img src="${ICON}"><div class="t"><div class="n">Turnout</div><div class="s">多个代理客户端，一键切换</div>${big ? '<div class="s" style="font-size:22px;opacity:.75">规则配一次，所有客户端通用 · 掉线自动切备用</div>' : ''}</div></body></html>`);
    await promo.screenshot({ path: path.join(PROMO, file) });
  };
  await tile('small-440x280.png', 440, 280, false);
  await tile('marquee-1400x560.png', 1400, 560, true);
  await promo.close();

  console.log('STORE ASSETS OK');
} finally {
  await context.close();
  await A.stop().catch(() => undefined);
  await B.stop().catch(() => undefined);
}
