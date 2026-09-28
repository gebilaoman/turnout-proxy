// 设置页「我的网站」：按网站手动指定直连 / 走代理，优先于规则订阅。
// 输入框可一次粘贴多个域名或网址（空格、逗号、换行分隔），方便整理直连白名单。
import { useState } from 'react';
import { i18n } from '#i18n';
import { MAX_SITE_RULES, removeSiteRule, setSiteRule, type PersistedConfig, type SiteAction } from '@/core/config';
import { domainFromInput, hasLeadingWildcard } from '@/core/domain';
import { Button, uiClass as ui } from '@/ui/components';
import { saveOrReport } from './ClientsSection';
import s from './Options.module.css';

export function SiteRules({ config }: { config: PersistedConfig }) {
  const [text, setText] = useState('');
  const [action, setAction] = useState<SiteAction>('direct');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');

  const add = async () => {
    const parts = text.split(/[\s,，;；]+/).filter(Boolean);
    const domains: string[] = [];
    const bad: string[] = [];
    const wildcards: string[] = [];
    setNote('');
    for (const p of parts) {
      const d = domainFromInput(p);
      if (d) {
        domains.push(d);
        if (hasLeadingWildcard(p)) wildcards.push(d);
      } else bad.push(p);
    }
    if (domains.length === 0) {
      setError(i18n.t('options.sites.invalid', [bad.slice(0, 3).join('、') || text]));
      return;
    }
    let next = config;
    for (const d of [...new Set(domains)].reverse()) next = setSiteRule(next, d, action);
    if (next.siteRules.length > MAX_SITE_RULES) {
      setError(i18n.t('options.sites.tooMany', [String(MAX_SITE_RULES)]));
      return;
    }
    setError(bad.length ? i18n.t('options.sites.partlyInvalid', [bad.slice(0, 3).join('、')]) : '');
    // 保存返回前用户可能已输入新内容：只在输入框没被改动时才换成无效的剩余部分
    const submitted = text;
    if (await saveOrReport(next, setError)) {
      setText((t) => (t === submitted ? bad.join(' ') : t));
      if (wildcards.length) setNote(i18n.t('options.sites.wildcardNote', [[...new Set(wildcards)].slice(0, 3).join('、')]));
    }
  };

  const shown = filter.trim() ? config.siteRules.filter((r) => r.domain.includes(filter.trim().toLowerCase())) : config.siteRules;
  const directCount = config.siteRules.filter((r) => r.action === 'direct').length;

  return (
    <section className={s.section}>
      <div className={s.head}>
        <div className={s.headText}>
          <h2 className={s.h2}>{i18n.t('options.sites.title')}</h2>
          <p className={s.lead}>{i18n.t('options.sites.lead')}</p>
        </div>
      </div>
      <div className={s.panel}>
        <form
          className={s.block}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className={s.inline}>
            <input
              className={`${ui.input} ${ui.mono}`}
              style={{ flexGrow: 1 }}
              value={text}
              placeholder={i18n.t('options.sites.placeholder')}
              aria-label={i18n.t('options.sites.inputLabel')}
              onChange={(e) => setText(e.target.value)}
            />
            <select className={ui.select} value={action} aria-label={i18n.t('options.sites.actionLabel')} onChange={(e) => setAction(e.target.value as SiteAction)}>
              <option value="direct">{i18n.t('options.sites.direct')}</option>
              <option value="proxy">{i18n.t('options.sites.proxy')}</option>
            </select>
            <Button variant="primary" type="submit" disabled={!text.trim()}>
              {i18n.t('common.add')}
            </Button>
          </div>
          {error && <div className={ui.error}>{error}</div>}
          {note && <div className={s.ok}>{note}</div>}
          <div className={s.tip}>{i18n.t('options.sites.tip')}</div>
        </form>

        {config.siteRules.length > 8 && (
          <div className={s.block}>
            <input className={ui.input} value={filter} placeholder={i18n.t('options.sites.filter')} onChange={(e) => setFilter(e.target.value)} />
          </div>
        )}

        {config.siteRules.length === 0 ? (
          <div className={s.empty}>{i18n.t('options.sites.empty')}</div>
        ) : (
          <div className={s.siteList}>
            {shown.map((r) => (
              <div key={r.domain} className={s.siteRow}>
                <span className={s.mono} style={{ flexGrow: 1, overflowWrap: 'anywhere' }}>
                  {r.domain}
                </span>
                <select
                  className={ui.select}
                  style={{ height: 30, fontSize: 13 }}
                  value={r.action}
                  aria-label={i18n.t('options.sites.actionFor', [r.domain])}
                  onChange={(e) => void saveOrReport(setSiteRule(config, r.domain, e.target.value as SiteAction), setError)}
                >
                  <option value="direct">{i18n.t('options.sites.direct')}</option>
                  <option value="proxy">{i18n.t('options.sites.proxy')}</option>
                </select>
                <Button small variant="ghostMuted" aria-label={i18n.t('options.sites.removeFor', [r.domain])} onClick={() => void saveOrReport(removeSiteRule(config, r.domain), setError)}>
                  {i18n.t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {config.siteRules.length > 0 && (
          <div className={s.block} style={{ borderBottom: 0 }}>
            <span className={s.tip}>
              {i18n.t('options.sites.count', [String(config.siteRules.length), String(directCount), String(config.siteRules.length - directCount), String(MAX_SITE_RULES)])}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
