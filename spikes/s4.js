// S4：SW 被停止后，chrome.proxy.onProxyError 能否唤醒它并送达事件
import { launch } from './lib/launch.js';
import { startLogProxy } from './lib/logproxy.js';
const hits = []; const alive = await startLogProxy(18082, hits);
const { context, sw, extId, version } = await launch({ args: ['--host-resolver-rules=MAP *.s4test 127.0.0.1'] });
const ext = await context.newPage();
await ext.goto(`chrome-extension://${extId}/page.html`);
const cdp = await context.newCDPSession(ext);
let status = 'unknown';
cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { for (const v of versions) if (v.scriptURL.includes(extId)) status = v.runningStatus; });
await cdp.send('ServiceWorker.enable');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const readLog = () => ext.evaluate(() => chrome.storage.local.get('log').then((x) => x.log || []));
const clearLog = () => ext.evaluate(() => chrome.storage.local.set({ log: [] }));
const stop = async () => { await cdp.send('ServiceWorker.stopAllWorkers'); for (let i = 0; i < 50 && status !== 'stopped'; i++) await wait(100); return status; };
const summary = (log) => log.map((l) => `${l.kind}${l.detail ? ' ' + l.detail.error + ' fatal=' + l.detail.fatal : ''}${l.name ? ' ' + l.name : ''} bootAt=${l.bootAt}`);
const out = { version, steps: [] };
const step = async (name, action, settle = 2500) => {
  await clearLog();
  const before = await stop();
  await action();
  await wait(settle);
  out.steps.push({ name, statusBeforeAction: before, statusAfter: status, log: summary(await readLog()) });
};
await sw.evaluate(() => spike.setPac(`function FindProxyForURL(url, host) {
  if (host === "dead.s4test") return "PROXY 127.0.0.1:18089";
  if (host === "fallback.s4test") return "PROXY 127.0.0.1:18088; PROXY 127.0.0.1:18082";
  return "DIRECT"; }`));
const tab = await context.newPage();
const nav = (u) => tab.goto(u, { timeout: 8000 }).catch((e) => e.message.split('\n')[0]);

// SW 运行时：回落成功（主死备活）时是否也触发 onProxyError
await clearLog(); await nav('http://fallback.s4test/x'); await wait(1000);
out.awakeFallback = { log: summary(await readLog()), hits: hits.splice(0).map((h) => h.port + ' ' + h.url) };

await step('对照 A：停止后什么也不做', async () => {});
await step('对照 B：停止后访问直连站点', async () => { await nav('http://ok.s4test:18082/'); });
await step('阳性对照：停止后 chrome.alarms 到点', async () => { await ext.evaluate(() => chrome.alarms.create('wake', { when: Date.now() + 1000 })); }, 4000);
await step('测试 1：停止后网页请求经死代理（fatal）', async () => { await nav('http://dead.s4test/a'); });
await step('测试 2：停止后网页请求主死备活（回落）', async () => { await nav('http://fallback.s4test/b'); });
await step('测试 3：停止后扩展页 fetch 经死代理', async () => { await ext.evaluate(() => fetch('http://dead.s4test/c').catch(() => 0)); });

// 自然空闲回收：不做任何事，观察 SW 是否会在 ~30 秒后自行停止（Playwright 附着可能阻止回收）
await sw.evaluate(() => 1).catch(() => 0);
const t0 = Date.now(); let idleStopped = null;
for (let i = 0; i < 90; i++) { await wait(1000); if (status === 'stopped') { idleStopped = Math.round((Date.now() - t0) / 1000); break; } }
out.naturalIdleStopAfterSec = idleStopped;
console.log(JSON.stringify(out, null, 2));
await context.close(); alive.close(); alive.closeAllConnections();
