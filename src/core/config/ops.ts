// 对配置的常用修改。纯函数：返回新对象，不修改入参；结果可能仍需 validateConfig 校验。
// 放在 core 里，界面（组装新配置）和后台（校验后保存）共用同一套规则。
import type { Client, Exit, Mode, PersistedConfig, RuleSource, SiteAction } from './schema';

const clone = (c: PersistedConfig): PersistedConfig => structuredClone(c);

export function setMode(cfg: PersistedConfig, mode: Mode): PersistedConfig {
  const next = clone(cfg);
  next.settings.mode = mode;
  return next;
}

// 切换出口时，若新出口正是备用，则把原默认客户端换成备用，避免"备用 = 出口"
export function setExit(cfg: PersistedConfig, exit: Exit): PersistedConfig {
  const next = clone(cfg);
  const prev = next.settings.exit;
  next.settings.exit = exit;
  if (exit.kind === 'client' && next.settings.backupClientId === exit.clientId) {
    next.settings.backupClientId = prev.kind === 'client' ? prev.clientId : null;
  }
  return next;
}

export function addClient(cfg: PersistedConfig, client: Client): PersistedConfig {
  const next = clone(cfg);
  next.clients.push(client);
  // 第一个客户端自动成为出口
  if (next.clients.length === 1 && next.settings.exit.kind === 'system') next.settings.exit = { kind: 'client', clientId: client.id };
  return next;
}

export function updateClient(cfg: PersistedConfig, client: Client): PersistedConfig {
  const next = clone(cfg);
  next.clients = next.clients.map((c) => (c.id === client.id ? client : c));
  return next;
}

// 删除客户端并修正引用：出口被删则改用备用（没有备用则跟随系统），备用被删则清空
export function removeClient(cfg: PersistedConfig, id: string): PersistedConfig {
  const next = clone(cfg);
  next.clients = next.clients.filter((c) => c.id !== id);
  const { exit, backupClientId } = next.settings;
  if (backupClientId === id) next.settings.backupClientId = null;
  if (exit.kind === 'client' && exit.clientId === id) {
    const fallback = next.settings.backupClientId;
    next.settings.exit = fallback ? { kind: 'client', clientId: fallback } : { kind: 'system' };
    next.settings.backupClientId = null;
  }
  return next;
}

export function setBackup(cfg: PersistedConfig, id: string | null): PersistedConfig {
  const next = clone(cfg);
  next.settings.backupClientId = id;
  return next;
}

export function setFallbackOptions(cfg: PersistedConfig, opts: { allowDirectWhenAllDown?: boolean; autoSwitchBack?: boolean }): PersistedConfig {
  const next = clone(cfg);
  if (opts.allowDirectWhenAllDown !== undefined) next.settings.allowDirectWhenAllDown = opts.allowDirectWhenAllDown;
  if (opts.autoSwitchBack !== undefined) next.settings.autoSwitchBack = opts.autoSwitchBack;
  return next;
}

export function setRuleSource(cfg: PersistedConfig, ruleSource: RuleSource): PersistedConfig {
  const next = clone(cfg);
  next.ruleSource = ruleSource;
  return next;
}

// 同一 host + 端口视为同一个客户端（用于发现与导入去重）
export function findByAddress(cfg: PersistedConfig, host: string, port: number): Client | undefined {
  const h = host.toLowerCase();
  return cfg.clients.find((c) => c.host.toLowerCase() === h && c.port === port);
}

// 「我的网站」：同一域名只保留一条，再次设置即覆盖；新条目放在最前
export function setSiteRule(cfg: PersistedConfig, domain: string, action: SiteAction): PersistedConfig {
  const next = clone(cfg);
  next.siteRules = [{ domain, action }, ...next.siteRules.filter((r) => r.domain !== domain)];
  return next;
}

export function removeSiteRule(cfg: PersistedConfig, domain: string): PersistedConfig {
  const next = clone(cfg);
  next.siteRules = next.siteRules.filter((r) => r.domain !== domain);
  return next;
}
