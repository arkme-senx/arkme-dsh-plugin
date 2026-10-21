import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { ArkmeDayTimeline } from '../src/client/ArkmeDayTimeline.js'
import { createDocumentedDayActivityReader } from '../src/client/documented-day-activity-reader.js'
const start = Date.parse('2026-10-14T09:00:00+08:00')
const query = { accountScope: 'test:42', bucketDate: '2026-10-14', timezone: 'Asia/Shanghai', mode: 'activities', kind: 'all', includeBackground: false } as const
function content(v: any): string { return typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(content).join('') : v?.children ? content(v.children) : '' }
it('keeps an already expanded conversation complete when a later source grows the same group', async () => {
  let finishRecord!: (v: unknown) => void
  const source = { sourceRef: 'sealed', sourceKey: 'chat:1', kind: 'private_chat', displayName: '测试对话' }
  const read = vi.fn(async (_op: unknown, params: any) => {
    if (params.source === 'record') return new Promise(resolve => { finishRecord = resolve })
    return { items: params.source === 'chat' ? [{ entry_id: 'newer', occurred_at: start + 60_000, source_item: source,
      source_kind: 'private_chat', relation_flags: ['received'], text: '先到达的聊天消息' }] : [], has_more: false }
  })
  const reader = createDocumentedDayActivityReader(query.accountScope, read as any)
  const detailSpy = vi.spyOn(reader, 'loadDetail')
  let view!: ReactTestRenderer
  try {
    await act(async () => { view = create(<ArkmeDayTimeline query={query} reader={reader} onQueryChange={() => {}} />) })
    const row = () => view.root.findByProps({ 'data-activity-id': 'chat:newer' })
    await act(async () => row().findByProps({ className: 'arkme-day-entry-content' }).props.onClick())
    expect(content(view.root.findByProps({ className: 'arkme-day-detail' }))).toContain('先到达的聊天消息')
    await act(async () => finishRecord({ items: [{ occurred_at: start, record_projection: {
      recordUid: 'older', accessState: 'available', textContent: '后到达的个人消息', source,
    } }], has_more: false }))
    expect(content(row())).toContain('2 条相关消息')
    const fresh = await reader.loadDetail(query, 'chat:newer', { signal: new AbortController().signal, snapshotId: detailSpy.mock.calls[0]![2].snapshotId })
    expect(fresh.items.map(i => i.text)).toEqual(['后到达的个人消息', '先到达的聊天消息'])
    expect(content(view.root.findByProps({ className: 'arkme-day-detail' }))).toContain('后到达的个人消息')
  } finally { if (view) await act(async () => view.unmount()) }
})

it('refreshes rich content even when deduplication leaves the group count unchanged, but ignores unrelated sources', async () => {
  let finishRecord!: (v: unknown) => void, finishCall!: (v: unknown) => void
  const source = { sourceRef: 'sealed', sourceKey: 'chat:1', kind: 'private_chat', displayName: '测试对话' }
  const read = vi.fn(async (_op: unknown, params: any) => {
    if (params.source === 'record') return new Promise(resolve => { finishRecord = resolve })
    if (params.source === 'call') return new Promise(resolve => { finishCall = resolve })
    return { items: params.source === 'chat' ? [{ entry_id: 'same', occurred_at: start, source_item: source,
      source_ref: { record_uid: 'same' }, source_kind: 'private_chat', relation_flags: ['sent'], text: '消息预览' }] : [], has_more: false }
  })
  const reader = createDocumentedDayActivityReader(query.accountScope, read as any)
  const detailSpy = vi.spyOn(reader, 'loadDetail')
  let view!: ReactTestRenderer
  try {
    await act(async () => { view = create(<ArkmeDayTimeline query={query} reader={reader} onQueryChange={() => {}}
      renderRecord={item => <p>{item.content ? '富文本内容已补齐' : item.text}</p>} />) })
    const row = () => view.root.findByProps({ 'data-activity-id': 'chat:same' })
    await act(async () => row().findByProps({ className: 'arkme-day-entry-content' }).props.onClick())
    expect(detailSpy).toHaveBeenCalledTimes(1)
    await act(async () => finishRecord({ items: [{ occurred_at: start, record_projection: {
      recordUid: 'same', accessState: 'available', textContent: '消息预览', source, content: { recordUid: 'same', text: '正文' },
    } }], has_more: false }))
    expect(content(row())).toContain('1 条相关消息')
    expect(content(view.root.findByProps({ className: 'arkme-day-detail' }))).toContain('富文本内容已补齐')
    expect(detailSpy).toHaveBeenCalledTimes(2)
    await act(async () => finishCall({ items: [], has_more: false }))
    expect(detailSpy).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledTimes(6)
  } finally { if (view) await act(async () => view.unmount()) }
})
