// 界面显示用的格式化：把状态翻译成文案与颜色。文案来自 i18n，不在这里硬编码。
import { i18n } from '#i18n';
import type { Client, ClientHealth, PortState, ProxyScheme } from '@/core/config';

export function schemeLabel(s: ProxyScheme): string {
  return s === 'mixed' ? i18n.t('scheme.mixed') : s === 'http' ? i18n.t('scheme.http') : i18n.t('scheme.socks5');
}

export function schemeShort(s: ProxyScheme): string {
  return s === 'mixed' ? i18n.t('scheme.mixedShort') : s === 'http' ? i18n.t('scheme.http') : i18n.t('scheme.socks5');
}

export function address(c: Pick<Client, 'host' | 'port'>): string {
  return `${c.host}:${c.port}`;
}

export interface HealthView {
  label: string; // 在线 / 离线 / 端口在听 …
  detail: string; // 延迟或原因
  color: string;
  online: boolean;
  offline: boolean;
}

export function healthView(h: ClientHealth | undefined, port: PortState | undefined): HealthView {
  if (h?.status === 'online') return { label: i18n.t('health.online'), detail: `${h.latencyMs} ms`, color: 'var(--ok)', online: true, offline: false };
  if (h?.status === 'offline') {
    const detail = h.reason === 'refused' ? i18n.t('health.refused') : h.reason === 'timeout' ? i18n.t('health.timeout') : i18n.t('health.proxyError');
    return { label: i18n.t('health.offline'), detail, color: 'var(--err)', online: false, offline: true };
  }
  if (port === 'http') return { label: i18n.t('health.listening'), detail: i18n.t('health.notMeasured'), color: 'var(--text-2)', online: false, offline: false };
  if (port === 'maybe_socks') return { label: i18n.t('health.pending'), detail: i18n.t('health.notMeasured'), color: 'var(--text-2)', online: false, offline: false };
  return { label: i18n.t('health.unknown'), detail: '', color: 'var(--text-2)', online: false, offline: false };
}

export function offlineReason(h: ClientHealth | undefined): string {
  if (h?.status !== 'offline') return '';
  return h.reason === 'refused' ? i18n.t('health.refusedLong') : h.reason === 'timeout' ? i18n.t('health.timeoutLong') : i18n.t('health.proxyErrorLong');
}

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return i18n.t('time.justNow');
  if (min < 60) return i18n.t('time.minutesAgo', [String(min)]);
  const hours = Math.floor(min / 60);
  if (hours < 48) return i18n.t('time.hoursAgo', [String(hours)]);
  return i18n.t('time.daysAgo', [String(Math.floor(hours / 24))]);
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ruleSourceName(sourceUrl: string | undefined): string {
  if (!sourceUrl) return i18n.t('rules.none');
  if (sourceUrl.startsWith('builtin:')) return i18n.t('rules.builtinName');
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return sourceUrl;
  }
}

export function ruleErrorText(code: string | undefined): string {
  if (!code) return '';
  if (code.startsWith('http_status:')) return i18n.t('rules.err.httpStatus', [code.slice('http_status:'.length)]);
  switch (code) {
    case 'no_permission':
      return i18n.t('rules.err.noPermission');
    case 'timeout':
      return i18n.t('rules.err.timeout');
    case 'network':
      return i18n.t('rules.err.network');
    case 'too_large':
      return i18n.t('rules.err.tooLarge');
    case 'decode_failed':
      return i18n.t('rules.err.decodeFailed');
    case 'not_autoproxy':
      return i18n.t('rules.err.notAutoproxy');
    case 'no_rules':
      return i18n.t('rules.err.noRules');
    default:
      return code;
  }
}

export function newClientId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
