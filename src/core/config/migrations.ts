// 配置版本迁移（ARCHITECTURE §7，CLAUDE.md「存储」）。
// 表的形状与 WXT storage.defineItem 的 migrations 一致：key 为目标版本，函数把上一版本的数据变成该版本。
// platform 层把同一张表交给 defineItem，也在导入文件时直接调用 migrateConfig。
// 规则：结构变更时递增 CURRENT_CONFIG_VERSION、在这里加一项、并在 migrations.test.ts 里为它写单测。
import { CURRENT_CONFIG_VERSION } from './schema';

export type Migration = (old: Record<string, unknown>) => Record<string, unknown>;
export type MigrationTable = Readonly<Record<number, Migration>>;

export const CONFIG_MIGRATIONS: MigrationTable = {
  // v2：新增「我的网站」列表
  2: (old) => ({ ...old, siteRules: Array.isArray(old.siteRules) ? old.siteRules : [] }),
};

export type MigrateError =
  | { code: 'not_object' }
  | { code: 'bad_version'; version: unknown }
  | { code: 'newer_version'; version: number; supported: number }
  | { code: 'missing_migration'; to: number };

export type MigrateResult =
  | { ok: true; data: Record<string, unknown>; from: number; to: number }
  | { ok: false; error: MigrateError };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// 把任意旧版本数据迁移到 target 版本。只做版本推进，不做结构校验（校验交给 PersistedConfigSchema）。
// 比当前版本新的数据一律拒绝，不做降级，避免新版扩展写的配置被旧版悄悄截断。
export function migrateConfig(
  raw: unknown,
  migrations: MigrationTable = CONFIG_MIGRATIONS,
  target: number = CURRENT_CONFIG_VERSION,
): MigrateResult {
  if (!isPlainObject(raw)) return { ok: false, error: { code: 'not_object' } };
  const from = raw.version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return { ok: false, error: { code: 'bad_version', version: from } };
  }
  if (from > target) return { ok: false, error: { code: 'newer_version', version: from, supported: target } };

  let data: Record<string, unknown> = structuredClone(raw);
  for (let v = from + 1; v <= target; v++) {
    const step = migrations[v];
    if (!step) return { ok: false, error: { code: 'missing_migration', to: v } };
    data = { ...step(data), version: v };
  }
  return { ok: true, data, from, to: target };
}
