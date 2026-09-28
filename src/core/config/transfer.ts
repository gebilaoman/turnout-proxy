// 导出 / 导入（ARCHITECTURE §7）。
// 导出文件 = PersistedConfig + `format: "turnout"`。
// 导入顺序：解析 JSON → 校验信封（format、version）→ 迁移到当前版本 → 用 PersistedConfigSchema 完整校验。
// 错误只返回错误码与字段路径，界面文案由 UI 层按 i18n 生成。
import { CONFIG_MIGRATIONS, migrateConfig, type MigrateError, type MigrationTable } from './migrations';
import { CURRENT_CONFIG_VERSION, PersistedConfigSchema, type PersistedConfig } from './schema';

export const EXPORT_FORMAT = 'turnout';

export type ExportFile = PersistedConfig & { format: typeof EXPORT_FORMAT };

export interface ConfigIssue {
  path: (string | number)[];
  code: string;
}

export type ImportError =
  | { code: 'invalid_json' }
  | { code: 'not_turnout' }
  | MigrateError
  | { code: 'invalid_config'; issues: ConfigIssue[] };

export type ImportResult = { ok: true; config: PersistedConfig; migratedFrom: number } | { ok: false; error: ImportError };

// 输出稳定：同一配置得到字节级相同的文本，方便用户比对与测试快照。
export function exportConfig(config: PersistedConfig): string {
  const file: ExportFile = { format: EXPORT_FORMAT, ...config };
  return JSON.stringify(file, null, 2) + '\n';
}

// 校验任意数据是否为当前版本的合法配置（也用于读取 storage 后的防御性检查）。
export function validateConfig(data: unknown): { ok: true; config: PersistedConfig } | { ok: false; issues: ConfigIssue[] } {
  const r = PersistedConfigSchema.safeParse(data);
  if (r.success) return { ok: true, config: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      code: i.code === 'custom' ? i.message : i.code,
    })),
  };
}

export function importConfig(text: string, migrations: MigrationTable = CONFIG_MIGRATIONS, target = CURRENT_CONFIG_VERSION): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'invalid_json' } };
  }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { format?: unknown }).format !== EXPORT_FORMAT) {
    return { ok: false, error: { code: 'not_turnout' } };
  }
  const { format: _format, ...rest } = parsed as Record<string, unknown>;
  const migrated = migrateConfig(rest, migrations, target);
  if (!migrated.ok) return { ok: false, error: migrated.error };
  const valid = validateConfig(migrated.data);
  if (!valid.ok) return { ok: false, error: { code: 'invalid_config', issues: valid.issues } };
  return { ok: true, config: valid.config, migratedFrom: migrated.from };
}
