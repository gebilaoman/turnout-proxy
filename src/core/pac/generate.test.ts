import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { defaultConfig, type Client, type PersistedConfig } from '../config';
import { compileRuleText } from '../rules';
import { CANARY_PROXY, fnv1a, generatePac, probeKey, probeUrl, proxyToken, type PacInput } from './generate';
import { planProxy, probeTable, routeFor } from './plan';

const flclash: Client = { id: 'c1', name: 'FlClash', host: '127.0.0.1', port: 7890, scheme: 'mixed', source: 'discovered' };
const wanda: Client = { id: 'c2', name: '万达云', host: '127.0.0.1', port: 7892, scheme: 'mixed', source: 'discovered' };
const v2: Client = { id: 'c3', name: 'v2rayN', host: '127.0.0.1', port: 10808, scheme: 'socks5', source: 'manual' };

const rules = compileRuleText('||google.com\n@@||ads.google.com\n||例子.cn\n/^https?:\\/\\/[^\\/]+blogspot\\./\n||constructor.io');

// 在 Node 里执行 PAC：只提供 PAC 标准函数中本 PAC 用到的 isPlainHostName
function run(pac: string) {
  const ctx = vm.createContext({ isPlainHostName: (h: string) => !h.includes('.') });
  vm.runInContext(pac, ctx);
  return (url: string) => (ctx.FindProxyForURL as (u: string, h: string) => string)(url, new URL(url).hostname);
}

const base = (routing: PacInput['routing']): PacInput => ({ routing, probes: probeTable([flclash, v2]), epoch: 0, version: '1.0.0' });
const ROUTE = ['PROXY 127.0.0.1:7890', 'PROXY 127.0.0.1:7892'];

describe('proxyToken / probeKey', () => {
  it('mixed 与 http 用 PROXY，socks5 用 SOCKS5', () => {
    expect(proxyToken(flclash)).toBe('PROXY 127.0.0.1:7890');
    expect(proxyToken({ ...flclash, scheme: 'http' })).toBe('PROXY 127.0.0.1:7890');
    expect(proxyToken(v2)).toBe('SOCKS5 127.0.0.1:10808');
    expect(proxyToken({ ...v2, host: '::1' })).toBe('SOCKS5 [::1]:10808');
    expect(proxyToken({ ...v2, host: '[::1]' })).toBe('SOCKS5 [::1]:10808');
    expect(probeKey(7890, 'mixed')).toBe('h7890');
    expect(probeKey(10808, 'socks5')).toBe('s10808');
    expect(probeUrl('h7890')).toBe('http://connectivitycheck.gstatic.com/generate_204?turnout_probe=h7890');
    expect(probeUrl('h7890', 'x1')).toBe('http://connectivitycheck.gstatic.com/generate_204?turnout_probe=h7890&n=x1');
  });
});

describe('generatePac · 智能分流', () => {
  const pac = generatePac(base({ kind: 'smart', route: ROUTE, rules }));
  const find = run(pac);

  it('只含 ASCII 可打印字符与换行', () => expect([...pac].every((c) => c === '\n' || (c >= ' ' && c <= '~'))).toBe(true));
  it('命中规则（含子域名）走代理列表，不追加 DIRECT', () => {
    expect(find('https://www.google.com/')).toBe('PROXY 127.0.0.1:7890; PROXY 127.0.0.1:7892');
    expect(find('https://a.b.GOOGLE.com/')).toBe('PROXY 127.0.0.1:7890; PROXY 127.0.0.1:7892');
  });
  it('例外优先', () => expect(find('https://ads.google.com/')).toBe('DIRECT'));
  it('国际化域名以 punycode 匹配', () => expect(find('https://www.例子.cn/')).toBe(ROUTE.join('; ')));
  it('正则规则', () => expect(find('http://x.blogspot.com/a')).toBe(ROUTE.join('; ')));
  it('未命中直连', () => {
    expect(find('https://www.baidu.com/')).toBe('DIRECT');
    expect(find('https://google.com.evil.net/')).toBe('DIRECT');
  });
  it('原型链上的键不会误命中', () => {
    expect(find('https://constructor/')).toBe('DIRECT');
    expect(find('https://a.hasownproperty/')).toBe('DIRECT');
    expect(find('https://constructor.io/')).toBe(ROUTE.join('; '));
  });
  it('本机地址直连', () => {
    for (const u of ['http://127.0.0.1:8080/', 'http://localhost/', 'http://intranet/', 'http://[::1]/']) expect(find(u)).toBe('DIRECT');
  });
  it('探测分支在规则之前，且只返回单一代理', () => {
    expect(find(probeUrl('h7890'))).toBe('PROXY 127.0.0.1:7890');
    expect(find(probeUrl('s10808', '3'))).toBe('SOCKS5 127.0.0.1:10808');
    expect(find(probeUrl('canary'))).toBe(CANARY_PROXY);
  });
  it('未登记的探测键、或其他域名带探测参数，都按普通规则处理', () => {
    expect(find(probeUrl('h1234'))).toBe('DIRECT');
    expect(find('https://www.google.com/?turnout_probe=h7890')).toBe(ROUTE.join('; '));
  });
});

describe('generatePac · 全部代理', () => {
  const find = run(generatePac(base({ kind: 'all', route: [...ROUTE, 'DIRECT'] })));
  it('所有请求走代理列表（用户开启时才带 DIRECT）', () => {
    expect(find('https://www.baidu.com/')).toBe('PROXY 127.0.0.1:7890; PROXY 127.0.0.1:7892; DIRECT');
  });
  it('本机仍直连，探测仍生效', () => {
    expect(find('http://localhost:3000/')).toBe('DIRECT');
    expect(find(probeUrl('h7890'))).toBe('PROXY 127.0.0.1:7890');
  });
});

