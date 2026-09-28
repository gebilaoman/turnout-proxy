// 后台编排（ARCHITECTURE §1）：收到命令 / 定时器 / 事件 → 调 core 计算 → 调 platform 执行 → 写状态。
// 业务判断都在 core；这里只负责按顺序把它们串起来。
import { browser } from '#imports';
import {
  findByAddress,
  importConfig as parseImport,
  validateConfig,
  type ClientHealth,
  type ImportError,
  type PersistedConfig,
  type PortState,
  type RuntimeState,
} from '@/core/config';
import { CANDIDATE_PORTS, canaryHealthy, classifyPort, classifyProbe, decideExit, shouldRecheck } from '@/core/health';
import { CANARY_KEY, explainRoute, planProxy, probeKey, type RouteExplanation } from '@/core/pac';
import { isBuiltinSource } from '@/core/rules';
import { iconState } from '@/core/state';
import { scheduleAlarms } from '@/platform/alarms';
import { setToolbarIcon } from '@/platform/icon';
import type { CommandResult, ScanHit, ViewState } from '@/platform/messages';
import { checkPort, probeVia, PROBE_TIMEOUT_MS } from '@/platform/probe';
import { applyPlan, readControl } from '@/platform/proxy';
import { fetchExitIp } from '@/platform/exitip';
import { BUILTIN_ONLINE_URL, builtinRuleCache, fetchRuleCache } from '@/platform/rules';
import {
  backupConfig,
  configItem,
  getConfig,
  getRuntime,
  metaItem,
  onboardedItem,
  readBackups,
  ruleCacheItem,
  runtimeItem,
} from '@/platform/storage';

const VERSION = browser.runtime.getManifest().version;

// 所有会改状态的操作串行执行，避免并发读-改-写（M0 S4 观察到的丢更新）
let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function updateRuntime(patch: (r: RuntimeState) => RuntimeState): Promise<RuntimeState> {
  const next = patch(await getRuntime());
  await runtimeItem.setValue(next);
  return next;
}

async function ensureRules(): Promise<void> {
  if (!(await ruleCacheItem.getValue())) await ruleCacheItem.setValue(await builtinRuleCache());
}

// 按当前配置与运行时状态计算并应用代理设置，同时刷新控制权状态与图标
export async function reconcile(extraMatch?: readonly string[]): Promise<void> {
  await ensureRules();
  const [config, runtime, cache] = await Promise.all([getConfig(), getRuntime(), ruleCacheItem.getValue()]);
  const planned = planProxy({ config, runtime, rules: cache?.compiled ?? null, version: VERSION, ...(extraMatch ? { extraMatch } : {}) });
  if (planned.ok) {
    try {
      await applyPlan(planned.plan);
    } catch (e) {
      console.warn('[turnout] apply proxy failed', e);
    }
  } else {
    console.warn('[turnout] plan failed', planned.error);
  }
  const control = await readControl();
  const next = await updateRuntime((r) => ({ ...r, control }));
  await setToolbarIcon(iconState(config.settings, next, next.alert)).catch(() => undefined);
  await scheduleAlarms(config.clients.length > 0, config.ruleSource);
}

function pacActive(config: PersistedConfig, control: RuntimeState['control']): boolean {
  return control === 'ok' && config.settings.mode !== 'direct' && config.settings.exit.kind === 'client';
}

// 两级健康检测 + 回落决策（ARCHITECTURE §5）。
// 网络探测在串行队列之外进行（最长约 10 秒），只有写入结果与重新应用代理的一步进入队列，
// 这样检测不会拖慢界面上的保存、切换等操作。
export async function runHealth(scope: 'active' | 'all'): Promise<void> {
  if (await measureAndCommit(scope)) void refreshExitIp();
}

