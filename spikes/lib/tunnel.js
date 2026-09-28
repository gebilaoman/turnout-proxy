// 本地真实转发代理（HTTP + CONNECT），直连出网。用于把"经 127.0.0.1 代理上网"与 FlClash 上游稳定性解耦。
import http from 'node:http';
import net from 'node:net';
export function startTunnel(port, log) {
  const srv = http.createServer((req, res) => {
    log.push('GET ' + req.url);
    const u = new URL(req.url);
    const up = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  srv.on('connect', (req, sock, head) => {
    log.push('CONNECT ' + req.url);
    const [h, p] = req.url.split(':');
    const up = net.connect(+p, h, () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
