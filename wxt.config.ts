import { defineConfig } from 'wxt';

// 权限清单见 CLAUDE.md「权限与商店合规」与 docs/ARCHITECTURE.md §8。修改前必须先停下来确认。
// v2（2026-09-28 确认）：activeTab 用于弹窗读取当前网站；one.one.one.one 为出口 IP 查询；raw.githubusercontent.com 为内置规则在线地址。
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  // 关闭自动导入：所有 WXT / 浏览器 API 都要显式 import，便于 lint 检查 core 不依赖浏览器层
  imports: false,
  manifest: {
    name: 'Turnout – Proxy Switcher',
    description: '__MSG_extDescription__',
    default_locale: 'zh_CN',
    permissions: ['proxy', 'storage', 'alarms', 'activeTab'],
    host_permissions: [
      'http://127.0.0.1/*',
      'http://localhost/*',
      'http://connectivitycheck.gstatic.com/*',
      'https://one.one.one.one/*',
      'https://raw.githubusercontent.com/*',
    ],
    // 仅在用户填写自定义订阅地址时，按该域名运行时申请（ARCHITECTURE §8）
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'Turnout' },
  },
});
