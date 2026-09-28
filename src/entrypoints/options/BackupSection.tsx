import { useEffect, useState } from 'react';
import { i18n } from '#i18n';
import { exportConfig, type ConfigBackup, type ImportError } from '@/core/config';
import type { ViewState } from '@/platform/messages';
import { sendMessage } from '@/platform/view';
import { Button, uiClass as ui } from '@/ui/components';
import { formatDate } from '@/ui/format';
import s from './Options.module.css';

function importErrorText(e: ImportError): string {
  switch (e.code) {
    case 'invalid_json':
      return i18n.t('options.backup.err.json');
    case 'not_turnout':
      return i18n.t('options.backup.err.notTurnout');
    case 'newer_version':
      return i18n.t('options.backup.err.newer', [String(e.version)]);
    case 'invalid_config':
      return i18n.t('options.backup.err.invalid', [e.issues.map((x) => `${x.path.join('.')}: ${x.code}`).join('; ')]);
    default:
      return i18n.t('options.backup.err.version');
  }
}

export function BackupSection({ view }: { view: ViewState }) {
  const [backups, setBackups] = useState<ConfigBackup[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = () => void sendMessage('listBackups', undefined).then(setBackups);
  useEffect(reload, []);

  const doExport = () => {
    const blob = new Blob([exportConfig(view.config)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `turnout-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const doImport = async (file: File) => {
    const text = await file.text();
    const r = await sendMessage('importConfig', text);
    setMessage(r.ok ? { ok: true, text: i18n.t('options.backup.imported') } : { ok: false, text: importErrorText(r.error) });
    reload();
  };

  const restore = async (i: number) => {
    const r = await sendMessage('restoreBackup', i);
    setMessage(r.ok ? { ok: true, text: i18n.t('options.backup.restored') } : { ok: false, text: r.code });
    reload();
  };

  return (
    <section className={s.section}>
      <div className={s.headText}>
        <h1 className={s.h1}>{i18n.t('options.backup.title')}</h1>
        <p className={s.lead}>{i18n.t('options.backup.lead')}</p>
      </div>
      <div className={s.panel}>
        <div className={s.panelRow}>
          <div className={s.rowText}>
            <div className={s.rowTitle}>{i18n.t('options.backup.export')}</div>
            <div className={s.rowDesc}>{i18n.t('options.backup.exportDesc')}</div>
          </div>
          <Button onClick={doExport}>{i18n.t('options.backup.exportBtn')}</Button>
        </div>
        <div className={s.panelRow}>
          <div className={s.rowText}>
            <div className={s.rowTitle}>{i18n.t('options.backup.import')}</div>
            <div className={s.rowDesc}>{i18n.t('options.backup.importDesc')}</div>
          </div>
          <label className={`${ui.btn} ${ui.secondary}`}>
            {i18n.t('options.backup.importBtn')}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>
      {message && <div className={message.ok ? s.ok : ui.error}>{message.text}</div>}

      <h2 className={s.h2}>{i18n.t('options.backup.auto')}</h2>
      <div className={s.panel}>
        {backups.length === 0 && <div className={s.empty}>{i18n.t('options.backup.none')}</div>}
        {backups.map((b, i) => (
          <div key={b.savedAt + i} className={s.panelRow}>
            <div className={s.rowText}>
              <div className={s.rowTitle}>{formatDate(b.savedAt)}</div>
              <div className={s.rowDesc}>{i18n.t('options.backup.backupDesc', [String(b.version ?? '?')])}</div>
            </div>
            <Button small onClick={() => void restore(i)}>
              {i18n.t('options.backup.restore')}
            </Button>
          </div>
        ))}
      </div>
      <div className={s.dashed}>{i18n.t('options.backup.zeroOmegaNote')}</div>
    </section>
  );
}
