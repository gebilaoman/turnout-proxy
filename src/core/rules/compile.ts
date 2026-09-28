// AutoProxy / GFWList 规则订阅的解析与编译（ARCHITECTURE §4）。
// 输出按域名后缀查找的表，供 core/pac 生成哈希表 PAC；不生成任何可执行代码。
import { err, ok, type Result } from '../result';

export const MAX_REGEX_RULES = 200;

export interface RuleStats {
  matched: number;
  excepted: number;
  regex: number;
  dropped: number; // 不支持的写法（关键字、通配 URL 片段、非法域名等）
  regexDropped: number; // 超过 MAX_REGEX_RULES 或无法编译的正则
}

export interface CompiledRules {
  match: string[]; // 排序、去重后的域名
  except: string[];
  regex: string[]; // 正则源码（不含两侧斜杠），生成 PAC 时用 new RegExp 输出
  stats: RuleStats;
}

export type RuleParseError = { code: 'not_autoproxy' } | { code: 'decode_failed' } | { code: 'no_rules' };

const HEADER_RE = /^\s*\[AutoProxy[^\]]*\]/i;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// 明文直接返回；否则按 base64 解码（GFWList 官方发布为 base64）。
export function decodeRuleText(text: string): Result<string, RuleParseError> {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (HEADER_RE.test(trimmed)) return ok(trimmed);
  const compact = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 === 1) return err({ code: 'decode_failed' });
  let decoded: string;
  try {
    const bin = atob(compact);
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return err({ code: 'decode_failed' });
  }
  decoded = decoded.replace(/^\uFEFF/, '').trim();
  return HEADER_RE.test(decoded) ? ok(decoded) : err({ code: 'not_autoproxy' });
}

// 规范化域名：小写、国际化域名转 punycode（Chrome 传给 PAC 的 host 是 punycode）、去掉末尾点。
// 不合法返回 null。
export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!d || d.includes('*')) return null;
  if (/[^\x21-\x7e]/.test(d)) {
    try {
      d = new URL(`http://${d}/`).hostname;
    } catch {
      return null;
    }
  }
  if (d.length > 253) return null;
  const labels = d.split('.');
  if (labels.length < 2) return null;
  return labels.every((l) => LABEL_RE.test(l)) ? d : null;
}

// 从一条去掉 @@ 前缀后的规则中提取域名；不是域名类规则返回 null。
function domainOfRule(rule: string): string | null {
  let rest: string;
  if (rule.startsWith('||')) rest = rule.slice(2);
  else if (/^\|https?:\/\//i.test(rule)) rest = rule.replace(/^\|https?:\/\//i, '');
  else if (/^\.?[^\s/|*?^:]+$/.test(rule)) rest = rule.replace(/^\./, ''); // 无前缀的纯域名行
  else return null;
  const host = rest.split(/[/^:?#]/, 1)[0] ?? '';
  return normalizeDomain(host);
}

function isValidRegex(src: string): boolean {
  try {
    new RegExp(src);
    return true;
  } catch {
    return false;
  }
}

export function compileRuleText(text: string): CompiledRules {
  const match = new Set<string>();
  const except = new Set<string>();
  const regex: string[] = [];
  const stats: RuleStats = { matched: 0, excepted: 0, regex: 0, dropped: 0, regexDropped: 0 };

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    const isExcept = line.startsWith('@@');
    if (isExcept) line = line.slice(2);

    if (line.length > 2 && line.startsWith('/') && line.endsWith('/')) {
      const src = line.slice(1, -1);
      // 例外正则首版不支持（极少见），计入丢弃
      if (isExcept) stats.dropped++;
      else if (regex.length >= MAX_REGEX_RULES || !isValidRegex(src)) stats.regexDropped++;
      else regex.push(src);
      continue;
    }
    const domain = domainOfRule(line);
    if (!domain) {
      stats.dropped++;
      continue;
    }
    (isExcept ? except : match).add(domain);
  }

  const sortedMatch = [...match].sort();
  const sortedExcept = [...except].sort();
  stats.matched = sortedMatch.length;
  stats.excepted = sortedExcept.length;
  stats.regex = regex.length;
  return { match: sortedMatch, except: sortedExcept, regex, stats };
}

// 订阅内容 → 编译结果。编译后一条可代理的规则都没有也视为失败（CLAUDE.md「网络请求」）。
export function parseRuleList(text: string): Result<CompiledRules, RuleParseError> {
  const decoded = decodeRuleText(text);
  if (!decoded.ok) return decoded;
  const compiled = compileRuleText(decoded.value);
  if (compiled.stats.matched === 0) return err({ code: 'no_rules' });
  return ok(compiled);
}
