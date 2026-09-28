# Turnout 架构设计

版本 0.4（2026-09-28）。本文件是实现的依据；实现与本文不一致时，以修改本文并经人确认为准。

变更记录：0.4（2026-09-28，第二版）新增「我的网站」（§4.1，配置 v2）、出口 IP（Cloudflare trace）、内置规则在线更新、ZeroOmega 导入；权限增加 activeTab 与两个域名（§8）。
0.3（2026-09-28）首个可用版本实现后的对齐——RuntimeState 增加字段、跟随系统改用 clear、探测键格式与重试、检测不阻塞串行队列、内置规则仅离线副本（详见各节「实现说明」）。
0.2 根据 M0 技术验证修订——新增探测域名权限、PAC epoch、金丝雀校验、第 1 级检测超时语义、onProxyError 节流；取消 LNA 检测与引导；候选端口加 1086。

## 1. 总览

```
┌──────────────── entrypoints ────────────────┐
│ popup      options      onboarding          │  React 界面，只读状态、发命令
└──────┬──────────────────────────────────────┘
       │ 类型化消息（@webext-core/messaging）
┌──────▼──────────── background (SW) ─────────┐
│ Controller：收到命令 / 定时器 / 事件 → 计算  │
│ 新配置 → 调 platform 应用 → 写状态           │
└──────┬───────────────────────────┬──────────┘
       │                           │
┌──────▼───────── platform ────────▼──────────┐
│ chrome/proxy  chrome/alarms  probe  fetcher  │  唯一接触浏览器 API 的层
└──────┬──────────────────────────────────────┘
       │ 纯数据
┌──────▼──────────── core ────────────────────┐
│ config  rules  pac  health  import           │  纯 TS，可在 Node 单测
└─────────────────────────────────────────────┘
```

原则：**core 负责"算"，platform 负责"做"，background 负责"编排"，UI 负责"显示"**。
任何业务判断（该走哪个代理、是否算离线、如何回落）都在 core 里，以纯函数实现并单测。

## 2. 数据模型（core/config）

```ts
type ProxyScheme = 'http' | 'socks5' | 'mixed';   // mixed = 同端口同时支持 HTTP 与 SOCKS（如 Clash 混合端口）

interface Client {
  id: string;            // 稳定 id（nanoid），不随改名变化
  name: string;          // 用户起的名字，如 "FlClash"
  host: string;          // 默认 127.0.0.1
  port: number;
  scheme: ProxyScheme;
  source: 'discovered' | 'manual' | 'imported';
}

type Mode = 'smart' | 'all' | 'direct';
type Exit = { kind: 'client'; clientId: string } | { kind: 'system' };

interface RuleSource {
  kind: 'builtin' | 'custom';
  url?: string;                 // custom 时必填
  updateInterval: 'daily' | 'weekly' | 'off';
}

interface Settings {
  mode: Mode;
  exit: Exit;
  backupClientId: string | null;
  allowDirectWhenAllDown: boolean;   // 默认 false
  autoSwitchBack: boolean;           // 默认 false
}

interface SiteRule {                // 「我的网站」，见 §4.1
  domain: string;                    // 规范化域名（小写、punycode），自动包含子域名
  action: 'direct' | 'proxy';
}

interface PersistedConfig {         // 存 storage.local，带 version + migrations；当前 version = 2
  version: number;
  clients: Client[];
  settings: Settings;
  ruleSource: RuleSource;
  siteRules: SiteRule[];             // v2 新增，最多 500 条；v1 → v2 迁移补空数组
}

interface RuleCache {                // 单独存，体积大，不参与导出
  fetchedAt: string;                 // ISO
  sha256: string;
  compiled: CompiledRules;           // 见 §4
  sourceUrl: string;
}

interface RuntimeState {             // 存 storage.session，可随时重算
  health: Record<string, ClientHealth>;       // key = clientId
  ports: Record<string, 'http' | 'refused' | 'maybe_socks'>;  // 第 1 级结果，直连 / 跟随系统时也能显示「端口在听」
  effectiveExit: Exit | null;                  // 实际在用的出口（主或备）
  alert: 'none' | 'on_backup' | 'can_switch_back' | 'all_down' | 'all_down_direct';  // §5 状态机输出
  alertDismissed: boolean;                     // 弹窗「知道了」；提示类型变化时重置
  probeOk: boolean;                            // 金丝雀校验结果（§5）
  lastCheckAt?: string;
  exitIp?: { ip: string; region?: string; checkedAt: string };
  control: 'ok' | 'other_extension' | 'policy';
  pacEpoch: number;                            // 见 §3，恢复主代理时递增
  ruleUpdate: { status: 'ok' | 'failed' | 'updating'; error?: string; at?: string };
}

type ClientHealth =
  | { status: 'online'; latencyMs: number; checkedAt: string }
  | { status: 'offline'; reason: 'refused' | 'timeout' | 'proxy_error'; checkedAt: string }
  | { status: 'unknown' };
```

