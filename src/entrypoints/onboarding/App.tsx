// 首次引导（docs/design/project/Onboarding）：1 发现客户端 → 2 选择分流规则 → 3 完成
import { useCallback, useEffect, useState } from 'react';
import { i18n } from '#i18n';
import { defaultConfig, validateConfig, type Client, type Mode, type PersistedConfig, type ProxyScheme } from '@/core/config';
import type { ScanHit, ViewState } from '@/platform/messages';
import { requestOriginPermission, sendMessage, subscribeView } from '@/platform/view';
import { Button, Logo, uiClass as ui, useSubscription } from '@/ui/components';
import { schemeLabel, newClientId } from '@/ui/format';
import s from './Onboarding.module.css';

interface Candidate {
  key: string;
  use: boolean;
  name: string;
  host: string;
  port: number;
  scheme: ProxyScheme;
  state: ScanHit['state'] | 'manual';
  source: Client['source'];
}

export function App() {
  const view = useSubscription<ViewState>(useCallback(subscribeView, []));
  const [step, setStep] = useState(1);
  const [scanning, setScanning] = useState(false);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [manual, setManual] = useState<{ port: string; scheme: ProxyScheme } | null>(null);
  const [ruleKind, setRuleKind] = useState<'builtin' | 'custom'>('builtin');
  const [ruleUrl, setRuleUrl] = useState('');
  const [mode, setMode] = useState<Mode>('smart');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const hits = await sendMessage('scan', undefined);
      setCands((prev) => {
        const manualOnes = prev.filter((c) => c.state === 'manual');
        const found = hits.map((h) => ({ key: `${h.host}:${h.port}`, use: true, name: h.hint, host: h.host, port: h.port, scheme: h.scheme, state: h.state, source: 'discovered' as const }));
        return [...found, ...manualOnes.filter((m) => !found.some((f) => f.key === m.key))];
      });
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const chosen = cands.filter((c) => c.use);

  const buildConfig = (): PersistedConfig => {
    // 已有配置时在其基础上合并（重新运行引导不会丢失已有客户端）
    const base = view && view.config.clients.length > 0 ? structuredClone(view.config) : defaultConfig();
    for (const c of chosen) {
      if (base.clients.some((x) => x.host === c.host && x.port === c.port)) continue;
      base.clients.push({ id: newClientId(), name: c.name.trim() || `${c.host}:${c.port}`, host: c.host, port: c.port, scheme: c.scheme, source: c.source });
    }
    const firstChosen = chosen[0] && base.clients.find((x) => x.host === chosen[0]?.host && x.port === chosen[0]?.port);
    const secondChosen = chosen[1] && base.clients.find((x) => x.host === chosen[1]?.host && x.port === chosen[1]?.port);
    if (firstChosen) {
      base.settings.exit = { kind: 'client', clientId: firstChosen.id };
      base.settings.backupClientId = secondChosen?.id ?? null;
    }
    base.settings.mode = mode;
    base.ruleSource = ruleKind === 'custom' ? { kind: 'custom', url: ruleUrl.trim(), updateInterval: 'daily' } : { kind: 'builtin', updateInterval: 'daily' };
    return base;
  };

  const next2 = async () => {
    setError('');
    if (ruleKind === 'custom') {
      let u: URL;
      try {
        u = new URL(ruleUrl.trim());
      } catch {
        setError(i18n.t('options.rules.badUrl'));
        return;
      }
      if (!(await requestOriginPermission(u.href))) {
        setError(i18n.t('options.rules.permissionDenied', [u.hostname]));
        return;
      }
    }
    const cfg = buildConfig();
    const v = validateConfig(cfg);
    if (!v.ok) {
      setError(i18n.t('errors.invalid', [v.issues.map((x) => x.code).join(', ')]));
      return;
    }
    setStep(3);
  };

  const finish = async () => {
    setError('');
    const r = await sendMessage('finishOnboarding', buildConfig());
    if (r.ok) setDone(true);
    else setError(i18n.t('errors.invalid', [r.code]));
  };

  const addManual = () => {
    if (!manual) return;
    const port = Number(manual.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(i18n.t('errors.portRange'));
      return;
    }
    setError('');
    const key = `127.0.0.1:${port}`;
    setCands((list) => (list.some((c) => c.key === key) ? list : [...list, { key, use: true, name: '', host: '127.0.0.1', port, scheme: manual.scheme, state: 'manual', source: 'manual' }]));
    setManual(null);
  };

  const STEPS = [i18n.t('onboarding.step1'), i18n.t('onboarding.step2'), i18n.t('onboarding.step3')];

  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <div className={s.brand}>
          <Logo size={28} />
          <div>Turnout</div>
        </div>

        <ol className={s.steps}>
          {STEPS.map((label, i) => (
            <li key={label} className={s.stepItem}>
              <span className={i + 1 <= step ? s.barOn : s.bar} />
              <span className={i + 1 === step ? s.stepOn : s.stepLabel}>
                {i + 1} · {label}
              </span>
            </li>
          ))}
        </ol>

        {step === 1 && (
          <>
            <div className={s.intro}>
              <h1 className={s.h1}>{scanning ? i18n.t('onboarding.scanning') : cands.length > 0 ? i18n.t('onboarding.found', [String(cands.length)]) : i18n.t('onboarding.notFound')}</h1>
              <p className={s.lead}>{i18n.t('onboarding.scanLead')}</p>
            </div>
            <div className={s.list}>
              {cands.map((c, idx) => {
                const rank = chosen.indexOf(c);
                return (
                  <div key={c.key} className={rank === 0 ? s.candOn : s.cand}>
                    <input type="checkbox" className={s.check} checked={c.use} aria-label={i18n.t('onboarding.useThis')} onChange={(e) => setCands((l) => l.map((x, j) => (j === idx ? { ...x, use: e.target.checked } : x)))} />
                    <label className={`${ui.field} ${s.grow}`}>
                      {i18n.t('options.clients.colName')}
                      <input className={ui.input} value={c.name} placeholder={`${c.host}:${c.port}`} maxLength={64} onChange={(e) => setCands((l) => l.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))} />
                    </label>
                    <div className={s.addr}>
                      <span className={s.mono}>
                        {c.host}:{c.port}
                      </span>
                      <select className={s.schemeSel} value={c.scheme} onChange={(e) => setCands((l) => l.map((x, j) => (j === idx ? { ...x, scheme: e.target.value as ProxyScheme } : x)))}>
                        {(['mixed', 'http', 'socks5'] as const).map((sc) => (
                          <option key={sc} value={sc}>
                            {schemeLabel(sc)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={s.state}>
                      {c.state === 'http' ? i18n.t('health.listening') : c.state === 'maybe_socks' ? i18n.t('health.pendingSocks') : i18n.t('onboarding.manual')}
                    </div>
                    {rank === 0 && <span className={s.badge}>{i18n.t('options.clients.default')}</span>}
                    {rank === 1 && <span className={s.badgeMuted}>{i18n.t('options.clients.backup')}</span>}
                  </div>
                );
              })}
              <div className={s.hint}>
                <span className={s.grow}>{i18n.t('onboarding.missing')}</span>
                {manual ? (
                  <>
                    <input className={`${ui.input} ${ui.mono}`} style={{ width: 90 }} placeholder="7890" value={manual.port} autoFocus onChange={(e) => setManual({ ...manual, port: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && addManual()} />
                    <select className={ui.select} value={manual.scheme} onChange={(e) => setManual({ ...manual, scheme: e.target.value as ProxyScheme })}>
                      {(['mixed', 'http', 'socks5'] as const).map((sc) => (
                        <option key={sc} value={sc}>
                          {schemeLabel(sc)}
                        </option>
                      ))}
                    </select>
                    <Button small variant="primary" onClick={addManual}>
                      {i18n.t('common.add')}
                    </Button>
                  </>
                ) : (
                  <Button small onClick={() => setManual({ port: '', scheme: 'mixed' })}>
                    {i18n.t('options.clients.add')}
                  </Button>
                )}
                <Button small variant="ghost" disabled={scanning} onClick={() => void scan()}>
                  {i18n.t('options.clients.rescan')}
                </Button>
              </div>
            </div>
            {error && <div className={ui.error}>{error}</div>}
            <div className={s.footer}>
              <span className={s.muted}>{i18n.t('onboarding.latencyLater')}</span>
              <div className={s.grow} />
              <Button variant="primary" className={s.bigBtn} disabled={chosen.length === 0} onClick={() => setStep(2)}>
                {i18n.t('common.next')}
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className={s.intro}>
              <h1 className={s.h1}>{i18n.t('onboarding.rulesTitle')}</h1>
              <p className={s.lead}>{i18n.t('onboarding.rulesLead')}</p>
            </div>
            <div className={s.list}>
              {(['smart', 'all'] as const).map((m) => (
                <label key={m} className={mode === m ? s.optOn : s.opt}>
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                  <span className={s.optText}>
                    <span className={s.optTitle}>{i18n.t(`mode.${m}`)}</span>
                    <span className={s.muted}>{i18n.t(`mode.${m}Hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
            {mode === 'smart' && (
              <div className={s.list}>
                <label className={ruleKind === 'builtin' ? s.optOn : s.opt}>
                  <input type="radio" name="rules" checked={ruleKind === 'builtin'} onChange={() => setRuleKind('builtin')} />
                  <span className={s.optText}>
                    <span className={s.optTitle}>{i18n.t('options.rules.builtin')}</span>
                    <span className={s.muted}>{i18n.t('options.rules.builtinDesc')}</span>
                  </span>
                </label>
                <label className={ruleKind === 'custom' ? s.optOn : s.opt}>
                  <input type="radio" name="rules" checked={ruleKind === 'custom'} onChange={() => setRuleKind('custom')} />
                  <span className={s.optText}>
                    <span className={s.optTitle}>{i18n.t('options.rules.custom')}</span>
                    <span className={s.muted}>{i18n.t('options.rules.customDesc')}</span>
                    {ruleKind === 'custom' && <input className={`${ui.input} ${ui.mono}`} placeholder="https://" value={ruleUrl} onChange={(e) => setRuleUrl(e.target.value)} />}
                  </span>
                </label>
              </div>
            )}
            {error && <div className={ui.error}>{error}</div>}
            <div className={s.footer}>
              <Button variant="ghostMuted" onClick={() => setStep(1)}>
                {i18n.t('common.back')}
              </Button>
              <div className={s.grow} />
              <Button variant="primary" className={s.bigBtn} disabled={ruleKind === 'custom' && mode === 'smart' && !ruleUrl.trim()} onClick={() => void next2()}>
                {i18n.t('common.next')}
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className={s.intro}>
              <h1 className={s.h1}>{done ? i18n.t('onboarding.doneTitle') : i18n.t('onboarding.confirmTitle')}</h1>
              <p className={s.lead}>{done ? i18n.t('onboarding.doneLead') : i18n.t('onboarding.confirmLead')}</p>
            </div>
            <div className={s.summary}>
              <div>
                <span className={s.muted}>{i18n.t('onboarding.sumExit')}</span>
                <b>{chosen[0]?.name || `${chosen[0]?.host}:${chosen[0]?.port}`}</b>
              </div>
              <div>
                <span className={s.muted}>{i18n.t('onboarding.sumBackup')}</span>
                <b>{chosen[1] ? chosen[1].name || `${chosen[1].host}:${chosen[1].port}` : i18n.t('options.fallback.noBackup')}</b>
              </div>
              <div>
                <span className={s.muted}>{i18n.t('onboarding.sumMode')}</span>
                <b>{i18n.t(`mode.${mode}`)}</b>
              </div>
              {mode === 'smart' && (
                <div>
                  <span className={s.muted}>{i18n.t('onboarding.sumRules')}</span>
                  <b>{ruleKind === 'builtin' ? i18n.t('options.rules.builtin') : ruleUrl}</b>
                </div>
              )}
            </div>
            {done && <div className={s.pinTip}>{i18n.t('onboarding.pinTip')}</div>}
            {error && <div className={ui.error}>{error}</div>}
            <div className={s.footer}>
              {!done && (
                <Button variant="ghostMuted" onClick={() => setStep(2)}>
                  {i18n.t('common.back')}
                </Button>
              )}
              <div className={s.grow} />
              {done ? (
                <Button variant="primary" className={s.bigBtn} onClick={() => window.close()}>
                  {i18n.t('onboarding.close')}
                </Button>
              ) : (
                <Button variant="primary" className={s.bigBtn} onClick={() => void finish()}>
                  {i18n.t('onboarding.finish')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
