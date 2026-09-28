// 弹窗「当前网站」：说明当前网站怎么走、为什么，并一键设为直连 / 走代理（写入「我的网站」）。
// 当前网址通过 activeTab 读取，只在用户点开弹窗时可用。
import { useEffect, useState } from 'react';
import { i18n } from '#i18n';
import { removeSiteRule, setSiteRule, type PersistedConfig, type SiteAction } from '@/core/config';
import { domainCandidates } from '@/core/domain';
import type { RouteExplanation } from '@/core/pac';
import { getActiveTabUrl, sendMessage } from '@/platform/view';
import s from './App.module.css';

function reasonText(e: RouteExplanation): string {
  switch (e.reason) {
    case 'mode_direct':
      return i18n.t('site.why.modeDirect');
    case 'exit_system':
      return i18n.t('site.why.system');
    case 'local':
      return i18n.t('site.why.local');
    case 'site':
      return i18n.t('site.why.site', [e.matched ?? '']);
    case 'sub_except':
      return i18n.t('site.why.subExcept', [e.matched ?? '']);
    case 'sub_match':
      return e.matched ? i18n.t('site.why.subMatch', [e.matched]) : i18n.t('site.why.subRegex');
    case 'all':
      return i18n.t('site.why.all');
    default:
      return i18n.t('site.why.default');
  }
}

export function CurrentSite({ config, onSave, busy }: { config: PersistedConfig; onSave: (c: PersistedConfig) => Promise<void>; busy: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [explain, setExplain] = useState<RouteExplanation | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    void getActiveTabUrl().then(setUrl);
  }, []);

  const http = url && /^https?:\/\//i.test(url) ? url : null;
  const host = http ? new URL(http).hostname : null;
  const candidates = host ? domainCandidates(host) : [];
  const domain = picked && candidates.includes(picked) ? picked : (candidates[0] ?? null);
  // 配置变化后重新解释（例如刚添加了一条规则）
  const key = JSON.stringify([config.siteRules, config.settings.mode, config.settings.exit]);
  useEffect(() => {
    if (http) void sendMessage('explain', http).then(setExplain);
  }, [http, key]);

  if (!http || !host || !domain) return null;

  const exact = config.siteRules.find((r) => r.domain === domain)?.action ?? null;
  const allMode = config.settings.mode === 'all';
  const actions: SiteAction[] = allMode ? ['direct'] : ['direct', 'proxy'];

  const toggle = (a: SiteAction) => void onSave(exact === a ? removeSiteRule(config, domain) : setSiteRule(config, domain, a));

  const routeLabel =
    explain?.route === 'proxy' ? i18n.t('site.routeProxy') : explain?.route === 'system' ? i18n.t('site.routeSystem') : explain ? i18n.t('site.routeDirect') : '';

  return (
    <section className={s.site} aria-label={i18n.t('site.title')}>
      <div className={s.label}>{i18n.t('site.title')}</div>
      <div className={s.siteHead}>
        {candidates.length > 1 ? (
          <select className={s.siteSelect} value={domain} aria-label={i18n.t('site.scope')} onChange={(e) => setPicked(e.target.value)}>
            {candidates.map((c) => (
              <option key={c} value={c}>
                {c === candidates[0] ? c : i18n.t('site.scopeOption', [c])}
              </option>
            ))}
          </select>
        ) : (
          <span className={s.siteDomain}>{domain}</span>
        )}
      </div>
      {explain && (
        <div className={s.siteWhy}>
          <span className={explain.route === 'proxy' ? s.routeProxy : s.routeDirect}>{routeLabel}</span> · {reasonText(explain)}
        </div>
      )}
      <div className={`${s.sitePick} ${allMode ? s.single : ''}`}>
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            className={exact === a ? s.pickOn : s.pick}
            aria-pressed={exact === a}
            title={exact === a ? i18n.t('site.clickToUndo') : undefined}
            disabled={busy}
            onClick={() => toggle(a)}
          >
            {exact === a ? i18n.t(a === 'direct' ? 'site.isDirect' : 'site.isProxy') : i18n.t(a === 'direct' ? 'site.setDirect' : 'site.setProxy')}
          </button>
        ))}
      </div>
      {allMode && <div className={s.siteWhy}>{i18n.t('site.allModeHint')}</div>}
    </section>
  );
}
