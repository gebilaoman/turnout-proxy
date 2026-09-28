// 运行时状态（ARCHITECTURE §2）：存 storage.session，浏览器重启即清空、可随时重算，
// 由扩展自己写入，不参与导出，因此只定义类型、不做 zod 校验。
import type { Exit } from './schema';

export type ClientHealth =
  | { status: 'online'; latencyMs: number; checkedAt: string }
  | { status: 'offline'; reason: 'refused' | 'timeout' | 'proxy_error'; checkedAt: string }
  | { status: 'unknown' };

// 第 1 级检测结果（端口是否在听），在无法做第 2 级（直连 / 跟随系统模式）时也能显示
export type PortState = 'http' | 'refused' | 'maybe_socks';

// 与 core/health/decide 的 ExitAlert 相同；在此重复定义以免 config 依赖 health
export type RuntimeAlert = 'none' | 'on_backup' | 'can_switch_back' | 'all_down' | 'all_down_direct';

export interface RuntimeState {
  health: Record<string, ClientHealth>; // key = clientId
  ports: Record<string, PortState>; // key = clientId
  effectiveExit: Exit | null; // 实际在用的出口（主或备）
  alert: RuntimeAlert;
  alertDismissed: boolean; // 用户在弹窗点了「知道了」；提示类型变化时重置
  probeOk: boolean; // 金丝雀校验是否通过（ARCHITECTURE §5）
  lastCheckAt?: string;
  exitIp?: { ip: string; region?: string; checkedAt: string };
  control: 'ok' | 'other_extension' | 'policy';
  pacEpoch: number; // ARCHITECTURE §3：恢复主代理时递增，迫使 Chrome 清除坏代理标记
  ruleUpdate: { status: 'ok' | 'failed' | 'updating'; error?: string; at?: string };
}

export function initialRuntimeState(): RuntimeState {
  return {
    health: {},
    ports: {},
    effectiveExit: null,
    alert: 'none',
    alertDismissed: false,
    probeOk: true,
    control: 'ok',
    pacEpoch: 0,
    ruleUpdate: { status: 'ok' },
  };
}
