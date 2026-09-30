import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecognizedSpeakerDirectory, SpeakerReadDeferred } from '../src/client/recognized-speaker-directory.js'
import { loaders, page, person, query, summary, deferred } from './helpers/speaker-directory.js'
afterEach(() => { vi.useRealTimers() })
const signal = () => new AbortController().signal

describe('server speaker directory', () => {
  it('shares lightweight summary, reads only the first page, and preserves server ordering', async () => {
    const api = loaders({ list: vi.fn(async () => page({ items: [person('2'), person('1')], hasMore: true, nextCursor: 'next' })) })
    const store = new RecognizedSpeakerDirectory(api)
    await Promise.all([store.summary('a'), store.summary('a')])
    const first = await store.first('a', query, signal())
    expect(api.summary).toHaveBeenCalledTimes(1)
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(first.items.map(row => row.personKey)).toEqual(['2', '1'])
    expect(api.seen).not.toHaveBeenCalled()
  })
  it('keeps exact snapshot and query on pagination and deduplicates boundary items', async () => {
    const api = loaders({ list: vi.fn(async input => input.cursor ? page({ items: [person('1'), person('2')] }) : page({ hasMore: true, nextCursor: 'next' })) })
    const store = new RecognizedSpeakerDirectory(api)
    const first = await store.first('a', query, signal())
    const next = await store.more('a', first, signal())
    expect(api.list).toHaveBeenLastCalledWith({ ...query, limit: 50, snapshotVersion: 'v1', cursor: 'next' }, expect.any(AbortSignal))
    expect(next.items.map(row => row.personKey)).toEqual(['1', '2'])
  })
  it('sends new searches/sorts to the server even when summary says not modified', async () => {
    const api = loaders({ summary: vi.fn(async () => summary({ notModified: true })) })
    const store = new RecognizedSpeakerDirectory(api)
    await store.first('a', query, signal())
    await store.first('a', { ...query, query: '  王  ', sort: 'recent' }, signal())
    expect(api.list).toHaveBeenLastCalledWith({ ...query, query: '王', sort: 'recent', cursor: '', limit: 50, snapshotVersion: 'v1' }, expect.any(AbortSignal))
  })
  it('never acknowledges prefetch, filtered results, unknown snapshots or hidden pages', async () => {
    const api = loaders(), store = new RecognizedSpeakerDirectory(api)
    const first = await store.first('a', query, signal())
    expect(api.seen).not.toHaveBeenCalled()
    for (const list of [{ ...first, query: { ...query, filter: 'marked' as const } }, { ...first, query: { ...query, query: '1' } }, { ...first, coverage: 'unknown' as const }]) await store.confirmDisplayed('a', list)
    expect(api.seen).not.toHaveBeenCalled()
    await store.confirmDisplayed('a', first)
    await store.confirmDisplayed('a', first)
    expect(api.seen).toHaveBeenCalledTimes(1)
    expect(api.seen).toHaveBeenCalledWith('seen-v1', expect.any(AbortSignal))
  })
  it('re-reads authoritative unseen count after seen, preserving newer discoveries', async () => {
    const api = loaders({ summary: vi.fn().mockResolvedValueOnce(summary()).mockResolvedValue(summary({ unseenCount: 1, seenVersion: 2, snapshotVersion: 'v2' })) })
    const store = new RecognizedSpeakerDirectory(api)
    await store.confirmDisplayed('a', await store.first('a', query, signal()))
    expect(store.get('a').summary?.unseenCount).toBe(1)
  })
  it('retains offline confirmation and respects rate-limit delay, including manual refresh', async () => {
    vi.useFakeTimers()
    const api = loaders({ seen: vi.fn().mockRejectedValueOnce({ retryAfterMillis: 45_000 }).mockResolvedValue({ success: true, seenVersion: 2 }) })
    const store = new RecognizedSpeakerDirectory(api)
    const first = await store.first('a', query, signal())
    await expect(store.confirmDisplayed('a', first)).rejects.toBeInstanceOf(SpeakerReadDeferred)
    store.invalidate('a')
    await expect(store.summary('a', true)).rejects.toBeInstanceOf(SpeakerReadDeferred)
    expect(api.summary).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(45_000)
    await store.confirmDisplayed('a', first)
    expect(api.seen).toHaveBeenCalledTimes(2)
  })
  it.each([{ success: false, state: 'snapshot_expired', retryAfterMs: 0 }, new Error('placeholder')])('invalidates expired seen tokens without acknowledging replacement unseen pages', async value => {
    const seen = value instanceof Error ? vi.fn().mockRejectedValue({ code: 'arkme-code-1001' }) : vi.fn().mockResolvedValue(value)
    const api = loaders({ seen }), store = new RecognizedSpeakerDirectory(api)
    const first = await store.first('a', query, signal())
    await store.confirmDisplayed('a', first)
    expect(store.needsReload('a', first)).toBe(true)
    await store.confirmDisplayed('a', first)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(api.list).toHaveBeenCalledTimes(1)
  })
  it('restarts expired pagination with a new version and never appends it to old rows', async () => {
    const api = loaders({
      summary: vi.fn().mockResolvedValueOnce(summary()).mockResolvedValue(summary({ snapshotVersion: 'v2' })),
      list: vi.fn().mockResolvedValueOnce(page({ items: [person('old')], hasMore: true, nextCursor: 'next' }))
        .mockResolvedValueOnce(page({ state: 'snapshot_expired', coverage: 'unknown', items: [] }))
        .mockResolvedValueOnce(page({ items: [person('new')], snapshotVersion: 'v2', throughCursor: 'seen-v2' })),
    })
    const store = new RecognizedSpeakerDirectory(api)
    const result = await store.more('a', await store.first('a', query, signal()), signal())
    expect(result.items.map(row => row.personKey)).toEqual(['new'])
  })
  it('aborts and rejects delayed old-account responses without repopulating caches', async () => {
    const delayed = deferred<ReturnType<typeof page>>()
    const api = loaders({ list: vi.fn(() => delayed.promise) }), store = new RecognizedSpeakerDirectory(api)
    const pending = store.first('a', query, signal())
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(api.list).toHaveBeenCalled())
    store.clear(); delayed.resolve(page())
    await rejected
    expect(store.get('a')).toEqual({})
    expect(store.peek('a', query)).toBeUndefined()
  })
  it('building/null is not zero and disabled stops list and seen requests', async () => {
    for (const state of ['building', 'disabled'] as const) {
      const api = loaders({ summary: vi.fn(async () => summary({ state, coverage: 'unknown', totalCount: null, snapshotVersion: '' })) })
      const store = new RecognizedSpeakerDirectory(api)
      const list = await store.first('a', query, signal())
      await store.confirmDisplayed('a', list)
      expect(api.list).not.toHaveBeenCalled(); expect(api.seen).not.toHaveBeenCalled()
      expect(store.get('a').summary?.totalCount).toBeNull()
    }
  })
  it('does not blindly retry invalid input and isolates caches by account', async () => {
    const api = loaders({ list: vi.fn().mockRejectedValueOnce({ code: 'arkme-code-1001', retryable: true }).mockResolvedValue(page()) })
    const store = new RecognizedSpeakerDirectory(api)
    await expect(store.first('a', query, signal())).rejects.toMatchObject({ code: 'arkme-code-1001' })
    await store.first('b', query, signal())
    expect(api.summary).toHaveBeenCalledTimes(2)
    expect(store.peek('a', query)).toBeUndefined()
  })
})

