// 用本机 Chrome 加载已构建的扩展（.output/chrome-mv3）。品牌版 Chrome 137+ 需经 CDP Extensions.loadUnpacked 加载。
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const EXT_DIR = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

export async function launch() {
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
