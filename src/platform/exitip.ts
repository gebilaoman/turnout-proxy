// 出口 IP 查询（ARCHITECTURE §6）。请求经 PAC 的出口 IP 分支固定走当前出口；解析在 core/exitip。
import { parseTrace, type ExitIpInfo } from '@/core/exitip';
import { EXIT_IP_URL } from '@/core/pac';
import { err, ok, type Result } from '@/core/result';

const TIMEOUT_MS = 8000;

export async function fetchExitIp(): Promise<Result<ExitIpInfo, string>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXIT_IP_URL, { cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
    if (!res.ok) return err(`http_status:${res.status}`);
    if (!(res.headers.get('content-type') ?? '').startsWith('text/plain')) return err('bad_content');
    const info = parseTrace(await res.text());
    return info ? ok(info) : err('bad_content');
  } catch {
    return err(ctrl.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}
