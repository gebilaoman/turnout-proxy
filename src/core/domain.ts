// 域名工具（规则订阅与「我的网站」共用）。

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// 规范化域名：小写、国际化域名转 punycode（Chrome 传给 PAC 的 host 是 punycode）、去掉末尾点。
// 不合法返回 null。
export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!d || d.includes('*')) return null;
  if (/[^\x21-\x7e]/.test(d)) {
    try {
      d = new URL(`http://${d}/`).hostname;
    } catch {
      return null;
    }
  }
  if (d.length > 253) return null;
  const labels = d.split('.');
  if (labels.length < 2) return null;
  return labels.every((l) => LABEL_RE.test(l)) ? d : null;
}

// 从用户输入（域名、带协议的网址、*.example.com、*example.com、.example.com）里取出规范化域名；取不出返回 null
export function domainFromInput(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    try {
      t = new URL(t).hostname;
    } catch {
      return null;
    }
  } else {
    t = t.split(/[/?#]/, 1)[0] ?? '';
    t = t.replace(/:\d+$/, '');
  }
  // 开头的通配（*.x.com、*x.com、.x.com）一律按 x.com 及其子域名处理；不做真正的通配匹配
  t = t.replace(/^\*+/, '').replace(/^\./, '');
  return normalizeDomain(t);
}

// 当前网站可选的添加粒度：从完整主机名逐级去掉最左一段，至少保留两段；默认去掉 www.
export function domainCandidates(host: string): string[] {
  const h = normalizeDomain(host);
  if (!h) return [];
  const labels = h.split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  if (out.length > 1 && out[0]?.startsWith('www.')) out.push(out.shift() as string);
  return out;
}

// 输入是否带开头通配（界面据此提示「已按 x.com 及其子域名添加」）
export function hasLeadingWildcard(raw: string): boolean {
  return /^\s*\*/.test(raw);
}
