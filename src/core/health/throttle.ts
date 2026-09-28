// onProxyError 触发复查的节流（ARCHITECTURE §5）。事件不带 URL，自家探测失败也会触发，
// 因此：探测进行中收到的事件忽略；两次复查间隔不少于 MIN_RECHECK_MS。时间戳由调用方存 storage.session。
export const MIN_RECHECK_MS = 10_000;

export function shouldRecheck(now: number, lastRecheckAt: number | null, probingUntil: number | null): boolean {
  if (probingUntil !== null && now < probingUntil) return false;
  return lastRecheckAt === null || now - lastRecheckAt >= MIN_RECHECK_MS;
}
