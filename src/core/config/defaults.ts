import { CURRENT_CONFIG_VERSION, type PersistedConfig } from './schema';

// 首次安装、尚未完成引导时的配置。
// 出口为「跟随系统」：按 ARCHITECTURE §3 会应用 mode: 'system'，与装扩展之前的浏览器行为一致，
// 不会在用户还没选客户端时就改变上网路径。
export function defaultConfig(): PersistedConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    clients: [],
    settings: {
      mode: 'smart',
      exit: { kind: 'system' },
      backupClientId: null,
      allowDirectWhenAllDown: false,
      autoSwitchBack: false,
    },
    ruleSource: { kind: 'builtin', updateInterval: 'daily' },
    siteRules: [],
  };
}
