import { browser, defineBackground } from '#imports';
import { HEALTH_ALARM, RULES_ALARM } from '@/platform/alarms';
import { onMessage } from '@/platform/messages';
import {
  dismissAlert,
  explain,
  finishOnboarding,
  getView,
  importConfig,
  onProxyErrorRecheck,
  reconcile,
  refreshIfOfflineCopy,
  refreshExitIp,
  refreshRules,
  restoreBackup,
  runHealth,
  saveConfig,
  saveConfigWithBackup,
  scan,
  serial,
  switchBack,
} from './controller';
import { readBackups } from '@/platform/storage';

export default defineBackground(() => {
  // 所有监听器在此同步注册（CLAUDE.md：不得在异步初始化之后再注册）
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void serial(async () => {
      await reconcile();
      if (reason === 'install') await browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
    });
  });
  browser.runtime.onStartup.addListener(() => {
    void serial(() => reconcile())
      .then(() => runHealth('active'))
      .then(() => serial(() => refreshIfOfflineCopy()));
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM) void runHealth('active');
    if (alarm.name === RULES_ALARM) void serial(() => refreshRules(false));
  });
  browser.proxy.onProxyError.addListener(() => {
    void onProxyErrorRecheck();
  });
  browser.proxy.settings.onChange.addListener(() => {
    void serial(() => reconcile());
  });

  onMessage('getView', () => getView());
  onMessage('explain', ({ data }) => explain(data));
  onMessage('saveConfig', ({ data }) => serial(() => saveConfig(data)));
  onMessage('saveConfigWithBackup', ({ data }) => serial(() => saveConfigWithBackup(data)));
  onMessage('refreshExitIp', () => refreshExitIp());
  onMessage('switchBack', () => serial(() => switchBack()));
  onMessage('dismissAlert', () => serial(() => dismissAlert()));
  onMessage('recheck', ({ data }) => runHealth(data));
  onMessage('scan', () => scan());
  onMessage('updateRules', ({ data }) => serial(() => refreshRules(data)));
  onMessage('importConfig', ({ data }) => serial(() => importConfig(data)));
  onMessage('listBackups', () => readBackups());
  onMessage('restoreBackup', ({ data }) => serial(() => restoreBackup(data)));
  onMessage('finishOnboarding', ({ data }) => serial(() => finishOnboarding(data)));
});