## 3. 路由：怎么让浏览器走对的出口

所有模式都通过 `chrome.proxy.settings.set` 应用，scope 为 `regular`：

| 模式 | 应用方式 |
| --- | --- |
| 直连 | `mode: 'direct'` |
| 出口 = 跟随系统 | `proxy.settings.clear` 交还控制权，浏览器回到默认的系统代理（此时"智能分流"不生效，UI 要说明） |
| 全部代理 | `pac_script`：所有请求返回 `主代理; 备用代理[; DIRECT]` |
| 智能分流 | `pac_script`：命中规则返回代理列表，否则 `DIRECT` |

"全部代理"也用 PAC 而不是 `fixed_servers`，因为只有 PAC 能返回有序的备用列表，实现浏览器级的即时回落。

代理串格式（core/pac 负责）：`http` → `PROXY h:p`；`socks5` → `SOCKS5 h:p`；`mixed` → `PROXY h:p`。

回落语义：Chrome 在连接级失败时按列表顺序尝试下一个，并把失败的代理标记为坏约 5 分钟。
**M0 实测：重新 set 内容完全相同的 PAC 不会清除坏代理标记。**因此 PAC 生成函数增加 `epoch` 输入并写入首行注释；
健康检测确认主代理恢复、需要切回时递增 `pacEpoch` 再应用，强制 Chrome 视为新配置。

实现说明：应用前先读当前设置，若已是要应用的内容则跳过（避免每分钟检测都触发 `onChange`）；需要清坏标记时 epoch 已让内容不同，不受影响。

### PAC 结构（自行实现，禁止参考 GPL 代码）

生成的 PAC 只包含数据表和一个很小的查找函数：

```
// Turnout <版本> <配置哈希> epoch=<pacEpoch>
var ROUTE = "PROXY 127.0.0.1:7890; PROXY 127.0.0.1:xxxx";   // 由 settings 决定
var SITE   = { "bank.com": "D", "x.org": "P" };  // 我的网站（§4.1），D = 直连，P = 走代理
var EXCEPT = { "example.cn": 1, ... };      // @@ 例外（优先）
var MATCH  = { "google.com": 1, ... };      // || 与可提取出域名的规则
var REGEX  = [ /.../, ... ];                // 少量无法转成域名的规则，限制条数
function hit(table, host) {                 // 按后缀逐级查找：a.b.c.com → b.c.com → c.com → com
  ...
}
function FindProxyForURL(url, host) {
  // 探测分支必须在所有规则之前（见 §5）
  if (host === "connectivitycheck.gstatic.com" && url.indexOf("turnout_probe=") > 0) return <按端口返回单一代理>;
  if (host === "one.one.one.one") return ROUTE;           // 出口 IP 查询固定走当前出口（§6）
  if (isPlainHostName(host) || host === "127.0.0.1" || host === "localhost") return "DIRECT";
  var s = site(host);                                     // 我的网站：最具体的一条生效
  if (s === "D") return "DIRECT";
  if (s === "P") return ROUTE;
  if (hit(EXCEPT, host)) return "DIRECT";
  if (hit(MATCH, host)) return ROUTE;
  for (...) if (REGEX[i].test(url)) return ROUTE;
  return "DIRECT";
}
```

要求：查找为 O(域名层数)；PAC 文本只含 ASCII；生成函数是纯函数，输入相同则输出字节级相同（便于哈希缓存和测试）。

## 4. 规则订阅（core/rules）

