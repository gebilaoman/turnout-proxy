// 工具栏状态图标（docs/brand/README.md）。状态由 core/state 计算，这里只调用 setIcon。
import { browser } from '#imports';
import type { IconState } from '@/core/state';

export async function setToolbarIcon(state: IconState): Promise<void> {
  await browser.action.setIcon({ path: { 16: `/icon/state/${state}-16.png`, 32: `/icon/state/${state}-32.png` } });
}
