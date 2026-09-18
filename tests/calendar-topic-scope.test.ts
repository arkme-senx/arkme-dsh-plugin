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
  return { runtime, source, media, privacy, service }
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

  it('rereads only a changed date instead of scanning every date again', async () => {
    const { runtime, service } = fixture()
    const otherDay = '2026-09-15'
    let revision = '0'
    runtime.calendarReadRevision.mockImplementation((_scope, start, end) => start <= day && end >= day ? revision : '0')
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => path.endsWith('buckets/query')
      ? { daily_data: [otherDay, day].map(bucket_date => ({ bucket_date, count: 1 })) }
      : { items: [raw(body.bucket_date, 200, { is_uncategorized: true })], has_more: false })
    const options = { sourceRef: 'all', startDate: otherDay, endDate: day }
    await service.bucketPage(options)
    runtime.authenticatedCalendarPost.mockClear()
    revision = '1'
    const result = await service.bucketPage(options)
    expect(result.days.map(item => item.count)).toEqual([1, 1])
    expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))
      .map(([, body]) => body.bucket_date)).toEqual([day])
  })

  it('retains finished days after a month request is interrupted, without caching partial days', async () => {
    const { runtime, service } = fixture()
    const otherDay = '2026-09-15'
    const controller = new AbortController()
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body, _session, signal) => {
      if (path.endsWith('buckets/query')) return { daily_data: [otherDay, day].filter(date => date <= body.end_date)
        .map(bucket_date => ({ bucket_date, count: 1 })) }
      if (body.bucket_date === day) return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      return { items: [raw('finished', 200, { is_uncategorized: true })], has_more: false }
    })
    const options = { sourceRef: 'all', startDate: otherDay, endDate: day }
    const interrupted = service.bucketPage({ ...options, signal: controller.signal })
    const rejected = expect(interrupted).rejects.toMatchObject({ name: 'AbortError' })
    // A concurrent date-only reader proves the first date completed, rather than
    // relying on a delay to assume its result has entered the shared cache.
    await service.bucketPage({ ...options, endDate: otherDay })
    controller.abort()
    await rejected
    runtime.authenticatedCalendarPost.mockClear()
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => path.endsWith('buckets/query')
      ? { daily_data: [otherDay, day].map(bucket_date => ({ bucket_date, count: 1 })) }
      : { items: [raw(body.bucket_date, 200, { is_uncategorized: true })], has_more: false })
    expect((await service.bucketPage(options)).days.map(item => item.count)).toEqual([1, 1])
    expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))
      .map(([, body]) => body.bucket_date)).toEqual([day])
  })

  it('does not extend daily freshness when an overlapping month reuses a count', async () => {
    let now = 100_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const { runtime, service } = fixture()
      const otherDay = '2026-09-15'
      runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => path.endsWith('buckets/query')
        ? { daily_data: [otherDay, day].filter(date => date <= body.end_date).map(bucket_date => ({ bucket_date, count: 1 })) }
        : { items: [raw(body.bucket_date, 200, { is_uncategorized: true })], has_more: false })
      const options = { sourceRef: 'all', startDate: otherDay, endDate: day }
      await service.bucketPage({ ...options, endDate: otherDay })
      now += 50_000
      await service.bucketPage(options)
      runtime.authenticatedCalendarPost.mockClear()
      now += 10_001
      await service.bucketPage(options)
      expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))
        .map(([, body]) => body.bucket_date)).toEqual([otherDay])
    } finally { clock.mockRestore() }
  })

  it('isolates daily counts by account, personal scope and timezone', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockImplementation(async path => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 2 }] }
      : { items: [raw('own', 200, { is_uncategorized: true }), raw('topic', 100, { topic_core: { topic_uid: 'topic' } })], has_more: false })
    const options = { sourceRef: 'all', startDate: day, endDate: day, timezone: 'UTC' }
    expect((await service.bucketPage(options)).days[0]?.count).toBe(2)
    expect((await service.bucketPage({ ...options, sourceRef: 'uncategorized' })).days[0]?.count).toBe(1)
    await service.bucketPage({ ...options, timezone: 'Asia/Shanghai' })
    runtime.requireSession.mockResolvedValue({ userId: 43 })
    await service.bucketPage(options)
    expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))).toHaveLength(4)
    service.dispose()
    await service.bucketPage(options)
    expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))).toHaveLength(5)
  })

  it('rechecks privacy after an invalidation and never caches failed date reads', async () => {
    const { runtime, privacy, service } = fixture()
    let revision = '0'
    runtime.calendarReadRevision.mockImplementation(() => revision)
    runtime.authenticatedCalendarPost.mockImplementation(async path => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 1 }] }
      : { items: [raw('own', 200, { is_uncategorized: true })], has_more: false })
    const options = { sourceRef: 'all', startDate: day, endDate: day }
    expect((await service.bucketPage(options)).days[0]?.count).toBe(1)
    revision = '1'
    privacy.lockedRecordUids.mockResolvedValue(new Set(['own']))
    expect((await service.bucketPage(options)).days[0]?.count).toBe(0)
    revision = '2'
    runtime.authenticatedCalendarPost.mockImplementation(async path => {
      if (path.endsWith('buckets/query')) return { daily_data: [{ bucket_date: day, count: 1 }] }
      throw new Error('offline')
    })
    await expect(service.bucketPage(options)).rejects.toThrow('offline')
    runtime.authenticatedCalendarPost.mockImplementation(async path => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count: 1 }] } : { items: [], has_more: false })
    expect((await service.bucketPage(options)).days[0]?.count).toBe(0)
  })

  it('reduces a 30-day, 100-record-per-day refresh from 61 calls to 3 for one changed date', async () => {
    const { runtime, service } = fixture()
    const dates = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`)
    let revision = '0'
    runtime.calendarReadRevision.mockImplementation((_scope, start, end) => start <= day && end >= day ? revision : '0')
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => {
      if (path.endsWith('buckets/query')) return { daily_data: dates.map(bucket_date => ({ bucket_date, count: 100 })) }
      const offset = body.cursor_record_uid ? 50 : 0
      return { items: Array.from({ length: 50 }, (_, index) => raw(`${body.bucket_date}:${offset + index}`, 1000 - offset - index, { is_uncategorized: true })),
        has_more: offset === 0, ...(offset === 0 ? { next_cursor_send_at: 951, next_cursor_record_uid: `${body.bucket_date}:49` } : {}) }
    })
    const options = { sourceRef: 'all', startDate: dates[0]!, endDate: dates.at(-1)! }
    expect((await service.bucketPage(options)).days.every(item => item.count === 100)).toBe(true)
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(61)
    runtime.authenticatedCalendarPost.mockClear()
    revision = '1'
    expect((await service.bucketPage(options)).days.every(item => item.count === 100)).toBe(true)
    expect(runtime.authenticatedCalendarPost).toHaveBeenCalledTimes(3)
  })

  it('invalidates a cached day when upstream counts change without a local date event', async () => {
    const { runtime, service } = fixture()
    let count = 1
    runtime.authenticatedCalendarPost.mockImplementation(async path => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: day, count }] }
      : { items: Array.from({ length: count }, (_, index) => raw(`own-${index}`, 200 - index, { is_uncategorized: true })), has_more: false })
    const options = { sourceRef: 'all', startDate: day, endDate: day }
    expect((await service.bucketPage(options)).days[0]?.count).toBe(1)
    count = 2
    expect((await service.bucketPage({ ...options, startDate: '2026-09-01' })).days[0]?.count).toBe(2)
    expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))).toHaveLength(2)
  })

  it('does not let an old in-flight day overwrite its post-invalidation replacement', async () => {
    const { runtime, service } = fixture()
    let revision = '0'
    let releaseOld!: (value: unknown) => void
    let started!: () => void
    const oldStarted = new Promise<void>(resolve => { started = resolve })
    runtime.calendarReadRevision.mockImplementation(() => revision)
    runtime.authenticatedCalendarPost.mockImplementation(async path => {
      if (path.endsWith('buckets/query')) return { daily_data: [{ bucket_date: day, count: 2 }] }
      if (revision === '0') {
        started()
        return await new Promise(resolve => { releaseOld = resolve })
      }
      return { items: [raw('new', 200, { is_uncategorized: true })], has_more: false }
    })
    const options = { sourceRef: 'all', startDate: day, endDate: day }
    const oldRead = service.bucketPage(options)
    await oldStarted
    revision = '1'
    expect((await service.bucketPage(options)).days[0]?.count).toBe(1)
    releaseOld({ items: [raw('old-a', 100, { is_uncategorized: true }), raw('old-b', 90, { is_uncategorized: true })], has_more: false })
    await oldRead
    expect((await service.bucketPage({ ...options, startDate: '2026-09-01' })).days[0]?.count).toBe(1)
    expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))).toHaveLength(2)
  })

  it('bounds daily summaries and evicts the least recently used dates', async () => {
    const { runtime, service } = fixture()
    runtime.authenticatedCalendarPost.mockImplementation(async (path, body) => path.endsWith('buckets/query')
      ? { daily_data: [{ bucket_date: body.start_date, count: 1 }] }
      : { items: [raw('own', 200, { is_uncategorized: true })], has_more: false })
    const queryFor = (index: number) => {
      const date = new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10)
      return { sourceRef: 'all', startDate: date, endDate: date }
    }
    for (let index = 0; index <= 512; index++) await service.bucketPage(queryFor(index))
    runtime.authenticatedCalendarPost.mockClear()
    await service.bucketPage(queryFor(0))
    expect(runtime.authenticatedCalendarPost.mock.calls.filter(([path]) => path.endsWith('records/query'))).toHaveLength(1)
  })
})
