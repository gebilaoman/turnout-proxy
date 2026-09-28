import { describe, expect, it } from 'vitest';
import { defaultConfig } from './defaults';
import { CONFIG_MIGRATIONS, migrateConfig, type Migration, type MigrationTable } from './migrations';
import { CURRENT_CONFIG_VERSION } from './schema';
import { validateConfig } from './transfer';

// 用于验证迁移执行器本身的假迁移表（v1 → v2 → v3），与真实配置结构无关。
const toV2: Migration = (old) => ({ ...old, renamed: old.legacy, legacy: undefined });
const toV3: Migration = (old) => ({ ...old, added: true });
const FIXTURE: MigrationTable = { 2: toV2, 3: toV3 };

describe('CONFIG_MIGRATIONS', () => {
  it('每个大于 1 的版本都有对应迁移', () => {
    for (let v = 2; v <= CURRENT_CONFIG_VERSION; v++) expect(CONFIG_MIGRATIONS[v], `缺少到 v${v} 的迁移`).toBeTypeOf('function');
  });

  it('当前版本的默认配置迁移后原样不变且合法', () => {
    const r = migrateConfig(defaultConfig());
    expect(r).toEqual({ ok: true, data: defaultConfig(), from: CURRENT_CONFIG_VERSION, to: CURRENT_CONFIG_VERSION });
    expect(r.ok && validateConfig(r.data).ok).toBe(true);
  });
});

describe('migrateConfig', () => {
  it('按顺序逐级执行并写入每一级的版本号', () => {
    const r = migrateConfig({ version: 1, legacy: 'x' }, FIXTURE, 3);
    expect(r).toEqual({ ok: true, from: 1, to: 3, data: { version: 3, renamed: 'x', legacy: undefined, added: true } });
  });

  it('从中间版本开始只执行剩余步骤', () => {
    const r = migrateConfig({ version: 2, renamed: 'y' }, FIXTURE, 3);
    expect(r).toEqual({ ok: true, from: 2, to: 3, data: { version: 3, renamed: 'y', added: true } });
  });

  it('不修改入参', () => {
    const input = { version: 1, legacy: 'x', nested: { a: 1 } };
    const snapshot = structuredClone(input);
    migrateConfig(input, FIXTURE, 3);
    expect(input).toEqual(snapshot);
  });

  it('拒绝比目标更新的版本，不降级', () => {
    expect(migrateConfig({ version: 4 }, FIXTURE, 3)).toEqual({ ok: false, error: { code: 'newer_version', version: 4, supported: 3 } });
  });

  it('缺少某一级迁移时报告缺的是哪一级', () => {
    expect(migrateConfig({ version: 1 }, { 3: toV3 }, 3)).toEqual({ ok: false, error: { code: 'missing_migration', to: 2 } });
  });

  it.each([null, 'str', 42, [1]])('非对象 %j', (raw) => {
    expect(migrateConfig(raw)).toEqual({ ok: false, error: { code: 'not_object' } });
  });

  it.each([undefined, '1', 0, 1.5, -1])('非法版本号 %j', (version) => {
    expect(migrateConfig({ version })).toEqual({ ok: false, error: { code: 'bad_version', version } });
  });
});

describe('v1 → v2', () => {
  it('补上空的 siteRules，结果是合法的当前版本配置', () => {
    const { siteRules: _s, ...v1 } = { ...defaultConfig(), version: 1 };
    const r = migrateConfig(v1);
    expect(r.ok && r.from).toBe(1);
    if (!r.ok) throw new Error('migrate failed');
    expect(r.data.siteRules).toEqual([]);
    expect(validateConfig(r.data).ok).toBe(true);
  });

  it('已有 siteRules（例如手工编辑过的文件）保留原样', () => {
    const v1 = { ...defaultConfig(), version: 1, siteRules: [{ domain: 'a.com', action: 'direct' }] };
    const r = migrateConfig(v1);
    expect(r.ok && r.data.siteRules).toEqual([{ domain: 'a.com', action: 'direct' }]);
  });
});
