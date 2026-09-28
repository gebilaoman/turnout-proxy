// S1 补充：① 探测域名加入 host_permissions 后能否读到真实状态码；② 主代理被标坏期间，单一代理探测能否直达主代理
import { launch } from './lib/launch.js';
import { startLogProxy } from './lib/logproxy.js';
const hits = [];
const servers = [await startLogProxy(18082, hits)];
const { context, sw } = await launch({ manifestPatch: { host_permissions: ['http://127.0.0.1/*', 'http://localhost/*', 'http://www.gstatic.com/*', 'http://cp.cloudflare.com/*'] } });
const out = {};
const f = (url, opts) => sw.evaluate(([u, o]) => spike.timedFetch(u, o), [url, opts]);
const take = () => hits.splice(0).map((h) => `${h.port} ${h.method} ${h.url}`);
const PAC = `function FindProxyForURL(url, host) {
  var P = { "7890": "PROXY 127.0.0.1:7890", "7890s": "SOCKS5 127.0.0.1:7890", "1087": "PROXY 127.0.0.1:1087", "1086": "SOCKS5 127.0.0.1:1086", "18085": "PROXY 127.0.0.1:18085" };
  var m = /[?&]turnout_probe=([0-9a-z]+)/.exec(url);
  if (m && P[m[1]]) return P[m[1]];
  if (host === "site.turnout.test") return "PROXY 127.0.0.1:18085; PROXY 127.0.0.1:18082";
  return "DIRECT";
}`;
await sw.evaluate((d) => spike.setPac(d), PAC);
for (const [k, u] of [['FlClash PROXY gstatic', 'http://www.gstatic.com/generate_204?turnout_probe=7890'], ['FlClash SOCKS5 gstatic', 'http://www.gstatic.com/generate_204?turnout_probe=7890s'],
  ['FlClash PROXY cloudflare', 'http://cp.cloudflare.com/generate_204?turnout_probe=7890'], ['privoxy 1087 上游坏', 'http://www.gstatic.com/generate_204?turnout_probe=1087'], ['ss-local 1086 上游坏', 'http://www.gstatic.com/generate_204?turnout_probe=1086']])
  out[k] = await f(u);
out['站点：主 18085 死 → 备'] = { res: await f('http://site.turnout.test/1'), hits: take() };
servers.push(await startLogProxy(18085, hits));
out['主恢复（被标坏中），单一代理探测主'] = { res: await f('http://probe.turnout.test/generate_204?turnout_probe=18085'), hits: take() };
out['主恢复后普通站点仍走备？'] = { res: await f('http://site.turnout.test/2'), hits: take() };
console.log(JSON.stringify(out, null, 2));
await context.close();
servers.forEach((s) => { s.close(); s.closeAllConnections(); });
