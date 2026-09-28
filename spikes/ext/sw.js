// M0 spike 扩展的后台。监听器全部在顶层同步注册。
const bootAt = Date.now();
async function log(kind, data) {
  const { log = [] } = await chrome.storage.local.get('log');
  log.push({ t: Date.now(), kind, ...data });
  await chrome.storage.local.set({ log });
}
chrome.proxy.onProxyError.addListener((d) => { log('proxyError', { bootAt, detail: d }); });
chrome.proxy.settings.onChange.addListener((d) => { log('settingsChange', { bootAt, levelOfControl: d.levelOfControl }); });
chrome.alarms.onAlarm.addListener((a) => { log('alarm', { bootAt, name: a.name }); });
log('boot', { bootAt });

// 供测试脚本通过 worker.evaluate 调用
globalThis.spike = {
  bootAt,
  setPac: (data) => chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data } }, scope: 'regular' }),
  setDirect: () => chrome.proxy.settings.set({ value: { mode: 'direct' }, scope: 'regular' }),
  getSettings: () => chrome.proxy.settings.get({}),
  async timedFetch(url, opts = {}, timeoutMs = 5000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal, ...opts });
      return { ok: true, status: r.status, type: r.type, via: r.headers.get('x-spike-via'), ms: Math.round(performance.now() - t0) };
    } catch (e) {
      return { ok: false, error: String(e), name: e.name, ms: Math.round(performance.now() - t0) };
    } finally { clearTimeout(timer); }
  },
};
