import { describe, expect, it } from 'vitest';
import { parseTrace } from './exitip';

describe('parseTrace', () => {
  it('解析 IPv4 与国家代码', () => {
    expect(parseTrace('fl=123\nh=one.one.one.one\nip=203.0.113.24\nts=1.2\nloc=JP\ntls=TLSv1.3\n')).toEqual({ ip: '203.0.113.24', country: 'JP' });
  });
  it('IPv6、CRLF', () => expect(parseTrace('ip=2001:db8::1\r\nloc=SG\r\n')).toEqual({ ip: '2001:db8::1', country: 'SG' }));
  it('缺少或未知国家代码时只返回 IP', () => {
    expect(parseTrace('ip=198.51.100.7')).toEqual({ ip: '198.51.100.7' });
    expect(parseTrace('ip=198.51.100.7\nloc=XX')).toEqual({ ip: '198.51.100.7' });
    expect(parseTrace('ip=198.51.100.7\nloc=japan')).toEqual({ ip: '198.51.100.7' });
  });
  it.each(['', '<html>blocked</html>', 'ip=', 'ip=999.1.1.1', 'ip=<script>'])('无效内容 %j → null', (t) => expect(parseTrace(t)).toBeNull());
});
