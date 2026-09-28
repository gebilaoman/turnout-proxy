// 由配置与运行时状态计算要交给 chrome.proxy 的设置（ARCHITECTURE §3）。
import type { Client, PersistedConfig, RuntimeState } from '../config';
import type { CompiledRules } from '../rules';
import { generatePac, probeKey, proxyToken } from './generate';

export type ProxyPlan = { mode: 'direct' } | { mode: 'system' } | { mode: 'pac_script'; data: string };

export interface PlanInput {
  config: PersistedConfig;
  runtime: Pick<RuntimeState, 'effectiveExit' | 'pacEpoch'>;
  rules: CompiledRules | null;
  version: string;
  extraMatch?: readonly string[]; // 「通过当前客户端更新」时临时加入的订阅域名
}

export type PlanError = { code: 'no_rules' } | { code: 'exit_missing' };

// 出口顺序：实际在用的出口在前，另一个在后；只有开启「全部离线时直连」才追加 DIRECT。
export function routeFor(config: PersistedConfig, effectiveClientId: string | null): string[] {
  const { exit, backupClientId, allowDirectWhenAllDown } = config.settings;
  const byId = new Map(config.clients.map((c) => [c.id, c]));
  const primaryId = exit.kind === 'client' ? exit.clientId : null;
  const order = [effectiveClientId, primaryId, backupClientId].filter((id, i, a): id is string => !!id && a.indexOf(id) === i);
  const route = order.map((id) => byId.get(id)).filter((c): c is Client => !!c).map(proxyToken);
  if (allowDirectWhenAllDown) route.push('DIRECT');
  return route;
}

// 每个客户端两种探测键都登记：混合端口可用 PROXY 或 SOCKS5 探测，纯 SOCKS 只登记 s 键
export function probeTable(clients: readonly Client[]): Record<string, string> {
  const t: Record<string, string> = {};
  for (const c of clients) {
    const k = probeKey(c.port, c.scheme);
    if (!(k in t)) t[k] = proxyToken(c);
  }
  return t;
}

export function planProxy(input: PlanInput): { ok: true; plan: ProxyPlan } | { ok: false; error: PlanError } {
  const { config, runtime, rules, version } = input;
  const { mode, exit } = config.settings;
  if (mode === 'direct') return { ok: true, plan: { mode: 'direct' } };
  if (exit.kind === 'system') return { ok: true, plan: { mode: 'system' } };
  if (!config.clients.some((c) => c.id === exit.clientId)) return { ok: false, error: { code: 'exit_missing' } };

  const eff = runtime.effectiveExit?.kind === 'client' ? runtime.effectiveExit.clientId : exit.clientId;
  const route = routeFor(config, eff);
  const probes = probeTable(config.clients);
  if (mode === 'all') {
    return { ok: true, plan: { mode: 'pac_script', data: generatePac({ routing: { kind: 'all', route }, probes, siteRules: config.siteRules, epoch: runtime.pacEpoch, version }) } };
  }
  if (!rules) return { ok: false, error: { code: 'no_rules' } };
  const routing = input.extraMatch ? { kind: 'smart' as const, route, rules, extraMatch: input.extraMatch } : { kind: 'smart' as const, route, rules };
  return { ok: true, plan: { mode: 'pac_script', data: generatePac({ routing, probes, siteRules: config.siteRules, epoch: runtime.pacEpoch, version }) } };
}
