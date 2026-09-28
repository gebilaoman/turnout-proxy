# M0 技术验证结论

日期 2026-09-28 · 环境：macOS（Apple Silicon）、Google Chrome 154.0.8037.58 品牌稳定版、FlClash（混合端口 7890）、ShadowsocksX-NG（1086 SOCKS5 / 1087 HTTP）

| 项 | 结论 | 与文档假设 | 详情 |
| --- | --- | --- | --- |
| S1 PAC 按 query 路由探测 | 成立 | **有 3 处需修改** | [S1-pac-query-routing.md](S1-pac-query-routing.md) |
| S2 LNA 行为 | 扩展与代理流量**不受** LNA 影响 | **不符** | [S2-lna.md](S2-lna.md) |
| S3 5000+ 规则 PAC 耗时 | 哈希 PAC 到 5 万条仍无可测影响 | 符合 | [S3-pac-performance.md](S3-pac-performance.md) |
| S4 onProxyError 唤醒 SW | 能唤醒 | **有 2 处限制** | [S4-onproxyerror-wake.md](S4-onproxyerror-wake.md) |
| S5 万达云补测 | 混合端口 7892，第 1 级响应 400，与 FlClash 相同 | 已补入候选端口 | [S5-wandacloud.md](S5-wandacloud.md) |

## 需要人确认的事项（2026-09-28 已全部确认，已写入 CLAUDE.md 与 ARCHITECTURE.md 0.2）

1. **权限（S1）**：第 2 级探测必须把探测域名加入 `host_permissions`，否则读不到状态码，会把返回 500/502 的坏代理判成在线。
   建议加 `http://connectivitycheck.gstatic.com/*`。这超出了 CLAUDE.md 的 host_permissions 白名单。
2. **探测域名约束（S1）**：必须 http 且不在 HSTS 列表（`cp.cloudflare.com` 实测不可用）；PAC 里探测分支放在规则匹配之前；运行时加"死端口必须失败"的金丝雀校验。
3. **回落恢复（S1，改 ARCHITECTURE §3）**：重设**相同内容**的 PAC 不会清除 Chrome 的坏代理标记。PAC 生成函数需增加 `epoch` 输入（写入首行注释），恢复主代理时递增。
4. **LNA（S2，影响设计稿 PopupLNA 与 `RuntimeState.lna`）**：Chrome 154 即使强制 `Enabled (Blocking)` 也不拦扩展和代理流量，现有设计会在"客户端都没开"时误导用户去关 Chrome 安全开关。
   建议 M2/M4 暂不做 LNA 检测与该弹窗。请确认，以及当初加这一项是否来自某次实际故障。
5. **第 1 级检测语义（S2，改 ARCHITECTURE §5）**：连接拒绝是立即失败；纯 SOCKS 端口是**挂起到超时**，不是报错。候选端口建议补 1086。
6. **onProxyError（S4，改 ARCHITECTURE §5）**：备用接管成功时不触发，只能靠 alarms 发现主离线；事件不带 URL，自己的探测也会触发，"立即复查"必须节流（状态存 `storage.session`）。

## 未完成

- ~~万达云未测~~：已补测，见 [S5-wandacloud.md](S5-wandacloud.md)。上游正常时的延迟尚未测到（测试时它的节点不通）。
- S4 的"自然空闲回收"没法在 Playwright 附着下复现，用 CDP 强制停止代替（对事件分发是同一状态）。
- Edge 未测。

## 复现

```bash
cd spikes && pnpm install
node s1.js      # 另有 s1b / s1c / s1d 补充用例；s1c、部分 s1 用例需要 FlClash 在 7890 运行
node s2.js && node s2b.js
curl -x http://127.0.0.1:7890 -o data/gfwlist.b64 https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt && base64 -D -i data/gfwlist.b64 -o data/gfwlist.txt
node s3-node.js && node s3-chrome.js
node s4.js
node s5-wandacloud.js   # 需要万达云在 7892 运行
```

- `spikes/` 是一次性验证代码，不属于产品代码，也不遵守 `src/` 的分层约定；唯一的依赖是 `playwright`（devDependency）。
- 品牌版 Chrome 137+ 已移除 `--load-extension`，脚本用 CDP `Extensions.loadUnpacked`（需 `--remote-debugging-pipe` + `--enable-unsafe-extension-debugging`）加载扩展。M2 的 Playwright 冒烟测试可以沿用 `spikes/lib/launch.js` 的这个做法，或改用 Playwright 自带的 Chromium。
- 注意 Playwright 默认参数会关闭 Finch 实验与 `HttpsUpgrades`；凡是测"真实用户环境"行为的用例要用 `launch({ clean: true, seed: true })`。
- `raw/` 中 `raw-s2.json`、`raw-s5-wandacloud.txt` 为重跑生成；其余在 2026-09-28 目录被误覆盖后按会话记录恢复，数值与首次运行一致（`raw-s1c.txt` 由表格转为文本格式）。
- 测试期间外部网络的状态：FlClash 上游有间歇性超时（curl 也同样），S1 中 gstatic 的个别失败来自此，已通过重复测试排除。
