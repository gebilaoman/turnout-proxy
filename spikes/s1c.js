import { launch } from './lib/launch.js';
const { context, sw } = await launch({ manifestPatch: { host_permissions: ['http://127.0.0.1/*', 'http://localhost/*', 'http://www.gstatic.com/*', 'http://cp.cloudflare.com/*'] } });
await sw.evaluate((d) => spike.setPac(d), `function FindProxyForURL(url, host) {
  var P = { "7890": "PROXY 127.0.0.1:7890", "7890s": "SOCKS5 127.0.0.1:7890" };
  var m = /[?&]turnout_probe=([0-9a-z]+)/.exec(url); if (m && P[m[1]]) return P[m[1]]; return "DIRECT"; }`);
const rows = [];
for (let i = 0; i < 6; i++) for (const u of ['http://cp.cloudflare.com/generate_204?turnout_probe=7890', 'http://cp.cloudflare.com/generate_204?turnout_probe=7890s', 'http://www.gstatic.com/generate_204?turnout_probe=7890'])
  rows.push({ u: u.replace('http://', '').replace('/generate_204', ''), ...(await sw.evaluate(([u, n]) => spike.timedFetch(u + '&n=' + n), [u, i])) });
console.table(rows);
await context.close();
