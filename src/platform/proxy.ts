// chrome.proxy 适配（ARCHITECTURE §3、§6）。scope 固定为 regular，不使用 mandatory。
import { browser } from '#imports';
import type { RuntimeState } from '@/core/config';
import type { ProxyPlan } from '@/core/pac';

export type Control = RuntimeState['control'];

export function mapLevelOfControl(level: string | undefined): Control {
  if (level === 'controlled_by_other_extensions') return 'other_extension';
  if (level === 'not_controllable') return 'policy';
  return 'ok';
}

export async function readControl(): Promise<Control> {
  const d = await browser.proxy.settings.get({});
  return mapLevelOfControl(d.levelOfControl);
}

// 当前已生效的正是要应用的设置时跳过，避免每次检测都触发 onChange。
// 注意：内容相同的 set 本来也不会清除 Chrome 的坏代理标记（M0 S1），需要清除时由 PAC 的 epoch 保证内容不同。
function alreadyApplied(current: { levelOfControl: string; value: { mode?: string | undefined; pacScript?: { data?: string | undefined } | undefined } }, plan: ProxyPlan): boolean {
  if (plan.mode === 'system') return current.levelOfControl !== 'controlled_by_this_extension';
  if (current.levelOfControl !== 'controlled_by_this_extension') return false;
  if (plan.mode === 'direct') return current.value.mode === 'direct';
  return current.value.mode === 'pac_script' && current.value.pacScript?.data === plan.data;
}

// 「跟随系统」通过 clear 交还控制权，浏览器回到默认的系统代理；其余模式显式设置
export async function applyPlan(plan: ProxyPlan): Promise<void> {
  const current = await browser.proxy.settings.get({});
  if (alreadyApplied(current, plan)) return;
  if (plan.mode === 'system') {
    await browser.proxy.settings.clear({ scope: 'regular' });
    return;
  }
  const value = plan.mode === 'pac_script' ? { mode: 'pac_script' as const, pacScript: { data: plan.data } } : { mode: 'direct' as const };
  await browser.proxy.settings.set({ value, scope: 'regular' });
}
