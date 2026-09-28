import { describe, expect, it } from 'vitest';
import { MAX_BACKUPS, pushBackup, type ConfigBackup } from './backups';

const at = (s: number) => new Date(Date.UTC(2026, 8, 28, 0, 0, s));

describe('pushBackup', () => {
  it('新备份放在最前，记录时间与版本', () => {
    expect(pushBackup([], { version: 1, clients: [] }, at(1))).toEqual([
      { savedAt: '2026-09-28T00:00:01.000Z', version: 1, data: { version: 1, clients: [] } },
    ]);
  });

  it(`最多保留 ${MAX_BACKUPS} 份，丢弃最旧的`, () => {
    let list: ConfigBackup[] = [];
    for (let i = 1; i <= 5; i++) list = pushBackup(list, { version: i }, at(i));
    expect(list.map((b) => b.version)).toEqual([5, 4, 3]);
  });

  it.each([null, 'garbage', { noVersion: true }, { version: '2' }])('无法识别版本的数据也原样备份 %j', (data) => {
    const [b] = pushBackup([], data, at(0));
    expect(b).toEqual({ savedAt: '2026-09-28T00:00:00.000Z', version: null, data });
  });

  it('备份是深拷贝，不受之后修改影响；不修改入参列表', () => {
    const data = { version: 1, clients: [{ id: 'a' }] };
    const before: ConfigBackup[] = [];
    const list = pushBackup(before, data, at(0));
    data.clients.push({ id: 'b' });
    expect(list[0]?.data).toEqual({ version: 1, clients: [{ id: 'a' }] });
    expect(before).toEqual([]);
  });
});
