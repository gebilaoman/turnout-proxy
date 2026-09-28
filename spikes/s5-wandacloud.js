// M0 补测：万达云（wandacloud）默认端口与第 1 / 2 级检测响应，与 FlClash 对照
import { launch } from './lib/launch.js';
const { context, sw, version } = await launch({ manifestPatch: { host_permissions: ['http://127.0.0.1/*', 'http://localhost/*', 'http://connectivitycheck.gstatic.com/*'] } });
const f = (u, to = 1500) => sw.evaluate(([u, to]) => spike.timedFetch(u, {}, to), [u, to]);
await sw.evaluate((d) => spike.setPac(d), `function FindProxyForURL(url, host) {
  var P = { "7892": "PROXY 127.0.0.1:7892", "7892s": "SOCKS5 127.0.0.1:7892", "7890": "PROXY 127.0.0.1:7890", "7890s": "SOCKS5 127.0.0.1:7890", "canary": "PROXY 127.0.0.1:9" };
  if (host === "connectivitycheck.gstatic.com") { var m = /[?&]turnout_probe=([0-9a-z]+)/.exec(url); if (m && P[m[1]]) return P[m[1]]; }
  return "DIRECT"; }`);
const out = { version, level1: {}, level2: [] };
for (const [k, u] of [['万达云 127.0.0.1:7892', 'http://127.0.0.1:7892/'], ['万达云 localhost:7892', 'http://localhost:7892/'], ['FlClash 127.0.0.1:7890', 'http://127.0.0.1:7890/']]) out.level1[k] = await f(u);
for (let i = 0; i < 5; i++) for (const k of ['7892', '7892s', '7890', '7890s', 'canary'])
  out.level2.push({ k, ...(await f(`http://connectivitycheck.gstatic.com/generate_204?turnout_probe=${k}&n=${i}`, 5000)) });
console.log(JSON.stringify(out.level1, null, 1)); console.table(out.level2.map(({ k, ok, status, error, ms }) => ({ k, ok, status, error: error?.slice(0, 30), ms })));
await context.close();
