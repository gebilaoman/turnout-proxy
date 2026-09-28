// 本地"记录型"HTTP 代理：不转发，记录收到的请求行，直接应答。用于确认 PAC 把请求路由到了哪个代理、URL 是否完整。
import http from 'node:http';
export function startLogProxy(port, hits) {
  const srv = http.createServer((req, res) => {
    hits.push({ port, method: req.method, url: req.url, t: Date.now() });
    const is204 = req.url.includes('generate_204');
    res.writeHead(is204 ? 204 : 200, { 'x-spike-via': String(port), 'content-type': 'image/gif', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-spike-via' });
    res.end(is204 ? undefined : Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  });
  srv.on('connect', (req, sock) => { hits.push({ port, method: 'CONNECT', url: req.url, t: Date.now() }); sock.end('HTTP/1.1 502 no\r\n\r\n'); });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
