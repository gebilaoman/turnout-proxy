import { describe, expect, it } from 'vitest';
import { defaultConfig } from './defaults';
import { validateConfig } from './transfer';
import type { Client, PersistedConfig } from './schema';

const flclash: Client = { id: 'c1', name: 'FlClash', host: '127.0.0.1', port: 7890, scheme: 'mixed', source: 'discovered' };
const wanda: Client = { id: 'c2', name: '万达云', host: '127.0.0.1', port: 7892, scheme: 'mixed', source: 'discovered' };

function withTwoClients(): PersistedConfig {
  const cfg = defaultConfig();
  cfg.clients = [flclash, wanda];
  cfg.settings.exit = { kind: 'client', clientId: 'c1' };
  cfg.settings.backupClientId = 'c2';
  return cfg;
}

const codes = (data: unknown) => {
  const r = validateConfig(data);
  return r.ok ? [] : r.issues.map((i) => `${i.path.join('.')}:${i.code}`);
};

describe('PersistedConfigSchema', () => {
  it('默认配置合法，且出口为跟随系统', () => {
    const cfg = defaultConfig();
    expect(validateConfig(cfg).ok).toBe(true);
    expect(cfg.settings.exit).toEqual({ kind: 'system' });
    expect(cfg.settings.allowDirectWhenAllDown).toBe(false);
  });

  it('defaultConfig 每次返回新对象', () => {
    const a = defaultConfig();
    a.clients.push(flclash);
    expect(defaultConfig().clients).toEqual([]);
  });

  it('主 + 备用的正常配置合法', () => {
    expect(codes(withTwoClients())).toEqual([]);
  });

  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['proxy.lan', true],
    ['[::1]', true],
    ['http://127.0.0.1', false],
    ['127.0.0.1:7890', false],
    ['a b', false],
    ['', false],
    ['-bad.host', false],
  ])('host %s → 合法=%s', (host, ok) => {
    const cfg = withTwoClients();
    cfg.clients[0] = { ...flclash, host };
    expect(validateConfig(cfg).ok).toBe(ok);
  });

  it.each([0, 65536, 1.5, -1])('端口 %s 不合法', (port) => {
    const cfg = withTwoClients();
    cfg.clients[0] = { ...flclash, port };
    expect(codes(cfg)).toContainEqual(expect.stringMatching(/^clients\.0\.port:/));
  });

  it('名称去除首尾空白后不能为空', () => {
    const cfg = withTwoClients();
    cfg.clients[0] = { ...flclash, name: '   ' };
    expect(codes(cfg)).toContainEqual(expect.stringMatching(/^clients\.0\.name:/));
  });

  it('客户端 id 不能重复', () => {
    const cfg = withTwoClients();
    cfg.clients[1] = { ...wanda, id: 'c1' };
    cfg.settings.backupClientId = null;
    expect(codes(cfg)).toContain('clients.1.id:duplicate_client_id');
  });

  it('出口指向不存在的客户端', () => {
    const cfg = withTwoClients();
    cfg.settings.exit = { kind: 'client', clientId: 'ghost' };
    expect(codes(cfg)).toContain('settings.exit.clientId:exit_client_missing');
  });

  it('备用指向不存在的客户端', () => {
    const cfg = withTwoClients();
    cfg.settings.backupClientId = 'ghost';
    expect(codes(cfg)).toContain('settings.backupClientId:backup_client_missing');
  });

  it('备用不能与出口是同一个客户端', () => {
    const cfg = withTwoClients();
    cfg.settings.backupClientId = 'c1';
    expect(codes(cfg)).toContain('settings.backupClientId:backup_same_as_exit');
  });

  it('出口为跟随系统时可以设置备用', () => {
    const cfg = withTwoClients();
    cfg.settings.exit = { kind: 'system' };
    expect(codes(cfg)).toEqual([]);
  });

  it('自定义规则源必须是 http(s) 地址', () => {
    const cfg = defaultConfig();
    expect(validateConfig({ ...cfg, ruleSource: { kind: 'custom', url: 'https://example.com/list.txt', updateInterval: 'weekly' } }).ok).toBe(true);
    expect(validateConfig({ ...cfg, ruleSource: { kind: 'custom', updateInterval: 'weekly' } }).ok).toBe(false);
    expect(validateConfig({ ...cfg, ruleSource: { kind: 'custom', url: 'ftp://example.com/x', updateInterval: 'weekly' } }).ok).toBe(false);
    expect(validateConfig({ ...cfg, ruleSource: { kind: 'custom', url: 'not a url', updateInterval: 'weekly' } }).ok).toBe(false);
  });

  it('版本号必须等于当前版本', () => {
    expect(codes({ ...defaultConfig(), version: 2 })).toContainEqual(expect.stringMatching(/^version:/));
  });

  it('未知枚举值与缺字段都被拒绝', () => {
    const cfg = defaultConfig();
    expect(validateConfig({ ...cfg, settings: { ...cfg.settings, mode: 'pac' } }).ok).toBe(false);
    const { ruleSource: _r, ...noRules } = cfg;
    expect(validateConfig(noRules).ok).toBe(false);
  });
});
