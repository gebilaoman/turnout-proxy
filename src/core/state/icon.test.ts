import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../config';
import { iconState } from './icon';

const s = defaultConfig().settings;
describe('iconState', () => {
  it('被接管 / 策略锁定优先显示异常', () => {
    expect(iconState({ ...s, mode: 'direct' }, { control: 'other_extension' }, 'none')).toBe('error');
    expect(iconState(s, { control: 'policy' }, 'none')).toBe('error');
  });
  it('直连', () => expect(iconState({ ...s, mode: 'direct' }, { control: 'ok' }, 'all_down')).toBe('direct'));
  it.each([
    ['none', 'normal'],
    ['on_backup', 'backup'],
    ['can_switch_back', 'backup'],
    ['all_down', 'error'],
    ['all_down_direct', 'error'],
  ] as const)('%s → %s', (alert, icon) => expect(iconState(s, { control: 'ok' }, alert)).toBe(icon));
});
