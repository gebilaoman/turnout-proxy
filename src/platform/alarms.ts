// chrome.alarms 适配。周期任务只用 alarms（CLAUDE.md「后台 Service Worker」）。
import { browser } from '#imports';
import type { RuleSource } from '@/core/config';

export const HEALTH_ALARM = 'health';
export const RULES_ALARM = 'rules';

const RULE_PERIOD_MIN = { daily: 24 * 60, weekly: 7 * 24 * 60 } as const;

export async function scheduleAlarms(hasClients: boolean, ruleSource: RuleSource): Promise<void> {
  const health = await browser.alarms.get(HEALTH_ALARM);
  if (hasClients && !health) await browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
  if (!hasClients && health) await browser.alarms.clear(HEALTH_ALARM);

  // 内置规则只有离线副本，不定时更新；自定义订阅按设置的间隔
  const period = ruleSource.kind === 'custom' && ruleSource.updateInterval !== 'off' ? RULE_PERIOD_MIN[ruleSource.updateInterval] : null;
  const rules = await browser.alarms.get(RULES_ALARM);
  if (period === null) {
    if (rules) await browser.alarms.clear(RULES_ALARM);
  } else if (rules?.periodInMinutes !== period) {
    await browser.alarms.create(RULES_ALARM, { periodInMinutes: period, delayInMinutes: period });
  }
}
