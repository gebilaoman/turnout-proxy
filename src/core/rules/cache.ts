import type { CompiledRules } from './compile';

// 规则缓存（ARCHITECTURE §2）：单独存 storage.local，体积大，不参与导出。
export interface RuleCache {
  fetchedAt: string; // ISO
  sha256: string;
  compiled: CompiledRules;
  sourceUrl: string; // 内置离线副本为 "builtin:<文件名>"
}
