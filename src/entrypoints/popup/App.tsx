// 弹窗（docs/design/project/Main、PopupOffline、PopupConflict、PopupAllDown）
import { useCallback, useEffect, useState } from 'react';
import { i18n } from '#i18n';
import { setExit, setMode, type Client, type Exit, type Mode, type PersistedConfig } from '@/core/config';
import type { ViewState } from '@/platform/messages';
import { openExtensionsPage, openOnboarding, openOptions, sendMessage, subscribeView } from '@/platform/view';
import { Banner, BannerBody, Button, Dot, Logo, Steps, useSubscription } from '@/ui/components';
import { address, healthView, offlineReason, relativeTime, ruleErrorText, ruleSourceName, schemeShort } from '@/ui/format';
import s from './App.module.css';

const MODES: Mode[] = ['smart', 'all', 'direct'];

export function App() {
  const view = useSubscription<ViewState>(useCallback(subscribeView, []));
  const [busy, setBusy] = useState(false);

  // 弹窗打开时立即检测所有客户端（ARCHITECTURE §5）
  useEffect(() => {
    void sendMessage('recheck', 'all');
  }, []);

  if (!view) return <div className={s.popup} />;
  const { config, runtime } = view;

  const save = async (next: PersistedConfig) => {
    setBusy(true);
    try {
      await sendMessage('saveConfig', next);
    } finally {
      setBusy(false);
    }
  };

  const byId = new Map(config.clients.map((c) => [c.id, c]));
  const primary = config.settings.exit.kind === 'client' ? byId.get(config.settings.exit.clientId) : undefined;
  const backup = config.settings.backupClientId ? byId.get(config.settings.backupClientId) : undefined;
  const effId = runtime.effectiveExit?.kind === 'client' ? runtime.effectiveExit.clientId : primary?.id;
  const effective = effId ? byId.get(effId) : undefined;
  const blocked = runtime.control !== 'ok';
  const direct = config.settings.mode === 'direct';
  const alert = direct ? 'none' : runtime.alert;

  return (
    <div className={s.popup}>
      <header className={s.header}>
        <Logo />
        <div className={s.brand}>Turnout</div>
        <button type="button" className={s.iconBtn} aria-label={i18n.t('popup.settings')} onClick={() => openOptions()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </header>

      <div className={s.body}>
        {blocked && (
          <Banner
            tone="error"
            icon="blocked"
            title={runtime.control === 'policy' ? i18n.t('popup.policy.title') : i18n.t('popup.conflict.title')}
            actions={
              runtime.control === 'other_extension' && (
                <>
                  <Button variant="danger" grow onClick={openExtensionsPage}>
                    {i18n.t('popup.conflict.openExtensions')}
                  </Button>
                  <Button variant="dangerOutline" onClick={() => void sendMessage('recheck', 'all')}>
                    {i18n.t('common.recheck')}
                  </Button>
                </>
              )
            }
          >
            <BannerBody>{runtime.control === 'policy' ? i18n.t('popup.policy.body') : i18n.t('popup.conflict.body')}</BannerBody>
            {runtime.control === 'other_extension' && (
              <Steps title={i18n.t('popup.conflict.stepsTitle')} items={[i18n.t('popup.conflict.step1'), i18n.t('popup.conflict.step2')]} />
            )}
          </Banner>
        )}

        {!blocked && config.clients.length === 0 && (
          <Banner tone="warn" icon="info" title={i18n.t('popup.noClients.title')} actions={<Button variant="primary" grow onClick={openOnboarding}>{i18n.t('popup.noClients.start')}</Button>}>
            <BannerBody>{i18n.t('popup.noClients.body')}</BannerBody>
          </Banner>
        )}

        {!blocked && alert === 'on_backup' && !runtime.alertDismissed && primary && backup && (
          <Banner
            tone="warn"
            icon="warn"
            title={i18n.t('popup.offline.title', [primary.name, backup.name])}
            actions={
              <>
                <Button variant="warnOutline" grow onClick={() => void sendMessage('recheck', 'active')}>
                  {i18n.t('popup.offline.recheck', [primary.name])}
                </Button>
                <Button variant="warnGhost" onClick={() => void sendMessage('dismissAlert', undefined)}>
                  {i18n.t('common.gotIt')}
                </Button>
              </>
            }
          >
            <BannerBody>
              {i18n.t('popup.offline.body', [address(primary), offlineReason(runtime.health[primary.id])])}
              {config.settings.autoSwitchBack ? i18n.t('popup.offline.autoBack') : i18n.t('popup.offline.noAutoBack')}
            </BannerBody>
          </Banner>
        )}

        {!blocked && alert === 'can_switch_back' && !runtime.alertDismissed && primary && backup && (
          <Banner
            tone="warn"
            icon="info"
            title={i18n.t('popup.recovered.title', [primary.name])}
            actions={
              <>
                <Button variant="warnOutline" grow onClick={() => void sendMessage('switchBack', undefined)}>
                  {i18n.t('popup.recovered.switchBack', [primary.name])}
                </Button>
                <Button variant="warnGhost" onClick={() => void sendMessage('dismissAlert', undefined)}>
                  {i18n.t('popup.recovered.stay')}
                </Button>
              </>
            }
          >
            <BannerBody>{i18n.t('popup.recovered.body', [backup.name])}</BannerBody>
          </Banner>
        )}

        {!blocked && (alert === 'all_down' || alert === 'all_down_direct') && (
          <Banner
            tone={alert === 'all_down' ? 'error' : 'warn'}
            icon="unplugged"
            title={alert === 'all_down' ? i18n.t('popup.allDown.title') : i18n.t('popup.allDownDirect.title')}
            actions={
              <>
                <Button variant={alert === 'all_down' ? 'danger' : 'warnOutline'} grow onClick={() => void sendMessage('recheck', 'all')}>
                  {i18n.t('common.recheck')}
                </Button>
                <Button variant={alert === 'all_down' ? 'dangerOutline' : 'warnGhost'} onClick={() => openOptions('clients')}>
                  {i18n.t('popup.manageClients')}
                </Button>
              </>
            }
          >
            <BannerBody>{alert === 'all_down' ? i18n.t('popup.allDown.body') : i18n.t('popup.allDownDirect.body')}</BannerBody>
            <Steps
              title={i18n.t('popup.allDown.stepsTitle')}
              items={[i18n.t('popup.allDown.step1', [config.clients.map((c) => c.name).join('、')]), i18n.t('popup.allDown.step2')]}
            />
          </Banner>
        )}

        {!blocked && alert !== 'all_down' && config.clients.length > 0 && <StatusCard view={view} effective={effective} />}

        {!runtime.probeOk && !direct && <div className={s.note}>{i18n.t('popup.probeBroken')}</div>}

        <section className={`${s.section} ${blocked ? s.disabled : ''}`}>
          <div className={s.label}>{i18n.t('popup.mode')}</div>
          <div className={s.segmented} role="radiogroup" aria-label={i18n.t('popup.mode')}>
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={config.settings.mode === m}
                className={config.settings.mode === m ? s.segOn : s.seg}
                disabled={blocked || busy}
                onClick={() => void save(setMode(config, m))}
              >
                {i18n.t(`mode.${m}`)}
              </button>
            ))}
          </div>
          <div className={s.hint}>
            {config.settings.mode === 'smart' && config.settings.exit.kind === 'system' ? i18n.t('mode.smartSystemHint') : i18n.t(`mode.${config.settings.mode}Hint`)}
          </div>
        </section>

        <section className={`${s.section} ${s.exits} ${blocked ? s.disabled : ''}`}>
          <div className={s.label}>{i18n.t('popup.exit')}</div>
          <div className={s.exitList} style={{ opacity: direct ? 0.45 : 1 }}>
            {config.clients.map((c) => (
              <ExitRow
                key={c.id}
                client={c}
                view={view}
                selected={config.settings.exit.kind === 'client' && config.settings.exit.clientId === c.id}
                isBackup={c.id === backup?.id}
                disabled={blocked || busy}
                onPick={() => void save(setExit(config, { kind: 'client', clientId: c.id }))}
              />
            ))}
            <SystemRow selected={config.settings.exit.kind === 'system'} disabled={blocked || busy} onPick={() => void save(setExit(config, { kind: 'system' } as Exit))} />
          </div>
        </section>
      </div>

      <footer className={s.footer}>
        {alert === 'all_down' ? (
          <div className={s.footerRow}>
            <span className={s.grow}>{i18n.t('popup.allDown.tempDirectHint')}</span>
            <Button small onClick={() => void save(setMode(config, 'direct'))}>
              {i18n.t('popup.allDown.tempDirect')}
            </Button>
          </div>
        ) : (
          <>
            <div className={s.footerRow}>
              <span>{i18n.t('popup.rules', [ruleSourceName(view.rules?.sourceUrl)])}</span>
              {runtime.ruleUpdate.status === 'failed' ? (
                <span className={s.warnText}>{ruleErrorText(runtime.ruleUpdate.error)}</span>
              ) : (
                <span>
                  {!view.rules
                    ? ''
                    : view.rules.sourceUrl.startsWith('builtin:')
                      ? i18n.t('options.rules.offlineCopy', [view.rules.fetchedAt.slice(0, 10)])
                      : i18n.t('popup.rulesUpdated', [relativeTime(view.rules.fetchedAt)])}
                </span>
              )}
            </div>
            <div className={s.footerRow}>
              <span>{backup ? i18n.t('popup.backup', [backup.name]) : i18n.t('popup.noBackup')}</span>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openOptions('clients');
                }}
              >
                {i18n.t('popup.manageClients')}
              </a>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

