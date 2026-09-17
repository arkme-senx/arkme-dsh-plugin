import { describe, expect, it, vi } from 'vitest'
import { CalendarService } from '../src/services/calendar-service.js'

const day = '2026-09-16'
const raw = (uid: string, at: number, extra: Record<string, unknown> = {}) => ({
  record_uid: uid, send_at: at,
  record_core: { record_uid: uid, send_at: at, content_access_state: 1, text_content: uid }, ...extra,
})

function fixture() {
  const runtime = {
    calendarReadRevision: vi.fn(() => '0'),
    requireSession: vi.fn(async () => ({ userId: 42 })),
    authenticatedPost: vi.fn(async (_path: string, body: { topic_uid: string }) => ({ topic_core: {
      topic_uid: body.topic_uid, kind: 1, privacy_state: body.topic_uid === 'locked-topic' ? 2 : 1, show_in_home: true,
    } })),
    authenticatedCalendarPost: vi.fn(),
  }
  const source = {
    openSourceRef: vi.fn(async (ref: string) => ({
      kind: ref === 'all' ? 'send_to_self' : ref === 'uncategorized' ? 'default_category' : ref === 'chat' ? 'private_chat' : 'topic', ownerRef: ref,
    })),
    topicSubtreeSources: vi.fn(async () => ['parent', 'child', 'locked-topic'].map(sourceRef => ({ sourceRef }))),
    searchTargetSource: vi.fn(async () => undefined),
    chatSourcesBySessionUids: vi.fn(async () => new Map()),
    hydrateDirectoryPage: vi.fn(async () => []),
  }
  const media = { hydrateRecordMediaPage: vi.fn(async () => ({ displayItemsByRecordUid: new Map(), unavailableRecordUids: new Set() })) }
  const record = { recordTimelineItemFromRaw: vi.fn(() => ({ textContent: '正文' })), isDSHAgentInput: (item: unknown) => Boolean((item as { agent?: boolean }).agent) }
  const privacy = { lockedRecordUids: vi.fn(async () => new Set(['locked-record'])) }
  const service = new CalendarService(runtime as never, privacy as never, media as never, record as never, source as never)
  return { runtime, source, media, service }
}

