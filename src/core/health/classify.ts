// 两级检测结果的判定（ARCHITECTURE §5，依据 M0 S2 / S5 实测语义）。
import type { ClientHealth, PortState } from '../config';

export type { PortState };

// platform/probe 把一次 fetch 的结果归一成这几种
export type FetchOutcome =
  | { kind: 'response'; status: number; ms: number }
  | { kind: 'error'; ms: number } // fetch 抛出网络错误（连接被拒绝、代理失败等）
  | { kind: 'timeout'; ms: number };

// 第 1 级：直接 GET 本机端口。收到任何 HTTP 响应（FlClash、万达云、privoxy 都回 400）即 HTTP / 混合端口；
// 立即失败 = 连接被拒绝；挂起到超时 = 很可能是纯 SOCKS 端口，交给第 2 级。
export function classifyPort(o: FetchOutcome): PortState {
  if (o.kind === 'response') return 'http';
  if (o.kind === 'timeout') return 'maybe_socks';
  return 'refused';
}

// 第 2 级：经 PAC 探测路由到该客户端，请求 generate_204。只有 204 算在线。
export function classifyProbe(port: PortState, probe: FetchOutcome | null, now: string): ClientHealth {
  if (port === 'refused') return { status: 'offline', reason: 'refused', checkedAt: now };
  if (!probe) return { status: 'unknown' }; // 未能做第 2 级（当前不是 PAC 模式）
  if (probe.kind === 'response' && probe.status === 204) return { status: 'online', latencyMs: Math.round(probe.ms), checkedAt: now };
  if (probe.kind === 'timeout') return { status: 'offline', reason: 'timeout', checkedAt: now };
  // 端口在听但探测失败 / 返回 500、502 等：代理本身或其上游坏了
  return { status: 'offline', reason: 'proxy_error', checkedAt: now };
}

// 金丝雀探测必须失败；若"成功"，说明 PAC 看不到探测参数，整轮第 2 级结果不可信
export function canaryHealthy(o: FetchOutcome): boolean {
  return o.kind !== 'response';
}
