import { describe, expect, it } from 'vitest';
import { addClient, defaultConfig, validateConfig } from '../config';
import { applyZeroOmega, parseZeroOmega, type ZeroOmegaOptions } from './zeroomega';

// docs/zeroomega-import.md §6 的样例
const SAMPLE = {
  schemaVersion: 2,
  '-startupProfileName': 'auto',
  '-downloadInterval': 1440,
  '+clash': {
    name: 'clash',
    profileType: 'FixedProfile',
    color: '#99ccee',
    revision: '18f2a1b3c4d',
    fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7890 },
    bypassList: [{ conditionType: 'BypassCondition', pattern: '127.0.0.1' }],
  },
  '+v2ray': { name: 'v2ray', profileType: 'FixedProfile', color: '#ffaa88', fallbackProxy: { scheme: 'socks5', host: '127.0.0.1', port: 10808 }, bypassList: [] },
  '+auto': {
    name: 'auto',
    profileType: 'SwitchProfile',
    color: '#99dd99',
    defaultProfileName: '__ruleListOf_auto',
    rules: [{ condition: { conditionType: 'HostWildcardCondition', pattern: '*.corp.com' }, profileName: 'direct' }],
  },
  '+__ruleListOf_auto': {
    name: '__ruleListOf_auto',
    profileType: 'RuleListProfile',
    format: 'AutoProxy',
    sourceUrl: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt',
    matchProfileName: 'clash',
    defaultProfileName: 'direct',
    ruleList: '',
  },
};
const opts: ZeroOmegaOptions = { existing: [], mixedPorts: [7890] };
const parse = (o: unknown, o2: ZeroOmegaOptions = opts) => parseZeroOmega(JSON.stringify(o), o2);

describe('parseZeroOmega', () => {
  it('文档样例：两个客户端、GFWList 订阅、智能分流、默认出口 clash、1 条条件未导入', () => {
    expect(parse(SAMPLE)).toEqual({
      ok: true,
      value: {
        clients: [
          { name: 'clash', host: '127.0.0.1', port: 7890, scheme: 'mixed', authDropped: false },
          { name: 'v2ray', host: '127.0.0.1', port: 10808, scheme: 'socks5', authDropped: false },
        ],
        ruleSourceUrl: 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt',
        mode: 'smart',
        exitName: 'clash',
        skipped: [{ name: 'auto', reason: 'conditions', count: 1 }],
      },
    });
  });

  it('未发现混合端口时保持 http', () => {
    const r = parse(SAMPLE, { existing: [], mixedPorts: [] });
    expect(r.ok && r.value.clients[0]?.scheme).toBe('http');
  });

  it('base64 编码的备份', () => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(SAMPLE))));
    const r = parseZeroOmega(b64, opts);
    expect(r.ok && r.value.clients.length).toBe(2);
  });

  it.each(['', 'not json', '[]', '"x"', '%%%'])('无效文件 %j', (t) => expect(parseZeroOmega(t, opts)).toEqual({ ok: false, error: { code: 'invalid_file' } }));
  it('不支持的 schemaVersion', () => expect(parse({ ...SAMPLE, schemaVersion: 3 })).toEqual({ ok: false, error: { code: 'unsupported_version', version: 3 } }));
  it('没有 schemaVersion 的旧文件也可以', () => {
    const { schemaVersion: _v, ...old } = SAMPLE;
    expect(parse(old).ok).toBe(true);
  });

  it('代理字段优先级：fallbackProxy > proxyForHttps > proxyForHttp', () => {
    const r = parse({
      schemaVersion: 2,
      '+a': { name: 'a', profileType: 'FixedProfile', proxyForHttp: { scheme: 'http', host: '10.0.0.1', port: 1 }, proxyForHttps: { scheme: 'http', host: '10.0.0.2', port: 2 } },
    });
    expect(r.ok && r.value.clients[0]).toMatchObject({ host: '10.0.0.2', port: 2 });
  });

  it('跳过：https / socks4、无代理字段、重复地址；带认证的导入地址并标记', () => {
    const r = parse(
      {
        schemaVersion: 2,
        '+h': { name: 'h', profileType: 'FixedProfile', fallbackProxy: { scheme: 'https', host: 'p.example', port: 443 } },
        '+s4': { name: 's4', profileType: 'FixedProfile', fallbackProxy: { scheme: 'socks4', host: '127.0.0.1', port: 1080 } },
        '+none': { name: 'none', profileType: 'FixedProfile' },
        '+badport': { name: 'badport', profileType: 'FixedProfile', fallbackProxy: { scheme: 'http', host: 'x', port: 70000 } },
        '+dupExisting': { name: 'dupExisting', profileType: 'FixedProfile', fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: 7892 } },
        '+auth': { name: 'auth', profileType: 'FixedProfile', fallbackProxy: { scheme: 'socks5', host: '127.0.0.1', port: 1086 }, auth: { fallbackProxy: { username: 'u', password: 'p' } } },
        '+dup': { name: 'dup', profileType: 'FixedProfile', fallbackProxy: { scheme: 'socks5', host: '127.0.0.1', port: 1086 } },
        '+noscheme': { name: 'noscheme', profileType: 'FixedProfile', fallbackProxy: { host: '::1', port: 8888 } },
      },
      { existing: [{ host: '127.0.0.1', port: 7892 }], mixedPorts: [] },
    );
    if (!r.ok) throw new Error('parse failed');
    expect(r.value.clients).toEqual([
      { name: 'auth', host: '127.0.0.1', port: 1086, scheme: 'socks5', authDropped: true },
      { name: 'noscheme', host: '[::1]', port: 8888, scheme: 'http', authDropped: false },
    ]);
    expect(r.value.skipped.map((s) => `${s.name}:${s.reason}`)).toEqual([
      'h:unsupported_scheme',
      's4:unsupported_scheme',
      'none:no_proxy',
      'badport:no_proxy',
      'dupExisting:duplicate',
      'dup:duplicate',
    ]);
  });

  it('其他配置类型的处理', () => {
    const r = parse({
      schemaVersion: 2,
      '+pac': { name: 'pac', profileType: 'PacProfile' },
      '+auto': { name: 'auto', profileType: 'AutoDetectProfile' },
      '+v': { name: 'v', profileType: 'VirtualProfile', defaultProfileName: 'x' },
      '+sw': { name: 'sw', profileType: 'SwitchProfile', rules: [] },
      '+d': { name: 'd', profileType: 'DirectProfile' },
      '+l1': { name: 'l1', profileType: 'AutoProxyRuleListProfile', format: 'AutoProxy', sourceUrl: 'https://a.example/1.txt' },
      '+l2': { name: 'l2', profileType: 'RuleListProfile', format: 'AutoProxy', sourceUrl: 'https://a.example/2.txt' },
      '+l3': { name: 'l3', profileType: 'SwitchyRuleListProfile', format: 'Switchy', sourceUrl: 'https://a.example/3.txt' },
    });
    if (!r.ok) throw new Error('parse failed');
    expect(r.value.ruleSourceUrl).toBe('https://a.example/1.txt');
    expect(r.value.skipped.map((s) => `${s.name}:${s.reason}`)).toEqual(['pac:pac', 'auto:auto_detect', 'v:virtual', 'l2:extra_rule_list', 'l3:unsupported_rule_format']);
  });

  it.each([
    ['direct', 'direct', null],
    ['clash', 'all', 'clash'],
    ['alias', 'all', 'clash'],
    ['missing', null, null],
  ])('启动配置 %s → 模式 %s、出口 %s', (start, mode, exit) => {
    const r = parse({ ...SAMPLE, '-startupProfileName': start, '+alias': { name: 'alias', profileType: 'VirtualProfile', defaultProfileName: 'clash' } });
    expect(r.ok && [r.value.mode, r.value.exitName]).toEqual([mode, exit]);
  });

  it('默认出口指向的客户端没有被导入时不设出口', () => {
    const r = parse({ ...SAMPLE, '+clash': { ...SAMPLE['+clash'], fallbackProxy: { scheme: 'https', host: 'x', port: 1 } } });
    expect(r.ok && r.value.exitName).toBeNull();
  });
});

