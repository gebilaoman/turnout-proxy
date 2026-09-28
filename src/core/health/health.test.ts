import { describe, expect, it } from 'vitest';
import type { ClientHealth, Settings } from '../config';
import { canaryHealthy, classifyPort, classifyProbe } from './classify';
import { decideExit } from './decide';
import { CANDIDATE_PORTS } from './ports';
import { MIN_RECHECK_MS, shouldRecheck } from './throttle';

const NOW = '2026-09-28T00:00:00.000Z';
const on: ClientHealth = { status: 'online', latencyMs: 100, checkedAt: NOW };
const off: ClientHealth = { status: 'offline', reason: 'refused', checkedAt: NOW };
const unk: ClientHealth = { status: 'unknown' };

describe('classifyPort', () => {
  it('HTTP 响应（400 也算）= 端口在听', () => expect(classifyPort({ kind: 'response', status: 400, ms: 3 })).toBe('http'));
  it('立即失败 = 拒绝', () => expect(classifyPort({ kind: 'error', ms: 3 })).toBe('refused'));
  it('超时 = 可能是 SOCKS', () => expect(classifyPort({ kind: 'timeout', ms: 1500 })).toBe('maybe_socks'));
});

describe('classifyProbe', () => {
  it('端口拒绝直接离线，不看探测', () => expect(classifyProbe('refused', null, NOW)).toEqual({ status: 'offline', reason: 'refused', checkedAt: NOW }));
  it('无法做第 2 级时未知', () => expect(classifyProbe('http', null, NOW)).toEqual({ status: 'unknown' }));
  it('只有 204 算在线，延迟取整', () => expect(classifyProbe('http', { kind: 'response', status: 204, ms: 185.6 }, NOW)).toEqual({ status: 'online', latencyMs: 186, checkedAt: NOW }));
  it.each([200, 500, 502])('%s → proxy_error', (status) =>
    expect(classifyProbe('http', { kind: 'response', status, ms: 10 }, NOW)).toEqual({ status: 'offline', reason: 'proxy_error', checkedAt: NOW }),
  );
  it('端口在听但探测网络错误 → proxy_error（万达云 SOCKS5 上游不通的情形）', () =>
    expect(classifyProbe('maybe_socks', { kind: 'error', ms: 10 }, NOW)).toEqual({ status: 'offline', reason: 'proxy_error', checkedAt: NOW }));
  it('探测超时 → timeout', () => expect(classifyProbe('http', { kind: 'timeout', ms: 5000 }, NOW)).toEqual({ status: 'offline', reason: 'timeout', checkedAt: NOW }));
});

describe('canaryHealthy', () => {
  it('金丝雀必须失败', () => {
    expect(canaryHealthy({ kind: 'error', ms: 3 })).toBe(true);
    expect(canaryHealthy({ kind: 'timeout', ms: 3 })).toBe(true);
    expect(canaryHealthy({ kind: 'response', status: 204, ms: 3 })).toBe(false);
  });
});

const S = (p: Partial<Settings> = {}): Settings => ({
  mode: 'all',
  exit: { kind: 'client', clientId: 'P' },
  backupClientId: 'B',
  allowDirectWhenAllDown: false,
  autoSwitchBack: false,
  ...p,
});
const P = { kind: 'client', clientId: 'P' } as const;
const B = { kind: 'client', clientId: 'B' } as const;

describe('decideExit', () => {
  it('出口跟随系统：不参与回落', () => expect(decideExit(S({ exit: { kind: 'system' } }), null, {}, {})).toEqual({ effectiveExit: { kind: 'system' }, alert: 'none', bumpEpoch: false }));
  it('启动时健康未知 → 用主', () => expect(decideExit(S(), null, {}, {})).toEqual({ effectiveExit: P, alert: 'none', bumpEpoch: false }));
  it('主在线 → 主', () => expect(decideExit(S(), P, { P: on }, { P: on, B: on })).toEqual({ effectiveExit: P, alert: 'none', bumpEpoch: false }));
  it('主短暂离线后恢复（一直在用主）→ 递增 epoch 清坏标记', () => expect(decideExit(S(), P, { P: off }, { P: on })).toEqual({ effectiveExit: P, alert: 'none', bumpEpoch: true }));
  it('主离线 & 备在线 → 切备', () => expect(decideExit(S(), P, { P: on, B: on }, { P: off, B: on })).toEqual({ effectiveExit: B, alert: 'on_backup', bumpEpoch: false }));
  it('主离线 & 备状态未知 → 仍切备（交给浏览器回落）', () => expect(decideExit(S(), P, {}, { P: off, B: unk })).toEqual({ effectiveExit: B, alert: 'on_backup', bumpEpoch: false }));
  it('在用备，备刚恢复 → 递增 epoch', () => expect(decideExit(S(), B, { P: off, B: off }, { P: off, B: on })).toEqual({ effectiveExit: B, alert: 'on_backup', bumpEpoch: true }));
  it('主恢复 & 不自动切回 → 保持备，提示可切回', () =>
    expect(decideExit(S(), B, { P: off, B: on }, { P: on, B: on })).toEqual({ effectiveExit: B, alert: 'can_switch_back', bumpEpoch: false }));
  it('主恢复 & 自动切回 → 主', () => expect(decideExit(S({ autoSwitchBack: true }), B, { P: off }, { P: on, B: on })).toEqual({ effectiveExit: P, alert: 'none', bumpEpoch: true }));
  it('主恢复但备已离线 → 回主', () => expect(decideExit(S(), B, { P: off, B: on }, { P: on, B: off })).toEqual({ effectiveExit: P, alert: 'none', bumpEpoch: true }));
  it('在用备，主状态未知 → 保持备', () => expect(decideExit(S(), B, {}, { P: unk, B: on })).toEqual({ effectiveExit: B, alert: 'on_backup', bumpEpoch: false }));
  it('全部离线 → 保持代理，红色提示', () => expect(decideExit(S(), P, {}, { P: off, B: off })).toEqual({ effectiveExit: P, alert: 'all_down', bumpEpoch: false }));
  it('全部离线 & 允许直连', () => expect(decideExit(S({ allowDirectWhenAllDown: true }), P, {}, { P: off, B: off })).toEqual({ effectiveExit: P, alert: 'all_down_direct', bumpEpoch: false }));
  it('无备用且主离线 → 全部离线', () => expect(decideExit(S({ backupClientId: null }), P, {}, { P: off })).toEqual({ effectiveExit: P, alert: 'all_down', bumpEpoch: false }));
});

describe('shouldRecheck', () => {
  it('首次允许', () => expect(shouldRecheck(1000, null, null)).toBe(true));
  it('间隔不足不允许，足够允许', () => {
    expect(shouldRecheck(1000 + MIN_RECHECK_MS - 1, 1000, null)).toBe(false);
    expect(shouldRecheck(1000 + MIN_RECHECK_MS, 1000, null)).toBe(true);
  });
  it('探测进行中收到的事件忽略', () => {
    expect(shouldRecheck(5000, null, 6000)).toBe(false);
    expect(shouldRecheck(6000, null, 6000)).toBe(true);
  });
});

describe('CANDIDATE_PORTS', () => {
  it('包含 ARCHITECTURE §5 列出的全部端口且不重复', () => {
    const ports = CANDIDATE_PORTS.map((c) => c.port);
    expect(new Set(ports).size).toBe(ports.length);
    expect([...ports].sort((a, b) => a - b)).toEqual([1080, 1086, 1087, 7890, 7891, 7892, 7897, 7898, 8888, 10808, 10809, 20171, 20172]);
  });
});