// 返回实际出口是否发生了变化
async function measureAndCommit(scope: 'active' | 'all'): Promise<boolean> {
  const config = await getConfig();
  const runtime = await getRuntime();
  const { exit, backupClientId } = config.settings;
  const activeIds = new Set([exit.kind === 'client' ? exit.clientId : null, backupClientId].filter((x): x is string => !!x));
  const targets = scope === 'all' ? config.clients : config.clients.filter((c) => activeIds.has(c.id));
  if (targets.length === 0) return false;

  const portStates = await Promise.all(
    targets.map(async (c): Promise<PortState> => {
      const o = checkPort(c);
      return o ? classifyPort(await o) : 'http';
    }),
  );

  const canProbe = pacActive(config, runtime.control);
  let probes: (Awaited<ReturnType<typeof probeVia>> | null)[] = targets.map(() => null);
  let probeOk: boolean | null = null;
  if (canProbe) {
    await metaItem.setValue({ ...(await metaItem.getValue()), probingUntil: Date.now() + 2 * PROBE_TIMEOUT_MS + 1000 });
    const nonce = Date.now().toString(36);
    // 端口在听但探测没拿到 204 时立即重试一次，避免客户端上游偶发抖动造成"离线"误报
    const probeClient = async (c: (typeof targets)[number], i: number) => {
      if (portStates[i] === 'refused') return null;
      const key = probeKey(c.port, c.scheme);
      const first = await probeVia(key, nonce);
      if (first.kind === 'response' && first.status === 204) return first;
      return probeVia(key, `${nonce}r`);
    };
    const [canary, ...rest] = await Promise.all([probeVia(CANARY_KEY, nonce), ...targets.map(probeClient)]);
    probeOk = canary ? canaryHealthy(canary) : true;
    probes = probeOk ? rest : targets.map(() => null);
  }
  const now = new Date().toISOString();

  return serial(async () => {
    // 探测期间配置可能已被修改：重新读取，只采纳地址与协议没变的客户端的结果
    const latest = await getConfig();
    const current = await getRuntime();
    const byId = new Map(latest.clients.map((c) => [c.id, c]));
    const health: Record<string, ClientHealth> = Object.fromEntries(Object.entries(current.health).filter(([id]) => byId.has(id)));
    const ports: Record<string, PortState> = Object.fromEntries(Object.entries(current.ports).filter(([id]) => byId.has(id)));
    targets.forEach((c, i) => {
      const now_ = byId.get(c.id);
      if (!now_ || now_.host !== c.host || now_.port !== c.port || now_.scheme !== c.scheme) return;
      const port = portStates[i] ?? 'refused';
      ports[c.id] = port;
      health[c.id] = classifyProbe(port, probes[i] ?? null, now);
    });

    const decision = decideExit(latest.settings, current.effectiveExit, current.health, health);
    await updateRuntime((r) => ({
      ...r,
      health,
      ports,
      probeOk: probeOk ?? r.probeOk,
      lastCheckAt: now,
      effectiveExit: decision.effectiveExit,
      alertDismissed: decision.alert === r.alert ? r.alertDismissed : false,
      alert: decision.alert,
      pacEpoch: r.pacEpoch + (decision.bumpEpoch ? 1 : 0),
    }));
    await reconcile();
    return JSON.stringify(decision.effectiveExit) !== JSON.stringify(current.effectiveExit);
  });
}

export async function onProxyErrorRecheck(): Promise<void> {
  // 节流判断在串行队列里做，避免连续到达的多个事件同时通过
  const go = await serial(async () => {
    const meta = await metaItem.getValue();
    const now = Date.now();
    if (!shouldRecheck(now, meta.lastRecheckAt, meta.probingUntil)) return false;
    await metaItem.setValue({ ...meta, lastRecheckAt: now });
    return true;
  });
  if (go) await runHealth('active');
}

export async function explain(url: string): Promise<RouteExplanation> {
  const [config, cache] = await Promise.all([getConfig(), ruleCacheItem.getValue()]);
  return explainRoute(url, config, cache?.compiled ?? null);
}

