// 出口 IP：解析 Cloudflare trace（https://one.one.one.one/cdn-cgi/trace）的返回内容。
// 格式为每行一个 key=value，其中 ip= 是出口 IP，loc= 是 ISO 3166-1 国家代码。

export interface ExitIpInfo {
  ip: string;
  country?: string; // 两位国家代码，如 JP；界面按语言显示国家名
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function parseTrace(text: string): ExitIpInfo | null {
  const kv = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const ip = kv.get('ip');
  if (!ip || !(IPV4.test(ip) || (ip.includes(':') && IPV6.test(ip)))) return null;
  const loc = kv.get('loc');
  return loc && /^[A-Z]{2}$/.test(loc) && loc !== 'XX' ? { ip, country: loc } : { ip };
}
