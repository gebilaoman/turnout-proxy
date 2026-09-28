// 界面 ↔ 后台的类型化消息（@webext-core/messaging）。界面只读状态、发命令；业务处理在后台。
import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ConfigBackup, ConfigIssue, ImportError, PersistedConfig, PortState, ProxyScheme, RuntimeState } from '@/core/config';
import type { RouteExplanation } from '@/core/pac';
import type { RuleStats } from '@/core/rules';

export interface RulesInfo {
  sourceUrl: string;
  fetchedAt: string;
  stats: RuleStats;
}

export interface ViewState {
  config: PersistedConfig;
  runtime: RuntimeState;
  rules: RulesInfo | null;
  onboarded: boolean;
  version: string;
}

export interface ScanHit {
  host: string;
  port: number;
  hint: string;
  scheme: ProxyScheme; // 猜测的协议：HTTP 响应的端口按候选表猜；超时的按 socks5
  state: PortState;
  configuredId: string | null; // 已添加为客户端时为其 id
}

export type CommandResult = { ok: true } | { ok: false; code: string; issues?: ConfigIssue[] };

export interface ProtocolMap {
  getView(): ViewState;
  saveConfig(config: PersistedConfig): CommandResult;
  saveConfigWithBackup(config: PersistedConfig): CommandResult;
  refreshExitIp(): void;
  explain(url: string): RouteExplanation;
  switchBack(): CommandResult;
  dismissAlert(): void;
  recheck(scope: 'active' | 'all'): void;
  scan(): ScanHit[];
  updateRules(viaProxy: boolean): CommandResult;
  importConfig(text: string): { ok: true } | { ok: false; error: ImportError };
  listBackups(): ConfigBackup[];
  restoreBackup(index: number): CommandResult;
  finishOnboarding(config: PersistedConfig): CommandResult;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
