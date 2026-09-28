import { launch } from './lib/launch.js';
import { startLogProxy } from './lib/logproxy.js';
const hits = []; const srv = await startLogProxy(18083, hits);
const { context, sw } = await launch({ manifestPatch: { host_permissions: ['http://127.0.0.1/*', 'http://www.gstatic.com/*', 'http://cp.cloudflare.com/*', 'http://connectivitycheck.gstatic.com/*', 'http://captive.apple.com/*', 'http://detectportal.firefox.com/*'] } });
await sw.evaluate((d) => spike.setPac(d), `function FindProxyForURL(url, host) {
  if (/[?&]turnout_probe=7890/.test(url)) return "PROXY 127.0.0.1:7890";
  return "PROXY 127.0.0.1:18083"; }`);
for (const u of ['http://cp.cloudflare.com/generate_204', 'http://www.gstatic.com/generate_204', 'http://connectivitycheck.gstatic.com/generate_204', 'http://captive.apple.com/hotspot-detect.html', 'http://detectportal.firefox.com/success.txt']) {
  const r = await sw.evaluate((u) => spike.timedFetch(u + '?turnout_probe=7890'), u);
  console.log(u, JSON.stringify(r), hits.splice(0).map((h) => h.method + ' ' + h.url).filter((x) => !x.includes('google.com:443') || x.includes('gstatic')));
}
await context.close(); srv.close(); srv.closeAllConnections();