function StatusCard({ view, effective }: { view: ViewState; effective: Client | undefined }) {
  const { config, runtime } = view;
  const direct = config.settings.mode === 'direct';
  const system = config.settings.exit.kind === 'system';
  const h = effective ? healthView(runtime.health[effective.id], runtime.ports[effective.id]) : null;
  const via = effective?.name ?? '';
  const title = direct
    ? i18n.t('popup.status.direct')
    : system
      ? i18n.t('popup.status.system', [i18n.t(`mode.${config.settings.mode}`)])
      : i18n.t('popup.status.via', [i18n.t(`mode.${config.settings.mode}`), via]);
  const dot = direct || system ? 'var(--muted)' : runtime.alert === 'all_down_direct' ? 'var(--warn)' : h?.online ? 'var(--ok)' : h?.offline ? 'var(--err)' : 'var(--muted)';
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <Dot color={dot} />
        <div className={s.cardTitle}>{title}</div>
        <div className={s.mono}>{!direct && !system && h?.online ? h.detail : ''}</div>
      </div>
      <div className={s.ipBox}>
        <div className={s.grow}>
          <div className={s.ipLabel}>{i18n.t('popup.exitIp')}</div>
          <div className={s.ipValue}>{i18n.t('popup.exitIpPending')}</div>
        </div>
      </div>
    </div>
  );
}

