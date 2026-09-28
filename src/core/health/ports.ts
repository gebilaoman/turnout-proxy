import type { ProxyScheme } from '../config';

// 自动发现的候选端口（ARCHITECTURE §5）。hint 只用于给发现结果起默认名字和猜测协议。
export interface PortCandidate {
  port: number;
  hint: string;
  scheme: ProxyScheme;
}

export const CANDIDATE_PORTS: readonly PortCandidate[] = [
  { port: 7890, hint: 'FlClash / Clash', scheme: 'mixed' },
  { port: 7891, hint: 'Clash SOCKS', scheme: 'socks5' },
  { port: 7892, hint: '万达云', scheme: 'mixed' },
  { port: 7897, hint: 'Clash Verge', scheme: 'mixed' },
  { port: 7898, hint: 'Clash Verge SOCKS', scheme: 'socks5' },
  { port: 10808, hint: 'v2rayN SOCKS', scheme: 'socks5' },
  { port: 10809, hint: 'v2rayN HTTP', scheme: 'http' },
  { port: 1080, hint: 'SOCKS', scheme: 'socks5' },
  { port: 1086, hint: 'ShadowsocksX-NG SOCKS', scheme: 'socks5' },
  { port: 1087, hint: 'ShadowsocksX-NG HTTP', scheme: 'http' },
  { port: 8888, hint: 'HTTP', scheme: 'http' },
  { port: 20171, hint: 'v2rayA SOCKS', scheme: 'socks5' },
  { port: 20172, hint: 'v2rayA HTTP', scheme: 'http' },
];
