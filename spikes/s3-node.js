// S3（Node/V8 部分）：PAC 文本体积、编译耗时、单次 FindProxyForURL 耗时
import vm from 'node:vm';
import { hashPac, linearPac, synthDomains, loadGfw } from './lib/pacgen.js';
const gfw = loadGfw();
console.log('GFWList 编译统计', { matched: gfw.match.length, excepted: gfw.except.length, regex: gfw.regex.length, dropped: gfw.dropped });
const ROUTE = 'PROXY 127.0.0.1:7890; PROXY 127.0.0.1:7897';
const cfgs = {
  'hash GFWList': hashPac(gfw, ROUTE),
  'hash 5k': hashPac({ match: synthDomains(5000) }, ROUTE),
  'hash 20k': hashPac({ match: synthDomains(20000) }, ROUTE),
  'hash 50k': hashPac({ match: synthDomains(50000) }, ROUTE),
  'hash GFWList+200regex': hashPac({ ...gfw, regex: Array.from({ length: 200 }, (_, i) => `^https?:\\/\\/[^\\/]*r${i}x\\.net`) }, ROUTE),
  'linear GFWList': linearPac(gfw, ROUTE),
  'linear 5k': linearPac({ match: synthDomains(5000) }, ROUTE),
  'linear 20k': linearPac({ match: synthDomains(20000) }, ROUTE),
};
const hosts = ['www.google.com', 'a.b.c.d.youtube.com', 'www.baidu.com', 'static.cdn.qq.com', 'site4999.example52.com', 'nomatch.example.org', 'x.y.z.w.v.u.t.example.net'];
const rows = {};
for (const [k, src] of Object.entries(cfgs)) {
  const ascii = /^[\x00-\x7f]*$/.test(src);
  let t0 = performance.now();
  const ctx = vm.createContext({ isPlainHostName: (h) => !h.includes('.') });
  new vm.Script(src).runInContext(ctx);
  const compileMs = performance.now() - t0;
  const fn = ctx.FindProxyForURL;
  t0 = performance.now(); fn('http://' + hosts[0] + '/', hosts[0]); const firstCallMs = performance.now() - t0;
  const N = 20000; t0 = performance.now();
  for (let i = 0; i < N; i++) { const h = hosts[i % hosts.length]; fn('https://' + h + '/', h); }
  const perCallUs = ((performance.now() - t0) / N) * 1000;
  rows[k] = { KB: Math.round(src.length / 1024), ascii, compileMs: +compileMs.toFixed(1), firstCallMs: +firstCallMs.toFixed(2), perCallUs: +perCallUs.toFixed(2) };
}
console.table(rows);