function ExitRow({ client, view, selected, isBackup, disabled, onPick }: { client: Client; view: ViewState; selected: boolean; isBackup: boolean; disabled: boolean; onPick: () => void }) {
  const h = healthView(view.runtime.health[client.id], view.runtime.ports[client.id]);
  const inUse = view.runtime.effectiveExit?.kind === 'client' && view.runtime.effectiveExit.clientId === client.id;
  return (
    <button type="button" role="radio" aria-checked={selected} className={selected ? s.rowOn : s.row} disabled={disabled} onClick={onPick}>
      <span className={selected ? s.radioOn : s.radio} />
      <span className={s.rowMain}>
        <span className={s.rowName}>
          {client.name}
          {isBackup && <span className={s.tag}>{i18n.t('popup.tagBackup')}</span>}
          {inUse && !selected && <span className={s.tag}>{i18n.t('popup.tagInUse')}</span>}
        </span>
        <span className={s.rowAddr}>
          {address(client)} · {schemeShort(client.scheme)}
        </span>
      </span>
      <span className={s.rowStatus}>
        <span style={{ color: h.color }}>{h.label}</span>
        <span className={s.rowAddr}>{h.detail}</span>
      </span>
    </button>
  );
}

function SystemRow({ selected, disabled, onPick }: { selected: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={selected ? s.rowOn : s.row} disabled={disabled} onClick={onPick}>
      <span className={selected ? s.radioOn : s.radio} />
      <span className={s.rowMain}>
        <span className={s.rowName}>{i18n.t('popup.systemExit')}</span>
        <span className={s.rowAddrSans}>{i18n.t('popup.systemExitDesc')}</span>
      </span>
    </button>
  );
}
