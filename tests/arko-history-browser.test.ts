import { describe, expect, it, vi } from 'vitest'
import type { ArkmeArkoHistoryItem, ArkmeArkoHistoryPage } from '../src/types.js'
import { arkoHistoryDays, exportArkoHistory, readArkoHistory, searchArkoHistory } from '../src/client/arko-history-browser.js'

const item = (id: number, text = `消息${id}`, extra: Partial<ArkmeArkoHistoryItem> = {}): ArkmeArkoHistoryItem => ({
  messageId: id, sessionId: 7, role: id % 2 ? 'user' : 'assistant', text, reasoning: '', status: 1,
  createdAtMillis: new Date(2026, 9, 18, 10, id).getTime(), createdRecordUids: [], ...extra,
})
const page = (items: ArkmeArkoHistoryItem[], nextOffset?: number): ArkmeArkoHistoryPage => ({ items, hasMore: nextOffset !== undefined, ...(nextOffset === undefined ? {} : { nextOffset }) })
describe('Arko history reads', () => {
  it('publishes each page and de-duplicates overlapping history before verifying the head', async () => {
    const read = vi.fn(async (offset: number) => offset === 0 ? page([item(3), item(2)], 2) : page([item(2), item(1)]))
    const seen: number[][] = []
    const result = await readArkoHistory(read, new AbortController().signal, items => seen.push(items.map(item => item.messageId)))
    expect(seen).toEqual([[2, 3], [1, 2, 3]])
    expect(result.map(item => item.messageId)).toEqual([1, 2, 3])
    expect(read.mock.calls.map(([offset]) => offset)).toEqual([0, 2, 0])
  })
  it('rejects a moving offset window instead of exporting missing history', async () => {
    let calls = 0
    const read = vi.fn(async () => ++calls === 1 ? page([item(3)], 1) : calls === 2 ? page([item(1)]) : page([item(4)], 1))
    await expect(readArkoHistory(read, new AbortController().signal, () => {})).rejects.toThrow('对话记录发生变化')
  })
  it.each([0, -1, NaN, undefined])('does not loop on an invalid cursor %s', async nextOffset => {
    const read = vi.fn(async () => ({ items: [item(1)], hasMore: true, nextOffset }) as ArkmeArkoHistoryPage)
    await expect(readArkoHistory(read, new AbortController().signal, () => {})).rejects.toThrow('当前结果不完整')
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('preserves available pages on network failure without reporting completion', async () => {
    const progress = vi.fn()
    const read = vi.fn(async (offset: number) => { if (offset) throw new Error('offline'); return page([item(3)], 1) })
    await expect(readArkoHistory(read, new AbortController().signal, progress)).rejects.toThrow('offline')
    expect(progress).toHaveBeenCalledTimes(1)
  })
  it('never publishes a response after account disposal', async () => {
    const controller = new AbortController(), progress = vi.fn()
    await expect(readArkoHistory(async () => { controller.abort(); return page([item(1)]) }, controller.signal, progress)).rejects.toThrow()
    expect(progress).not.toHaveBeenCalled()
  })
  it('groups valid timestamps in local calendar dates and includes both roles', () => {
    expect(arkoHistoryDays([item(1), item(2), item(3, '', { createdAtMillis: 0 })])).toEqual([
      expect.objectContaining({ bucketDate: '2026-10-18', count: 2, hasRecords: true }),
    ])
  })
  it('finds older user and assistant messages and orders matches newest first', () => {
    expect(searchArkoHistory([item(1, 'Test问题'), item(2, 'TEST回复'), item(3, '其他')], ' test ').map(item => item.messageId)).toEqual([2, 1])
    expect(searchArkoHistory([item(1)], ' ')).toEqual([])
  })
  it('exports source Markdown, identities, roles and time without including reasoning', () => {
    const text = exportArkoHistory([item(1, '我的问题'), item(2, '## 标题\n\n**回答**', { reasoning: '隐藏推理' })], 'Arko')
    expect(text).toContain('共 2 条消息')
    expect(text).toContain('会话 7 · 消息 2')
    expect(text).toContain('## 标题\n\n**回答**')
    expect(text).not.toContain('隐藏推理')
  })
})
