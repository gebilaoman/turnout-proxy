// 从 ZeroOmega / SwitchyOmega 导入（docs/zeroomega-import.md §5：预览、可逐个取消、说明未导入项、导入前自动备份）
import { useState } from 'react';
import { i18n } from '#i18n';
import type { PersistedConfig } from '@/core/config';
import { applyZeroOmega, parseZeroOmega, type SkippedItem, type ZeroOmegaImport as Parsed } from '@/core/import/zeroomega';
import { hasOriginPermission, requestOriginPermission, sendMessage } from '@/platform/view';
import { Button, uiClass as ui } from '@/ui/components';
import { newClientId, schemeLabel } from '@/ui/format';
import s from './Options.module.css';

function skipText(it: SkippedItem): string {
  switch (it.reason) {
    case 'unsupported_scheme':
      return i18n.t('options.zo.skip.scheme');
    case 'no_proxy':
      return i18n.t('options.zo.skip.noProxy');
    case 'duplicate':
      return i18n.t('options.zo.skip.duplicate');
    case 'pac':
      return i18n.t('options.zo.skip.pac');
    case 'auto_detect':
      return i18n.t('options.zo.skip.autoDetect');
    case 'conditions':
      return i18n.t('options.zo.skip.conditions', [String(it.count ?? 0)]);
    case 'virtual':
      return i18n.t('options.zo.skip.virtual');
    case 'extra_rule_list':
      return i18n.t('options.zo.skip.extraRuleList');
    default:
      return i18n.t('options.zo.skip.ruleFormat');
  }
}

export function ZeroOmegaImport({ config, onDone }: { config: PersistedConfig; onDone: (msg: { ok: boolean; text: string }) => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [useRules, setUseRules] = useState(true);
  const [useMode, setUseMode] = useState(true);
  const [error, setError] = useState('');

  const load = async (file: File) => {
    setError('');
    const text = await file.text();
    // 扫描本机端口，用于判断导入的本机代理是否为混合端口（§3 第 3 条）
    const hits = await sendMessage('scan', undefined).catch(() => []);
    const r = parseZeroOmega(text, { existing: config.clients, mixedPorts: hits.filter((h) => h.state === 'http').map((h) => h.port) });
    if (!r.ok) {
      setParsed(null);
      setError(r.error.code === 'unsupported_version' ? i18n.t('options.zo.unsupportedVersion', [String(r.error.version)]) : i18n.t('options.zo.invalidFile'));
      return;
    }
    setParsed(r.value);
    setPicked(r.value.clients.map((c) => c.name));
  };

  const doImport = async () => {
    if (!parsed) return;
    const wantRules = useRules && !!parsed.ruleSourceUrl;
    // 权限申请必须在点击处理中第一时间发起
    if (wantRules && parsed.ruleSourceUrl && !(await hasOriginPermission(parsed.ruleSourceUrl)) && !(await requestOriginPermission(parsed.ruleSourceUrl))) {
      setError(i18n.t('options.rules.permissionDenied', [new URL(parsed.ruleSourceUrl).hostname]));
      return;
    }
    const next = applyZeroOmega(config, parsed, { clientNames: picked, useRuleSource: wantRules, useMode }, newClientId);
    const r = await sendMessage('saveConfigWithBackup', next);
    if (r.ok) {
      setParsed(null);
      onDone({ ok: true, text: i18n.t('options.zo.done', [String(picked.length)]) });
    } else {
      setError(i18n.t('errors.invalid', [r.issues?.[0]?.code ?? r.code]));
    }
  };

  return (
    <>
      <div className={s.panelRow}>
        <div className={s.rowText}>
          <div className={s.rowTitle}>{i18n.t('options.zo.title')}</div>
          <div className={s.rowDesc}>{i18n.t('options.zo.desc')}</div>
        </div>
        <label className={`${ui.btn} ${ui.secondary}`}>
          {i18n.t('options.backup.importBtn')}
          <input
            type="file"
            accept=".bak,.json,.txt,application/json,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && (
        <div className={s.block}>
          <div className={ui.error}>{error}</div>
        </div>
      )}
      {parsed && (
        <div className={s.block}>
          <div className={s.rowTitle}>{i18n.t('options.zo.clients')}</div>
          {parsed.clients.length === 0 && <div className={s.tip}>{i18n.t('options.zo.noClients')}</div>}
          {parsed.clients.map((c) => (
            <label key={c.name} className={s.inline}>
              <input
                type="checkbox"
                checked={picked.includes(c.name)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.name] : p.filter((x) => x !== c.name)))}
              />
              <span style={{ fontWeight: 500 }}>{c.name}</span>
              <span className={s.mono}>
                {c.host}:{c.port}
              </span>
              <span className={s.cellMuted}>{schemeLabel(c.scheme)}</span>
              {c.name === parsed.exitName && <span className={s.badge}>{i18n.t('options.clients.default')}</span>}
              {c.authDropped && <span className={s.tip}>{i18n.t('options.zo.authDropped')}</span>}
            </label>
          ))}
          {parsed.ruleSourceUrl && (
            <label className={s.inline}>
              <input type="checkbox" checked={useRules} onChange={(e) => setUseRules(e.target.checked)} />
              <span>{i18n.t('options.zo.useRules')}</span>
              <span className={s.mono} style={{ overflowWrap: 'anywhere' }}>
                {parsed.ruleSourceUrl}
              </span>
            </label>
          )}
          {parsed.mode && (
            <label className={s.inline}>
              <input type="checkbox" checked={useMode} onChange={(e) => setUseMode(e.target.checked)} />
              <span>{i18n.t('options.zo.useMode', [i18n.t(`mode.${parsed.mode}`)])}</span>
            </label>
          )}
          {parsed.skipped.length > 0 && (
            <>
              <div className={s.rowTitle} style={{ marginTop: 6 }}>
                {i18n.t('options.zo.skipped')}
              </div>
              <ul className={s.issues}>
                {parsed.skipped.map((it, i) => (
                  <li key={i}>
                    {it.name}：{skipText(it)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className={s.inline} style={{ marginTop: 6 }}>
            <Button variant="primary" disabled={picked.length === 0 && !(useRules && parsed.ruleSourceUrl)} onClick={() => void doImport()}>
              {i18n.t('options.zo.confirm')}
            </Button>
            <Button variant="ghostMuted" onClick={() => setParsed(null)}>
              {i18n.t('common.cancel')}
            </Button>
            <span className={s.tip}>{i18n.t('options.zo.backupNote')}</span>
          </div>
        </div>
      )}
    </>
  );
}
