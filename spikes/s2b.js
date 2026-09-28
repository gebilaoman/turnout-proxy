// S2 补充：Blocking 模式下，公网 https 网页及其子请求经 127.0.0.1 本地代理，是否被 LNA 拦截
import { launch } from './lib/launch.js';
import { startTunnel } from './lib/tunnel.js';
const tlog = []; const srv = await startTunnel(18086, tlog);
const out = {};
for (const [mode, opt] of Object.entries({ 'Finch 默认': { clean: true, seed: true }, '强制 Blocking': { clean: true, seed: true, labs: ['local-network-access-check@2'] } })) {
  const { context, sw } = await launch(opt);
  await sw.evaluate((d) => spike.setPac(d), 'function FindProxyForURL(url, host) { if (host === "127.0.0.1" || host === "localhost") return "DIRECT"; return "PROXY 127.0.0.1:18086"; }');
  const p = await context.newPage();
  const r = {};
  for (const u of ['https://example.com/', 'https://www.baidu.com/', 'http://www.baidu.com/']) {
    try { const resp = await p.goto(u, { timeout: 20000 }); r[u] = resp.status(); } catch (e) { r[u] = 'ERR ' + e.message.split('\n')[0]; }
  }
  r['baidu 页内 fetch https://www.baidu.com/favicon.ico'] = await p.evaluate(async () => { try { return (await fetch('https://www.baidu.com/favicon.ico')).status; } catch (e) { return 'ERR ' + e; } });
  r['baidu 页内 fetch http://127.0.0.1:7890/（公网页→本机，参照）'] = await p.evaluate(async () => { const c = new AbortController(); setTimeout(() => c.abort(), 4000); try { return (await fetch('http://127.0.0.1:7890/', { signal: c.signal })).status; } catch (e) { return 'ERR ' + e; } });
  r.tunnel = tlog.splice(0).filter((x) => /example|baidu/.test(x));
  out[mode] = r;
  await context.close();
}
console.log(JSON.stringify(out, null, 2));
srv.close(); srv.closeAllConnections?.();
