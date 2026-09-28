// 内置规则来源。
// 离线副本随扩展打包（src/assets/rules），只在没有任何缓存时使用；在线地址为 GFWList 官方，
// 它本身在 GFWList 里，智能分流时会自动经当前客户端下载。
export const BUILTIN_SOURCE = 'builtin:gfwlist-2026-09-28';
export const BUILTIN_ONLINE_URL = 'https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt';

export const isBuiltinSource = (sourceUrl: string | undefined): boolean => !!sourceUrl && (sourceUrl.startsWith('builtin:') || sourceUrl === BUILTIN_ONLINE_URL);
