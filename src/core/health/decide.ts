// 回落状态机（ARCHITECTURE §5）。纯函数：上一状态 + 检测结果 + 设置 → 新的实际出口与提示。
import type { ClientHealth, Exit, RuntimeAlert, Settings } from '../config';

// 提示类型：none / on_backup（主离线，已切到备用）/ can_switch_back（主已恢复，仍在用备用）/
// all_down（全部离线，保持代理）/ all_down_direct（全部离线，已按设置直连）
export type ExitAlert = RuntimeAlert;

export interface Decision {
  effectiveExit: Exit;
  alert: ExitAlert;
  bumpEpoch: boolean; // 需要让 Chrome 清掉坏代理标记（重新尝试主代理）
}

const isOnline = (h: ClientHealth | undefined) => h?.status === 'online';
const isOffline = (h: ClientHealth | undefined) => h?.status === 'offline';

export function decideExit(
  settings: Settings,
  prevEffective: Exit | null,
  prevHealth: Readonly<Record<string, ClientHealth>>,
  health: Readonly<Record<string, ClientHealth>>,
): Decision {
  const { exit, backupClientId, autoSwitchBack, allowDirectWhenAllDown } = settings;
  if (exit.kind === 'system') return { effectiveExit: exit, alert: 'none', bumpEpoch: false };

  const primary = exit.clientId;
  const backup = backupClientId;
  const onBackup = prevEffective?.kind === 'client' && prevEffective.clientId === backup && backup !== null;
  const primaryRecovered = isOffline(prevHealth[primary]) && isOnline(health[primary]);
  const toPrimary: Exit = { kind: 'client', clientId: primary };

  // 主在线
  if (!isOffline(health[primary])) {
    if (onBackup && backup && !autoSwitchBack && isOnline(health[primary])) {
      // 备用也挂了就没必要守着备用
      if (isOffline(health[backup])) return { effectiveExit: toPrimary, alert: 'none', bumpEpoch: true };
      return { effectiveExit: { kind: 'client', clientId: backup }, alert: 'can_switch_back', bumpEpoch: false };
    }
    if (onBackup && !isOnline(health[primary])) {
      // 主状态未知（尚未检测到）时保持现状
      return { effectiveExit: prevEffective, alert: 'on_backup', bumpEpoch: false };
    }
    return { effectiveExit: toPrimary, alert: 'none', bumpEpoch: primaryRecovered || onBackup };
  }

  // 主离线
  if (backup && !isOffline(health[backup])) {
    return { effectiveExit: { kind: 'client', clientId: backup }, alert: 'on_backup', bumpEpoch: isOffline(prevHealth[backup]) && isOnline(health[backup]) };
  }
  return { effectiveExit: toPrimary, alert: allowDirectWhenAllDown ? 'all_down_direct' : 'all_down', bumpEpoch: false };
}
