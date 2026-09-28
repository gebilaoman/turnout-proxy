globalThis.timedFetch = async (url, opts = {}, timeoutMs = 5000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal, ...opts });
    return { ok: true, status: r.status, type: r.type, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, error: String(e), name: e.name, ms: Math.round(performance.now() - t0) };
  } finally { clearTimeout(timer); }
};
