// 解释某个网址会怎么走（弹窗「当前网站」显示用）。与 generatePac 中 FindProxyForURL 的判断顺序保持一致，
// explain.test.ts 会把两者逐一对比。
import type { PersistedConfig, SiteAction } from '../config';
import { normalizeDomain } from '../domain';
import type { CompiledRules } from '../rules';

export type RouteReason =
  | 'mode_direct' // 直连模式
  | 'exit_system' // 出口跟随系统，浏览器用系统代理设置
  | 'local' // 本机 / 内网主机名
  | 'site' // 命中「我的网站」
  | 'sub_except' // 命中订阅的 @@ 例外
  | 'sub_match' // 命中订阅规则
  | 'all' // 全部代理
  | 'default'; // 未命中，直连

export interface RouteExplanation {
  route: 'direct' | 'proxy' | 'system';
  reason: RouteReason;
  matched?: string; // 命中的域名（site / sub_* 时）
}

function suffixes(host: string): string[] {
  const out: string[] = [];
  let h = host;
  for (;;) {
    out.push(h);
    const i = h.indexOf('.');
    if (i < 0) return out;
    h = h.substring(i + 1);
  }
}

export function findSiteRule(host: string, rules: PersistedConfig['siteRules']): { domain: string; action: SiteAction } | null {
  const map = new Map(rules.map((r) => [r.domain, r.action]));
  for (const s of suffixes(host)) {
    const a = map.get(s);
    if (a) return { domain: s, action: a };
  }
  return null;
}

const isLocalHost = (h: string) => !h.includes('.') || h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';

export function explainRoute(url: string, config: PersistedConfig, rules: CompiledRules | null): RouteExplanation {
  const { mode, exit } = config.settings;
  if (mode === 'direct') return { route: 'direct', reason: 'mode_direct' };
  if (exit.kind === 'system') return { route: 'system', reason: 'exit_system' };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { route: 'direct', reason: 'default' };
  }
  if (isLocalHost(host)) return { route: 'direct', reason: 'local' };
  host = normalizeDomain(host) ?? host.toLowerCase();

  const site = findSiteRule(host, config.siteRules);
  if (mode === 'all') {
    if (site?.action === 'direct') return { route: 'direct', reason: 'site', matched: site.domain };
    return { route: 'proxy', reason: 'all' };
  }
  if (site) return { route: site.action === 'direct' ? 'direct' : 'proxy', reason: 'site', matched: site.domain };
  if (rules) {
    const except = new Set(rules.except);
    const match = new Set(rules.match);
    const sx = suffixes(host);
    const e = sx.find((s) => except.has(s));
    if (e) return { route: 'direct', reason: 'sub_except', matched: e };
    const m = sx.find((s) => match.has(s));
    if (m) return { route: 'proxy', reason: 'sub_match', matched: m };
    // PAC 中正则测试的是完整 url（https 会被 Chrome 剥离到 scheme://host/），这里按同样方式测试
    const u = new URL(url);
    const pacUrl = u.protocol === 'https:' ? `${u.protocol}//${u.host}/` : url;
    if (rules.regex.some((r) => new RegExp(r).test(pacUrl))) return { route: 'proxy', reason: 'sub_match' };
  }
  return { route: 'direct', reason: 'default' };
}