describe('large directory and visibility boundaries', () => {
  it('paginates beyond 2,000 people with no full-directory scan for the entry', async () => {
    const api = loaders({ list: vi.fn(async input => {
      const offset = Number(input.cursor || 0)
      return page({ items: Array.from({ length: 50 }, (_, i) => person(String(offset + i))), hasMore: offset < 2000, nextCursor: offset < 2000 ? String(offset + 50) : '' })
    }) })
    const store = new RecognizedSpeakerDirectory(api)
    let list = await store.first('a', query, signal())
    expect(api.list).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 40; i++) list = await store.more('a', list, signal())
    expect(list.items).toHaveLength(2050); expect(list.hasMore).toBe(false)
    expect(new Set(list.items.map(row => row.personKey)).size).toBe(2050)
  })
  it('rejects cyclic cursors and a silently changed page version', async () => {
    for (const next of [page({ snapshotVersion: 'v2' }), page({ hasMore: true, nextCursor: 'first' })]) {
      const api = loaders({ list: vi.fn().mockResolvedValueOnce(page({ hasMore: true, nextCursor: 'first' }))
        .mockResolvedValueOnce(page({ hasMore: true, nextCursor: 'second' })).mockResolvedValueOnce(next) })
      const store = new RecognizedSpeakerDirectory(api)
      const second = await store.more('a', await store.first('a', query, signal()), signal())
      await expect(store.more('a', second, signal())).rejects.toThrow('目录版本已变化')
    }
  })
  it('does not read or acknowledge while the document is hidden', async () => {
    vi.useFakeTimers()
    const document = new EventTarget() as EventTarget & { visibilityState: string }
    document.visibilityState = 'hidden'; vi.stubGlobal('document', document)
    const api = loaders(), store = new RecognizedSpeakerDirectory(api)
    const stop = store.watch('a')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.summary).not.toHaveBeenCalled()
    const list = await store.first('a', query, signal())
    await store.confirmDisplayed('a', list)
    expect(api.seen).not.toHaveBeenCalled()
    document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.summary).toHaveBeenCalledTimes(2)
    stop(); vi.unstubAllGlobals()
  })
})

it('after an expired-page backoff, reloads first page instead of replaying the invalid cursor', async () => {
  vi.useFakeTimers()
  const api = loaders({ list: vi.fn().mockResolvedValueOnce(page({ hasMore: true, nextCursor: 'expired' }))
    .mockResolvedValueOnce(page({ state: 'snapshot_expired', coverage: 'unknown', retryAfterMs: 3000 }))
    .mockResolvedValueOnce(page({ items: [person('new')] })) })
  const store = new RecognizedSpeakerDirectory(api)
  const previous = await store.first('a', query, signal())
  await expect(store.more('a', previous, signal())).rejects.toBeInstanceOf(SpeakerReadDeferred)
  await vi.advanceTimersByTimeAsync(3000)
  const refreshed = await store.more('a', previous, signal())
  expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '' }), expect.any(AbortSignal))
  expect(refreshed.items[0]?.personKey).toBe('new')
})