describe('generatePac · 稳定性', () => {
  it('相同输入字节级相同；epoch 变化只改首行', () => {
    const a = generatePac(base({ kind: 'smart', route: ROUTE, rules }));
    expect(generatePac(base({ kind: 'smart', route: ROUTE, rules }))).toBe(a);
    const b = generatePac({ ...base({ kind: 'smart', route: ROUTE, rules }), epoch: 1 });
    expect(b).not.toBe(a);
    expect(b.split('\n').slice(1)).toEqual(a.split('\n').slice(1));
    expect(b.split('\n')[0]).toMatch(/^\/\/ Turnout 1\.0\.0 [0-9a-f]{8} epoch=1$/);
  });
  it('探测表键的顺序不影响输出', () => {
    const p1 = generatePac({ ...base({ kind: 'all', route: ROUTE }), probes: { b: 'PROXY x:1', a: 'PROXY x:2' } });
    const p2 = generatePac({ ...base({ kind: 'all', route: ROUTE }), probes: { a: 'PROXY x:2', b: 'PROXY x:1' } });
    expect(p1).toBe(p2);
  });
  it('extraMatch 临时加入订阅域名', () => {
    const find = run(generatePac(base({ kind: 'smart', route: ROUTE, rules, extraMatch: ['raw.githubusercontent.com'] })));
    expect(find('https://raw.githubusercontent.com/gfwlist/x')).toBe(ROUTE.join('; '));
  });
  it('空规则表与空正则也能生成可执行 PAC', () => {
    const find = run(generatePac(base({ kind: 'smart', route: ROUTE, rules: compileRuleText('') })));
    expect(find('https://a.com/')).toBe('DIRECT');
  });
  it('fnv1a', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });
  it('快照', () => {
    expect(generatePac(base({ kind: 'smart', route: ROUTE, rules }))).toMatchSnapshot();
  });
});

function cfg(patch: (c: PersistedConfig) => void): PersistedConfig {
  const c = defaultConfig();
  c.clients = [flclash, wanda, v2];
  c.settings.exit = { kind: 'client', clientId: 'c1' };
  c.settings.backupClientId = 'c2';
  patch(c);
  return c;
}

describe('routeFor', () => {
  it('实际出口在前、另一出口在后', () => {
    expect(routeFor(cfg(() => {}), 'c1')).toEqual(ROUTE);
    expect(routeFor(cfg(() => {}), 'c2')).toEqual(['PROXY 127.0.0.1:7892', 'PROXY 127.0.0.1:7890']);
  });
  it('没有备用时只有主', () => expect(routeFor(cfg((c) => (c.settings.backupClientId = null)), 'c1')).toEqual(['PROXY 127.0.0.1:7890']));
  it('只有开启「全部离线时直连」才追加 DIRECT', () => {
    expect(routeFor(cfg((c) => (c.settings.allowDirectWhenAllDown = true)), 'c1')).toEqual([...ROUTE, 'DIRECT']);
  });
  it('指向已删除客户端的 id 被忽略', () => expect(routeFor(cfg(() => {}), 'ghost')).toEqual(ROUTE));
});

describe('planProxy', () => {
  const rt = { effectiveExit: null, pacEpoch: 0 };
  it('直连模式', () => expect(planProxy({ config: cfg((c) => (c.settings.mode = 'direct')), runtime: rt, rules, version: '1' })).toEqual({ ok: true, plan: { mode: 'direct' } }));
  it('出口跟随系统', () =>
    expect(planProxy({ config: cfg((c) => (c.settings.exit = { kind: 'system' })), runtime: rt, rules, version: '1' })).toEqual({ ok: true, plan: { mode: 'system' } }));
  it('出口客户端不存在', () =>
    expect(planProxy({ config: cfg((c) => (c.settings.exit = { kind: 'client', clientId: 'ghost' })), runtime: rt, rules, version: '1' })).toEqual({ ok: false, error: { code: 'exit_missing' } }));
  it('智能分流缺规则', () => expect(planProxy({ config: cfg(() => {}), runtime: rt, rules: null, version: '1' })).toEqual({ ok: false, error: { code: 'no_rules' } }));
  it('全部代理不需要规则；按实际出口排序；带 epoch', () => {
    const r = planProxy({ config: cfg((c) => (c.settings.mode = 'all')), runtime: { effectiveExit: { kind: 'client', clientId: 'c2' }, pacEpoch: 7 }, rules: null, version: '1' });
    if (!r.ok || r.plan.mode !== 'pac_script') throw new Error('expected pac');
    expect(r.plan.data).toContain('epoch=7');
    expect(run(r.plan.data)('https://a.com/')).toBe('PROXY 127.0.0.1:7892; PROXY 127.0.0.1:7890');
  });
  it('智能分流 + extraMatch', () => {
    const r = planProxy({ config: cfg(() => {}), runtime: rt, rules, version: '1', extraMatch: ['sub.example.org'] });
    if (!r.ok || r.plan.mode !== 'pac_script') throw new Error('expected pac');
    expect(run(r.plan.data)('https://sub.example.org/list')).toBe(ROUTE.join('; '));
  });
  it('探测表覆盖所有客户端，同端口只登记一次', () => {
    expect(probeTable([flclash, { ...flclash, id: 'dup', host: '192.168.1.2' }, v2])).toEqual({ h7890: 'PROXY 127.0.0.1:7890', s10808: 'SOCKS5 127.0.0.1:10808' });
  });
});
