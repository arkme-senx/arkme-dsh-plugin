import { describe, expect, it, vi } from 'vitest'
import { CalendarMonthCache, type CalendarMonthQuery } from '../src/client/calendar-month-cache.js'
import type { ArkmeCalendarBucketPage } from '../src/types.js'

const query = (month = '09', scopeKey = 'send_to_self'): CalendarMonthQuery => ({
  scopeKey, sourceRef: scopeKey, startDate: `2026-${month}-01`, endDate: `2026-${month}-${month === '09' ? '30' : '31'}`, timezone: 'Asia/Shanghai',
})
const page = (q: CalendarMonthQuery, count = 4): ArkmeCalendarBucketPage => ({
  scope: 'send_to_self', startDate: q.startDate, endDate: q.endDate, timezone: q.timezone, refreshedAtMillis: Date.now(),
  days: [{ bucketDate: q.startDate, count, protectedCount: 0, hasRecords: count > 0 }],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}
function disk() {
  const values = new Map<string, string>()
  return { values, storage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } as Storage }
}

describe('shared calendar month cache', () => {
  it.each(['calendar-view-invalid', 'arkme-code-40001', 'arkme-code-50001'])('drops unsafe stale summaries and anchors after %s', async code => {
    let now = 100_000
    const { storage } = disk()
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => storage, () => now)
    cache.activateAccount('a'); await cache.ensure('a', query())
    now += 61_000
    load.mockRejectedValueOnce(Object.assign(new Error('需要重新加载'), { body: { code } }))
    await cache.ensure('a', query())
    expect(cache.get('a', query())).toEqual({ loading: false, error: '需要重新加载' })
    const restored = new CalendarMonthCache(load, () => storage, () => now)
    restored.activateAccount('a')
    expect(restored.get('a', query()).value).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not restore summaries from the old client-counted calendar contract', () => {
    const { storage } = disk()
    storage.setItem('dsh-arkme:calendar-months:v1:a', JSON.stringify([{
      key: JSON.stringify(['send_to_self', 'Asia/Shanghai', '2026-09-01', '2026-09-30']),
      value: page(query(), 999), refreshed: Date.now(),
    }]))
    const cache = new CalendarMonthCache(async q => page(q), () => storage)
    cache.activateAccount('a')
    expect(cache.get('a', query()).value).toBeUndefined()
  })

  it('persists full chat date summaries and precise owner anchors without message bodies', async () => {
    const { storage, values } = disk()
    const q = { ...query(), scopeKey: 'chat:a', startDate: '0001-01-01', endDate: '9999-12-31', timezoneOffsetMillis: 28800000 }
    const value: ArkmeCalendarBucketPage = { ...page(q), scope: 'private_chat', totalDayCount: 1,
      days: [{ bucketDate: '2020-01-02', count: 9, protectedCount: 0, hasRecords: true,
        anchor: { recordUid: 'old', recordOwnerUserId: '9223372036854775806', sendAtMillis: 123 } }] }
    const cache = new CalendarMonthCache(async () => ({ ...value, text: 'private-message-body' }), () => storage)
    cache.activateAccount('a'); await cache.ensure('a', q)
    const restored = new CalendarMonthCache(async () => value, () => storage)
    restored.activateAccount('a')
    expect(restored.get('a', q).value).toMatchObject(value)
    expect([...values.values()].join('')).not.toContain('private-message-body')
    expect(restored.get('a', { ...q, timezoneOffsetMillis: 0 }).value).toBeUndefined()
    restored.activateAccount('b')
    expect(restored.get('b', q).value).toBeUndefined()
  })
  it('reuses multiple months on switching, closing and remounting without another request', async () => {
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => undefined)
    const close = cache.subscribe('a', query(), vi.fn())
    await cache.ensure('a', query()); close()
    await cache.ensure('a', query('08'))
    const reopen = cache.subscribe('a', query(), vi.fn())
    await cache.ensure('a', query())
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.get('a', query()).value?.days[0]?.count).toBe(4)
    reopen()
  })

  it('deduplicates requests, including foreground joining a prefetch', async () => {
    const pending = deferred<ArkmeCalendarBucketPage>()
    const load = vi.fn(() => pending.promise)
    const cache = new CalendarMonthCache(load, () => undefined)
    cache.activateAccount('a')
    const first = cache.ensure('a', query(), true)
    const second = cache.ensure('a', query())
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]?.[2]).toBe(true)
    pending.resolve(page(query()))
    await Promise.all([first, second])
  })

  it('shows disk summaries immediately after reload while revalidating in the background', async () => {
    const { storage, values } = disk()
    const original = new CalendarMonthCache(async q => ({ ...page(q), secretBody: 'must not persist' }), () => storage)
    original.activateAccount('a'); await original.ensure('a', query())
    expect([...values.values()].join('')).not.toContain('must not persist')
    const pending = deferred<ArkmeCalendarBucketPage>()
    const restored = new CalendarMonthCache(() => pending.promise, () => storage)
    restored.activateAccount('a')
    expect(restored.get('a', query()).value?.days[0]?.count).toBe(4)
    const refresh = restored.ensure('a', query())
    expect(restored.get('a', query())).toMatchObject({ loading: true, value: { days: [{ count: 4 }] } })
    pending.resolve(page(query(), 5)); await refresh
    expect(restored.get('a', query()).value?.days[0]?.count).toBe(5)
  })

  it('retains cached numbers if background refresh fails', async () => {
    let now = 100_000
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => undefined, () => now)
    cache.activateAccount('a'); await cache.ensure('a', query())
    now += 61_000; load.mockRejectedValueOnce(new Error('offline'))
    await cache.ensure('a', query())
    expect(cache.get('a', query())).toMatchObject({ loading: false, error: 'offline', value: { days: [{ count: 4 }] } })
  })

  it('invalidates only the affected month and keeps old values during a soft refresh', async () => {
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => undefined)
    cache.subscribe('a', query(), () => { cache.get('a', query()) })
    await cache.ensure('a', query()); await cache.ensure('a', query('08'))
    cache.invalidate({ dates: ['2026-07-01'], hard: false })
    expect(load).toHaveBeenCalledTimes(2)
    const pending = deferred<ArkmeCalendarBucketPage>()
    load.mockImplementationOnce(() => pending.promise)
    cache.invalidate({ dates: ['2026-09-02'], hard: false })
    expect(cache.get('a', query())).toMatchObject({ loading: true, value: { days: [{ count: 4 }] } })
    await cache.ensure('a', query('08'))
    expect(load).toHaveBeenCalledTimes(3)
    pending.resolve(page(query(), 7)); await cache.ensure('a', query())
    expect(cache.get('a', query()).value?.days[0]?.count).toBe(7)
  })

  it('clears private summaries immediately and rejects late pre-invalidation responses', async () => {
    const { storage } = disk()
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => storage)
    cache.subscribe('a', query(), vi.fn()); await cache.ensure('a', query())
    const old = deferred<ArkmeCalendarBucketPage>(), current = deferred<ArkmeCalendarBucketPage>()
    load.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    cache.invalidate({ hard: false }); await Promise.resolve()
    cache.invalidate({ hard: true }); await Promise.resolve()
    expect(cache.get('a', query()).value).toBeUndefined()
    const restored = new CalendarMonthCache(load, () => storage); restored.activateAccount('a')
    expect(restored.get('a', query()).value).toBeUndefined()
    old.resolve(page(query(), 99)); await Promise.resolve(); await Promise.resolve()
    expect(cache.get('a', query()).value).toBeUndefined()
    current.resolve(page(query(), 2)); await cache.ensure('a', query())
    expect(cache.get('a', query()).value?.days[0]?.count).toBe(2)
  })

  it('isolates topics and timezones and removes the old account on logout', async () => {
    const { storage, values } = disk()
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => storage)
    cache.activateAccount('a'); await cache.ensure('a', query())
    await cache.ensure('a', query('09', 'topic-one'))
    await cache.ensure('a', { ...query(), timezone: 'UTC' })
    expect(load).toHaveBeenCalledTimes(3)
    const late = deferred<ArkmeCalendarBucketPage>(); load.mockImplementationOnce(() => late.promise)
    const pending = cache.ensure('a', query('08')); await Promise.resolve()
    const signal = load.mock.calls.at(-1)?.[1] as AbortSignal
    cache.activateAccount(undefined)
    expect(signal.aborted).toBe(true); expect(values.size).toBe(0)
    cache.activateAccount('b'); late.resolve(page(query('08'))); await pending
    expect(cache.get('b', query('08')).value).toBeUndefined()
    expect(cache.get('a', query()).value).toBeUndefined()
  })

  it('aborts abandoned loads, tolerates unavailable storage, and retries next opening', async () => {
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => { throw new Error('blocked') })
    const close = cache.subscribe('a', query(), vi.fn())
    const pending = cache.ensure('a', query()); close(); await pending
    expect(cache.get('a', query()).value).toBeUndefined()
    cache.subscribe('a', query(), vi.fn()); await cache.ensure('a', query())
    expect(cache.get('a', query()).value?.days[0]?.count).toBe(4)
  })

  it('drops a cached topic when its permission check fails, rather than showing old counts', async () => {
    const { storage } = disk()
    let now = 100_000
    const load = vi.fn(async q => page(q))
    const cache = new CalendarMonthCache(load, () => storage, () => now)
    cache.activateAccount('a'); await cache.ensure('a', query())
    now += 61_000
    load.mockRejectedValueOnce(Object.assign(new Error('主题已锁定'), { body: { code: 'topic-privacy-locked' } }))
    await cache.ensure('a', query())
    expect(cache.get('a', query()).value).toBeUndefined()
    const restored = new CalendarMonthCache(load, () => storage, () => now); restored.activateAccount('a')
    expect(restored.get('a', query()).value).toBeUndefined()
  })

  it('bounds persistent summaries and ignores expired snapshots', async () => {
    const { storage, values } = disk()
    let now = 100_000
    const cache = new CalendarMonthCache(async q => page(q), () => storage, () => now)
    cache.activateAccount('a')
    for (let index = 0; index < 55; index++) await cache.ensure('a', query('09', `topic-${index}`))
    expect(JSON.parse([...values.values()][0]!)).toHaveLength(48)
    now += 8 * 86_400_000
    const restored = new CalendarMonthCache(async q => page(q), () => storage, () => now); restored.activateAccount('a')
    expect(restored.get('a', query('09', 'topic-54')).value).toBeUndefined()
  })
})
