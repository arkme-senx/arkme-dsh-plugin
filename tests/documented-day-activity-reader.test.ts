import { describe, expect, it, vi } from 'vitest'
import type { callArkme } from '../src/client/api.js'
import type { DayActivityQuery } from '../src/client/calendar-activity-model.js'
import { createDocumentedDayActivityReader } from '../src/client/documented-day-activity-reader.js'

const start = new Date(2026, 8, 19, 9).getTime()
const query: DayActivityQuery = {
  accountScope: 'test:42', bucketDate: '2026-09-19', timezone: 'Asia/Shanghai', mode: 'activities', kind: 'all', includeBackground: false,
}
const options = () => ({ signal: new AbortController().signal })

describe('documented multi-source day activity reader', () => {
  it('projects existing avatars and speaker labels, selects meaningful text and preserves all expanded messages', async () => {
    const row = (id: string, text: string, offset: number, sent: boolean) => ({ entry_id: id, occurred_at: start + offset,
      source_kind: 'group_chat', source_ref: { chat_session_uid: 'group:1' },
      source_item: { sourceRef: 'sealed:group', sourceKey: 'group:1', kind: 'group_chat', displayName: '产品讨论群', avatarRefs: ['image:1'] },
      relation_flags: [sent ? 'sent' : 'received'], relation: sent ? {} : { display_name_snapshot: '周鹏' },
      record: { payload: { text_content: text } } })
    const read = vi.fn<typeof callArkme>(async (_op, params) => ({ items: (params as any).source === 'chat'
      ? [row('a', '明天把接口联调完成。', 0, true), row('b', '我先补齐回复筛选字段。', 60_000, false), row('c', '好的', 120_000, true)] : [], has_more: false }))
    const reader = createDocumentedDayActivityReader(query.accountScope, read), page = await reader.loadDay(query, options())
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ avatar: { avatarRefs: ['image:1'] }, title: '产品讨论群', recordCount: 3 })
    expect(page.items[0]!.excerpts).toEqual([
      { id: 'chat:a', text: '明天把接口联调完成。', self: true },
      { id: 'chat:b', text: '我先补齐回复筛选字段。', self: false, author: { name: '周鹏' } },
    ])
    const detail = await reader.loadDetail(query, 'chat:c', { ...options(), snapshotId: page.snapshotId })
    expect(detail.items.map(item => item.text)).toEqual(['明天把接口联调完成。', '我先补齐回复筛选字段。', '好的'])
    expect(read.mock.calls.every(([operation]) => operation === 'calendar.activity')).toBe(true)
  })
  it('projects record, chat, call, recording, Arko and Bot responses without faking coordinates', async () => {
    const read = vi.fn<typeof callArkme>(async operation => {
      if (operation !== 'calendar.activity') throw new Error(`unexpected ${operation}`)
      return { data: { items: [] as unknown[], has_more: false } }
    })
    read.mockImplementation(async (_operation, params) => {
      const source = (params as any).source
      if (source === 'record') return { data: { items: [{ record_core: { record_uid: 'note-1', title: '带位置记录', text_content: '内容' }, occurred_at: start, location_summary: { label: '办公室', captured_at: start }, location_ref: 'loc-1' }], has_more: false } }
      if (source === 'chat') return { data: { items: [{ entry_id: 'chat-1', occurred_at: start + 60_000, source_item: { sourceRef: 'sealed-chat:1', sourceKey: 'chat:1', displayName: '备注名', kind: 'private_chat' }, source_ref: { chat_session_uid: 'chat:1' }, relation_flags: ['received'], text: '你好' }], has_more: false } }
      if (source === 'call') return { data: { items: [{ call_id: 'call-1', started_at: start + 120_000, ended_at: start + 300_000, peer_display_name: '备注名', media_type: 'audio', result_label: '已接通' }], has_more: false } }
      if (source === 'audio') return { data: { items: [{ start_at: start + 360_000, end_at: start + 600_000, source_label: '本人录音', status: 'saved' }], has_more: false, coverage: { status: 'ready' } } }
      if (source === 'arko') return { data: { items: [{ entry_id: 'arko-1', occurred_at: start + 700_000, text: 'Arko 回复' }], has_more: false } }
      return { data: { items: [{ entry_id: 'bot-1', occurred_at: start + 800_000, bot_name: '助手', text: 'Bot 回复' }], has_more: false } }
    })
    const reader = createDocumentedDayActivityReader(query.accountScope, read)
    const page = await reader.loadDay(query, options())
    expect(page.items.map(item => item.kind).sort()).toEqual(['arko', 'bot', 'call', 'note', 'private_chat', 'recording'])
    const note = page.items.find(item => item.id === 'note:note-1')!
    expect(note.locationSummary).toEqual({ label: '办公室', capturedAtMillis: start })
    expect(note.location).toBeUndefined()
    expect(note.canLoadLocation).toBe(true)
    expect(page.coverage?.intervals).toHaveLength(1)
    expect(page.completeness).toBe('complete')
    const privateChat = page.items.find(item => item.kind === 'private_chat')!
    const detail = await reader.loadDetail(query, privateChat.id, { ...options(), snapshotId: page.snapshotId })
    expect(detail.items[0]?.author.name).toBe('备注名')
    expect(reader.resolveTarget(detail.sourceRef!)).toMatchObject({ kind: 'source', source: { displayName: '备注名' } })
    const locationRead = vi.fn<typeof callArkme>(async (operation, params) => {
      if (operation === 'calendar.record-location') return { recordUid: 'note-1', access: 'available', location: { source: 'device', latitude: 30, longitude: 114 } }
      return (params as any).source === 'record'
        ? { data: { items: [{ record_core: { record_uid: 'note-1', title: '记录' }, occurred_at: start, location_ref: 'loc-1' }], has_more: false } }
        : { data: { items: [], has_more: false } }
    })
    const withLocation = createDocumentedDayActivityReader(query.accountScope, locationRead)
    // The location ref is opaque to the reader and is passed only through the host operation.
    const locationPage = await withLocation.loadDay(query, options())
    await withLocation.loadLocation!(query, 'note:note-1', { ...options(), snapshotId: locationPage.snapshotId })
    expect(locationRead.mock.calls.at(-1)?.[0]).toBe('calendar.record-location')
  })

  it('keeps source cursors independent and exposes partial state until the next page', async () => {
    const read = vi.fn<typeof callArkme>(async (_operation, params) => {
      const source = (params as any).source
      if (source === 'chat' && !(params as any).body?.cursor) return { data: { items: [], has_more: true, next_cursor: 'chat-next' } }
      if (source === 'chat') return { data: { items: [{ entry_id: 'chat-2', occurred_at: start, text: '下一页', source_ref: { chat_session_uid: 'chat:2', source_key: 'chat:2', display_name: '群聊', kind: 'group_chat' } }], has_more: false } }
      return { data: { items: [], has_more: false } }
    })
    const reader = createDocumentedDayActivityReader(query.accountScope, read)
    const first = await reader.loadDay({ ...query, kind: 'conversation' }, options())
    expect(first.hasMore).toBe(true)
    expect(first.missingKinds).toContain('private_chat')
    expect(first.missingKinds).toContain('group_chat')
    const second = await reader.loadDay({ ...query, kind: 'conversation' }, { ...options(), snapshotId: first.snapshotId, cursor: first.nextCursor! })
    expect(second.items[0]?.preview).toBe('下一页')
    expect(second.hasMore).toBe(false)
    expect(read.mock.calls.filter(([, params]) => (params as any).source === 'chat')).toHaveLength(2)
  })

  it('reports unavailable recording coverage as recording, not an unknown audio activity kind', async () => {
    const read = vi.fn<typeof callArkme>(async (_operation, params) => {
      if ((params as any).source === 'audio') throw new Error('upstream unavailable')
      return { data: { items: [], has_more: false } }
    })
    const page = await createDocumentedDayActivityReader(query.accountScope, read).loadDay(query, options())
    expect(page.completeness).toBe('partial')
    expect(page.missingKinds).toEqual(['recording'])
    expect(page.warnings).toHaveLength(1)
  })

  it('reads the real Chat payload, keeps separate people separate, and expands every grouped message', async () => {
    const row = (id: string, uid: string, name: string, at: number) => ({ entry_id: id, occurred_at: at, source_kind: 'private_chat',
      source_ref: { chat_session_uid: uid }, source_item: { sourceRef: `sealed:${uid}`, sourceKey: uid, kind: 'private_chat', displayName: name },
      relation_flags: ['received'], relation: { display_name_snapshot: name }, record: { status: 1, payload: { text_content: `正文${id}` } } })
    const read = vi.fn<typeof callArkme>(async (_op, params) => ({ items: (params as any).source === 'chat'
      ? [row('a', 'person-a', '备注甲', start), row('b', 'person-a', '备注甲', start + 60_000), row('c', 'person-b', '备注乙', start)] : [], has_more: false }))
    const reader = createDocumentedDayActivityReader(query.accountScope, read), page = await reader.loadDay(query, options())
    expect(page.items).toHaveLength(2)
    expect(page.items.find(item => item.id === 'chat:b')).toMatchObject({ recordCount: 2, preview: '正文b', participant: { name: '备注甲' } })
    const detail = await reader.loadDetail(query, 'chat:b', { ...options(), snapshotId: page.snapshotId })
    expect(detail.items.map(item => item.text)).toEqual(['正文a', '正文b'])
    expect(reader.resolveTarget(detail.sourceRef!)?.kind).toBe('source')
  })

  it('does not navigate with raw chat UIDs or truncate expanded messages to the preview length', async () => {
    const body = '详细正文'.repeat(100)
    const read = vi.fn<typeof callArkme>(async (_op, params) => ({ items: (params as any).source === 'chat'
      ? [{ entry_id: 'raw', source_kind: 'private_chat', occurred_at: start, source_ref: { chat_session_uid: 'not-a-capability' }, record: { payload: { text_content: body } } }] : [], has_more: false }))
    const reader = createDocumentedDayActivityReader(query.accountScope, read), page = await reader.loadDay(query, options())
    expect(page.items[0]?.preview).toHaveLength(240)
    const detail = await reader.loadDetail(query, 'chat:raw', { ...options(), snapshotId: page.snapshotId })
    expect(detail.items[0]?.text).toBe(body)
    expect(detail.sourceRef).toBeUndefined()
  })

  it('reads only requested sources and preserves an explicit partial-coverage warning', async () => {
    const read = vi.fn<typeof callArkme>(async () => ({ items: [], has_more: false, coverage: { status: 'partial', uncovered_sources: ['legacy'] } }))
    const filtered = { ...query, kind: 'recording' as const }
    const page = await createDocumentedDayActivityReader(query.accountScope, read).loadDay(filtered, options())
    expect(read.mock.calls.map(([, params]) => (params as any).source)).toEqual(['audio'])
    expect(page.completeness).toBe('partial')
    expect(page.missingKinds).toEqual(['recording'])
  })

  it('accumulates recording coverage pages and fetches transcripts only for the expanded recording', async () => {
    const recording_id = '0123456789abcdef01234567'
    const read = vi.fn<typeof callArkme>(async (_op, params) => {
      const { mode, body } = params as any
      if (mode === 'transcripts') return { items: [{ entry_id: 'speech', occurred_at: start, text: '转写正文', speaker: { label: '张三' } }], has_more: false }
      return { items: [{ recording_id, start_at: start + (body.cursor ? 60_000 : 0), end_at: start + (body.cursor ? 120_000 : 60_000) }], has_more: !body.cursor, ...(!body.cursor ? { next_cursor: 'next' } : {}) }
    })
    const reader = createDocumentedDayActivityReader(query.accountScope, read), filtered = { ...query, kind: 'recording' as const }
    const first = await reader.loadDay(filtered, options())
    const second = await reader.loadDay(filtered, { ...options(), snapshotId: first.snapshotId, cursor: first.nextCursor! })
    expect(second.coverage?.intervals).toHaveLength(2)
    expect(read).toHaveBeenCalledTimes(2)
    const detail = await reader.loadDetail(filtered, first.items[0]!.id, { ...options(), snapshotId: first.snapshotId })
    expect((read.mock.calls.at(-1)?.[1] as any).body.recording_id).toBe(recording_id)
    expect(detail.items[0]).toMatchObject({ text: '转写正文', author: { name: '张三' } })
  })

  it('keeps record cursors paired and reports repeated cursors rather than looping', async () => {
    const read = vi.fn<typeof callArkme>(async () => ({ items: [], has_more: true, next_cursor_send_at: start, next_cursor_record_uid: 'tail' }))
    const reader = createDocumentedDayActivityReader(query.accountScope, read), filtered = { ...query, kind: 'note' as const }
    const first = await reader.loadDay(filtered, options())
    const second = await reader.loadDay(filtered, { ...options(), snapshotId: first.snapshotId, cursor: first.nextCursor! })
    expect((read.mock.calls.at(-1)?.[1] as any).body).toMatchObject({ cursor_send_at: start, cursor_record_uid: 'tail' })
    expect(second.hasMore).toBe(false)
    expect(second.warnings?.length).toBeGreaterThan(0)
  })

  it('honors a location access revocation instead of casting the response envelope to coordinates', async () => {
    const read = vi.fn<typeof callArkme>(async (op, params) => op === 'calendar.record-location'
      ? { recordUid: 'mine', access: 'restricted' }
      : { items: (params as any).source === 'record' ? [{ occurred_at: start, record_projection: { recordUid: 'mine', accessState: 'available', locationRef: 'signed', textContent: '记录' } }] : [], has_more: false })
    const reader = createDocumentedDayActivityReader(query.accountScope, read), page = await reader.loadDay(query, options())
    expect(await reader.loadLocation!(query, 'note:mine', { ...options(), snapshotId: page.snapshotId })).toMatchObject({ access: 'restricted' })
  })

  it('deduplicates only an explicit own-record link in the same conversation', async () => {
    const source = { sourceRef: 'sealed', sourceKey: 'chat:1', kind: 'private_chat', displayName: '备注名' }
    const read = vi.fn<typeof callArkme>(async (_op, params) => ({ items: (params as any).source === 'record'
      ? [{ occurred_at: start, record_projection: { recordUid: 'mine', accessState: 'available', textContent: '记录', source } }]
      : (params as any).source === 'chat' ? [
        { entry_id: 'same', source_kind: 'private_chat', occurred_at: start, source_item: source, source_ref: { record_uid: 'mine' }, relation_flags: ['sent'], text: '记录' },
        { entry_id: 'other', source_kind: 'private_chat', occurred_at: start, source_item: { ...source, sourceKey: 'chat:2' }, source_ref: { record_uid: 'mine' }, relation_flags: ['sent'], text: '记录' },
      ] : [], has_more: false }))
    const page = await createDocumentedDayActivityReader(query.accountScope, read).loadDay(query, options())
    expect(page.items.map(item => item.id).sort()).toEqual(['chat:other', 'chat:same'])
  })
})
