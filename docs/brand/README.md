# Turnout 品牌与图标

图形「道岔」：底部一条入口，向上分成两条轨道。亮的是当前出口，暗的是备用。

## 扩展图标（manifest `icons`）

`public/icon/16.png`、`32.png`、`48.png`、`128.png`（WXT 会自动识别 `public/icon/` 下的这些文件）。

## 工具栏状态图标（`chrome.action.setIcon`）

`public/icon/state/<状态>-16.png` 与 `-32.png`，调用时同时传入 16 和 32 两个尺寸：

| 状态 | 文件前缀 | 底色 | 图形 | 何时使用 |
| --- | --- | --- | --- | --- |
| 正常 | `normal` | `#2B59C3` | 右轨亮 | 智能分流 / 全部代理，经默认客户端 |
| 已切到备用 | `backup` | `#B8650A` | 左轨亮 | 默认客户端离线，走备用 |
| 直连 | `direct` | `#6B6A64` | 轨道拉直 | 直连模式 |
| 异常 | `error` | `#B3261E` | 两轨都暗 | 被其他扩展接管、策略锁定、全部客户端都连不上 |

状态到图标的映射放在 `core`（纯函数，输入 RuntimeState 输出状态名），`platform` 只负责调用 `setIcon`。

## 源文件

`turnout-<状态>.svg`（128 母版）、`turnout-<状态>-16.svg`、`turnout-<状态>-32.svg`（小尺寸单独调整了线宽）。
`turnout-512.png` 用于 GitHub 仓库头像、商店宣传图等。

横版组合：图标 + 「Turnout」（IBM Plex Sans 600）+ 副标题「Proxy Switcher」（400，`#5C5B55`）。
