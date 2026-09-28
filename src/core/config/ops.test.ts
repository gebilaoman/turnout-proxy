import { describe, expect, it } from 'vitest';
import { defaultConfig } from './defaults';
import { addClient, findByAddress, removeClient, setBackup, setExit, setFallbackOptions, setMode, setRuleSource, updateClient } from './ops';
import type { Client, PersistedConfig } from './schema';
import { validateConfig } from './transfer';

const a: Client = { id: 'a', name: 'FlClash', host: '127.0.0.1', port: 7890, scheme: 'mixed', source: 'discovered' };
const b: Client = { id: 'b', name: '万达云', host: '127.0.0.1', port: 7892, scheme: 'mixed', source: 'discovered' };

function two(): PersistedConfig {
  return setBackup(addClient(addClient(defaultConfig(), a), b), 'b');
}

describe('config ops', () => {
  it('第一个客户端自动成为出口，之后的不改出口', () => {
    const cfg = two();
    expect(cfg.settings.exit).toEqual({ kind: 'client', clientId: 'a' });
    expect(cfg.settings.backupClientId).toBe('b');
    expect(validateConfig(cfg).ok).toBe(true);
  });

  it('已选择跟随系统时加第一个客户端不覆盖（只在默认的 system 出口上自动设置）', () => {
    const cfg = addClient(defaultConfig(), a);
    expect(removeClient(cfg, 'a').settings.exit).toEqual({ kind: 'system' });
  });

  it('不修改入参', () => {
    const cfg = two();
    const snap = structuredClone(cfg);
    setMode(cfg, 'direct');
    setExit(cfg, { kind: 'system' });
    removeClient(cfg, 'a');
    updateClient(cfg, { ...a, name: 'x' });
    expect(cfg).toEqual(snap);
  });

  it('setMode', () => expect(setMode(two(), 'all').settings.mode).toBe('all'));

  it('切到备用作为出口时，原出口变成备用', () => {
    const cfg = setExit(two(), { kind: 'client', clientId: 'b' });
    expect(cfg.settings).toMatchObject({ exit: { kind: 'client', clientId: 'b' }, backupClientId: 'a' });
    expect(validateConfig(cfg).ok).toBe(true);
  });

  it('从跟随系统切到备用客户端时，备用清空', () => {
    const sys = setExit(two(), { kind: 'system' });
    expect(setExit(sys, { kind: 'client', clientId: 'b' }).settings.backupClientId).toBeNull();
  });

  it('切到跟随系统保留备用', () => expect(setExit(two(), { kind: 'system' }).settings.backupClientId).toBe('b'));

  it('删除出口客户端 → 备用接替出口', () => {
    const cfg = removeClient(two(), 'a');
    expect(cfg.settings).toMatchObject({ exit: { kind: 'client', clientId: 'b' }, backupClientId: null });
    expect(validateConfig(cfg).ok).toBe(true);
  });

  it('删除唯一客户端 → 跟随系统', () => {
    const cfg = removeClient(addClient(defaultConfig(), a), 'a');
    expect(cfg.settings.exit).toEqual({ kind: 'system' });
    expect(validateConfig(cfg).ok).toBe(true);
  });

  it('删除备用 → 备用清空', () => {
    const cfg = removeClient(two(), 'b');
    expect(cfg.settings).toMatchObject({ exit: { kind: 'client', clientId: 'a' }, backupClientId: null });
  });

  it('updateClient 按 id 替换', () => expect(updateClient(two(), { ...b, port: 7899 }).clients[1]?.port).toBe(7899));

  it('setFallbackOptions 只改传入的项', () => {
    const cfg = setFallbackOptions(two(), { autoSwitchBack: true });
    expect(cfg.settings).toMatchObject({ autoSwitchBack: true, allowDirectWhenAllDown: false });
    expect(setFallbackOptions(cfg, { allowDirectWhenAllDown: true }).settings).toMatchObject({ autoSwitchBack: true, allowDirectWhenAllDown: true });
  });

  it('setRuleSource', () => {
    const src = { kind: 'custom', url: 'https://example.com/l.txt', updateInterval: 'weekly' } as const;
    expect(setRuleSource(two(), src).ruleSource).toEqual(src);
  });

  it('findByAddress 忽略 host 大小写', () => {
    expect(findByAddress(two(), '127.0.0.1', 7892)?.id).toBe('b');
    expect(findByAddress(addClient(defaultConfig(), { ...a, host: 'LocalHost' }), 'localhost', 7890)?.id).toBe('a');
    expect(findByAddress(two(), '127.0.0.1', 1)).toBeUndefined();
  });
});
