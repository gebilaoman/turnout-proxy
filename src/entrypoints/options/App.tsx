// 设置页（docs/design/project/SettingsClients、SettingsRules）
import { useCallback, useEffect, useState } from 'react';
import { i18n } from '#i18n';
import type { ViewState } from '@/platform/messages';
import { subscribeView } from '@/platform/view';
import { CURRENT_CONFIG_VERSION } from '@/core/config';
import { Logo, StaleExtensionBanner, useSubscription } from '@/ui/components';
import { BackupSection } from './BackupSection';
import { ClientsSection } from './ClientsSection';
import { RulesSection } from './RulesSection';
import s from './Options.module.css';

const SECTIONS = ['clients', 'rules', 'backup', 'about'] as const;
type Section = (typeof SECTIONS)[number];

function currentSection(): Section {
  const h = location.hash.slice(1);
  return (SECTIONS as readonly string[]).includes(h) ? (h as Section) : 'clients';
}

export function App() {
  const view = useSubscription<ViewState>(useCallback(subscribeView, []));
  const [section, setSection] = useState<Section>(currentSection);

  useEffect(() => {
    const onHash = () => setSection(currentSection());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = `${i18n.t(`options.nav.${section}`)} · Turnout`;
  }, [section]);

  const rulesProblem = view?.runtime.ruleUpdate.status === 'failed';

  return (
    <div className={s.layout}>
      <nav className={s.nav} aria-label={i18n.t('options.navLabel')}>
        <div className={s.navBrand}>
          <Logo />
          <span>Turnout</span>
        </div>
        {SECTIONS.map((id) => (
          <a key={id} href={`#${id}`} aria-current={section === id ? 'page' : undefined} className={section === id ? s.navOn : s.navItem}>
            {i18n.t(`options.nav.${id}`)}
            {id === 'rules' && rulesProblem && <span className={s.navDot} aria-label={i18n.t('options.hasProblem')} />}
          </a>
        ))}
        <div className={s.navFoot}>
          {i18n.t('options.version', [view?.version ?? ''])}
          <br />
          {i18n.t('options.noTelemetry')}
        </div>
      </nav>
      <main className={s.main}>
        {view && (
          <StaleExtensionBanner configVersion={view.config.version} expected={CURRENT_CONFIG_VERSION} title={i18n.t('errors.staleTitle')} text={i18n.t('errors.staleExtension')} />
        )}
        {!view ? null : section === 'clients' ? (
          <ClientsSection view={view} />
        ) : section === 'rules' ? (
          <RulesSection view={view} />
        ) : section === 'backup' ? (
          <BackupSection view={view} />
        ) : (
          <AboutSection version={view.version} />
        )}
      </main>
    </div>
  );
}

function AboutSection({ version }: { version: string }) {
  return (
    <section className={s.section}>
      <div className={s.head}>
        <h1 className={s.h1}>{i18n.t('options.about.title')}</h1>
        <p className={s.lead}>{i18n.t('options.about.lead', [version])}</p>
      </div>
      <div className={s.panel}>
        {(['p1', 'p2', 'p3', 'p4'] as const).map((k) => (
          <div key={k} className={s.panelRow}>
            <div className={s.rowText}>
              <div className={s.rowTitle}>{i18n.t(`options.about.${k}Title`)}</div>
              <div className={s.rowDesc}>{i18n.t(`options.about.${k}`)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
