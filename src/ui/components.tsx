// 共享的展示组件。不直接访问浏览器 API 或后台；数据与回调由入口页面传入。
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import s from './ui.module.css';

// Logo 使用 public/icon 下提供的图标，不自行重画（CLAUDE.md「工作方式」）
export function Logo({ size = 22 }: { size?: number }) {
  return <img className={s.logo} src="/icon/32.png" width={size} height={size} alt="" />;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'ghostMuted' | 'danger' | 'dangerOutline' | 'warnOutline' | 'warnGhost';

export function Button({ variant = 'secondary', small, grow, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean; grow?: boolean }) {
  const cls = [s.btn, s[variant], small ? s.small : '', grow ? s.grow : '', className ?? ''].filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest} />;
}

const ICONS = {
  warn: (
    <>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
  blocked: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.9 4.9l14.2 14.2" />
    </>
  ),
  unplugged: (
    <>
      <path d="M9 7V3" />
      <path d="M15 7V3" />
      <path d="M6 7h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
      <path d="M12 17v4" />
      <path d="M3 3l18 18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
};

export function Icon({ name, color, size = 18 }: { name: keyof typeof ICONS; color: string; size?: number }) {
  return (
    <svg className={s.bannerIcon} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Banner({ tone, icon, title, children, actions }: { tone: 'warn' | 'error'; icon: keyof typeof ICONS; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`${s.banner} ${tone === 'warn' ? s.bannerWarn : s.bannerError}`}>
      <div className={s.bannerHead}>
        <Icon name={icon} color={tone === 'warn' ? 'var(--warn)' : 'var(--err)'} />
        <div className={s.bannerText}>
          <div className={s.bannerTitle}>{title}</div>
          {children}
        </div>
      </div>
      {actions && <div className={s.bannerActions}>{actions}</div>}
    </div>
  );
}

export function BannerBody({ children }: { children: ReactNode }) {
  return <div className={s.bannerBody}>{children}</div>;
}

export function Steps({ title, items, note }: { title: string; items: string[]; note?: string }) {
  return (
    <div className={s.steps}>
      <div className={s.stepsTitle}>{title}</div>
      {items.map((it, i) => (
        <div key={i}>
          {i + 1}. {it}
        </div>
      ))}
      {note && <div style={{ color: 'var(--text-2)' }}>{note}</div>}
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return <span className={s.dot} style={{ background: color }} />;
}

// 点击后立即翻转（乐观更新），保存完成后以传入的 checked 为准
export function Toggle({ id, checked, onChange, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const [local, setLocal] = useState(checked);
  useEffect(() => setLocal(checked), [checked]);
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className={s.toggle}
      checked={local}
      disabled={disabled}
      onChange={(e) => {
        setLocal(e.target.checked);
        onChange(e.target.checked);
      }}
    />
  );
}

// 扩展文件已更新但扩展没有重新加载时（开发时加载未打包目录才会出现），页面与后台版本不一致
export function StaleExtensionBanner({ configVersion, expected, text, title }: { configVersion: number; expected: number; text: string; title: string }) {
  if (configVersion === expected) return null;
  return (
    <Banner tone="warn" icon="warn" title={title}>
      <BannerBody>{text}</BannerBody>
    </Banner>
  );
}

export const uiClass = s;

// 订阅一个外部数据源：subscribe 调用 cb 推送新值，返回取消函数
export function useSubscription<T>(subscribe: (cb: (v: T) => void) => () => void): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => subscribe(setValue), [subscribe]);
  return value;
}
