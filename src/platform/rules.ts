// 规则订阅下载（ARCHITECTURE §4，CLAUDE.md「网络请求」）。检查状态码、响应头与内容；解析交给 core/rules。
import { browser } from '#imports';
import builtinText from '@/assets/rules/gfwlist.txt?raw';
import { err, ok, type Result } from '@/core/result';
import { parseRuleList, type RuleCache, type RuleParseError } from '@/core/rules';

export const BUILTIN_SOURCE = 'builtin:gfwlist-2026-09-28';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

export type RuleFetchError =
  | { code: 'no_permission' }
  | { code: 'timeout' }
  | { code: 'network' }
  | { code: 'http_status'; status: number }
  | { code: 'too_large' }
  | RuleParseError;

export function originPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

export async function hasOriginPermission(url: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [originPattern(url)] });
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function builtinRuleCache(): Promise<RuleCache> {
  const parsed = parseRuleList(builtinText);
  if (!parsed.ok) throw new Error(`builtin rules invalid: ${parsed.error.code}`);
  return { fetchedAt: '2026-09-28T00:00:00.000Z', sha256: await sha256(builtinText), compiled: parsed.value, sourceUrl: BUILTIN_SOURCE };
}

export async function fetchRuleCache(url: string): Promise<Result<RuleCache, RuleFetchError>> {
  if (!(await hasOriginPermission(url))) return err({ code: 'no_permission' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let text: string;
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    if (!res.ok) return err({ code: 'http_status', status: res.status });
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_BYTES) return err({ code: 'too_large' });
    text = await res.text();
  } catch {
    return err(ctrl.signal.aborted ? { code: 'timeout' } : { code: 'network' });
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_BYTES) return err({ code: 'too_large' });
  const parsed = parseRuleList(text);
  if (!parsed.ok) return parsed;
  return ok({ fetchedAt: new Date().toISOString(), sha256: await sha256(text), compiled: parsed.value, sourceUrl: url });
}
