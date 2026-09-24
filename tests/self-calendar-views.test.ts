import { describe, expect, it, vi } from 'vitest'
import { CalendarService } from '../src/services/calendar-service.js'
import { ArkmePluginError, ServiceRuntime } from '../src/services/service.js'

const timezone = 'Asia/Shanghai'
const day = '2026-09-16'
const context = { timezone, belong_date_policy: { kind: 1, smart_continuity_millis: 123 } }
const query = { sourceRef: 'all', startDate: '2026-09-01', endDate: '2026-09-30', timezone }
const row = (uid: string, at: number, extra = {}) => ({ record_uid: uid, send_at: at,
  record_core: { record_uid: uid, send_at: at, content_access_state: 1, text_content: uid }, ...extra })
const summary = (extra = {}) => ({ bucket_date: day, count: 3, has_records: true, protected_count: 0,
  first_record_uid: 'newest', first_send_at: 300, ...extra })
function fixture() {
  const runtime = {
    config: { selfCalendarViewsEnabled: true },
    calendarReadRevision: vi.fn(() => '0'),
    requireSession: vi.fn(async () => ({ userId: 42 })),
    authenticatedPost: vi.fn(),
    authenticatedCalendarPost: vi.fn(async () => ({ ...context, daily_data: [summary()] })),
  }
  const source = {
    openSourceRef: vi.fn(async ref => ({ kind: ref === 'all' ? 'send_to_self' : ref === 'uncategorized' ? 'default_category'
      : ref === 'chat' ? 'private_chat' : 'topic', ownerRef: ref })),
    topicSubtreeSources: vi.fn(),
    searchTargetSource: vi.fn(async () => undefined),
    chatSourcesBySessionUids: vi.fn(async () => new Map()),
    hydrateDirectoryPage: vi.fn(async () => []),
  }
  const privacy = { lockedRecordUids: vi.fn(async () => new Set()) }
  const media = { hydrateRecordMediaPage: vi.fn(async () => ({ displayItemsByRecordUid: new Map(), unavailableRecordUids: new Set() })) }
  const record = { recordTimelineItemFromRaw: vi.fn(() => ({ textContent: '历史内容', senderAvatarUrl: 'historical-avatar' })) }
  const service = new CalendarService(runtime as never, privacy as never, media as never, record as never, source as never)
  return { runtime, service, source, privacy, media, record }
}

