// 用本机 Chrome 加载已构建的扩展（.output/chrome-mv3）。品牌版 Chrome 137+ 需经 CDP Extensions.loadUnpacked 加载。
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const EXT_DIR = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

async function launchOnce() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnout-e2e-'));
  const context = await chromium.launchPersistentContext(userDir, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR });
  let sw = context.serviceWorkers().find((w) => w.url().includes(id));
  if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().includes(id) });
  return { context, sw, extId: id, url: (p) => `chrome-extension://${id}/${p}` };
}

// 已知偶发问题：紧接着上一个 Chrome 实例关闭后启动时，扩展页里 chrome.i18n 偶尔全部取不到文案（约 1/4，
// 只在 CDP loadUnpacked + 连续启动时观察到，单独运行未复现）。启动后先检查，异常则记录并重启浏览器。
export async function launch({ retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const env = await launchOnce();
    const probe = await env.context.newPage();
    await probe.goto(env.url('options.html'));
    const pageMsg = await probe.evaluate(() => chrome.i18n.getMessage('common_save'));
    await probe.close();
    if (pageMsg || attempt >= retries) {
      if (!pageMsg) console.warn('[e2e] chrome.i18n 仍为空，继续运行');
      return env;
    }
    const swMsg = await env.sw.evaluate(() => chrome.i18n.getMessage('common_save')).catch((e) => `ERR ${e.message}`);
    console.warn(`[e2e] 扩展页 chrome.i18n 为空（后台 SW：${JSON.stringify(swMsg)}），重启浏览器重试 ${attempt + 1}/${retries}`);
    await env.context.close();
  }
}
