# CLAUDE.md — Turnout 开发约定

本文件是给 AI 编码助手（claude-cli）的强制约定。开始任何任务前先读本文件和 `docs/ARCHITECTURE.md`。
与本文件冲突的实现一律不合格；确需偏离时，先停下来说明理由，等人确认。

## 产品一句话

Turnout – Proxy Switcher：给同时用多个本地代理客户端（FlClash、Clash Verge、v2rayN、机场客户端等）的个人用户，
一个装上就能用、一键切换、状态一目了然的 Chrome 代理切换扩展。

## 产品原则（功能取舍以此为准）

1. **规则在扩展里配一次，对所有客户端生效**：客户端只提供出口，分流规则由扩展的一条订阅决定。
2. **状态永远可见**：随时能看到当前模式、经由哪个客户端、是否在线、延迟、出口 IP。
3. **坏了要说清楚**：不允许静默失效、静默直连；每种故障都有原因和修复步骤。
4. **配置永不丢失**：本地持久化、带版本迁移、迁移前自动备份、可导出导入。
5. **可信赖**：开源、权限最小、无遥测、无推销、免注册。

## 明确不做（除非人工确认改变定位）

情景模式 / 自动切换模式的嵌套引用；多条订阅叠加与规则优先级编排；自带代理节点或推销代理服务；
账号注册与云端；遥测与使用统计；按标签页代理、多账号 IP 隔离；SOCKS5 账号密码认证；PAC 脚本编辑与远程 PAC。

## 技术栈（固定，不得替换）

- WXT（Node 22+）+ TypeScript（`strict: true`）+ React 18
- 包管理：pnpm
- 样式：CSS 变量 + CSS Modules；**不引入** UI 组件库（MUI、Antd、Chakra 等）和 CSS-in-JS
- 数据校验：zod
- 存储：WXT storage（`storage.defineItem`，带 `version` 与 `migrations`）
- 扩展内消息：`@webext-core/messaging`（类型化）
- 测试：Vitest（core 单元测试）、Playwright（加载未打包扩展的端到端测试）
- 新增任何运行时依赖前必须先说明用途和体积，等人确认

## 目录与依赖方向

```
src/
  core/          纯 TypeScript，禁止引用 chrome.* / browser.* / wxt/*，必须 100% 可在 Node 下单测
  platform/      浏览器适配层；唯一允许调用 chrome.proxy / chrome.alarms / fetch 探测 的地方
  entrypoints/   background / popup / options / onboarding，只做组装与界面，不写业务规则
  ui/            共享 React 组件与设计 token（对应 docs/design/）
```

依赖方向只能是 `entrypoints → platform → core`、`entrypoints → ui`。core 不得反向依赖任何层。

## 硬性规则（每条都来自竞品踩过的坑）

**权限与商店合规**
- 只申请 `proxy`、`storage`、`alarms`、`activeTab`（第二版确认，仅用于弹窗读取当前网站）四个权限；`host_permissions` 只写 `http://127.0.0.1/*`、`http://localhost/*`、探测域名 `http://connectivitycheck.gstatic.com/*`（M0 确认）、默认规则源 `https://raw.githubusercontent.com/*` 和出口 IP 服务 `https://one.one.one.one/*`（第二版确认）。
- 禁止 `<all_urls>`、`tabs`、`webRequest`、`history`、`cookies`。用户自定义订阅地址用 `optional_host_permissions` 运行时申请。
- 禁止远程代码：不得 `eval`、`new Function`、加载远程脚本或远程 PAC。订阅规则只当数据解析。
- 修改 `wxt.config.ts` 中的 manifest 权限必须先停下来确认。

**后台 Service Worker**
- 所有 `chrome.*` 事件监听器必须在 background 顶层**同步**注册，不得在异步初始化之后再注册（ZeroOmega 启动时弹认证框的根源）。
- 禁止保活 hack（定时调用 API 防止 SW 被回收）、禁止 localStorage 或内存模拟 localStorage；状态全部放 `chrome.storage`。
- 周期任务只用 `chrome.alarms`（最短 30 秒）。

**PAC 与路由**
- PAC 由 `core/pac` 生成，输出必须只含 ASCII（非 ASCII 一律 `\uXXXX` 转义），CI 校验。
- 规则编译成按域名后缀查找的哈希表，禁止几千条 if + 正则的线性匹配。
- 只有用户开启"全部离线时直连"才允许在代理列表末尾追加 `DIRECT`，默认绝不追加。
- 不使用 `mandatory: true`。

**网络请求**
- 所有 `fetch` 必须检查 `response.ok` 与状态码，用 `headers.get()` 读取响应头，并校验内容（例如规则订阅解析后条数 > 0）。
- 订阅更新失败必须保留上一次成功的规则，并把失败原因写入状态、在 UI 显示。

**存储**
- 持久化数据结构变更必须：递增 version、写 migration、写 migration 单测、迁移前把旧数据写入备份槽（保留最近 3 份）。

**版权**
- 禁止复制 ZeroOmega / SwitchyOmega / FoxyProxy / SmartProxy 的任何代码（它们是 GPL）。只能参考 `docs/` 里描述的格式和行为，自己实现。

## 工作方式

- 按 `docs/ARCHITECTURE.md` 的里程碑顺序推进，一次只做一个里程碑中的一项，完成后停下汇报。
- 每项完成的标准：`pnpm check`（typecheck + lint + test）通过；core 新代码有单测；更新相关文档。
- 遇到以下情况必须停下来问人：改权限、改存储结构、加依赖、偏离本文件或 ARCHITECTURE.md、技术验证结果与文档假设不符。
- 提交信息用中文或英文均可，但要写清"做了什么、为什么"。
- 图标与状态图标已提供在 `public/icon/`，用法见 `docs/brand/README.md`；不要自行重画或引入图标库替代 Logo。
- 界面文字以 `docs/design/` 设计稿为准，用户可见文案使用简体中文，预留 i18n（`wxt` 的 `i18n` 模块），不要硬编码在组件里。
