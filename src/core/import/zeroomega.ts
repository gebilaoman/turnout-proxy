// 从 ZeroOmega / SwitchyOmega 备份导入（docs/zeroomega-import.md）。
// 只依据文档描述的格式自行实现，不参考其 GPL 代码。纯函数：解析 → 预览结果，由界面让用户勾选后再合并。
import type { Client, Mode, PersistedConfig, ProxyScheme } from '../config';
import { err, ok, type Result } from '../result';

export interface ImportedClient {
  name: string;
  host: string;
  port: number;
  scheme: ProxyScheme;
  authDropped: boolean; // 原配置带账号密码，已丢弃（首版不支持认证）
}

export type SkipReason =
  | 'unsupported_scheme' // https / socks4
  | 'no_proxy' // FixedProfile 没有可用的代理字段
  | 'duplicate' // 与已有客户端或本次导入中前面的项地址相同
  | 'pac' // PAC 脚本配置
  | 'auto_detect' // 自动检测配置
  | 'conditions' // 自动切换配置里的条件规则
  | 'virtual' // 虚拟配置（别名）
  | 'extra_rule_list' // 第二条及以后的规则订阅
  | 'unsupported_rule_format'; // 非 AutoProxy 格式的规则列表

export interface SkippedItem {
  name: string;
  reason: SkipReason;
  count?: number; // conditions：条件条数
}

export interface ZeroOmegaImport {
  clients: ImportedClient[];
  ruleSourceUrl: string | null;
  mode: Mode | null; // 由启动配置推断；null 表示无法推断
  exitName: string | null; // 默认出口客户端名称
  skipped: SkippedItem[];
}

