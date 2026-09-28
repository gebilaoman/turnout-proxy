# 从 ZeroOmega / SwitchyOmega 导入

根据 ZeroOmega 源码（commit c367db2，2026-09-09）整理的备份格式说明。**只描述格式，不得复制其代码（GPL-3.0）。**

## 1. 文件格式

- 文件名通常为 `ZeroOmegaOptions-<时间>.bak` 或 SwitchyOmega 的 `OmegaOptions.bak`。
- 内容是一个 JSON 对象；若内容不以 `{` 开头，则是 base64 编码的 JSON，先解码。
- `schemaVersion` 为 2（旧版可能为 1 或缺失）；其他值拒绝并提示"不支持的版本"。
- 键的约定：
  - `-` 开头：全局设置（如 `-startupProfileName`、`-downloadInterval`，单位分钟）
  - `+` 开头：一个配置（profile），键名为 `+<名字>`
  - 名字以 `__` 开头的配置为内部隐藏配置（例如 `__ruleListOf_<名>`）
  - `direct`、`system` 为内置配置，不会出现在文件中

## 2. 配置类型与处理方式

| profileType | 含义 | Turnout 处理 |
| --- | --- | --- |
| `FixedProfile` | 固定代理服务器 | **导入为客户端**（见 §3） |
| `RuleListProfile`（旧名 `SwitchyRuleListProfile`、`AutoProxyRuleListProfile`） | 规则订阅 | `format` 为 `AutoProxy` 且有 `sourceUrl` 的，第一条导入为规则订阅；其余提示未导入 |
| `SwitchProfile` | 自动切换（条件列表 + 默认配置） | 不导入条件；用于推断默认出口（见 §4） |
| `VirtualProfile` | 指向另一配置的别名 | 不导入 |
| `PacProfile`、`AutoDetectProfile` | PAC 脚本 / 自动检测 | 不导入，提示原因 |
| `DirectProfile`、`SystemProfile` | 直连 / 系统代理 | 忽略 |

## 3. FixedProfile → Client

FixedProfile 的代理字段：`fallbackProxy`、`proxyForHttp`、`proxyForHttps`、`proxyForFtp`，
每个形如 `{ "scheme": "http" | "https" | "socks4" | "socks5", "host": "...", "port": 1234 }`。

映射规则：

1. 优先取 `fallbackProxy`；没有则依次取 `proxyForHttps`、`proxyForHttp`。
2. `scheme`：`http` → `http`；`socks5` → `socks5`；`https`、`socks4` → 不支持，跳过并提示。
3. 若 host 为 `127.0.0.1` / `localhost` / `::1` 且端口在已发现的混合端口中，`scheme` 标为 `mixed`。
4. `name` 取配置名；`source: 'imported'`。
5. 与已有客户端 host+port 相同的视为重复，不重复添加。
6. 带 `auth` 字段的：导入地址，但**不导入账号密码**（首版不支持认证），并提示用户。
7. `bypassList` 不导入（Turnout 固定对本机地址直连）。

## 4. 推断默认出口与备用

- 读取 `-startupProfileName`：
  - 指向 FixedProfile → 该客户端为默认出口，模式设为"全部代理"。
  - 指向 SwitchProfile → 模式设为"智能分流"；其规则列表（`__ruleListOf_<名>` 或引用的 RuleListProfile）的 `matchProfileName` 指向的 FixedProfile 为默认出口。
  - 指向 `direct` → 模式设为"直连"。
- 备用客户端不推断，留空由用户在导入结果页选择。

## 5. 导入结果页必须展示

- 成功导入的客户端列表（可逐个取消勾选）
- 导入的规则订阅地址
- 未导入的项目及原因（PAC、条件规则、认证信息、不支持的协议等）
- 导入前自动备份当前 Turnout 配置，可一键撤销

## 6. 测试样例（根据源码推导，非真实导出文件）

```json
{
  "schemaVersion": 2,
  "-startupProfileName": "auto",
  "-downloadInterval": 1440,
  "+clash": {
    "name": "clash", "profileType": "FixedProfile", "color": "#99ccee", "revision": "18f2a1b3c4d",
    "fallbackProxy": { "scheme": "http", "host": "127.0.0.1", "port": 7890 },
    "bypassList": [{ "conditionType": "BypassCondition", "pattern": "127.0.0.1" }]
  },
  "+v2ray": {
    "name": "v2ray", "profileType": "FixedProfile", "color": "#ffaa88",
    "fallbackProxy": { "scheme": "socks5", "host": "127.0.0.1", "port": 10808 },
    "bypassList": []
  },
  "+auto": {
    "name": "auto", "profileType": "SwitchProfile", "color": "#99dd99",
    "defaultProfileName": "__ruleListOf_auto",
    "rules": [{ "condition": { "conditionType": "HostWildcardCondition", "pattern": "*.corp.com" }, "profileName": "direct" }]
  },
  "+__ruleListOf_auto": {
    "name": "__ruleListOf_auto", "profileType": "RuleListProfile", "format": "AutoProxy",
    "sourceUrl": "https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt",
    "matchProfileName": "clash", "defaultProfileName": "direct", "ruleList": ""
  }
}
```

期望结果：客户端 clash（127.0.0.1:7890，mixed 或 http）与 v2ray（127.0.0.1:10808，socks5）；
规则订阅为上述 GFWList 地址；模式"智能分流"，默认出口 clash；提示"1 条条件规则（*.corp.com 直连）未导入"。

M1 阶段需要用真实的 ZeroOmega 导出文件补充测试样例（请用户提供一份去除敏感信息的备份）。
