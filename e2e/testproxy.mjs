// 测试用本地 HTTP 代理：不转发，对 generate_204 直接回 204，其他回 200。可随时停止 / 重启以模拟客户端离线。
import http from 'node:http';
export class TestProxy {
  constructor(port) { this.port = port; this.hits = []; this.srv = null; }
  start() {
    this.srv = http.createServer((req, res) => {
      this.hits.push(req.url);
      const is204 = req.url.includes('generate_204');
      res.writeHead(is204 ? 204 : 200, { 'cache-control': 'no-store' });
      res.end(is204 ? undefined : 'ok');
    });
    this.srv.on('connect', (_req, sock) => sock.end('HTTP/1.1 502 no\r\n\r\n'));
    return new Promise((r) => this.srv.listen(this.port, '127.0.0.1', r));
  }
  stop() {
    return new Promise((r) => { this.srv.closeAllConnections(); this.srv.close(() => r()); });
  }
}