describe('topic scoped calendar', () => {
  it('caches completed multi-query results, isolates months, and refreshes changed revisions', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockResolvedValue({ daily_data: [] })
    const options = { sourceRef: 'all', startDate: '2026-09-01', endDate: '2026-09-30', timezone: 'Asia/Shanghai' }
    const august = { ...options, startDate: '2026-08-01', endDate: '2026-08-31' }
    await service.bucketPage(options); await service.bucketPage(august); await service.bucketPage(options)
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(2)
    runtime.calendarReadRevision.mockImplementation((_scope, start) => start.startsWith('2026-09') ? '1' : '0')
    await service.bucketPage(august); await service.bucketPage(options)
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(3)
    service.dispose(); await service.bucketPage(options)
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(4)
  })

  it('shares an in-flight composite read and schedules prefetch requests in the background lane', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockImplementation(async path => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 1 }] }
      : { items: [raw('personal', 200, { is_uncategorized: true })], has_more: false })
    const options = { sourceRef: 'all', startDate: day, endDate: day, background: true }
    const [first, second] = await Promise.all([service.bucketPage(options), service.bucketPage(options)])
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(2)
    expect(runtime.authenticatedCalendarPost.mock.calls.every(call => call[4].lane === 'background-read')).toBe(true)
    first.days[0]!.count = 999
    expect(second.days[0]?.count).toBe(1)
    expect((await service.bucketPage(options)).days[0]?.count).toBe(1)
  })

  it('merges parent and visible descendants, deduplicates counts, and keeps cache scopes separate', async () => {
    const { runtime, media, service } = fixture()
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 2 }] }
      : { items: [raw('shared', 300), raw(body.bucket_scope_uid, 200)], has_more: false })
    const page = await service.bucketPage({ sourceRef: 'parent', startDate: '2026-09-01', endDate: '2026-09-30' })
    expect(page.scope).toBe('topic')
    expect(page.days).toEqual([{ bucketDate: day, count: 3, protectedCount: 0, hasRecords: true, firstSendAtMillis: 200 }])
    expect(runtime.authenticatedCalendarPost.mock.calls.every(([, body]) => body.bucket_scope_kind === 2 && ['parent', 'child'].includes(body.bucket_scope_uid))).toBe(true)
    expect(runtime.authenticatedCalendarPost.mock.calls.map(call => call[4].key)).toEqual(expect.arrayContaining([
      expect.stringContaining('buckets:topic:parent:'), expect.stringContaining('buckets:topic:child:'),
    ]))
    expect(media.hydrateRecordMediaPage).not.toHaveBeenCalled()
  })

  it('merges day streams with a stable continuation cursor and excludes locked records', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockImplementation(async (_path, body) => ({
      items: body.bucket_scope_uid === 'parent' ? [raw('shared', 300), raw('parent', 200), raw('locked-record', 150)]
        : [raw('shared', 300), raw('child', 100)], has_more: false,
    }))
    const result = await service.dayRecords({ sourceRef: 'parent', bucketDate: day, limit: 2 })
    expect(result.items.map(item => item.recordUid)).toEqual(['shared', 'parent'])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual({ sendAtMillis: 200, recordUid: 'parent' })
    await service.dayRecords({ sourceRef: 'parent', bucketDate: day, limit: 2, cursor: result.nextCursor })
    expect(runtime.authenticatedCalendarPost.mock.calls.slice(-2).every(([, body]) => body.cursor_send_at === 200 && body.cursor_record_uid === 'parent')).toBe(true)
  })

  it('counts only uncategorized non-agent records and backfills filtered pages', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 7 }] }
      : body.cursor_record_uid ? { items: [raw('uncategorized', 100, { is_uncategorized: true })], has_more: false }
        : { items: [raw('classified', 400), raw('agent', 300, { creation_source: 3, is_uncategorized: true }), raw('locked-record', 200, { is_uncategorized: true })],
          has_more: true, next_cursor_send_at: 200, next_cursor_record_uid: 'locked-record' })
    const buckets = await service.bucketPage({ sourceRef: 'uncategorized', startDate: day, endDate: day })
    expect(buckets.days[0]?.count).toBe(1)
    const records = await service.dayRecords({ sourceRef: 'uncategorized', bucketDate: day, limit: 1 })
    expect(records.items.map(item => item.recordUid)).toEqual(['uncategorized'])
    expect(records.hasMore).toBe(false)
  })

  it('fails closed for locked or non-self sources and stalled cursors', async () => {
    const { runtime, service } = fixture()
    await expect(service.dayRecords({ sourceRef: 'locked-topic', bucketDate: day })).rejects.toMatchObject({ code: 'topic-privacy-locked' })
    await expect(service.dayRecords({ sourceRef: 'chat', bucketDate: day })).rejects.toMatchObject({ code: 'calendar-source-invalid' })
    expect(runtime.authenticatedCalendarPost).not.toHaveBeenCalled()
    runtime.authenticatedCalendarPost.mockResolvedValue({ items: [], has_more: true, next_cursor_send_at: 100, next_cursor_record_uid: 'stuck' })
    await expect(service.dayRecords({ sourceRef: 'uncategorized', bucketDate: day })).rejects.toMatchObject({ code: 'calendar-cursor-invalid' })
  })

  it('keeps DSH/chat in the global calendar but excludes them from personal counts and records', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 5 }] }
      : { items: [
        raw('dsh', 500, { creation_source: '3', is_uncategorized: true }),
        raw('system-topic', 400, { topic_core: { topic_uid: 'dsh', kind: 3, title: 'DSH Agent Input' } }),
        raw('chat', 300, { chat_core: { chat_session_uid: 'chat' } }),
        raw('personal', 200, { is_uncategorized: true }),
        raw('ordinary-topic', 100, { topic_core: { topic_uid: 'ordinary', kind: 1, title: 'DSH Agent Input' } }),
      ].filter(item => !body.cursor_send_at || item.send_at < body.cursor_send_at), has_more: false })
    const global = await service.dayRecords({ bucketDate: day })
    expect(global.items.map(item => item.recordUid)).toEqual(['dsh', 'system-topic', 'chat', 'personal', 'ordinary-topic'])
    expect(global.items[0]?.creationSource).toBe(3)
    const own = await service.dayRecords({ sourceRef: 'all', bucketDate: day, limit: 1 })
    expect(own.scope).toBe('send_to_self')
    expect(own.items.map(item => item.recordUid)).toEqual(['personal'])
    expect(own.hasMore).toBe(true)
    const next = await service.dayRecords({ sourceRef: 'all', bucketDate: day, limit: 1, cursor: own.nextCursor })
    expect(next.items.map(item => item.recordUid)).toEqual(['ordinary-topic'])
    expect(next.hasMore).toBe(false)
    const allCounts = await service.bucketPage({ startDate: day, endDate: day })
    const ownCounts = await service.bucketPage({ sourceRef: 'all', startDate: day, endDate: day })
    expect(allCounts.days[0]?.count).toBe(5)
    expect(ownCounts.days[0]?.count).toBe(2)
  })

  it('filters DSH from a single-topic count as well as its day records', async () => {
    const { runtime, service, source } = fixture()
    source.topicSubtreeSources.mockResolvedValue([{ sourceRef: 'parent' }])
    runtime.authenticatedCalendarPost.mockImplementation(async path => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 2 }] }
      : { items: [raw('dsh', 300, { creationSource: 3 }), raw('personal', 200)], has_more: false })
    expect((await service.bucketPage({ sourceRef: 'parent', startDate: day, endDate: day })).days[0]?.count).toBe(1)
    expect((await service.dayRecords({ sourceRef: 'parent', bucketDate: day })).items.map(item => item.recordUid)).toEqual(['personal'])
  })
})
