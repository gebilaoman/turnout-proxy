import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { defaultConfig, setSiteRule, type Client, type PersistedConfig } from '../config';
import { compileRuleText } from '../rules';
import { explainRoute, findSiteRule } from './explain';
import { EXIT_IP_URL, probeUrl } from './generate';
import { planProxy } from './plan';

const a: Client = { id: 'a', name: 'A', host: '127.0.0.1', port: 7890, scheme: 'mixed', source: 'manual' };
const rules = compileRuleText('||google.com\n@@||ads.google.com\n||例子.cn\n/^https?:\\/\\/[^\\/]+blogspot\\./');

function cfg(mode: PersistedConfig['settings']['mode'] = 'smart'): PersistedConfig {
  let c = defaultConfig();
  c.clients = [a];
  c.settings.exit = { kind: 'client', clientId: 'a' };
  c.settings.mode = mode;
  c = setSiteRule(c, 'bank.com', 'direct');
  c = setSiteRule(c, 'my-proxy.org', 'proxy');
  c = setSiteRule(c, 'cn.google.com', 'direct'); // 比订阅更具体的直连
  c = setSiteRule(c, 'ads.google.com', 'proxy'); // 我的网站优先于订阅例外
  return c;
}

function pacFind(c: PersistedConfig) {
  const r = planProxy({ config: c, runtime: { effectiveExit: null, pacEpoch: 0 }, rules, version: 't' });
  if (!r.ok || r.plan.mode !== 'pac_script') throw new Error('expected pac');
  const ctx = vm.createContext({ isPlainHostName: (h: string) => !h.includes('.') });
  vm.runInContext(r.plan.data, ctx);
  return (url: string) => {
    const u = new URL(url);
    // Chrome 对 https 只把 scheme://host/ 交给 PAC
    const pacUrl = u.protocol === 'https:' ? `${u.protocol}//${u.host}/` : url;
    return (ctx.FindProxyForURL as (u: string, h: string) => string)(pacUrl, u.hostname);
  };
}

const URLS = [
  'https://www.google.com/search?q=1',
  'https://ads.google.com/',
  'https://news.cn.google.com/',
  'https://www.bank.com/login',
  'https://api.my-proxy.org/',
  'https://www.例子.cn/',
  'http://x.blogspot.com/post',
  'https://www.baidu.com/',
  'http://localhost:3000/',
  'http://intranet/',
];

describe('explainRoute 与 PAC 一致', () => {
  for (const mode of ['smart', 'all'] as const) {
    it(`${mode}`, () => {
      const c = cfg(mode);
      const find = pacFind(c);
      for (const u of URLS) {
        const e = explainRoute(u, c, rules);
        const pac = find(u);
        expect(pac === 'DIRECT' ? 'direct' : 'proxy', `${mode} ${u}`).toBe(e.route);
      }
    });
  }
});

describe('explainRoute 原因', () => {
  it.each([
    ['https://www.bank.com/', { route: 'direct', reason: 'site', matched: 'bank.com' }],
    ['https://api.my-proxy.org/', { route: 'proxy', reason: 'site', matched: 'my-proxy.org' }],
    ['https://news.cn.google.com/', { route: 'direct', reason: 'site', matched: 'cn.google.com' }],
    ['https://ads.google.com/', { route: 'proxy', reason: 'site', matched: 'ads.google.com' }],
    ['https://www.google.com/', { route: 'proxy', reason: 'sub_match', matched: 'google.com' }],
    ['http://x.blogspot.com/', { route: 'proxy', reason: 'sub_match' }],
    ['https://www.baidu.com/', { route: 'direct', reason: 'default' }],
    ['http://localhost/', { route: 'direct', reason: 'local' }],
    ['not a url', { route: 'direct', reason: 'default' }],
  ])('%s', (u, expected) => expect(explainRoute(u, cfg(), rules)).toEqual(expected));

  it('订阅例外', () => {
    const c = cfg();
    c.siteRules = [];
    expect(explainRoute('https://ads.google.com/', c, rules)).toEqual({ route: 'direct', reason: 'sub_except', matched: 'ads.google.com' });
  });

  it('没有规则缓存时未命中我的网站即直连', () => expect(explainRoute('https://www.google.com/', cfg(), null)).toEqual({ route: 'direct', reason: 'default' }));

  it('全部代理：只有直连条目生效', () => {
    expect(explainRoute('https://www.bank.com/', cfg('all'), rules)).toEqual({ route: 'direct', reason: 'site', matched: 'bank.com' });
    expect(explainRoute('https://www.baidu.com/', cfg('all'), rules)).toEqual({ route: 'proxy', reason: 'all' });
  });

  it('直连模式、跟随系统', () => {
    expect(explainRoute('https://www.google.com/', cfg('direct'), rules)).toEqual({ route: 'direct', reason: 'mode_direct' });
    const sys = cfg();
    sys.settings.exit = { kind: 'system' };
    expect(explainRoute('https://www.google.com/', sys, rules)).toEqual({ route: 'system', reason: 'exit_system' });
  });
});

describe('PAC 中的出口 IP 分支', () => {
  it('查询出口 IP 的请求始终走当前出口，即使被我的网站设为直连', () => {
    const c = setSiteRule(cfg(), 'one.one.one.one', 'direct');
    for (const mode of ['smart', 'all'] as const) {
      c.settings.mode = mode;
      expect(pacFind(c)(EXIT_IP_URL)).toBe('PROXY 127.0.0.1:7890');
    }
  });
  it('探测仍然优先', () => expect(pacFind(cfg())(probeUrl('h7890'))).toBe('PROXY 127.0.0.1:7890'));
});

describe('findSiteRule', () => {
  it('最具体的条目生效', () => {
    const list = [
      { domain: 'google.com', action: 'proxy' as const },
      { domain: 'cn.google.com', action: 'direct' as const },
    ];
    expect(findSiteRule('a.cn.google.com', list)).toEqual({ domain: 'cn.google.com', action: 'direct' });
    expect(findSiteRule('www.google.com', list)).toEqual({ domain: 'google.com', action: 'proxy' });
    expect(findSiteRule('google.com.evil.net', list)).toBeNull();
  });
});
