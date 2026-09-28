import { describe, expect, it } from 'vitest';
import { defaultConfig } from './defaults';
import type { MigrationTable } from './migrations';
import type { PersistedConfig } from './schema';
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
    expect(JSON.parse(text)).toMatchObject({ format: 'turnout', version: 1 });
    expect(exportConfig(sample())).toBe(text);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('importConfig', () => {
  it('导出后再导入得到相同配置', () => {
    expect(importConfig(exportConfig(sample()))).toEqual({ ok: true, config: sample(), migratedFrom: 1 });
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
    expect(importConfig(text)).toEqual({ ok: false, error: { code: 'newer_version', version: 99, supported: 1 } });
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

  it('旧版本文件先迁移再校验', () => {
    // 假设 v2 把 settings.mode 的旧值 "proxy" 改名为 "all"
    const migrations: MigrationTable = {
      2: (old) => {
        const settings = old.settings as Record<string, unknown>;
        return { ...old, settings: { ...settings, mode: settings.mode === 'proxy' ? 'all' : settings.mode } };
      },
    };
    const v1 = { ...JSON.parse(exportConfig(sample())), version: 1 };
    v1.settings.mode = 'proxy';
    const r = importConfig(JSON.stringify(v1), migrations, 2);
    // 当前 schema 只接受 version 1，所以 v2 结果必然报 version；关键在于只剩这一条——
    // 若迁移没执行，mode: "proxy" 也会报错。
    expect(r.ok).toBe(false);
    if (r.ok || r.error.code !== 'invalid_config') throw new Error('expected invalid_config');
    expect(r.error.issues).toEqual([{ path: ['version'], code: 'invalid_value' }]);
  });

  it('多余字段被丢弃，不会带进配置', () => {
    const file = { ...JSON.parse(exportConfig(sample())), telemetry: true };
    const r = importConfig(JSON.stringify(file));
    expect(r.ok && 'telemetry' in r.config).toBe(false);
  });
});
