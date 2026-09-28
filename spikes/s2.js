// S2：Chrome 稳定版的本地网络访问（LNA）限制对扩展探测 127.0.0.1 与经本地代理上网的影响
import { launch } from './lib/launch.js';
import { startLogProxy } from './lib/logproxy.js';
const hits = [];
const srv = await startLogProxy(18081, hits);
const TARGETS = { 'FlClash 7890': 'http://127.0.0.1:7890/', 'FlClash localhost:7890': 'http://localhost:7890/', 'privoxy 1087': 'http://127.0.0.1:1087/',
  'ss-local 1086 (SOCKS)': 'http://127.0.0.1:1086/', '关闭端口 18099': 'http://127.0.0.1:18099/', '本地 HTTP 18081': 'http://127.0.0.1:18081/' };
const PERM_NAMES = ['local-network-access', 'loopback-network', 'local-network'];
const MODES = { 'Finch 默认（真实种子）': { clean: true, seed: true }, '强制 Enabled (Blocking)': { clean: true, seed: true, labs: ['local-network-access-check@2'] } };
const permsExpr = async (names) => { const o = {}; for (const n of names) { try { o[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { o[n] = 'ERR ' + e.name; } } return o; };
const result = {};
for (const [mode, opt] of Object.entries(MODES)) {
  for (const hostPerm of [true, false]) {
    const console_ = [];
    const { context, sw, extId } = await launch({ ...opt, manifestPatch: hostPerm ? {} : { host_permissions: [] } });
    context.on('console', (m) => console_.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
    const key = `${mode} / host_permissions=${hostPerm ? '有' : '无'}`;
    const r = (result[key] = { sw: {}, extPage: {} });
    for (const [k, u] of Object.entries(TARGETS)) r.sw[k] = await sw.evaluate((u) => spike.timedFetch(u, {}, 4000), u);
    r.swPerms = await sw.evaluate(permsExpr, PERM_NAMES);
    const page = await context.newPage();
    page.on('console', (m) => console_.push(`[page ${m.type()}] ${m.text()}`.slice(0, 300)));
    await page.goto(`chrome-extension://${extId}/page.html`);
    for (const [k, u] of Object.entries(TARGETS)) r.extPage[k] = await page.evaluate((u) => timedFetch(u, {}, 4000), u);
    r.extPagePerms = await page.evaluate(permsExpr, PERM_NAMES);
    if (hostPerm) {
      // 参照：公网网页直接 fetch 127.0.0.1
      const web = await context.newPage();
      web.on('console', (m) => console_.push(`[web ${m.type()}] ${m.text()}`.slice(0, 300)));
      try {
        await web.goto('https://example.com/', { timeout: 15000 });
        r.webPage = await web.evaluate(async (u) => { const t0 = performance.now(); const c = new AbortController(); setTimeout(() => c.abort(), 4000);
          try { const x = await fetch(u, { signal: c.signal }); return { ok: true, status: x.status, ms: Math.round(performance.now() - t0) }; } catch (e) { return { ok: false, error: String(e), ms: Math.round(performance.now() - t0) }; } }, 'http://127.0.0.1:18081/');
        r.webPerms = await web.evaluate(permsExpr, PERM_NAMES);
      } catch (e) { r.webPage = 'example.com 打不开: ' + e.message.split('\n')[0]; }
      // 关键：网页经 PAC → 127.0.0.1 本地代理 上网，是否受 LNA 影响
      await sw.evaluate((d) => spike.setPac(d), `function FindProxyForURL(url, host) { if (host === "www.gstatic.com") return "PROXY 127.0.0.1:7890"; if (host === "site.turnout.test") return "PROXY 127.0.0.1:18081"; return "DIRECT"; }`);
      const nav = await context.newPage();
      const navRes = {};
      for (const u of ['http://site.turnout.test/nav', 'https://www.gstatic.com/generate_204']) {
        try { const resp = await nav.goto(u, { timeout: 15000 }); navRes[u] = resp ? resp.status() : 'no response'; } catch (e) { navRes[u] = 'ERR ' + e.message.split('\n')[0]; }
      }
      if (typeof r.webPage === 'object') navRes['example.com 页面内 fetch(https://www.gstatic.com/generate_204) 经本地代理'] = await web.evaluate(async () => { try { const x = await fetch('https://www.gstatic.com/generate_204', { mode: 'no-cors' }); return 'ok ' + x.type; } catch (e) { return 'ERR ' + e; } });
      r.viaLocalProxy = navRes;
      r.logproxyHits = hits.splice(0).map((h) => h.method + ' ' + h.url);
    }
    r.console = [...new Set(console_)].slice(0, 30);
    await context.close();
    process.stderr.write('done ' + key + '\n');
  }
}
console.log(JSON.stringify(result, null, 2));
srv.close(); srv.closeAllConnections();
