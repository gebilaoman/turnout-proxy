# S2：当前稳定版 Chrome 的本地网络访问（LNA）行为

日期 2026-09-28 · Chrome 154.0.8037.58（macOS，品牌稳定版） · 脚本 `spikes/s2*.js` · 原始输出 `raw/raw-s2*.json`

## 结论

**与设计假设不符：Chrome 154 的 LNA 不拦截扩展对 127.0.0.1 的请求，也不拦截"网页经 127.0.0.1 代理上网"。
设计稿 `PopupLNA`（"Chrome 阻止了连接本机代理……把 #local-network-access-check 设为 Disabled"）的前提在当前稳定版上不成立，需要讨论是否保留。**

## 测试环境说明

- Playwright 默认启动参数带 `--disable-field-trial-config`，会关掉 Finch 实验，LNA 结果可能失真。本项改为**干净参数启动**，
  并把本机真实 Chrome 的 Finch 种子（`VariationsSeedV2` 与 `Local State` 中的 `variations_*`）复制进临时配置目录，尽量还原你实际拿到的实验配置。
- 两种模式各测一遍：① Finch 默认；② 在 `chrome://flags/#local-network-access-check` 选 **Enabled (Blocking)**（最严格）。
- 每种模式再分"manifest 有 / 无 `http://127.0.0.1/*` host 权限"两组。
- 客户端：FlClash（运行中，混合端口 7890）、ShadowsocksX-NG（privoxy HTTP 1087、ss-local SOCKS5 1086，上游不通）、本地测试 HTTP 服务、关闭的端口。
- **万达云未测**：它没有在运行，我没有擅自启动（可能会改系统代理）。从安装包看它是 FlClash 的 Flutter 分支（同样的 `ClashConfig(mixedPort)`、mihomo 内核、同样的配置目录结构），预期行为与 FlClash 一致，但默认端口需要你启动一次后确认。

## 结果

### 扩展自身请求 127.0.0.1（SW 与扩展页结果相同，两种 LNA 模式结果相同）

| 目标 | 有 host 权限 | 无 host 权限 |
| --- | --- | --- |
| FlClash `127.0.0.1:7890` / `localhost:7890` | 200 以外的 HTTP 响应：**400**（可读） | `Failed to fetch`（CORS，非 LNA） |
| privoxy `1087` | **400**（可读） | `Failed to fetch`（CORS） |
| 本地服务（带 `Access-Control-Allow-Origin: *`） | 200 | 200 —— 证明无权限时的失败来自 CORS 而非 LNA |
| 关闭端口 18099 | `Failed to fetch`，3–26ms，控制台 `ERR_CONNECTION_REFUSED` | 同左 |
| ss-local `1086`（纯 SOCKS5） | **挂起直到超时**（4s 超时触发 AbortError） | 同左 |

即使在 Enabled (Blocking) 下，扩展也没有被拦截，没有任何 LNA 相关的控制台报错。

### 网页经 127.0.0.1 代理上网（PAC → 本机代理）

| 场景 | Finch 默认 | Enabled (Blocking) |
| --- | --- | --- |
| 导航 `http://…` 经本地代理 | 200 | 200 |
| 导航 `https://example.com`、`https://www.baidu.com` 经本地 CONNECT 代理 | 200 | 200 |
| 公网 https 页面内 `fetch` 子资源经本地代理 | 200 | 200 |

代理连接不属于 LNA 的检查对象。

### 参照：公网网页直接 fetch 127.0.0.1

`https://example.com` 页面里 `fetch('http://127.0.0.1:…')`：Finch 默认下**挂起**（等待权限提示），Blocking 下失败。
说明 LNA 在 154 上确实对**网页**生效——只是不影响扩展和代理。

### `navigator.permissions.query`

`local-network-access` / `loopback-network` / `local-network` 在 SW、扩展页、网页里都返回 `prompt`，**与实际是否被拦截无关**，不能用来检测 LNA 状态。

## 对设计的影响

1. **`RuntimeState.lna` 与 PopupLNA**：在当前稳定版上，这个故障不会出现。继续保留有两个风险：
   - 误判：本地端口全部 fetch 失败时，真实原因几乎总是"客户端都没开"，若把它解释成 LNA 并引导用户去关 Chrome 安全开关，是错误且有害的建议。
   - 无从判定：拦截与连接拒绝都表现为 `TypeError: Failed to fetch`，扩展读不到控制台的 net 错误码，permissions API 也不可靠。
   
   建议（需确认）：M2/M4 暂不实现 LNA 检测与 PopupLNA；在 `docs/` 记录本结论，Chrome 行为变化时再启用。若要保留一个兜底，可改为"代理设置正常、PAC 生效、但所有本地端口都失败且 FlClash 等进程显然在运行"时显示中性的"无法连接本机端口"说明，**不引导用户关闭 LNA**。
   
   也想问一下：当初加这一项是否来自某次实际故障？如果是，可能是旧版本 Chrome、其他扩展（例如在网页上下文里探测本机端口的扩展），或 Chrome 另外的策略，我可以按那个场景再复现。

2. **第 1 级检测需要 127.0.0.1 host 权限**——原因是 CORS 而非 LNA：FlClash 返回的 400 不带 CORS 头，无权限读不到。与现有权限清单一致，无需改动。

3. **ARCHITECTURE §5 第 1 级检测描述需要修正**：
   - 连接拒绝 → 立即失败（< 30ms）→ 可直接判"离线（refused）"。
   - 纯 SOCKS 端口 → **不会报错而是挂起**，1.5 秒超时 → 判"待确认（可能是 SOCKS）"，交给第 2 级。
   - 收到 HTTP 响应（FlClash 与 privoxy 都是 400）→ HTTP/混合端口在听。
   - 所以"网络错误 → 离线或纯 SOCKS"应改为"立即拒绝 → 离线；超时 → 可能是 SOCKS，第 2 级确认"。

4. **自动发现候选端口**：本机 ShadowsocksX-NG 默认 1086（SOCKS5）+ 1087（HTTP），候选列表里只有 1087，建议补上 1086。

## 待补

- 万达云：请启动一次，我补测其默认端口、协议与第 1 级检测的响应（预期与 FlClash 相同）。
- Edge 未测（ARCHITECTURE §9 说 Chrome/Edge 同方案）。