export async function getView(): Promise<ViewState> {
  const [config, runtime, cache, onboarded] = await Promise.all([getConfig(), getRuntime(), ruleCacheItem.getValue(), onboardedItem.getValue()]);
  return {
    config,
    runtime,
    rules: cache ? { sourceUrl: cache.sourceUrl, fetchedAt: cache.fetchedAt, stats: cache.compiled.stats } : null,
    onboarded,
    version: VERSION,
  };
}

function exitChanged(a: PersistedConfig, b: PersistedConfig): boolean {
  return JSON.stringify([a.settings.exit, a.settings.backupClientId, a.clients]) !== JSON.stringify([b.settings.exit, b.settings.backupClientId, b.clients]);
}

export async function saveConfig(next: PersistedConfig): Promise<CommandResult> {
  const valid = validateConfig(next);
  if (!valid.ok) return { ok: false, code: 'invalid_config', issues: valid.issues };
  const prev = await getConfig();
  await configItem.setValue(valid.config);
  if (exitChanged(prev, valid.config)) {
    // 出口或客户端变了：实际出口回到新的主出口，提示清空，递增 epoch 让 Chrome 重新尝试
    await updateRuntime((r) => ({ ...r, effectiveExit: null, alert: 'none', alertDismissed: false, pacEpoch: r.pacEpoch + 1 }));
  }
  const sourceChanged = JSON.stringify(prev.ruleSource) !== JSON.stringify(valid.config.ruleSource);
  await reconcile();
  if (sourceChanged) await refreshRules(false);
  // 检测与出口 IP 查询异步进行，不阻塞界面（结果写入时自行进入串行队列）
  void runHealth('all');
  void refreshExitIp();
  return { ok: true };
}

export async function switchBack(): Promise<CommandResult> {
  const config = await getConfig();
  if (config.settings.exit.kind !== 'client') return { ok: false, code: 'no_client_exit' };
  const primary = config.settings.exit.clientId;
  await updateRuntime((r) => ({ ...r, effectiveExit: { kind: 'client', clientId: primary }, alert: 'none', alertDismissed: false, pacEpoch: r.pacEpoch + 1 }));
  await reconcile();
  void refreshExitIp();
  return { ok: true };
}

export async function dismissAlert(): Promise<void> {
  await updateRuntime((r) => ({ ...r, alertDismissed: true }));
}

// 规则更新：失败时保留旧规则，把原因写入状态（CLAUDE.md「网络请求」）。
// 内置来源从 GFWList 官方地址在线更新，扩展包内的离线副本只在没有任何缓存时使用。
export async function refreshRules(viaProxy: boolean): Promise<CommandResult> {
  const config = await getConfig();
  const url = config.ruleSource.kind === 'custom' ? config.ruleSource.url : BUILTIN_ONLINE_URL;
  await updateRuntime((r) => ({ ...r, ruleUpdate: { ...r.ruleUpdate, status: 'updating' } }));
  // 「通过当前客户端更新」：临时把订阅域名加入 MATCH，更新完成后恢复
  if (viaProxy) await reconcile([new URL(url).hostname]);
  const result = await fetchRuleCache(url);
  const at = new Date().toISOString();
  if (result.ok) {
    await ruleCacheItem.setValue(result.value);
    await updateRuntime((r) => ({ ...r, ruleUpdate: { status: 'ok', at } }));
  } else {
    const e = result.error;
    await updateRuntime((r) => ({ ...r, ruleUpdate: { status: 'failed', at, error: e.code === 'http_status' ? `http_status:${e.status}` : e.code } }));
    // 切换到内置来源但在线更新失败时，至少换回内置离线副本，不继续用旧的自定义订阅
    const cache = await ruleCacheItem.getValue();
    if (config.ruleSource.kind === 'builtin' && cache && !isBuiltinSource(cache.sourceUrl)) {
      await ruleCacheItem.setValue(await builtinRuleCache());
    }
  }
  await reconcile();
  return result.ok ? { ok: true } : { ok: false, code: result.error.code };
}

