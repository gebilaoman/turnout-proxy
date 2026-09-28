import { useState } from 'react';
import { i18n } from '#i18n';
import { setRuleSource, type RuleSource } from '@/core/config';
import type { ViewState } from '@/platform/messages';
import { requestOriginPermission, sendMessage } from '@/platform/view';
import { Banner, BannerBody, Button, uiClass as ui } from '@/ui/components';
import { formatDate, relativeTime, ruleErrorText, ruleSourceName } from '@/ui/format';
import { saveOrReport } from './ClientsSection';
import { SiteRules } from './SiteRules';
import s from './Options.module.css';

export function RulesSection({ view }: { view: ViewState }) {
  const { config, runtime, rules } = view;
  const src = config.ruleSource;
  const [kind, setKind] = useState<RuleSource['kind']>(src.kind);
  const [url, setUrl] = useState(src.kind === 'custom' ? src.url : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const interval = src.updateInterval;
  const failed = runtime.ruleUpdate.status === 'failed';
  const exitIsClient = config.settings.exit.kind === 'client';

  const applyBuiltin = async () => {
    setKind('builtin');
    setError('');
    if (src.kind !== 'builtin') await saveOrReport(setRuleSource(config, { kind: 'builtin', updateInterval: interval }), setError);
  };

  const applyCustom = async () => {
    setError('');
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      setError(i18n.t('options.rules.badUrl'));
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      setError(i18n.t('options.rules.badUrl'));
      return;
    }
    // 权限申请必须在点击处理函数里同步发起
    const granted = await requestOriginPermission(parsed.href);
    if (!granted) {
      setError(i18n.t('options.rules.permissionDenied', [parsed.hostname]));
      return;
    }
    setBusy(true);
    try {
      await saveOrReport(setRuleSource(config, { kind: 'custom', url: parsed.href, updateInterval: interval === 'off' ? 'off' : interval }), setError);
    } finally {
      setBusy(false);
    }
  };

  const update = async (viaProxy: boolean) => {
    setBusy(true);
    setError('');
    try {
      await sendMessage('updateRules', viaProxy);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.section}>
      <div className={s.headText}>
        <h1 className={s.h1}>{i18n.t('options.rules.title')}</h1>
        <p className={s.lead}>{i18n.t('options.rules.lead')}</p>
      </div>

      {failed && (
        <Banner
          tone="warn"
          icon="warn"
          title={i18n.t('options.rules.failedTitle', [formatDate(runtime.ruleUpdate.at), ruleErrorText(runtime.ruleUpdate.error)])}
          actions={
            <>
              {exitIsClient && (
                <Button variant="warnOutline" disabled={busy} onClick={() => void update(true)}>
                  {i18n.t('options.rules.viaProxy')}
                </Button>
              )}
              <Button variant="warnGhost" disabled={busy} onClick={() => void update(false)}>
                {i18n.t('common.retry')}
              </Button>
            </>
          }
        >
          <BannerBody>{i18n.t('options.rules.failedBody', [formatDate(rules?.fetchedAt)])}</BannerBody>
        </Banner>
      )}

      <div className={s.panel}>
        <div className={s.block}>
          <div className={s.rowTitle}>{i18n.t('options.rules.source')}</div>
          <div className={s.radioCards}>
            <label className={kind === 'builtin' ? s.radioCardOn : s.radioCard}>
              <input type="radio" name="src" checked={kind === 'builtin'} onChange={() => void applyBuiltin()} />
              <span className={s.rowText}>
                <span className={s.rowTitle}>{i18n.t('options.rules.builtin')}</span>
                <span className={s.rowDesc}>{i18n.t('options.rules.builtinDesc')}</span>
              </span>
            </label>
            <label className={kind === 'custom' ? s.radioCardOn : s.radioCard}>
              <input type="radio" name="src" checked={kind === 'custom'} onChange={() => setKind('custom')} />
              <span className={s.rowText}>
                <span className={s.rowTitle}>{i18n.t('options.rules.custom')}</span>
                <span className={s.rowDesc}>{i18n.t('options.rules.customDesc')}</span>
              </span>
            </label>
          </div>
        </div>

        {kind === 'custom' && (
          <div className={s.block}>
            <label htmlFor="url" className={s.rowTitle}>
              {i18n.t('options.rules.url')}
            </label>
            <div className={s.inline}>
              <input id="url" className={`${ui.input} ${ui.mono}`} style={{ flexGrow: 1 }} value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
              <Button variant="primary" disabled={busy || !url.trim()} onClick={() => void applyCustom()}>
                {src.kind === 'custom' && src.url === url.trim() ? i18n.t('options.rules.updateNow') : i18n.t('options.rules.useThis')}
              </Button>
            </div>
            <div className={s.tip}>{i18n.t('options.rules.permissionTip')}</div>
          </div>
        )}
        {error && (
          <div className={s.block}>
            <div className={ui.error}>{error}</div>
          </div>
        )}

        <div className={s.stats}>
          <div className={s.stat}>
            <span className={s.statLabel}>{i18n.t('options.rules.current')}</span>
            <span className={s.statValue}>
              {ruleSourceName(rules?.sourceUrl)} · {rules?.sourceUrl.startsWith('builtin:') ? i18n.t('options.rules.offlineCopy', [formatDate(rules.fetchedAt).slice(0, 10)]) : i18n.t('options.rules.updatedAt', [relativeTime(rules?.fetchedAt)])}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>{i18n.t('options.rules.count')}</span>
            <span className={s.statValue}>{rules ? i18n.t('options.rules.countValue', [String(rules.stats.matched), String(rules.stats.excepted), String(rules.stats.regex)]) : '—'}</span>
          </div>
          <div className={s.stat}>
            <label htmlFor="freq" className={s.statLabel}>
              {i18n.t('options.rules.autoUpdate')}
            </label>
            <select
              id="freq"
              className={ui.select}
              style={{ width: 160 }}
              value={interval}
              onChange={(e) => void saveOrReport(setRuleSource(config, { ...src, updateInterval: e.target.value as RuleSource['updateInterval'] }), setError)}
            >
              <option value="daily">{i18n.t('options.rules.daily')}</option>
              <option value="weekly">{i18n.t('options.rules.weekly')}</option>
              <option value="off">{i18n.t('options.rules.off')}</option>
            </select>
          </div>
        </div>
      </div>
      {src.kind === 'builtin' && (
        <div className={s.inline}>
          <span className={s.tip} style={{ flexGrow: 1 }}>
            {i18n.t('options.rules.builtinTip')}
          </span>
          <Button disabled={busy || runtime.ruleUpdate.status === 'updating'} onClick={() => void update(false)}>
            {runtime.ruleUpdate.status === 'updating' ? i18n.t('options.rules.updating') : i18n.t('options.rules.updateNow')}
          </Button>
        </div>
      )}
      <SiteRules config={config} />
    </section>
  );
}
