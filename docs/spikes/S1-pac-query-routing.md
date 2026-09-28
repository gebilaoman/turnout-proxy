# S1：PAC 按 URL query 路由探测请求

日期 2026-09-28 · Chrome 154.0.8037.58（macOS，品牌稳定版） · 脚本 `spikes/s1*.js` · 原始输出 `raw/raw-s1*.{json,txt}`

## 结论

**假设成立，但有三个 ARCHITECTURE.md 未写到的前提，其中两个与现有约定冲突，需要确认。**

| # | 验证点 | 结果 |
| --- | --- | --- |
| 1 | http URL 的 path + query 是否完整传给 `FindProxyForURL` | ✅ 完整。`?turnout_probe=18081`、`?a=1&turnout_probe=18082` 都被路由到对应的本地记录代理，代理收到的请求行与原 URL 一字不差 |
| 2 | https URL 是否被剥离 | ✅ 被剥离（符合官方文档）。带 query 的 https 请求落到了"无 query"分支，代理只收到 `CONNECT probe.turnout.test:443` |
| 3 | 探测条目只写单一代理时，代理死了会不会偷偷直连 | ✅ 不会。直接失败（`Failed to fetch`，约 5ms），并触发 `onProxyError` |
| 4 | 主代理被 Chrome 标记为"坏"期间，单一代理探测能否直达主代理 | ✅ 能。所以健康检测可以及时发现主代理恢复 |
| 5 | SOCKS5 与 HTTP 两种代理串 | ✅ FlClash 混合端口 7890 用 `PROXY` 与 `SOCKS5` 都能通 |
| 6 | 延迟 | FlClash → gstatic 10 次：185–326ms，中位约 205ms（与 curl 相当） |

### 前提 A：探测域名必须不在 HSTS 列表里 ⚠️ 需写入文档

`cp.cloudflare.com` 在 curl 里正常返回 204，在 Chrome 里 **100% 失败**：cloudflare.com 在 HSTS 预加载列表里且含子域名，
Chrome 在请求发出前把 `http://` 内部改写成 `https://`，query 随之被剥离，PAC 走了非探测分支（见 `raw-s1d.txt`，代理收到 `CONNECT cp.cloudflare.com:443`）。

- 能用：`connectivitycheck.gstatic.com`、`www.gstatic.com`、`captive.apple.com`、`detectportal.firefox.com`（均实测无 HSTS 头、http 可达）。
- 不能用：`cp.cloudflare.com` 及任何 HSTS 预加载域名。
- 推荐：`http://connectivitycheck.gstatic.com/generate_204` —— 它本来就是给 http 联网检测用的，不会加 HSTS。
- 动态 HSTS 风险：若将来该域名开始下发 HSTS，用户访问过一次 https 版本后探测就会失效。建议运行时加一个**金丝雀**：
  对一个肯定没人监听的端口（如 `turnout_probe=canary` → `PROXY 127.0.0.1:9`）做一次探测，**必须失败**；若成功，说明 query 已不可见，探测结论不可信，UI 报"无法检测"而不是"在线"。
- 注意：GFWList 的 `@@` 例外里正好有 `connectivitycheck.gstatic.com` 和 `www.gstatic.com`，所以 PAC 里**探测分支必须放在 EXCEPT/MATCH 之前**。

### 前提 B：探测域名必须加入 host_permissions ⚠️ 与 CLAUDE.md 冲突，需确认

没有 host 权限时：
- 默认 `cors` 模式：gstatic 不回 CORS 头 → `Failed to fetch`，与"代理不可用"无法区分。
- `no-cors` 模式：能拿到响应，但是不透明响应（`status: 0`）。实测 ShadowsocksX-NG 的 privoxy 在上游不通时回 **500**，FlClash 上游不通时回 **502**，
  在 no-cors 下都显示为"成功"——**会把坏代理判成在线**，违反"坏了要说清楚"。

加上 `http://connectivitycheck.gstatic.com/*`（或所选探测域名）的 host 权限后，能读到真实状态码（204 / 500 / 502），问题消失。

CLAUDE.md 的 host_permissions 白名单只列了 127.0.0.1、localhost、默认规则源、出口 IP 服务，**没有探测域名**。两个选项：
1. 白名单增加探测域名一项（推荐，用途单一、好向商店解释）。
2. 让出口 IP 服务兼任探测目标，不加新域名。前提是该服务必须支持 http 且无 HSTS、响应足够小；目前多数 IP 回显服务都强制 https，不太现实。

### 前提 C："重新 set 会清空坏代理标记"只在 PAC 内容变化时成立 ⚠️ 与 ARCHITECTURE §3 描述不符

回落实验（主 18085 死、备 18082 活，`raw-s1.json` 后半段）：

| 操作 | 普通请求走向 |
| --- | --- |
| 主死 | 备 ✅ |
| 主恢复，不重设 PAC（立即 / 3 秒后） | 仍走备（坏标记还在） |
| 重设 PAC，内容有变化（哪怕只改注释） | 主 ✅ |
| 主再死再恢复，重设**完全相同**的 PAC | 仍走备 ❌ —— Chrome 认为配置没变，不清标记 |
| 先 set direct 再 set 相同 PAC | 主 ✅，但中间有一段直连窗口，违反"不允许静默直连"，不可用 |

所以 §3 的"健康检测恢复后重新生成 PAC 即可恢复主代理"要改成：**恢复时生成的 PAC 必须与当前生效的字节不同**。
建议在 PAC 生成函数的输入里加一个 `epoch`（RuntimeState 里单调递增的计数，写进首行注释），需要清坏标记时 +1。
这样生成函数仍是纯函数（相同输入 → 相同输出），只是多了一个输入。这是对 ARCHITECTURE §3 的修改，需确认。

## 其他观察

- Chrome 自身的后台请求（如 `android.clients.google.com:443`）也会走扩展设置的 PAC，测试断言要容忍这类噪音。
- 探测失败会触发 `onProxyError`，而事件里**不带 URL**，无法区分是自己的探测还是用户流量（见 S4 的连锁影响）。
- HTTP 规范上，Chrome 文档称"未来可能对 http URL 也做剥离"。目前 154 未剥离；建议 M2 的 Playwright 冒烟测试里保留"探测 query 可见"的回归用例（直接复用 `spikes/s1.js` 的前两个 case）。

## 对 ARCHITECTURE.md 的修改建议（待确认）

1. §5 第 2 级检测：写明探测 URL 用 `http://connectivitycheck.gstatic.com/generate_204?turnout_probe=<clientId>`，探测域名须非 HSTS，加金丝雀校验；PAC 中探测分支位于最前。
2. §8 权限清单：增加探测域名的 host_permissions。
3. §3 回落语义：改为"内容变化才清坏标记"，PAC 生成加 `epoch` 输入。