export type ZeroOmegaError = { code: 'invalid_file' } | { code: 'unsupported_version'; version: unknown };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const RULE_LIST_TYPES = new Set(['RuleListProfile', 'SwitchyRuleListProfile', 'AutoProxyRuleListProfile']);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function decode(text: string): Obj | null {
  let t = text.replace(/^\uFEFF/, '').trim();
  if (!t.startsWith('{')) {
    try {
      const bin = atob(t.replace(/\s+/g, ''));
      t = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return null;
    }
  }
  try {
    const v: unknown = JSON.parse(t);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function pickProxy(p: Obj): Obj | null {
  for (const k of ['fallbackProxy', 'proxyForHttps', 'proxyForHttp']) {
    const v = p[k];
    if (isObj(v)) return v;
  }
  return null;
}

export interface ZeroOmegaOptions {
  existing: readonly Pick<Client, 'host' | 'port'>[]; // 已有客户端，用于去重
  mixedPorts: readonly number[]; // 本机已发现的混合端口（ARCHITECTURE §5 扫描结果）
}

export function parseZeroOmega(text: string, opts: ZeroOmegaOptions): Result<ZeroOmegaImport, ZeroOmegaError> {
  const root = decode(text);
  if (!root) return err({ code: 'invalid_file' });
  const ver = root.schemaVersion;
  if (ver !== undefined && ver !== 1 && ver !== 2) return err({ code: 'unsupported_version', version: ver });

  const profiles = new Map<string, Obj>();
  for (const [k, v] of Object.entries(root)) {
    if (k.startsWith('+') && isObj(v)) profiles.set(str(v.name) ?? k.slice(1), v);
  }
  if (profiles.size === 0 && ver === undefined) return err({ code: 'invalid_file' });

  const seen = new Set(opts.existing.map((c) => `${c.host.toLowerCase()}:${c.port}`));
  const clients: ImportedClient[] = [];
  const skipped: SkippedItem[] = [];
  let ruleSourceUrl: string | null = null;

  for (const [name, p] of profiles) {
    const type = str(p.profileType);
    if (type === 'FixedProfile') {
      const proxy = pickProxy(p);
      const host = proxy && str(proxy.host);
      const port = proxy && typeof proxy.port === 'number' ? proxy.port : null;
      if (!proxy || !host || !port || !Number.isInteger(port) || port < 1 || port > 65535) {
        skipped.push({ name, reason: 'no_proxy' });
        continue;
      }
      const scheme = str(proxy.scheme) ?? 'http';
      if (scheme !== 'http' && scheme !== 'socks5') {
        skipped.push({ name, reason: 'unsupported_scheme' });
        continue;
      }
      const key = `${host.toLowerCase()}:${port}`;
      if (seen.has(key)) {
        skipped.push({ name, reason: 'duplicate' });
        continue;
      }
      seen.add(key);
      const mixed = LOCAL_HOSTS.has(host.toLowerCase()) && opts.mixedPorts.includes(port);
      clients.push({ name: name.slice(0, 64), host: host === '::1' ? '[::1]' : host, port, scheme: mixed ? 'mixed' : scheme, authDropped: isObj(proxy.auth) || isObj(p.auth) });
    } else if (type && RULE_LIST_TYPES.has(type)) {
      const url = str(p.sourceUrl);
      if (str(p.format)?.toLowerCase() !== 'autoproxy' || !url) skipped.push({ name, reason: 'unsupported_rule_format' });
      else if (ruleSourceUrl) skipped.push({ name, reason: 'extra_rule_list' });
      else ruleSourceUrl = url;
    } else if (type === 'SwitchProfile') {
      const n = Array.isArray(p.rules) ? p.rules.length : 0;
      if (n > 0) skipped.push({ name, reason: 'conditions', count: n });
    } else if (type === 'VirtualProfile') {
      skipped.push({ name, reason: 'virtual' });
    } else if (type === 'PacProfile') {
      skipped.push({ name, reason: 'pac' });
    } else if (type === 'AutoDetectProfile') {
      skipped.push({ name, reason: 'auto_detect' });
    }
  }

  // 由启动配置推断模式与默认出口（§4）
  const imported = new Set(clients.map((c) => c.name));
  let mode: Mode | null = null;
  let exitName: string | null = null;
  let start = str(root['-startupProfileName']);
  for (let hops = 0; start && hops < 5; hops++) {
    if (start === 'direct') {
      mode = 'direct';
      break;
    }
    const p = profiles.get(start);
    const type = p && str(p.profileType);
    if (!p || !type) break;
    if (type === 'VirtualProfile') {
      start = str(p.defaultProfileName);
      continue;
    }
    if (type === 'FixedProfile') {
      mode = 'all';
      exitName = start;
      break;
    }
    if (type === 'SwitchProfile') {
      mode = 'smart';
      const listName = str(p.defaultProfileName) ?? `__ruleListOf_${start}`;
      const list = profiles.get(listName) ?? profiles.get(`__ruleListOf_${start}`);
      const target = list && str(list.matchProfileName);
      if (target && str(profiles.get(target)?.profileType) === 'FixedProfile') exitName = target;
      break;
    }
    break;
  }
  if (exitName && !imported.has(exitName)) exitName = null;

  return ok({ clients, ruleSourceUrl, mode, exitName, skipped });
}

// 把用户勾选的导入项合并进当前配置。结果仍需 validateConfig 校验（例如自定义订阅地址格式）。
export function applyZeroOmega(
  cfg: PersistedConfig,
  imp: ZeroOmegaImport,
  choice: { clientNames: readonly string[]; useRuleSource: boolean; useMode: boolean },
  newId: () => string,
): PersistedConfig {
  const next = structuredClone(cfg);
  const idByName = new Map<string, string>();
  for (const c of imp.clients) {
    if (!choice.clientNames.includes(c.name)) continue;
    const id = newId();
    idByName.set(c.name, id);
    next.clients.push({ id, name: c.name, host: c.host, port: c.port, scheme: c.scheme, source: 'imported' });
  }
  const exitId = imp.exitName ? idByName.get(imp.exitName) : undefined;
  if (exitId) {
    const prev = next.settings.exit;
    next.settings.exit = { kind: 'client', clientId: exitId };
    if (next.settings.backupClientId === null && prev.kind === 'client') next.settings.backupClientId = prev.clientId;
  } else if (next.settings.exit.kind === 'system') {
    const first = [...idByName.values()][0];
    if (first) next.settings.exit = { kind: 'client', clientId: first };
  }
  if (choice.useMode && imp.mode) next.settings.mode = imp.mode;
  if (choice.useRuleSource && imp.ruleSourceUrl) next.ruleSource = { kind: 'custom', url: imp.ruleSourceUrl, updateInterval: next.ruleSource.updateInterval };
  return next;
}
