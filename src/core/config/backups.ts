// 迁移前备份（ARCHITECTURE §7：迁移前写入 backup.1..3，保留最近 3 份）。
// 这里只负责计算新的备份列表；platform 层把第 i 项写入 storage 的 `backup.<i+1>`。

export const MAX_BACKUPS = 3;

export interface ConfigBackup {
  savedAt: string; // ISO 时间
  version: number | null; // 备份数据自身声明的版本；读不出时为 null
  data: unknown; // 原样保存，不做校验——备份的意义就是保住无法识别的数据
}

// 返回新列表：最新的在前，超出上限的最旧项被丢弃。不修改入参。
export function pushBackup(backups: readonly ConfigBackup[], data: unknown, now: Date): ConfigBackup[] {
  const version =
    typeof data === 'object' && data !== null && 'version' in data && typeof data.version === 'number'
      ? data.version
      : null;
  const entry: ConfigBackup = { savedAt: now.toISOString(), version, data: structuredClone(data) };
  return [entry, ...backups].slice(0, MAX_BACKUPS);
}
