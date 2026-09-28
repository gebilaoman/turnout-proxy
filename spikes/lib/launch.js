// 用本机 Google Chrome 稳定版加载未打包扩展。
// 品牌版 Chrome 137+ 已移除 --load-extension，改用 CDP Extensions.loadUnpacked（需 pipe + --enable-unsafe-extension-debugging）。
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// clean: 不用 Playwright 默认参数（其默认带 --disable-field-trial-config 等，会关掉 Finch 实验）
// seed: 复制本机真实 Chrome 的 Finch 种子，尽量还原用户实际拿到的实验配置
// labs: 等同在 chrome://flags 里选择的项，如 'local-network-access-check@2'
export async function launch({ manifestPatch = {}, args = [], headless = false, clean = false, seed = false, labs = [] } = {}) {
  const extSrc = path.resolve(import.meta.dirname, '../ext');
  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnout-ext-'));
  for (const f of fs.readdirSync(extSrc)) fs.copyFileSync(path.join(extSrc, f), path.join(extDir, f));
  const manifest = {
    manifest_version: 3, name: 'Turnout Spike', version: '0.0.1',
    permissions: ['proxy', 'storage', 'alarms'],
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
    background: { service_worker: 'sw.js' },
    ...manifestPatch,
  };
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnout-prof-'));
  const localState = { browser: { enabled_labs_experiments: labs } };
  if (seed) {
    const real = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
    const ls = JSON.parse(fs.readFileSync(path.join(real, 'Local State'), 'utf8'));
    for (const k of Object.keys(ls)) if (k.startsWith('variations')) localState[k] = ls[k];
    for (const f of ['VariationsSeedV2', 'VariationsSafeSeedV2', 'Variations']) if (fs.existsSync(path.join(real, f))) fs.copyFileSync(path.join(real, f), path.join(userDir, f));
  }
  fs.writeFileSync(path.join(userDir, 'Local State'), JSON.stringify(localState));
  const context = await chromium.launchPersistentContext(userDir, {
    executablePath: CHROME, headless,
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', ...(clean ? [`--user-data-dir=${userDir}`, '--remote-debugging-pipe', '--use-mock-keychain', '--password-store=basic'] : []), ...args],
    ignoreDefaultArgs: clean ? true : ['--disable-extensions'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extDir });
  let sw = context.serviceWorkers().find((w) => w.url().includes(id));
  if (!sw) sw = await context.waitForEvent('serviceworker', { predicate: (w) => w.url().includes(id) });
  const version = context.browser().version();
  return { context, cdp, sw, extId: id, version };
}