- 支持格式：AutoProxy / GFWList（明文或 base64，首行 `[AutoProxy ...]`）。
- 规则编译：
  - `||domain` → MATCH 表
  - `|http://domain/...`、`|https://domain/...` → 提取域名进 MATCH 表
  - `@@` 开头 → 去掉前缀后按同样规则进 EXCEPT 表
  - `/regex/` → REGEX 列表（上限 200 条，超出丢弃并在状态中计数）
  - 无前缀的域名样式行（如 `.example.com`、`example.com`）→ MATCH 表
  - 其余（关键字、带通配的 URL 片段）→ 丢弃并计数；首版不支持
  - `!` 注释、`[` 头部、空行 → 跳过
- 编译结果带统计：`{ matched, excepted, regex, dropped }`，设置页展示规则条数。
- 更新（platform/fetcher + background）：
  1. 按 `updateInterval` 用 alarm 触发；设置页可手动触发。
  2. fetch 后检查 `response.ok`；base64 解码失败、首行不是 AutoProxy、编译后 `matched === 0` 均视为失败。
  3. 失败：保留旧 `RuleCache`，写 `ruleUpdate.status = 'failed'` 与原因。
  4. 成功：写新 `RuleCache`，重新生成并应用 PAC。
- 内置规则源：扩展包内打包一份离线副本（首次安装、离线时使用），并配置一个默认在线地址。
  实现说明：离线副本为 2026-09-28 的 GFWList 明文（`src/assets/rules/`，LGPL-2.1 原样分发）；
  在线地址为 `https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt`（它本身在 GFWList 中，智能分流时自动经客户端下载）。
  首次安装不立即在线更新（此时通常还没有客户端，国内直连 GitHub 多半失败），在引导完成、PAC 生效后更新一次；之后按 `updateInterval` 定时更新，浏览器启动时若仍是离线副本也会尝试一次。
- "通过当前客户端更新"：生成 PAC 时临时把订阅地址的域名加入 MATCH，更新完成后恢复。

## 4.1 我的网站（按网站手动指定，第二版）

目标是最少的概念：一张表，每条只有「域名」和「直连 / 走代理」两样。不支持正则、通配、路径，不做优先级编排，也不按网站指定客户端。

- 域名自动包含所有子域名；输入时接受完整网址、`*.x.com`、`.x.com`，统一规范化后存储（`core/domain`）。
- 生效顺序固定：本机地址 > 我的网站 > 订阅例外 > 订阅命中 > 直连。同一网站在表里有多级时，最具体的一条生效（PAC 按域名层数逐级查 `SITE` 表）。
- 全部代理模式下只有「直连」条目生效（PAC 生成时只写入 `D` 条目），即常说的「直连白名单」。
- 直连模式、出口跟随系统时不生效。
- 入口：设置页「规则订阅」页中的「我的网站」（可一次粘贴多个域名）；弹窗「当前网站」一键设为直连 / 走代理（依赖 activeTab 读当前网址，§8）。
- 弹窗说明「当前网站怎么走、为什么」由 `core/pac/explain.ts` 计算，其判断顺序与生成的 PAC 保持一致，由单测逐一对比。
- 从 ZeroOmega 导入时条件规则不自动转换，导入结果页提示可在「我的网站」手动添加。

## 5. 健康检测与发现（core/health + platform/probe）

两级检测：

1. **端口存活**：`fetch('http://127.0.0.1:<port>/')`，超时 1.5 秒（M0 S2 实测语义）。
   - 收到任何 HTTP 响应（包括 400/407）→ 端口在听，且是 HTTP 或混合端口。
   - 立即失败（连接被拒绝）→ 离线。
   - **挂起到超时** → 很可能是纯 SOCKS 端口，标记"待确认"，交给第 2 级判定；不得直接判为离线。
