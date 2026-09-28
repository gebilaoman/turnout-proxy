// spike 用的简易规则编译与 PAC 生成（仅为测量性能，不是 core/pac 的实现）
import fs from 'node:fs';
export function compileAutoProxy(text) {
  const match = new Set(), except = new Set(), regex = []; let dropped = 0;
  const domainOf = (s) => {
    s = s.replace(/^\|\|/, '').replace(/^\|https?:\/\//, '').replace(/^https?:\/\//, '').replace(/^\./, '');
    const d = s.split(/[\/:^?]/)[0];
    return /^[a-z0-9.-]+\.[a-z0-9-]+$/i.test(d) && !d.includes('*') ? d.toLowerCase() : null;
  };
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] === '!' || line[0] === '[') continue;
    let set = match;
    if (line.startsWith('@@')) { set = except; line = line.slice(2); }
    if (line.length > 2 && line[0] === '/' && line.endsWith('/')) { if (regex.length < 200) regex.push(line.slice(1, -1)); else dropped++; continue; }
    if (line.startsWith('||') || line.startsWith('|http') || /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(line)) { const d = domainOf(line); if (d) { set.add(d); continue; } }
    dropped++;
  }
  return { match: [...match].sort(), except: [...except].sort(), regex, dropped };
}
const esc = (s) => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const table = (arr) => '{' + arr.map((d) => JSON.stringify(d) + ':1').join(',') + '}';
export function hashPac({ match, except = [], regex = [] }, route) {
  return esc(`var ROUTE = ${JSON.stringify(route)};
var EXCEPT = ${table(except)};
var MATCH = ${table(match)};
var REGEX = [${regex.map((r) => 'new RegExp(' + JSON.stringify(r) + ')').join(',')}];
function hit(t, h) { for (;;) { if (t.hasOwnProperty(h)) return true; var i = h.indexOf("."); if (i < 0) return false; h = h.substring(i + 1); } }
function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || host === "127.0.0.1" || host === "localhost") return "DIRECT";
  if (hit(EXCEPT, host)) return "DIRECT";
  if (hit(MATCH, host)) return ROUTE;
  for (var i = 0; i < REGEX.length; i++) if (REGEX[i].test(url)) return ROUTE;
  return "DIRECT";
}`);
}
// 竞品常见写法的近似：每条规则一个正则，线性逐条匹配
export function linearPac({ match, regex = [] }, route) {
  const res = match.map((d) => '/(^|\\.)' + d.replace(/\./g, '\\.') + '$/').concat(regex.map((r) => 'new RegExp(' + JSON.stringify(r) + ')'));
  return esc(`var ROUTE = ${JSON.stringify(route)};
var RULES = [${res.join(',\n')}];
function FindProxyForURL(url, host) {
  for (var i = 0; i < RULES.length; i++) if (RULES[i].test(host)) return ROUTE;
  return "DIRECT";
}`);
}
export function synthDomains(n) { const a = []; for (let i = 0; i < n; i++) a.push(`site${i}.example${i % 97}.com`); return a; }
export function loadGfw() { return compileAutoProxy(fs.readFileSync(new URL('../data/gfwlist.txt', import.meta.url), 'utf8')); }
