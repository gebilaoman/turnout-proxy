# S4：`chrome.proxy.onProxyError` 能否唤醒 Service Worker

日期 2026-09-28 · Chrome 154.0.8037.58（macOS，品牌稳定版） · 脚本 `spikes/s4.js` · 原始输出 `raw/raw-s4.json`

## 结论

**能唤醒，事件会送达。但有两个限制会影响 §5 的设计：回落成功时不触发；事件不带 URL，自己的探测失败也会触发。**

## 方法

- 监听器在 SW 顶层同步注册，每次触发把 `{kind, bootAt}` 写入 `storage.local`（`bootAt` 是 SW 实例启动时间，用来判断是否是新实例）。
- 每个用例前通过 CDP `ServiceWorker.stopAllWorkers` 停掉 SW，并确认 `runningStatus = stopped`；用例后等 2.5 秒，从扩展页读日志（读 storage 不会唤醒 SW）。

| 用例 | SW 状态 | 日志 |
| --- | --- | --- |
| 对照 A：停止后什么也不做 | stopped | 无 |
| 对照 B：停止后访问直连站点 | stopped | 无 |
| 阳性对照：停止后 `chrome.alarms` 到点 | **running** | `alarm`（新实例） |
| 网页请求经死代理（单一代理，fatal） | **running** | 2 条 `onProxyError`：`ERR_PROXY_CONNECTION_FAILED fatal=true`（新实例） |
| 扩展页 fetch 经死代理 | **running** | 1 条 `onProxyError`（新实例） |
| 网页请求"主死备活"（浏览器自动回落成功） | stopped | **无** |
| 同上，但 SW 本来就在运行 | running | **无** |

## 对设计的影响

1. **回落成功不会产生事件**。主代理挂了、备用顶上时，扩展完全收不到通知。所以"主离线 → 已切到备用"的 UI 状态只能靠
   `chrome.alarms` 定时检测和弹窗打开时检测得到——ARCHITECTURE 已有这两个触发点，但要明确：**`onProxyError` 只是补充，不能作为主离线的主要信号**。
   另外，alarm 周期 1 分钟意味着最长约 1 分钟后 UI 才显示"已切到备用"，这是可接受的，但设计稿里的文案不要暗示"实时"。
2. **只有全部代理都失败（fatal）时才触发**，此时正是"全部离线"的情况，立即复查是有价值的。
3. **事件不带 URL**（`details` 为空字符串，只有 `error` 与 `fatal`），而第 2 级探测本身就会经死代理失败并触发该事件。
   如果"收到 onProxyError → 立即复查"不做节流，复查的失败又会触发事件，形成循环。建议：
   - 复查节流（例如 10 秒内最多一次），节流状态存 `storage.session`（SW 随时可能被回收，不能放内存）；
   - 探测进行中标记一个时间窗，窗内的事件忽略。
   这条属于 core/health 状态机的输入处理，M1 实现时加单测。
4. 自然空闲回收未能验证：Playwright 通过 CDP 附着在 SW 上会阻止它被回收（等了 90 秒仍在运行），所以用 CDP 强制停止代替。
   强制停止与空闲回收对事件分发来说是同一状态（`stopped`），结论可以外推；如需百分百确认，可以手动测：普通方式加载扩展、关掉 DevTools 等 30 秒以上，再访问经死代理的网站，看 `chrome://serviceworker-internals`。

## 顺带确认

- 监听器顶层同步注册 + 被事件唤醒时，事件能送达新实例，符合 CLAUDE.md 的 SW 约定。
- spike 里 `boot` 日志和 `proxyError` 日志同时"读-改-写" storage 存在丢更新（`boot` 那条被覆盖了）。正式实现里凡是并发写同一个 storage key 的地方都要串行化，或按事件分 key 写。