2. **代理可用 + 延迟**：通过 PAC 把专用探测请求路由到指定客户端，请求 204 地址计时（M0 S1 已验证成立）。
   - 探测 URL：`http://connectivitycheck.gstatic.com/generate_204?turnout_probe=<键>&n=<随机>`。
     键为 `h<端口>`（经 `PROXY`，http / mixed 客户端）或 `s<端口>`（经 `SOCKS5`），PAC 的探测表把键映射到该客户端的单一代理串；金丝雀键为 `canary` → `PROXY 127.0.0.1:9`。
   - 超时 6 秒（略大于 Clash 系客户端约 5.2 秒的上游拨号超时，以便拿到其 502）；未拿到 204 时立即重试一次，两次都失败才判离线，降低上游抖动造成的误报。
   - 只有当前应用的是 PAC（智能分流 / 全部代理且出口为客户端）时才能做第 2 级；直连与跟随系统模式下只做第 1 级，界面显示「端口在听」而不是在线 / 延迟。
   - 实现说明：探测在后台串行队列之外进行，只有写入结果、运行状态机、重新应用 PAC 的一步进入队列，避免检测拖慢界面操作；写入前重新读取配置，丢弃地址已被修改的客户端的结果。
   - 探测域名必须是 http 且不在 HSTS 预加载列表（`cp.cloudflare.com` 实测会被升级为 https 而失效）。
   - 探测域名必须在 `host_permissions` 中，否则读不到状态码；只有收到 204 才算在线，500/502 等一律判为 `proxy_error`。
   - PAC 中探测分支放在规则匹配之前；探测条目只写单一代理，不带备用，避免回落掩盖故障。
   - **金丝雀校验**：每轮检测同时探测一个确定没有监听的端口，它必须失败；若"成功"，说明 PAC 路由失效
     （例如未来 Chrome 改变 query 处理），整轮结果作废并在设置页提示"检测不可用"。

触发时机：
- 弹窗打开时立即检测所有客户端。
- 后台 `chrome.alarms` 每 1 分钟检测当前与备用客户端。**这是发现主客户端离线的主要途径**：
  M0 S4 实测，备用代理接管成功时 `onProxyError` 不会触发。
- `chrome.proxy.onProxyError` 能唤醒 SW，但事件不带 URL，自家探测失败也会触发。
  收到后做一次节流复查（同一时刻最多一次、间隔不少于 10 秒，节流时间戳存 `storage.session`），
  并忽略探测进行期间收到的事件。

状态机（纯函数，core/health）：

```
输入：上一状态 + 本次检测结果 + settings
输出：新状态 + 需要执行的动作（重新生成 PAC / 通知 UI）

主在线            → effectiveExit = 主
主离线 & 备在线    → effectiveExit = 备，UI 显示"已切到备用"
主恢复 & autoSwitchBack=false → 保持备用，UI 提示"可切回"
主恢复 & autoSwitchBack=true  → effectiveExit = 主
全部离线          → allowDirectWhenAllDown ? 直连并橙色警告 : 保持代理（请求失败），红色提示
```

发现（onboarding / 重新扫描）：对候选端口 `7890, 7891, 7892, 7897, 7898, 10808, 10809, 1080, 1086, 1087, 8888, 20171, 20172`
并发做第 1 级检测。候选列表放在 `core/health/ports.ts`，可扩充。
实现说明：发现阶段只做第 1 级——此时出口多为跟随系统，做第 2 级需要临时改写全局代理，会让其他标签页短暂直连；延迟在引导完成、PAC 生效后自动测出。设计稿引导页上的「可用 · 延迟」因此改为「端口在听」。
已知客户端：FlClash `7890`（mixed）、万达云 `7892`（mixed，M0 S5）、ShadowsocksX-NG `1086`（socks5）/ `1087`（http）。

## 6. 环境与冲突检测（platform/chrome）

- **被其他扩展接管 / 策略锁定**：启动时和弹窗打开时 `chrome.proxy.settings.get`，并监听 `onChange`；
  `levelOfControl` 为 `controlled_by_other_extensions` → `control = 'other_extension'`；`not_controllable` → `'policy'`。
  这两种状态下 UI 禁用切换控件。不做"自动改回"。
- **所有客户端都连不上**：给出"客户端可能未运行 / 端口已修改"的排查引导（打开客户端、检查端口、重新扫描）。
- **LNA（本地网络访问限制）：不做检测，也不引导用户关闭 Chrome 安全开关。**M0 S2 在 Chrome 154 上实测，
  即使强制开启拦截，扩展请求与代理流量也不受影响；此前的风险来自第三方用户报告（Chrome 143/146 时期）。
  若日后收到可复现的 LNA 故障报告，再单独评估。
