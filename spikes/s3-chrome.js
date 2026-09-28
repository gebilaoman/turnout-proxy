// S3（Chrome 部分）：大规则 PAC 下 proxy.settings.set 耗时与页面加载耗时
// 页面含 200 个子资源、分布在 200 个不同主机名上（每个主机名都要单独走一次 FindProxyForURL）：
// 150 个不命中规则走 DIRECT（--host-resolver-rules 映射到本机），50 个命中规则走本地记录型代理。
import http from 'node:http';
import { launch } from './lib/launch.js';
import { startLogProxy } from './lib/logproxy.js';
import { hashPac, linearPac, synthDomains, loadGfw } from './lib/pacgen.js';
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const web = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/page') {
    const run = u.searchParams.get('run');
    let html = '<!doctype html><title>s3</title>';
    for (let i = 0; i < 150; i++) html += `<img src="http://h${i}-${run}.s3test:18090/i.gif">`;
    for (let j = 0; j < 50; j++) html += `<img src="http://r${run}.p${j}.s3test:18090/i.gif">`;
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(html);
  }
  res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' }); res.end(GIF);
});
await new Promise((r) => web.listen(18090, '127.0.0.1', r));
const hits = []; const lp = await startLogProxy(18081, hits);
const ROUTE = 'PROXY 127.0.0.1:18081';
const P = Array.from({ length: 50 }, (_, j) => `p${j}.s3test`);
const gfw = loadGfw();
const CFGS = {
  'direct（无 PAC）': null,
  'PAC 最小（仅 50 条）': hashPac({ match: P }, ROUTE),
  'hash GFWList(4.3k)': hashPac({ ...gfw, match: [...gfw.match, ...P] }, ROUTE),
  'hash 20k': hashPac({ match: [...synthDomains(20000), ...P] }, ROUTE),
  'hash 50k': hashPac({ match: [...synthDomains(50000), ...P] }, ROUTE),
  'linear GFWList(4.3k)': linearPac({ match: [...gfw.match, ...P] }, ROUTE),
  'linear 20k': linearPac({ match: [...synthDomains(20000), ...P] }, ROUTE),
};
const { context, sw, version } = await launch({ args: ['--host-resolver-rules=MAP *.s3test 127.0.0.1'] });
const page = await context.newPage();
const rows = {};
let run = 0;
const load = async () => { run++; await page.goto(`http://page.s3test:18090/page?run=${run}`, { waitUntil: 'load' });
  return page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { load: Math.round(n.loadEventEnd), imgs: [...document.images].filter((i) => i.naturalWidth > 0).length }; }); };
for (const [k, pac] of Object.entries(CFGS)) {
  const t0 = performance.now();
  if (pac) await sw.evaluate((d) => spike.setPac(d), pac); else await sw.evaluate(() => spike.setDirect());
  const setMs = Math.round(performance.now() - t0);
  hits.length = 0;
  const first = await load();
  const proxied = hits.length;
  const ms = []; for (let i = 0; i < 7; i++) ms.push((await load()).load);
  ms.sort((a, b) => a - b);
  rows[k] = { KB: pac ? Math.round(pac.length / 1024) : 0, setMs, firstLoadMs: first.load, imgsOk: first.imgs, viaProxy: proxied, medianMs: ms[3], minMs: ms[0], maxMs: ms[6] };
  process.stderr.write(k + ' ' + JSON.stringify(rows[k]) + '\n');
}
console.log('Chrome', version); console.table(rows);
await context.close(); web.close(); web.closeAllConnections(); lp.close(); lp.closeAllConnections();
