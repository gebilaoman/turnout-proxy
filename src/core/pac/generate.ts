// PAC 生成（ARCHITECTURE §3）。纯函数：输入相同则输出字节级相同；输出只含 ASCII。
// 只输出数据表和一个很小的查找函数，规则内容一律作为字符串数据写入，不拼接成代码。
import type { Client, ProxyScheme, SiteRule } from '../config';
import type { CompiledRules } from '../rules';

export const PROBE_HOST = 'connectivitycheck.gstatic.com';
export const PROBE_PARAM = 'turnout_probe';
export const CANARY_KEY = 'canary';
// 金丝雀：端口 9（discard）按约定没有服务监听，经它的探测必须失败
export const CANARY_PROXY = 'PROXY 127.0.0.1:9';
// 出口 IP 查询（Cloudflare trace）。PAC 固定把这个主机名交给当前出口，显示的就是经客户端出去的 IP
export const EXIT_IP_HOST = 'one.one.one.one';
export const EXIT_IP_URL = `https://${EXIT_IP_HOST}/cdn-cgi/trace`;

export function proxyToken(c: Pick<Client, 'host' | 'port' | 'scheme'>): string {
  const host = c.host.includes(':') && !c.host.startsWith('[') ? `[${c.host}]` : c.host;
  return `${c.scheme === 'socks5' ? 'SOCKS5' : 'PROXY'} ${host}:${c.port}`;
}

// 探测键：h<端口> 走 PROXY，s<端口> 走 SOCKS5（ARCHITECTURE §5：探测 URL 中写端口）
export function probeKey(port: number, scheme: ProxyScheme): string {
  return `${scheme === 'socks5' ? 's' : 'h'}${port}`;
}

export function probeUrl(key: string, nonce?: string): string {
  return `http://${PROBE_HOST}/generate_204?${PROBE_PARAM}=${key}${nonce ? `&n=${nonce}` : ''}`;
}

export type PacRouting =
  | { kind: 'all'; route: string[] } // 全部代理：所有请求返回 route
  | { kind: 'smart'; route: string[]; rules: CompiledRules; extraMatch?: readonly string[] };

export interface PacInput {
  routing: PacRouting;
  probes: Readonly<Record<string, string>>; // 探测键 → 单一代理串
  siteRules?: readonly SiteRule[]; // 「我的网站」，优先于规则订阅；全部代理模式下只有「直连」条目生效
  epoch: number;
  version: string; // 扩展版本，写进首行注释
}

// 把字符串写成 JS 字符串字面量，并把所有非 ASCII 字符转成 \uXXXX
function lit(s: string): string {
  return JSON.stringify(s).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function table(keys: readonly string[]): string {
  if (keys.length === 0) return '{}';
  return `{\n${keys.map((k) => `${lit(k)}:1`).join(',\n')}\n}`;
}

function sortedEntries(o: Readonly<Record<string, string>>): [string, string][] {
  return Object.keys(o)
    .sort()
    .map((k) => [k, o[k] as string]);
}

// 简单、稳定的 32 位 FNV-1a 哈希，只用于首行注释标识配置内容，不用于安全目的
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function generatePac(input: PacInput): string {
  const { routing, probes, epoch, version } = input;
  const siteEntries = [...(input.siteRules ?? [])]
    .filter((r) => routing.kind === 'smart' || r.action === 'direct')
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0))
    .map((r) => `${lit(r.domain)}:${lit(r.action === 'direct' ? 'D' : 'P')}`);
  const siteTable = siteEntries.length === 0 ? '{}' : `{\n${siteEntries.join(',\n')}\n}`;
  const route = routing.route.join('; ');
  const probeTable = `{\n${sortedEntries({ ...probes, [CANARY_KEY]: CANARY_PROXY })
    .map(([k, v]) => `${lit(k)}:${lit(v)}`)
    .join(',\n')}\n}`;

  let body: string;
  if (routing.kind === 'all') {
    body = `var ROUTE = ${lit(route)};
function FindProxyForURL(url, host) {
  var p = probe(url, host);
  if (p) return p;
  if (host === ${lit(EXIT_IP_HOST)}) return ROUTE;
  if (isLocal(host)) return "DIRECT";
  if (site(host.toLowerCase()) === "D") return "DIRECT";
  return ROUTE;
}`;
  } else {
    const match = [...new Set([...routing.rules.match, ...(routing.extraMatch ?? [])])].sort();
    body = `var ROUTE = ${lit(route)};
var EXCEPT = ${table(routing.rules.except)};
var MATCH = ${table(match)};
var REGEX = [${routing.rules.regex.map((r) => `new RegExp(${lit(r)})`).join(',\n')}];
function hit(t, h) {
  for (;;) {
    if (Object.prototype.hasOwnProperty.call(t, h)) return true;
    var i = h.indexOf(".");
    if (i < 0) return false;
    h = h.substring(i + 1);
  }
}
function FindProxyForURL(url, host) {
  var p = probe(url, host);
  if (p) return p;
  if (host === ${lit(EXIT_IP_HOST)}) return ROUTE;
  if (isLocal(host)) return "DIRECT";
  host = host.toLowerCase();
  var s = site(host);
  if (s === "D") return "DIRECT";
  if (s === "P") return ROUTE;
  if (hit(EXCEPT, host)) return "DIRECT";
  if (hit(MATCH, host)) return ROUTE;
  for (var i = 0; i < REGEX.length; i++) if (REGEX[i].test(url)) return ROUTE;
  return "DIRECT";
}`;
  }

  const common = `var PROBES = ${probeTable};
function probe(url, host) {
  if (host !== ${lit(PROBE_HOST)}) return "";
  var m = /[?&]${PROBE_PARAM}=([0-9a-z]+)/.exec(url);
  if (m && Object.prototype.hasOwnProperty.call(PROBES, m[1])) return PROBES[m[1]];
  return "";
}
function isLocal(host) {
  return isPlainHostName(host) || host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}
var SITE = ${siteTable};
function site(h) {
  for (;;) {
    if (Object.prototype.hasOwnProperty.call(SITE, h)) return SITE[h];
    var i = h.indexOf(".");
    if (i < 0) return "";
    h = h.substring(i + 1);
  }
}`;

  const content = `${common}\n${body}\n`;
  return `// Turnout ${version} ${fnv1a(content)} epoch=${epoch}\n${content}`;
}
