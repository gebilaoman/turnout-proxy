// 持久化配置的数据模型（docs/ARCHITECTURE.md §2）。
// 类型全部由 zod schema 推导，schema 是唯一来源。
import { z } from 'zod';
import { normalizeDomain } from '../domain';

// 不让 zod 尝试用 Function 构造器生成校验代码（CLAUDE.md：禁止 eval / new Function）
z.config({ jitless: true });

export const CURRENT_CONFIG_VERSION = 2;
export const MAX_SITE_RULES = 500;

export const ProxySchemeSchema = z.enum(['http', 'socks5', 'mixed']);
export type ProxyScheme = z.infer<typeof ProxySchemeSchema>;

export const ClientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// 主机名、IPv4 或带方括号的 IPv6；不允许带协议、路径、端口或空白
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])$/;

export const ClientSchema = z.object({
  id: ClientIdSchema,
  name: z.string().trim().min(1).max(64),
  host: z.string().max(253).regex(HOST_RE),
  port: z.number().int().min(1).max(65535),
  scheme: ProxySchemeSchema,
  source: z.enum(['discovered', 'manual', 'imported']),
});
export type Client = z.infer<typeof ClientSchema>;

export const ModeSchema = z.enum(['smart', 'all', 'direct']);
export type Mode = z.infer<typeof ModeSchema>;

export const ExitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('client'), clientId: ClientIdSchema }),
  z.object({ kind: z.literal('system') }),
]);
export type Exit = z.infer<typeof ExitSchema>;

const HttpUrlSchema = z.url({ protocol: /^https?$/ });

export const RuleSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), updateInterval: z.enum(['daily', 'weekly', 'off']) }),
  z.object({ kind: z.literal('custom'), url: HttpUrlSchema, updateInterval: z.enum(['daily', 'weekly', 'off']) }),
]);
export type RuleSource = z.infer<typeof RuleSourceSchema>;

// 「我的网站」：按网站手动指定直连或走代理，优先于规则订阅（ARCHITECTURE §4）。
// 域名自动包含所有子域名；存储的一律是规范化后的域名。
export const SiteActionSchema = z.enum(['direct', 'proxy']);
export type SiteAction = z.infer<typeof SiteActionSchema>;
export const SiteRuleSchema = z.object({
  domain: z.string().refine((d) => normalizeDomain(d) === d, { message: 'invalid_domain' }),
  action: SiteActionSchema,
});
export type SiteRule = z.infer<typeof SiteRuleSchema>;

export const SettingsSchema = z.object({
  mode: ModeSchema,
  exit: ExitSchema,
  backupClientId: ClientIdSchema.nullable(),
  allowDirectWhenAllDown: z.boolean(),
  autoSwitchBack: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const PersistedConfigSchema = z
  .object({
    version: z.literal(CURRENT_CONFIG_VERSION),
    clients: z.array(ClientSchema).max(100),
    settings: SettingsSchema,
    ruleSource: RuleSourceSchema,
    siteRules: z.array(SiteRuleSchema).max(MAX_SITE_RULES),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    cfg.clients.forEach((c, i) => {
      if (ids.has(c.id)) ctx.addIssue({ code: 'custom', message: 'duplicate_client_id', path: ['clients', i, 'id'] });
      ids.add(c.id);
    });
    const domains = new Set<string>();
    cfg.siteRules.forEach((r, i) => {
      if (domains.has(r.domain)) ctx.addIssue({ code: 'custom', message: 'duplicate_site_rule', path: ['siteRules', i, 'domain'] });
      domains.add(r.domain);
    });
    const { exit, backupClientId } = cfg.settings;
    if (exit.kind === 'client' && !ids.has(exit.clientId)) {
      ctx.addIssue({ code: 'custom', message: 'exit_client_missing', path: ['settings', 'exit', 'clientId'] });
    }
    if (backupClientId !== null) {
      if (!ids.has(backupClientId)) {
        ctx.addIssue({ code: 'custom', message: 'backup_client_missing', path: ['settings', 'backupClientId'] });
      } else if (exit.kind === 'client' && exit.clientId === backupClientId) {
        ctx.addIssue({ code: 'custom', message: 'backup_same_as_exit', path: ['settings', 'backupClientId'] });
      }
    }
  });
export type PersistedConfig = z.infer<typeof PersistedConfigSchema>;
