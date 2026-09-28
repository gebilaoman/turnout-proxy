# S5（补测）：万达云默认端口与第 1 级检测响应

日期 2026-09-28 · 万达云 2.2.7（macOS） · Chrome 154.0.8037.58 · 脚本 `spikes/s5-wandacloud.js` · 原始输出 `raw/raw-s5-wandacloud.txt`

## 结论

- **端口 7892，协议为混合端口（`mixed`，HTTP 与 SOCKS5 共用），只监听 `127.0.0.1`。**
- 第 1 级检测响应与 FlClash 完全相同：`GET http://127.0.0.1:7892/` → **400**（`Content-Length: 0`、`Connection: close`），`localhost:7892` 同样。
- 已把 7892 加入 ARCHITECTURE §5 的候选端口。

## 依据

- `lsof`：`wandacloudCore` 只监听 `127.0.0.1:7892`。
- 本机配置（`defaults read com.wandacloud flutter.config` 的 `patchClashConfig`）：`mixed-port = 7892`，`port / socks-port / redir-port / tproxy-port = 0`，TUN 关闭。
- 万达云是 FlClash 的 Flutter 分支（mihomo 内核，TUN 设备名仍叫 `FlClash`）。FlClash 默认 7890，万达云用 7892，**推测是出厂时特意错开的**，这样两者能同时运行。
  但我无法从二进制里确认这个值是出厂默认还是在本机被改过——**如果你没手动改过万达云的端口，就可以视为默认值。**

## 第 2 级检测（顺带验证了 M0 的探测方案）

经 PAC 把 `http://connectivitycheck.gstatic.com/generate_204?turnout_probe=<键>` 路由到各客户端，连续 5 轮：

| 目标 | 结果 |
| --- | --- |
| 万达云 `PROXY 127.0.0.1:7892` | 5/5 次返回 **502**（2.2–3.6s） |
| 万达云 `SOCKS5 127.0.0.1:7892` | 5/5 次 `Failed to fetch` |
| FlClash `PROXY` / `SOCKS5 127.0.0.1:7890`（对照） | 首轮受上游抖动影响超时，之后 4/4 次 204，约 185ms |
| 金丝雀 `PROXY 127.0.0.1:9` | 5/5 次失败（2–4ms）✅ |

curl 结果一致（经 7892 走 HTTP 为 502，走 SOCKS5 失败）。说明测试时**万达云的端口在听，但上游节点不通**（可能没有选中节点或节点不可用），与 Chrome 无关。

这正好验证了 ARCHITECTURE §5 的设计：
- 第 1 级（400）→ 端口在听；第 2 级（502）→ 判为 `proxy_error`，不会误报在线。
- 若当初用 no-cors 或不读状态码，这里就会把万达云判成"在线"。
- 万达云以 SOCKS5 方式探测时，上游不通表现为 `Failed to fetch`，和连接被拒绝的表现一样；因为第 1 级已确认端口在听，第 2 级失败应判为 `proxy_error` 而不是 `refused`。M1 的 health 状态机要按"第 1 级结果 + 第 2 级结果"组合判断原因。

## 未验证

- 万达云上游正常时的延迟（需要它连上可用节点后再测一次，不影响方案）。
