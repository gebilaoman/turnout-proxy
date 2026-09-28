import { describe, expect, it } from 'vitest';
import { initialRuntimeState } from './runtime';

describe('initialRuntimeState', () => {
  it('启动时：健康未知、未确定出口、epoch 从 0 开始', () => {
    expect(initialRuntimeState()).toEqual({
      health: {},
      ports: {},
      effectiveExit: null,
      alert: 'none',
      alertDismissed: false,
      probeOk: true,
      control: 'ok',
      pacEpoch: 0,
      ruleUpdate: { status: 'ok' },
    });
  });

  it('每次返回新对象', () => {
    const a = initialRuntimeState();
    a.health.x = { status: 'unknown' };
    expect(initialRuntimeState().health).toEqual({});
  });
});
