import { useState } from 'react';
import { i18n } from '#i18n';
import {
  addClient,
  removeClient,
  setBackup,
  setExit,
  setFallbackOptions,
  updateClient,
  validateConfig,
  CURRENT_CONFIG_VERSION,
  type ConfigIssue,
  type Client,
  type PersistedConfig,
  type ProxyScheme,
} from '@/core/config';
import type { CommandResult, ScanHit, ViewState } from '@/platform/messages';
import { sendMessage } from '@/platform/view';
import { Button, Dot, Toggle, uiClass as ui } from '@/ui/components';
import { address, healthView, newClientId, schemeLabel } from '@/ui/format';
import s from './Options.module.css';

export async function saveOrReport(next: PersistedConfig, onError: (msg: string) => void): Promise<boolean> {
  // 页面比后台新（扩展文件已更新但扩展未重新加载）：配置还是旧版本，保存必然失败，直接说明原因
  if (next.version !== CURRENT_CONFIG_VERSION) {
    onError(i18n.t('errors.staleExtension'));
    return false;
  }
  const local = validateConfig(next);
  if (!local.ok) {
    onError(issueText(local.issues[0]));
    return false;
  }
  const r: CommandResult = await sendMessage('saveConfig', next);
  if (!r.ok) onError(issueText(r.issues?.[0] ?? { path: [], code: r.code }));
  return r.ok;
}

function issueText(issue: ConfigIssue | undefined): string {
  const code = issue?.code;
  switch (code) {
    case 'duplicate_client_id':
      return i18n.t('errors.duplicateId');
    case 'too_big':
    case 'too_small':
      return i18n.t('errors.portRange');
    case 'invalid_format':
      return i18n.t('errors.hostFormat');
    case 'invalid_domain':
      return i18n.t('errors.invalidDomain');
    default:
      // 未单独翻译的错误：带上字段路径，便于定位
      return i18n.t('errors.invalid', [[issue?.path.join('.'), code].filter(Boolean).join(' ')]);
  }
}

type Draft = { id: string | null; name: string; host: string; port: string; scheme: ProxyScheme };
const emptyDraft = (): Draft => ({ id: null, name: '', host: '127.0.0.1', port: '', scheme: 'mixed' });

