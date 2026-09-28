# Turnout – Proxy Switcher

给同时用多个本地代理客户端（FlClash、万达云、Clash Verge、v2rayN 等）的人用的 Chrome 代理切换扩展：
规则在扩展里配一次、对所有客户端生效；一键切换模式与出口；当前客户端离线时浏览器立即改走备用；状态一目了然。

开发约定见 [CLAUDE.md](CLAUDE.md)，架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，技术验证结论见 [docs/spikes/](docs/spikes/README.md)。

## 在 Chrome 里安装（开发版）

```bash
pnpm install
pnpm build            # 产物在 .output/chrome-mv3
```

1. 打开 `chrome://extensions`，右上角打开「开发者模式」。
2. 点「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录。
3. 会自动打开引导页：扫描本机常用端口 → 选择上网方式 → 完成。
4. 点浏览器右上角拼图图标，把 Turnout 固定到工具栏。

代码修改后重新 `pnpm build`，再在扩展管理页点 Turnout 的刷新按钮。开发时也可以用 `pnpm dev`（WXT 会打开一个带扩展的独立 Chrome）。

> 如果之前装过 ZeroOmega / SwitchyOmega 等代理扩展，请先停用，否则弹窗会提示「代理设置被其他扩展接管」。

## 使用

- **模式**：智能分流（GFWList 命中的网站走出口，其余直连）/ 全部代理 / 直连。
- **出口**：选一个客户端，或「跟随系统代理」。
- **备用**：设置页「客户端与备用」里选。默认客户端连不上时浏览器立即改走备用；弹窗说明原因，默认不自动切回。
- **全部离线**：默认不改为直连（避免暴露真实 IP），弹窗提供「临时直连」。
- **规则**：内置 GFWList 离线副本；也可以填自定义 AutoProxy / GFWList 订阅地址（保存时 Chrome 会询问该域名的访问权限）。
- **备份**：设置页可导出 / 导入配置；导入和升级前会自动备份，最近 3 份可恢复。

## 开发

```bash
pnpm check            # typecheck + lint + 单元测试（src/core，Vitest）
pnpm e2e              # 构建后用本机 Chrome 跑端到端测试（e2e/，截图在 e2e/shots/）
```

- `pnpm e2e` 默认使用 `/Applications/Google Chrome.app`，可用 `CHROME_PATH` 覆盖。
- `e2e/smoke.mjs` 依赖本机有可用的代理客户端（如 FlClash 7890）；`e2e/failover.mjs` 自带测试代理，不依赖外部环境。

目录：

```
src/core/          纯 TypeScript 业务逻辑（配置、规则、PAC、健康检测状态机），可在 Node 下单测
src/platform/      浏览器适配（chrome.proxy / alarms / storage / 探测 / 消息）
src/entrypoints/   background（编排）、popup、options、onboarding
src/ui/            共享组件与设计 token
src/locales/       界面文案（i18n）
spikes/            M0 技术验证脚本（一次性，不属于产品代码）
```

## 尚未完成

- 出口 IP 显示（查询服务待选定）
- 内置规则的在线更新地址（待选定）
- 从 ZeroOmega / SwitchyOmega 导入
- 深色主题、Firefox 版