describe('applyZeroOmega', () => {
  let n = 0;
  const id = () => `imp${++n}`;
  it('合并勾选项；出口指向导入的默认客户端，原出口变为备用；结果合法', () => {
    const base = addClient(defaultConfig(), { id: 'old', name: 'FlClash', host: '127.0.0.1', port: 7892, scheme: 'mixed', source: 'discovered' });
    const imp = parse(SAMPLE);
    if (!imp.ok) throw new Error('parse failed');
    const cfg = applyZeroOmega(base, imp.value, { clientNames: ['clash', 'v2ray'], useRuleSource: true, useMode: true }, id);
    expect(cfg.clients.map((c) => [c.name, c.source])).toEqual([
      ['FlClash', 'discovered'],
      ['clash', 'imported'],
      ['v2ray', 'imported'],
    ]);
    expect(cfg.settings.exit).toEqual({ kind: 'client', clientId: cfg.clients[1]?.id });
    expect(cfg.settings.backupClientId).toBe('old');
    expect(cfg.settings.mode).toBe('smart');
    expect(cfg.ruleSource).toEqual({ kind: 'custom', url: SAMPLE['+__ruleListOf_auto'].sourceUrl, updateInterval: 'daily' });
    expect(validateConfig(cfg).ok).toBe(true);
  });

  it('只导入部分客户端、不采用规则与模式', () => {
    const imp = parse(SAMPLE);
    if (!imp.ok) throw new Error('parse failed');
    const cfg = applyZeroOmega(defaultConfig(), imp.value, { clientNames: ['v2ray'], useRuleSource: false, useMode: false }, id);
    expect(cfg.clients.map((c) => c.name)).toEqual(['v2ray']);
    expect(cfg.settings.exit).toEqual({ kind: 'client', clientId: cfg.clients[0]?.id });
    expect(cfg.settings.mode).toBe('smart');
    expect(cfg.ruleSource.kind).toBe('builtin');
    expect(validateConfig(cfg).ok).toBe(true);
  });
});