export function ClientsSection({ view }: { view: ViewState }) {
  const { config, runtime } = view;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [hits, setHits] = useState<ScanHit[] | null>(null);

  const primaryId = config.settings.exit.kind === 'client' ? config.settings.exit.clientId : null;
  const backupId = config.settings.backupClientId;

  const submitDraft = async () => {
    if (!draft) return;
    const port = Number(draft.port);
    const name = draft.name.trim() || `${draft.host}:${draft.port}`;
    const dup = config.clients.find((c) => c.id !== draft.id && c.host.toLowerCase() === draft.host.trim().toLowerCase() && c.port === port);
    if (dup) {
      setError(i18n.t('errors.duplicateAddress', [dup.name]));
      return;
    }
    const client: Client = { id: draft.id ?? newClientId(), name, host: draft.host.trim(), port, scheme: draft.scheme, source: draft.id ? (config.clients.find((c) => c.id === draft.id)?.source ?? 'manual') : 'manual' };
    const next = draft.id ? updateClient(config, client) : addClient(config, client);
    setError('');
    // 只关闭当初提交的那份表单（保存返回前用户可能已打开新的表单）
    const submitted = draft;
    if (await saveOrReport(next, setError)) setDraft((d) => (d === submitted ? null : d));
  };

  const doScan = async () => {
    setScanning(true);
    try {
      setHits(await sendMessage('scan', undefined));
    } finally {
      setScanning(false);
    }
  };

  const addHit = async (h: ScanHit) => {
    const client: Client = { id: newClientId(), name: h.hint, host: h.host, port: h.port, scheme: h.scheme, source: 'discovered' };
    await saveOrReport(addClient(config, client), setError);
    setHits((list) => list?.map((x) => (x.port === h.port ? { ...x, configuredId: client.id } : x)) ?? null);
  };

  return (
    <>
      <section className={s.section}>
        <div className={s.head}>
          <div className={s.headText}>
            <h1 className={s.h1}>{i18n.t('options.clients.title')}</h1>
            <p className={s.lead}>{i18n.t('options.clients.lead')}</p>
          </div>
          <Button onClick={doScan} disabled={scanning}>
            {scanning ? i18n.t('options.clients.scanning') : i18n.t('options.clients.rescan')}
          </Button>
          <Button variant="primary" onClick={() => setDraft(emptyDraft())}>
            {i18n.t('options.clients.add')}
          </Button>
        </div>

        {hits && (
          <div className={s.scan}>
            {hits.length === 0 ? (
              <span>{i18n.t('options.clients.scanNone')}</span>
            ) : (
              hits.map((h) => (
                <div key={h.port} className={s.scanRow}>
                  <span className={s.mono}>{address(h)}</span>
                  <span className={s.cellMuted} style={{ flexGrow: 1 }}>
                    {h.hint} · {h.state === 'http' ? i18n.t('health.listening') : i18n.t('health.pendingSocks')}
                  </span>
                  {h.configuredId ? (
                    <span className={s.ok}>{i18n.t('options.clients.alreadyAdded')}</span>
                  ) : (
                    <Button small onClick={() => void addHit(h)}>
                      {i18n.t('options.clients.addThis')}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <div className={s.table}>
          <div className={s.th}>
            <span>{i18n.t('options.clients.colName')}</span>
            <span>{i18n.t('options.clients.colAddr')}</span>
            <span>{i18n.t('options.clients.colType')}</span>
            <span>{i18n.t('options.clients.colStatus')}</span>
            <span>{i18n.t('options.clients.colLatency')}</span>
            <span className={s.right}>{i18n.t('options.clients.colActions')}</span>
          </div>
          {draft && <DraftForm draft={draft} setDraft={setDraft} error={error} onSubmit={submitDraft} onCancel={() => { setDraft(null); setError(''); }} />}
          {config.clients.length === 0 && !draft && <div className={s.empty}>{i18n.t('options.clients.empty')}</div>}
          {config.clients.map((c) => {
            const h = healthView(runtime.health[c.id], runtime.ports[c.id]);
            return (
              <div key={c.id} className={s.tr}>
                <span className={s.name}>
                  {c.name}
                  {c.id === primaryId && <span className={s.badge}>{i18n.t('options.clients.default')}</span>}
                  {c.id === backupId && <span className={s.badgeMuted}>{i18n.t('options.clients.backup')}</span>}
                </span>
                <span className={s.mono}>{address(c)}</span>
                <span className={s.cellMuted}>{schemeLabel(c.scheme)}</span>
                <span className={s.status} style={{ color: h.color }}>
                  <Dot color={h.color} />
                  {h.label}
                </span>
                <span className={s.mono} style={{ color: 'var(--text-3)' }}>
                  {h.online ? h.detail : h.offline ? <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}>{h.detail}</span> : '—'}
                </span>
                <span className={s.actions}>
                  {c.id !== primaryId && (
                    <Button small variant="ghost" onClick={() => void saveOrReport(setExit(config, { kind: 'client', clientId: c.id }), setError)}>
                      {i18n.t('options.clients.makeDefault')}
                    </Button>
                  )}
                  <Button small variant="ghost" onClick={() => setDraft({ id: c.id, name: c.name, host: c.host, port: String(c.port), scheme: c.scheme })}>
                    {i18n.t('common.edit')}
                  </Button>
                  {confirmDelete === c.id ? (
                    <Button
                      small
                      variant="dangerOutline"
                      onClick={() => {
                        setConfirmDelete(null);
                        void saveOrReport(removeClient(config, c.id), setError);
                      }}
                    >
                      {i18n.t('options.clients.confirmDelete')}
                    </Button>
                  ) : (
                    <Button small variant="ghostMuted" onClick={() => setConfirmDelete(c.id)}>
                      {i18n.t('common.delete')}
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {error && !draft && <div className={ui.error}>{error}</div>}
        <div className={s.tip}>{i18n.t('options.clients.portTip')}</div>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>{i18n.t('options.fallback.title')}</h2>
        <div className={s.panel}>
          <div className={s.panelRow}>
            <div className={s.rowText}>
              <label htmlFor="backup" className={s.rowTitle}>
                {i18n.t('options.fallback.backup')}
              </label>
              <span className={s.rowDesc}>{i18n.t('options.fallback.backupDesc')}</span>
            </div>
            <select
              id="backup"
              className={ui.select}
              style={{ width: 220 }}
              value={backupId ?? ''}
              onChange={(e) => void saveOrReport(setBackup(config, e.target.value || null), setError)}
            >
              <option value="">{i18n.t('options.fallback.noBackup')}</option>
              {config.clients
                .filter((c) => c.id !== primaryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className={s.panelRow}>
            <div className={s.rowText}>
              <label htmlFor="direct" className={s.rowTitle}>
                {i18n.t('options.fallback.direct')}
              </label>
              <span className={s.rowDesc}>{i18n.t('options.fallback.directDesc')}</span>
            </div>
            <Toggle id="direct" checked={config.settings.allowDirectWhenAllDown} onChange={(v) => void saveOrReport(setFallbackOptions(config, { allowDirectWhenAllDown: v }), setError)} />
          </div>
          <div className={s.panelRow}>
            <div className={s.rowText}>
              <label htmlFor="back" className={s.rowTitle}>
                {i18n.t('options.fallback.autoBack')}
              </label>
              <span className={s.rowDesc}>{i18n.t('options.fallback.autoBackDesc')}</span>
            </div>
            <Toggle id="back" checked={config.settings.autoSwitchBack} onChange={(v) => void saveOrReport(setFallbackOptions(config, { autoSwitchBack: v }), setError)} />
          </div>
        </div>
      </section>
    </>
  );
}

function DraftForm({ draft, setDraft, error, onSubmit, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; error: string; onSubmit: () => void; onCancel: () => void }) {
  const portOk = /^\d{1,5}$/.test(draft.port) && Number(draft.port) >= 1 && Number(draft.port) <= 65535;
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (portOk) onSubmit();
      }}
    >
      <label className={ui.field}>
        {i18n.t('options.clients.colName')}
        <input className={ui.input} value={draft.name} placeholder={i18n.t('options.clients.namePlaceholder')} maxLength={64} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className={ui.field}>
        {i18n.t('options.clients.host')}
        <input className={`${ui.input} ${ui.mono}`} value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
      </label>
      <label className={ui.field}>
        {i18n.t('options.clients.port')}
        <input className={`${ui.input} ${ui.mono}`} value={draft.port} inputMode="numeric" placeholder="7890" autoFocus onChange={(e) => setDraft({ ...draft, port: e.target.value.trim() })} />
      </label>
      <label className={ui.field}>
        {i18n.t('options.clients.colType')}
        <select className={ui.select} value={draft.scheme} onChange={(e) => setDraft({ ...draft, scheme: e.target.value as ProxyScheme })}>
          {(['mixed', 'http', 'socks5'] as const).map((sc) => (
            <option key={sc} value={sc}>
              {schemeLabel(sc)}
            </option>
          ))}
        </select>
      </label>
      <div className={s.formActions}>
        <Button variant="primary" type="submit" disabled={!portOk}>
          {i18n.t('common.save')}
        </Button>
        <Button variant="ghostMuted" onClick={onCancel}>
          {i18n.t('common.cancel')}
        </Button>
      </div>
      {error && <div className={`${ui.error} ${s.formErr}`}>{error}</div>}
    </form>
  );
}
