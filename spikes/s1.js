// S1：PAC 能否按 URL query 把探测请求路由到指定客户端
import { launch } from './lib/launch.js';
import { startLogProxy } from './lib/logproxy.js';
const hits = [];
const servers = [await startLogProxy(18081, hits), await startLogProxy(18082, hits), await startLogProxy(18083, hits)];
const { context, sw, version } = await launch();
const out = { version, cases: {} };
const pac = (body) => `function FindProxyForURL(url, host) {\n${body}\n}`;
const PROBE_PAC = pac(`
  var P = { "18081": "PROXY 127.0.0.1:18081", "18082": "PROXY 127.0.0.1:18082", "18084": "PROXY 127.0.0.1:18084",
            "7890": "PROXY 127.0.0.1:7890", "7890s": "SOCKS5 127.0.0.1:7890", "1086": "SOCKS5 127.0.0.1:1086", "1087": "PROXY 127.0.0.1:1087", "18089": "PROXY 127.0.0.1:18089" };
  var m = /[?&]turnout_probe=([0-9a-z]+)/.exec(url);
  if (m && P[m[1]]) return P[m[1]];
  if (url.substring(0, 6) === "https:") return "PROXY 127.0.0.1:18083";
  return "DIRECT";`);
const f = (url, opts, to) => sw.evaluate(([u, o, t]) => spike.timedFetch(u, o, t), [url, opts, to]);
const take = () => hits.splice(0).map((h) => `${h.port} ${h.method} ${h.url}`);
const step = async (name, fn) => { const r = await fn(); out.cases[name] = { ...r, proxyHits: take() }; };

await sw.evaluate((d) => spike.setPac(d), PROBE_PAC);
await step('http query → 18081', async () => ({ res: await f('http://probe.turnout.test/generate_204?turnout_probe=18081') }));
await step('http query → 18082', async () => ({ res: await f('http://probe.turnout.test/generate_204?a=1&turnout_probe=18082') }));
await step('https query（预期被剥离，落到 18083）', async () => ({ res: await f('https://probe.turnout.test/generate_204?turnout_probe=18081') }));
await step('真实 gstatic 经 FlClash(PROXY) cors', async () => ({ res: await f('http://www.gstatic.com/generate_204?turnout_probe=7890') }));
await step('真实 gstatic 经 FlClash(PROXY) no-cors', async () => ({ res: await f('http://www.gstatic.com/generate_204?turnout_probe=7890', { mode: 'no-cors' }) }));
await step('真实 gstatic 经 FlClash(SOCKS5) no-cors', async () => ({ res: await f('http://www.gstatic.com/generate_204?turnout_probe=7890s', { mode: 'no-cors' }) }));
await step('SS privoxy 1087（端口在、上游坏）', async () => ({ res: await f('http://www.gstatic.com/generate_204?turnout_probe=1087', { mode: 'no-cors' }) }));
await step('SS ss-local 1086 SOCKS5（端口在、上游坏）', async () => ({ res: await f('http://www.gstatic.com/generate_204?turnout_probe=1086', { mode: 'no-cors' }) }));
await step('死端口 18089 单一代理（预期失败、不能直连）', async () => ({ res: await f('http://www.gstatic.com/generate_204?turnout_probe=18089', { mode: 'no-cors' }) }));

// 延迟：连续 10 次经 FlClash
const lat = [];
for (let i = 0; i < 10; i++) lat.push((await f(`http://www.gstatic.com/generate_204?turnout_probe=7890&n=${i}`, { mode: 'no-cors' })).ms);
out.cases['FlClash 延迟 10 次(ms)'] = { lat };

// 坏代理标记：单一代理的探测，端口从死到活，不重设 PAC，能否立即成功
await step('18084 未启动', async () => ({ res: await f('http://probe.turnout.test/generate_204?turnout_probe=18084') }));
servers.push(await startLogProxy(18084, hits));
await step('18084 启动后立即再探（不重设 PAC）', async () => ({ res: await f('http://probe.turnout.test/generate_204?turnout_probe=18084&n=2') }));

// 回落列表：主 18085（死）→ 备 18082；主恢复后，不重设 / 重设 PAC 时走哪个
const FAILOVER = pac(`return "PROXY 127.0.0.1:18085; PROXY 127.0.0.1:18082";`);
await sw.evaluate((d) => spike.setPac(d), FAILOVER);
await step('回落：主死 → 应走备 18082', async () => ({ res: await f('http://site.turnout.test/a') }));
servers.push(await startLogProxy(18085, hits));
await step('回落：主恢复，不重设 PAC', async () => ({ res: await f('http://site.turnout.test/b') }));
await new Promise((r) => setTimeout(r, 3000));
await step('回落：主恢复 3 秒后，不重设 PAC', async () => ({ res: await f('http://site.turnout.test/c') }));
await sw.evaluate((d) => spike.setPac(d), FAILOVER + '\n// v2');
await step('回落：重设 PAC（内容变化）后', async () => ({ res: await f('http://site.turnout.test/d') }));
// 再杀主，确认重设相同内容是否也清标记
servers.at(-1).close(); servers.at(-1).closeAllConnections();
await step('回落：主再次死亡', async () => ({ res: await f('http://site.turnout.test/e') }));
servers.push(await startLogProxy(18085, hits));
await sw.evaluate((d) => spike.setPac(d), FAILOVER + '\n// v2');
await step('回落：主恢复，重设"相同内容"PAC 后', async () => ({ res: await f('http://site.turnout.test/f') }));
await sw.evaluate((d) => spike.setDirect());
await sw.evaluate((d) => spike.setPac(d), FAILOVER + '\n// v2');
await step('回落：先 direct 再设回相同 PAC 后', async () => ({ res: await f('http://site.turnout.test/g') }));

out.log = await sw.evaluate(() => chrome.storage.local.get('log').then((x) => x.log.filter((l) => l.kind === 'proxyError').map((l) => l.detail)));
console.log(JSON.stringify(out, null, 2));
await context.close();
servers.forEach((s) => { s.close(); s.closeAllConnections(); });
