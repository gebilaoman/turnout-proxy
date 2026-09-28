import { describe, expect, it } from 'vitest';
import { defaultConfig } from './defaults';
import type { MigrationTable } from './migrations';
import { CURRENT_CONFIG_VERSION, type PersistedConfig } from './schema';
import { exportConfig, importConfig } from './transfer';

function sample(): PersistedConfig {
  const cfg = defaultConfig();
  cfg.clients = [
    { id: 'c1', name: 'FlClash', host: '127.0.0.1', port: 7890, scheme: 'mixed', source: 'discovered' },
    { id: 'c2', name: '万达云', host: '127.0.0.1', port: 7892, scheme: 'mixed', source: 'manual' },
  ];
  cfg.settings = { ...cfg.settings, mode: 'all', exit: { kind: 'client', clientId: 'c1' }, backupClientId: 'c2' };
  return cfg;
}

describe('exportConfig', () => {
  it('带 format 标记，输出稳定', () => {
    const text = exportConfig(sample());
    expect(JSON.parse(text)).toMatchObject({ format: 'turnout', version: CURRENT_CONFIG_VERSION, siteRules: [] });
    expect(exportConfig(sample())).toBe(text);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('importConfig', () => {
  it('导出后再导入得到相同配置', () => {
    expect(importConfig(exportConfig(sample()))).toEqual({ ok: true, config: sample(), migratedFrom: CURRENT_CONFIG_VERSION });
  });

  it('非 JSON', () => {
    expect(importConfig('{oops')).toEqual({ ok: false, error: { code: 'invalid_json' } });
  });

  it.each(['null', '[]', '"x"', '{"version":1}', '{"format":"zeroomega","version":1}'])('不是 Turnout 导出文件：%s', (text) => {
    expect(importConfig(text)).toEqual({ ok: false, error: { code: 'not_turnout' } });
  });

  it('版本号非法', () => {
    expect(importConfig('{"format":"turnout","version":"1"}')).toEqual({ ok: false, error: { code: 'bad_version', version: '1' } });
  });

  it('来自更新版本扩展的文件被拒绝', () => {
    const text = JSON.stringify({ ...JSON.parse(exportConfig(sample())), version: 99 });
    expect(importConfig(text)).toEqual({ ok: false, error: { code: 'newer_version', version: 99, supported: CURRENT_CONFIG_VERSION } });
  });

  it('结构不合法时返回字段路径与原因', () => {
    const file = JSON.parse(exportConfig(sample()));
    file.clients[0].port = 70000;
    file.settings.backupClientId = 'c1';
    const r = importConfig(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (r.ok || r.error.code !== 'invalid_config') throw new Error('expected invalid_config');
    expect(r.error.issues).toContainEqual({ path: ['clients', 0, 'port'], code: 'too_big' });
    expect(r.error.issues).toContainEqual({ path: ['settings', 'backupClientId'], code: 'backup_same_as_exit' });
  });

  it('0.1.0 导出的 v1 文件（没有 siteRules）可以导入', () => {
    const { siteRules: _s, ...v1 } = { ...JSON.parse(exportConfig(sample())), version: 1 };
    const r = importConfig(JSON.stringify(v1));
    expect(r).toEqual({ ok: true, config: sample(), migratedFrom: 1 });
  });

  it('迁移后仍要完整校验：迁移结果不合法时报 invalid_config', () => {
    const migrations: MigrationTable = { [CURRENT_CONFIG_VERSION + 1]: (old) => ({ ...old, clients: 'broken' }) };
    const r = importConfig(exportConfig(sample()), migrations, CURRENT_CONFIG_VERSION + 1);
    expect(r.ok).toBe(false);
    if (r.ok || r.error.code !== 'invalid_config') throw new Error('expected invalid_config');
    expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(expect.arrayContaining(['version', 'clients']));
  });

  it('多余字段被丢弃，不会带进配置', () => {
    const file = { ...JSON.parse(exportConfig(sample())), telemetry: true };
    const r = importConfig(JSON.stringify(file));
    expect(r.ok && 'telemetry' in r.config).toBe(false);
  });
});