describe('server-owned self calendar views', () => {
  it.each([
    ['all', 'send_to_self', { bucket_scope_kind: 1, view_scope_kind: 1 }],
    ['uncategorized', 'uncategorized', { bucket_scope_kind: 1, view_scope_kind: 2 }],
    ['topic-root', 'topic', { bucket_scope_kind: 2, bucket_scope_uid: 'topic-root', view_scope_kind: 3, include_descendants: true }],
  ])('queries %s in one request without record scans or client subtree enumeration', async (sourceRef, kind, scope) => {
    const { runtime, service, source, privacy, media } = fixture()
    const result = await service.bucketPage({ ...query, sourceRef: sourceRef as string, background: true })
    expect(result.scope).toBe(kind)
    expect(result.days).toEqual([{ bucketDate: day, count: 3, hasRecords: true, protectedCount: 0 }])
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledExactlyOnceWith('/api/v1/calendar/buckets/query', {
      ...scope as object, start_date: query.startDate, end_date: query.endDate, timezone, belong_date_policy: { kind: 1 },
    }, { userId: 42 }, expect.any(AbortSignal), expect.objectContaining({ lane: 'background-read', cacheMs: 0 }))
    expect(source.topicSubtreeSources).not.toHaveBeenCalled()
    expect(runtime.authenticatedPost).not.toHaveBeenCalled()
    expect(privacy.lockedRecordUids).not.toHaveBeenCalled()
    expect(media.hydrateRecordMediaPage).not.toHaveBeenCalled()
  })

  it('keeps scopes, accounts, months and invalidations isolated and shares concurrent reads', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockResolvedValue({ ...context, daily_data: [] })
    await Promise.all([service.bucketPage(query), service.bucketPage(query)])
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(1)
    await service.bucketPage({ ...query, sourceRef: 'uncategorized' })
    await service.bucketPage({ ...query, startDate: '2026-08-01', endDate: '2026-08-31' })
    await service.bucketPage(query)
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(3)
    runtime.calendarReadRevision.mockReturnValue('1')
    await service.bucketPage(query)
    runtime.requireSession.mockResolvedValue({ userId: 43 })
    await service.bucketPage(query)
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(5)
  })

  it('retains backend-admitted chat-origin home records and the shared historical rendering projection', async () => {
    const { service, runtime, record } = fixture()
    runtime.authenticatedCalendarPost.mockResolvedValue({ ...context, items: [row('home-chat-origin', 100,
      { chat_core: { chat_session_uid: 'original-chat' }, is_uncategorized: false })], has_more: true,
    next_cursor_send_at: 100, next_cursor_record_uid: 'home-chat-origin' } as never)
    const result = await service.dayRecords({ sourceRef: 'all', bucketDate: day, timezone, limit: 1, oldestFirst: true })
    expect(result.items[0]).toMatchObject({ recordUid: 'home-chat-origin', sourceKind: 'chat', content: { senderAvatarUrl: 'historical-avatar' } })
    expect(record.recordTimelineItemFromRaw).toHaveBeenCalledTimes(1)
    const body = runtime.authenticatedCalendarPost.mock.calls[0]![1] as object
    expect(body).toEqual({ bucket_scope_kind: 1, view_scope_kind: 1, bucket_date: day, timezone,
      belong_date_policy: { kind: 1 }, limit: 1, oldest_first: true })
    expect(result.nextCursor).toEqual({ sendAtMillis: 100, recordUid: 'home-chat-origin' })
  })

  it.each([false, true])('preserves stable backend cursor pairs and ordering, oldestFirst=%s', async oldestFirst => {
    const { service, runtime } = fixture()
    const items = oldestFirst ? [row('b', 100), row('c', 100)] : [row('b', 100), row('a', 100)]
    const last = items[1]!
    runtime.authenticatedCalendarPost.mockResolvedValue({ ...context, items, has_more: true,
      next_cursor_send_at: last.send_at, next_cursor_record_uid: last.record_uid } as never)
    const result = await service.dayRecords({ sourceRef: 'topic-root', bucketDate: day, timezone, limit: 2, oldestFirst,
      cursor: { sendAtMillis: 100, recordUid: oldestFirst ? 'a' : 'c' } })
    expect(result.items.map(item => item.recordUid)).toEqual(items.map(item => item.record_uid))
    expect(runtime.authenticatedCalendarPost.mock.calls[0]![1]).toMatchObject({ include_descendants: true, oldest_first: oldestFirst,
      cursor_send_at: 100, cursor_record_uid: oldestFirst ? 'a' : 'c' })
  })

  it.each([
    {}, { daily_data: null }, { daily_data: [summary({ count: -1 })] },
    { daily_data: [summary({ has_records: false })] }, { daily_data: [summary({ protected_count: 1 })] },
    { daily_data: [summary(), summary()] }, { daily_data: [summary({ bucket_date: '2026-08-31' })] },
    { daily_data: [summary({ bucket_date: '2026-09-31' })] },
    { daily_data: [], timezone: 'UTC' }, { daily_data: [], belong_date_policy: { kind: 2 } },
  ])('rejects incomplete/inconsistent month responses, not zero counts: %j', async response => {
    const { service, runtime } = fixture()
    runtime.authenticatedCalendarPost.mockResolvedValue({ ...context, ...response } as never)
    await expect(service.bucketPage(query)).rejects.toMatchObject({ code: 'calendar-view-invalid' })
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(1)
  })

  it.each([
    {}, { items: [], has_more: true }, { items: [row('a', 100)], has_more: true },
    { items: [row('a', 100), row('a', 100)], has_more: false },
    { items: [row('a', 100), row('b', 200)], has_more: false },
    { items: [row('a', 100, { record_core: { content_access_state: 2 } })], has_more: false },
    { items: [], has_more: false, next_cursor_send_at: 100 },
  ])('rejects malformed day pagination or protected rows: %j', async response => {
    const { service, runtime, media } = fixture()
    runtime.authenticatedCalendarPost.mockResolvedValue({ ...context, ...response } as never)
    await expect(service.dayRecords({ sourceRef: 'all', bucketDate: day, timezone })).rejects.toMatchObject({ code: 'calendar-view-invalid' })
    expect(media.hydrateRecordMediaPage).not.toHaveBeenCalled()
  })

  it.each(['arkme-code-40001', 'arkme-code-50001'])('never falls back or loops on %s', async code => {
    const { service, runtime } = fixture()
    runtime.authenticatedCalendarPost.mockRejectedValue(new ArkmePluginError(code, 'range changed', true, 502))
    await expect(service.bucketPage(query)).rejects.toMatchObject({ code })
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed cursors and wrong sources before requesting records', async () => {
    const { service, runtime } = fixture()
    await expect(service.dayRecords({ sourceRef: 'all', bucketDate: day, cursor: { sendAtMillis: 100, recordUid: '' } }))
      .rejects.toMatchObject({ code: 'calendar-cursor-invalid' })
    await expect(service.bucketPage({ ...query, sourceRef: 'chat' })).rejects.toMatchObject({ code: 'calendar-source-invalid' })
    await expect(service.dayRecords({ bucketDate: day, oldestFirst: true })).rejects.toMatchObject({ code: 'calendar-order-unsupported' })
    expect(runtime.authenticatedCalendarPost).not.toHaveBeenCalled()
  })

  it.each([200, 40001, 50001])('rejects HTTP 200 with business code %s without retrying a different contract', async code => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: 'not ready', data: context })))
    const runtime = new ServiceRuntime({ recordBaseUrl: 'https://record.test', requestTimeoutMs: 1000 } as never,
      { read: async () => ({ userId: 42, accessToken: 'test', refreshToken: 'test' }) } as never, {} as never, fetcher)
    await expect(runtime.authenticatedCalendarPost('/api/v1/calendar/buckets/query', { view_scope_kind: 1 },
      { userId: 42, accessToken: 'test', refreshToken: 'test' })).rejects.toMatchObject({ code: `arkme-code-${code}` })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
