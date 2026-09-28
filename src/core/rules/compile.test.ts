import { describe, expect, it } from 'vitest';
import { MAX_REGEX_RULES, compileRuleText, decodeRuleText, normalizeDomain, parseRuleList } from './compile';

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe('decodeRuleText', () => {
  it('明文带头部直接通过（容忍 BOM 与空白）', () => {
    expect(decodeRuleText('\uFEFF  [AutoProxy 0.2.9]\n||a.com')).toEqual({ ok: true, value: '[AutoProxy 0.2.9]\n||a.com' });
  });
  it('base64（含换行）解码', () => {
    const enc = b64('[AutoProxy 0.2.9]\n||例子.cn\n').replace(/(.{20})/g, '$1\n');
    expect(decodeRuleText(enc)).toEqual({ ok: true, value: '[AutoProxy 0.2.9]\n||例子.cn' });
  });
  it('base64 解出来不是 AutoProxy', () => {
    expect(decodeRuleText(b64('hello world'))).toEqual({ ok: false, error: { code: 'not_autoproxy' } });
  });
  it.each(['<html>404</html>', 'abc$', 'A', '////'.repeat(3) + '='])('无法解码：%s', (t) => {
    const r = decodeRuleText(t);
    expect(r.ok).toBe(false);
  });
  it('base64 内容不是合法 UTF-8', () => {
    expect(decodeRuleText(btoa('\xff\xfe\xfd\xfc'))).toEqual({ ok: false, error: { code: 'decode_failed' } });
  });
});

describe('normalizeDomain', () => {
  it.each([
    ['Example.COM', 'example.com'],
    ['example.com.', 'example.com'],
    ['例子.中国', 'xn--fsqu00a.xn--fiqs8s'],
    ['85.17.73.31', '85.17.73.31'],
  ])('%s → %s', (a, b) => expect(normalizeDomain(a)).toBe(b));
  it.each(['', 'localhost', '*.a.com', 'a..com', '-a.com', 'a_b.com', '__proto__', 'a'.repeat(64) + '.com', `${'a.'.repeat(127)}com`, 'a b.com'])('拒绝 %j', (d) =>
    expect(normalizeDomain(d)).toBeNull(),
  );
  it('无法转成 punycode 的非 ASCII 被拒绝', () => {
    expect(normalizeDomain('a\u0000\u00e9.com')).toBeNull();
    expect(normalizeDomain('ab\u200b\u00e9%.com')).toBeNull();
  });
});

describe('compileRuleText', () => {
  it('按 ARCHITECTURE §4 分类', () => {
    const r = compileRuleText(
      [
        '[AutoProxy 0.2.9]',
        '! 注释',
        '',
        '||google.com',
        '||Google.com^',
        '||youtube.com/watch',
        '|http://blogspot.com/path',
        '|https://twitter.com:443/x',
        '.facebook.com',
        'wikipedia.org',
        '@@||baidu.com',
        '@@.qq.com',
        '/^https?:\\/\\/[^\\/]+blogspot\\.(.*)/',
        '@@/^https?:\\/\\/x/',
        '/[/',
        'keyword',
        'example.com/some/path',
        '*.wild.com',
        '|http://*.wild.org',
      ].join('\n'),
    );
    expect(r.match).toEqual(['blogspot.com', 'facebook.com', 'google.com', 'twitter.com', 'wikipedia.org', 'youtube.com']);
    expect(r.except).toEqual(['baidu.com', 'qq.com']);
    expect(r.regex).toEqual(['^https?:\\/\\/[^\\/]+blogspot\\.(.*)']);
    expect(r.stats).toEqual({ matched: 6, excepted: 2, regex: 1, dropped: 5, regexDropped: 1 });
  });

  it(`正则最多保留 ${MAX_REGEX_RULES} 条，其余计数`, () => {
    const lines = Array.from({ length: MAX_REGEX_RULES + 5 }, (_, i) => `/r${i}x/`);
    const r = compileRuleText(lines.join('\n'));
    expect(r.regex).toHaveLength(MAX_REGEX_RULES);
    expect(r.stats.regexDropped).toBe(5);
  });

  it('输出排序去重、与输入顺序无关', () => {
    const a = compileRuleText('||b.com\n||a.com\n||b.com');
    const b = compileRuleText('||a.com\n||b.com');
    expect(a.match).toEqual(['a.com', 'b.com']);
    expect(a).toEqual(b);
  });
});

describe('parseRuleList', () => {
  it('成功', () => {
    const r = parseRuleList(b64('[AutoProxy]\n||a.com'));
    expect(r.ok && r.value.stats.matched).toBe(1);
  });
  it('编译后没有可代理的规则视为失败', () => {
    expect(parseRuleList('[AutoProxy]\n! only comments\n@@||a.com')).toEqual({ ok: false, error: { code: 'no_rules' } });
  });
  it('解码失败原样透出', () => {
    expect(parseRuleList('<html>')).toEqual({ ok: false, error: { code: 'decode_failed' } });
  });
});
