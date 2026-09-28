// 工具栏图标状态（docs/brand/README.md）：由设置与运行时状态决定，platform 只负责 setIcon。
import type { RuntimeState, Settings } from '../config';
import type { ExitAlert } from '../health';

export type IconState = 'normal' | 'backup' | 'direct' | 'error';

export function iconState(settings: Settings, runtime: Pick<RuntimeState, 'control'>, alert: ExitAlert): IconState {
  if (runtime.control !== 'ok') return 'error';
  if (settings.mode === 'direct') return 'direct';
  if (alert === 'all_down' || alert === 'all_down_direct') return 'error';
  if (alert === 'on_backup' || alert === 'can_switch_back') return 'backup';
  return 'normal';
}
