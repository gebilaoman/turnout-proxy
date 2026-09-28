// 健康检测的网络部分（ARCHITECTURE §5）。只负责发请求并把结果归一成 FetchOutcome，判定在 core/health。
import type { Client } from '@/core/config';
import type { FetchOutcome } from '@/core/health';
import { probeUrl } from '@/core/pac';

export const PORT_TIMEOUT_MS = 1500;
// 略大于 Clash 系客户端的上游拨号超时（约 5.2 秒），以便拿到它返回的 502 而不是自己先超时
export const PROBE_TIMEOUT_MS = 6000;

export async function timedFetch(url: string, timeoutMs: number): Promise<FetchOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    // redirect: manual —— 被劫持到登录页（302）时拿到的是 opaqueredirect（status 0），不会被误判为 204
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'manual', signal: ctrl.signal });
    const ms = performance.now() - t0;
    await res.body?.cancel().catch(() => undefined);
    return { kind: 'response', status: res.status, ms };
  } catch {
    const ms = performance.now() - t0;
    return ctrl.signal.aborted ? { kind: 'timeout', ms } : { kind: 'error', ms };
  } finally {
    clearTimeout(timer);
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

// 第 1 级：只对本机地址做（host_permissions 只覆盖 127.0.0.1 / localhost）；其他地址返回 null，直接交给第 2 级
export function checkPort(c: Pick<Client, 'host' | 'port'>): Promise<FetchOutcome> | null {
  if (!LOOPBACK.has(c.host.toLowerCase())) return null;
  return timedFetch(`http://${c.host}:${c.port}/`, PORT_TIMEOUT_MS);
}

// 第 2 级：经 PAC 探测分支路由到指定代理
export function probeVia(key: string, nonce: string): Promise<FetchOutcome> {
  return timedFetch(probeUrl(key, nonce), PROBE_TIMEOUT_MS);
}