- **出口 IP**：请求 Cloudflare trace `https://one.one.one.one/cdn-cgi/trace`，取 `ip=` 与 `loc=`（国家代码）。
  PAC 对 `one.one.one.one` 固定返回当前出口的代理列表，所以显示的是经客户端出去的 IP；直连模式显示本机公网 IP，跟随系统时经系统代理。
  结果带 `via`（查询时的出口），出口变化后旧结果作废；弹窗打开、出口变化、回落切换后自动重新查询。选用专用主机名而非 www.cloudflare.com，避免影响用户正常访问 Cloudflare 网站。

## 7. 存储与迁移

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| PersistedConfig | storage.local | version + migrations；迁移前写入 `backup.1..3` |
| RuleCache | storage.local | 可重新下载，不导出、不同步 |
| RuntimeState | storage.session | 浏览器重启清空，启动后重算 |

导出文件 = `PersistedConfig` 的 JSON（带 `format: "turnout"` 与 version）。导入顺序：解析 JSON → 校验信封（`format`、`version`）→ 迁移到当前版本 → 用当前版本的 zod schema 完整校验（`core/config/transfer.ts`）。
比当前版本新的文件一律拒绝，不降级。

## 8. 权限清单（提交商店时逐条说明用途）

| 权限 | 用途 |
| --- | --- |
| `proxy` | 设置浏览器代理与 PAC |
| `activeTab` | 仅在用户点开弹窗时读取当前网站地址，用于「当前网站」一键设置（第二版确认） |
| `storage` | 保存客户端列表、设置、规则缓存 |
| `alarms` | 定时健康检测与规则更新 |
| `host_permissions: http://127.0.0.1/*, http://localhost/*` | 检测本机代理客户端是否在线 |
| `host_permissions: http://connectivitycheck.gstatic.com/*` | 经各客户端请求 204 地址，判断代理是否可用并测延迟 |
| `host_permissions: https://raw.githubusercontent.com/*` | 下载内置规则（GFWList） |
| `host_permissions: https://one.one.one.one/*` | 查询出口 IP（Cloudflare trace） |
| `optional_host_permissions: <all_urls>` | 仅在用户填写自定义订阅地址时，按该域名运行时申请 |

## 9. 浏览器兼容

- Chrome / Edge：本文方案。
- Firefox（第二版）：新增 `platform/firefox`，用 `proxy.onRequest` 按请求返回代理（支持 `failoverTimeout`），复用 core 的规则与状态机；Firefox 不支持内联 PAC。

## 10. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| M0 技术验证（已完成 2026-09-28） | S1 成立（需探测域名权限、epoch、金丝雀）；S2 LNA 不影响扩展与代理；S3 哈希 PAC 到 5 万条无可测影响；S4 能唤醒但有限制 | 结论见 `docs/spikes/README.md`；万达云已补测（S5），Edge 待补测 |
| M1 core | config（类型、zod、迁移）、rules 解析编译、pac 生成、health 状态机、ZeroOmega 导入转换 | 单测覆盖所有分支；PAC 快照测试。**状态：已完成（ZeroOmega 导入于第二版补齐）** |
| M2 后台与弹窗 | background 编排、chrome 适配层、弹窗（正常、已切备用、被接管、全部连不上） | Playwright 冒烟测试（CI 用 Playwright 自带 Chromium；需要品牌版行为的用例沿用 `spikes/lib/launch.js`）：切换模式/出口后 PAC 正确。**状态：已完成（`e2e/smoke.mjs`、`e2e/failover.mjs`）** |
| M3 引导与设置 | 首次引导、设置页（客户端、备用与回落、规则订阅、备份与导入） | 与 `docs/design/` 设计稿一致。**状态：已实现首版，待人工对照设计稿验收** |
| M4 稳定性 | 订阅失败处理、冲突与全部离线引导、导出导入、迁移备份 | 所有异常状态可复现并有 UI 反馈 |
| 第二版 | 我的网站（§4.1）、出口 IP、内置规则在线更新、ZeroOmega 导入 | `e2e/v2.mjs`：规则进 PAC、弹窗一键设置、出口 IP、导入、v1→v2 迁移与备份。**状态：已完成** |
| M5 上架 | 图标、商店素材、隐私政策、权限说明、`wxt zip` | 通过 Chrome 商店审核。**状态：资料已备齐（`docs/store/`、`PRIVACY.md`、GPL-3.0），待提交审核** |

## 11. 待定事项

（已定：许可证 GPL-3.0-only；默认规则源 GFWList 官方地址；出口 IP 服务 Cloudflare trace。）

