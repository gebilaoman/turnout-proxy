import { describe, expect, it } from 'vitest';
import { domainCandidates, domainFromInput, hasLeadingWildcard } from './domain';

describe('domainFromInput', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM ', 'example.com'],
    ['https://www.example.com/path?q=1#x', 'www.example.com'],
    ['http://example.com:8080/', 'example.com'],
    ['example.com/some/path', 'example.com'],
    ['example.com:443', 'example.com'],
    ['*.example.com', 'example.com'],
    ['*example.com', 'example.com'],
    ['**.example.com', 'example.com'],
    ['*baidu.com', 'baidu.com'],
    ['.example.com', 'example.com'],
    ['例子.cn', 'xn--fsqu00a.cn'],
    ['https://例子.cn/', 'xn--fsqu00a.cn'],
  ])('%j → %s', (input, out) => expect(domainFromInput(input)).toBe(out));

  it.each(['', '   ', 'localhost', 'http://', 'not a domain', 'a..b', 'ftp:/broken', 'http://[::1]/', '*', 'baidu*.com', 'baidu.com*', 'a.*.com'])('%j → null', (input) => expect(domainFromInput(input)).toBeNull());
});

describe('domainCandidates', () => {
  it('默认去掉 www.，其余由具体到宽泛', () => {
    expect(domainCandidates('www.example.com')).toEqual(['example.com', 'www.example.com']);
    expect(domainCandidates('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
    expect(domainCandidates('example.com')).toEqual(['example.com']);
  });
  it('不是合法域名时为空', () => {
    expect(domainCandidates('localhost')).toEqual([]);
    expect(domainCandidates('127.0.0')).toEqual(['127.0.0', '0.0']);
  });
});

describe('hasLeadingWildcard', () => {
  it.each([
    ['*baidu.com', true],
    [' *.baidu.com', true],
    ['baidu.com', false],
    ['.baidu.com', false],
  ])('%j → %s', (t, v) => expect(hasLeadingWildcard(t)).toBe(v));
});
