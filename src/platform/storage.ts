// 持久化与会话状态（ARCHITECTURE §7）。所有状态都在 chrome.storage，不放内存。
import { storage } from '#imports';
import {
  CONFIG_MIGRATIONS,
  CURRENT_CONFIG_VERSION,
  MAX_BACKUPS,
  defaultConfig,
  initialRuntimeState,
  pushBackup,
  type ConfigBackup,
  type PersistedConfig,
  type RuntimeState,
} from '@/core/config';
import type { RuleCache } from '@/core/rules';

const backupSlots = Array.from({ length: MAX_BACKUPS }, (_, i) =>
  storage.defineItem<ConfigBackup | null>(`local:backup.${i + 1}`, { fallback: null }),
);

export async function readBackups(): Promise<ConfigBackup[]> {
  const all = await Promise.all(backupSlots.map((s) => s.getValue()));
  return all.filter((b): b is ConfigBackup => b !== null);
}

// 写入一份备份：最新的在 backup.1，最多保留 MAX_BACKUPS 份
export async function backupConfig(data: unknown): Promise<void> {
  const list = pushBackup(await readBackups(), data, new Date());
  await Promise.all(backupSlots.map((s, i) => s.setValue(list[i] ?? null)));
}

// 包装 core 的迁移表交给 WXT：任一迁移开始前先把旧数据写入备份槽；缺少某一级迁移时报错而不是静默跳过
let backedUpThisRun = false;
const wxtMigrations: Record<number, (old: Record<string, unknown>) => Promise<Record<string, unknown>>> = {};
for (let v = 2; v <= CURRENT_CONFIG_VERSION; v++) {
  wxtMigrations[v] = async (old) => {
    if (!backedUpThisRun) {
      backedUpThisRun = true;
      await backupConfig(old);
    }
    const step = CONFIG_MIGRATIONS[v];
    if (!step) throw new Error(`missing config migration to v${v}`);
    return { ...step(old), version: v };
  };
}

export const configItem = storage.defineItem<PersistedConfig>('local:config', {
  fallback: defaultConfig(),
  version: CURRENT_CONFIG_VERSION,
  migrations: wxtMigrations,
});

export const ruleCacheItem = storage.defineItem<RuleCache | null>('local:ruleCache', { fallback: null });

export const onboardedItem = storage.defineItem<boolean>('local:onboarded', { fallback: false });

export const runtimeItem = storage.defineItem<RuntimeState>('session:runtime', { fallback: initialRuntimeState() });

// 后台自用的会话数据：节流时间戳、上次应用的 PAC 哈希
export interface BackgroundMeta {
  lastRecheckAt: number | null;
  probingUntil: number | null;
}
export const metaItem = storage.defineItem<BackgroundMeta>('session:meta', { fallback: { lastRecheckAt: null, probingUntil: null } });

export async function getConfig(): Promise<PersistedConfig> {
  return structuredClone(await configItem.getValue());
}

export async function getRuntime(): Promise<RuntimeState> {
  return { ...initialRuntimeState(), ...structuredClone(await runtimeItem.getValue()) };
}
