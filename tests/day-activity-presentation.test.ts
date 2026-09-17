import { describe, expect, it } from 'vitest'
import { dayActivityMetadata, dayExcerptAuthor, selectDayActivityExcerpts } from '../src/client/day-activity-presentation.js'
import { groupDayActivities } from '../src/client/multisource-day-activity-reader.js'
import type { DayActivityEntry } from '../src/client/calendar-activity-model.js'

const start = Date.parse('2026-09-20T00:00:00+08:00')
const entry = (id: string, preview: string, changes: Partial<DayActivityEntry> = {}): DayActivityEntry => ({
  id, kind: 'private_chat', title: '周鹏', sourceName: '周鹏', sourceIdentity: 'peer:42', access: 'available',
  startAtMillis: start + Number(id) * 60_000, endAtMillis: start + Number(id) * 60_000,
  preview, recordCount: 1, participation: 'self', ...changes,
})

describe('bounded daily activity excerpts', () => {
  it('keeps a meaningful exchange instead of the last acknowledgement, preserving exact original text', () => {
    const items = [entry('1', '明天上午把接口联调完成，可以吗？'), entry('2', '可以，先补齐回复筛选字段。', { participation: 'received', previewAuthor: { name: '昵称', remark: '周鹏' } }), entry('3', '好的')]
    const result = groupDayActivities(items, 'activities')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.excerpts).toEqual([
      { id: '1', text: items[0]!.preview, self: true },
      { id: '2', text: items[1]!.preview, self: false, author: { name: '昵称', remark: '周鹏' } },
    ])
    expect(result.groups.get('3')).toHaveLength(3)
    expect(result.items[0]!.id).toBe('3')
    expect(dayExcerptAuthor(items[1]!, result.items[0]!.excerpts![1]!)).toBe('周鹏')
  })
  it('does not suppress short meaningful text, and still shows an acknowledgement-only segment', () => {
    expect(selectDayActivityExcerpts([entry('1', '退款'), entry('2', '继续')]).map(item => item.text)).toEqual(['退款'])
    expect(selectDayActivityExcerpts([entry('1', '好的'), entry('2', '收到')]).map(item => item.text)).toEqual(['收到'])
  })
  it('does not select duplicates, inaccessible content or background messages', () => {
    const selected = selectDayActivityExcerpts([entry('1', '具体讨论内容'), entry('2', '具体讨论内容'),
      entry('3', '不可访问的秘密内容'.repeat(50), { access: 'restricted' }),
      entry('4', '内部背景事件'.repeat(50), { participation: 'background' })])
    expect(selected.map(item => item.id)).toEqual(['2'])
  })
  it('keeps separate source identities, gaps and records mode separate', () => {
    const items = [entry('1', '讨论甲'), entry('2', '讨论乙', { sourceIdentity: 'peer:other' }), entry('30', '下一次讨论')]
    expect(groupDayActivities(items, 'activities').items).toHaveLength(3)
    expect(groupDayActivities([entry('1', '甲'), entry('2', '乙')], 'records').items).toHaveLength(2)
  })
  it('does not call a group name a person or mislabel unknown authors', () => {
    const group = entry('1', '回复内容', { kind: 'group_chat', participation: 'received', title: '项目群' })
    expect(dayExcerptAuthor(group, selectDayActivityExcerpts([group])[0]!)).toBe('群成员')
    expect(dayExcerptAuthor(entry('1', '自述'), { id: '1', text: '自述', self: true })).toBe('我')
  })
  it('removes duplicate minute ranges and irrelevant message counts while keeping call status', () => {
    const audio = entry('1', '', { kind: 'recording', endAtMillis: start + 65_000, recordCount: 0 })
    expect(dayActivityMetadata(audio, 'Asia/Shanghai', start, start + 86_400_000)).toBe('录音 0:05')
    const call = entry('1', '', { kind: 'call', statusLabel: '已接通 · 3:46' })
    expect(dayActivityMetadata(call, 'Asia/Shanghai', start, start + 86_400_000)).toBe('已接通 · 3:46')
  })
})
