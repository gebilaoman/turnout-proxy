// 界面侧的数据订阅与命令：从后台取视图状态，storage 变化时自动刷新。
import { browser } from '#imports';
import { i18n } from '#i18n';
import { sendMessage, type ViewState } from './messages';
import { hasOriginPermission, originPattern } from './rules';
import { configItem, onboardedItem, ruleCacheItem, runtimeItem } from './storage';

export function subscribeView(cb: (v: ViewState) => void): () => void {
  let alive = true;
  let pending = false;
  const refresh = () => {
    if (pending) return;
    pending = true;
    // 合并同一轮内的多次 storage 变化
    queueMicrotask(() => {
      pending = false;
      sendMessage('getView', undefined)
        .then((v) => alive && cb(v))
        .catch((e: unknown) => console.warn('[turnout] getView failed', e));
    });
  };
  refresh();
  const unwatch = [configItem, runtimeItem, ruleCacheItem, onboardedItem].map((item) => item.watch(refresh));
  return () => {
    alive = false;
    unwatch.forEach((u) => u());
  };
}

// 自定义订阅地址按域名运行时申请权限（ARCHITECTURE §8）；必须在用户点击的处理函数里调用
export async function requestOriginPermission(url: string): Promise<boolean> {
  return browser.permissions.request({ origins: [originPattern(url)] });
}

export function openOptions(section?: string): void {
  const url = browser.runtime.getURL('/options.html');
  void browser.tabs.create({ url: section ? `${url}#${section}` : url });
}

export function openOnboarding(): void {
  void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
}

export function openExtensionsPage(): void {
  void browser.tabs.create({ url: 'chrome://extensions' });
}

// 当前标签页网址。依赖 activeTab：只有用户点开弹窗时才能读到
export async function getActiveTabUrl(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
}

export function extensionVersion(): string {
  return browser.runtime.getManifest().version;
}

// 偶发：扩展刚安装后打开的页面里 chrome.i18n 取不到文案（全部为空）。检测到时重载一次页面。
export function ensureI18nLoaded(): boolean {
  if (i18n.t('extDescription')) return true;
  const KEY = 'turnout-i18n-reload';
  try {
    if (sessionStorage.getItem(KEY)) return true; // 已重载过一次，不再循环
    sessionStorage.setItem(KEY, '1');
  } catch {
    return true;
  }
  location.reload();
  return false;
}

export { hasOriginPermission, sendMessage };