// 出口 IP：查询经 PAC 固定走当前出口。via 标记查询时的出口，出口变化后旧结果作废
function currentVia(config: PersistedConfig, runtime: RuntimeState): string {
  if (config.settings.mode === 'direct') return 'direct';
  if (config.settings.exit.kind === 'system') return 'system';
  return runtime.effectiveExit?.kind === 'client' ? runtime.effectiveExit.clientId : config.settings.exit.clientId;
}

export async function refreshExitIp(): Promise<void> {
  const via = currentVia(await getConfig(), await getRuntime());
  const r = await fetchExitIp();
  const checkedAt = new Date().toISOString();
  await serial(async () => {
    // 查询期间出口变了，结果不可信，丢弃
    if (currentVia(await getConfig(), await getRuntime()) !== via) return;
    await updateRuntime((rt) => ({ ...rt, exitIp: r.ok ? { ...r.value, checkedAt, via } : { error: r.error, checkedAt, via } }));
  });
}

// 自动发现：对候选端口做第 1 级检测（ARCHITECTURE §5）
export async function scan(): Promise<ScanHit[]> {
  const config = await getConfig();
  const results = await Promise.all(
    CANDIDATE_PORTS.map(async (cand) => {
      const outcome = await checkPort({ host: '127.0.0.1', port: cand.port });
      return { cand, state: outcome ? classifyPort(outcome) : 'refused' };
    }),
  );
  return results
    .filter((r) => r.state !== 'refused')
    .map(({ cand, state }) => ({
      host: '127.0.0.1',
      port: cand.port,
      hint: cand.hint,
      // HTTP 响应说明是 HTTP 或混合端口：按候选表的猜测，猜 socks5 的改为 mixed；超时的按 socks5
      scheme: state === 'maybe_socks' ? 'socks5' : cand.scheme === 'socks5' ? 'mixed' : cand.scheme,
      state,
      configuredId: findByAddress(config, '127.0.0.1', cand.port)?.id ?? null,
    }));
}

export async function importConfig(text: string): Promise<{ ok: true } | { ok: false; error: ImportError }> {
  const parsed = parseImport(text);
  if (!parsed.ok) return parsed;
  await backupConfig(await getConfig());
  const r = await saveConfig(parsed.config);
  if (!r.ok) return { ok: false, error: { code: 'invalid_config', issues: r.issues ?? [] } };
  return { ok: true };
}

export async function restoreBackup(index: number): Promise<CommandResult> {
  const backup = (await readBackups())[index];
  if (!backup) return { ok: false, code: 'not_found' };
  const r = await importConfig(JSON.stringify({ format: 'turnout', ...(backup.data as object) }));
  return r.ok ? { ok: true } : { ok: false, code: r.error.code };
}

// 先把当前配置写入备份槽再保存（从其他扩展导入时使用，可在「备份与导入」里撤销）
export async function saveConfigWithBackup(next: PersistedConfig): Promise<CommandResult> {
  await backupConfig(await getConfig());
  return saveConfig(next);
}

export async function finishOnboarding(config: PersistedConfig): Promise<CommandResult> {
  const r = await saveConfig(config);
  if (r.ok) {
    await onboardedItem.setValue(true);
    // 引导完成后 PAC 已生效，内置规则此时可经客户端在线更新（排在队列里，不阻塞返回）
    void serial(() => refreshIfOfflineCopy());
  }
  return r;
}

// 仍在使用扩展自带的离线副本时尝试在线更新一次（内置来源且开启了自动更新）
export async function refreshIfOfflineCopy(): Promise<void> {
  const [config, cache] = await Promise.all([getConfig(), ruleCacheItem.getValue()]);
  if (config.ruleSource.kind !== 'builtin' || config.ruleSource.updateInterval === 'off') return;
  if (cache && !cache.sourceUrl.startsWith('builtin:')) return;
  await refreshRules(false);
}
