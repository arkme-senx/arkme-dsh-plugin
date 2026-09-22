import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelfTopicDirectoryCache } from '../src/client/self-topic-directory-cache.js'
import type { ArkmeNavigationCache } from '../src/client/navigation-cache.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../src/types.js'

const source = (sourceRef: string, kind: ArkmeSourceItem['kind'], recordCount = 1): ArkmeSourceItem => ({
  sourceRef, kind, displayName: sourceRef, recordCount, activeAtMillis: 0, unreadCount: 0,
  ...(kind === 'topic' ? { topicHierarchyKey: sourceRef } : {}),
})
const base = [source('self', 'send_to_self'), source('default', 'default_category'), source('a', 'topic', 10), source('b', 'topic', 20)]
const page = (items = base, nextCursor?: string): ArkmeSourceList => ({ directory: 'send_to_self', items, hasMore: !!nextCursor, ...(nextCursor ? { nextCursor } : {}) })
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(seed?: Partial<ArkmeNavigationCache>, initialTime = 100_000) {
  let now = initialTime
  let saved: ArkmeNavigationCache | undefined = seed ? {
    version: 1, userId: 42, directory: 'root', updatedAtMillis: now,
    sources: { send_to_self: base }, selfTopics: { complete: true, environment: 'prod', refreshedAtMillis: now }, ...seed,
  } : undefined
  const load = vi.fn<(cursor: string | undefined, signal: AbortSignal, refresh: boolean) => Promise<ArkmeSourceList>>().mockResolvedValue(page())
  const write = vi.fn((value: ArkmeNavigationCache) => { saved = value })
  const make = (environment: 'prod' | 'test' = 'prod') => new SelfTopicDirectoryCache(42, environment, load, () => saved, write, () => now)
  return { load, write, make, advance: (ms: number) => { now += ms }, getSaved: () => saved }
}
afterEach(() => vi.useRealTimers())
describe('shared topic directory cache', () => {
  it('hides overlapping subtrees immediately and rolls back only the failed intent', async () => {
    const tree = [...base, { ...source('child', 'topic'), parentTopicHierarchyKey: 'a' },
      { ...source('grandchild', 'topic'), parentTopicHierarchyKey: 'child' }]
    const f = fixture({ sources: { send_to_self: tree } }), cache = f.make()
    const child = cache.beginArchive(tree[4]!)!
    const parent = cache.beginArchive(base[2]!)!
    expect(cache.getSnapshot().sources.map(identity => identity.sourceRef)).toEqual(['self', 'default', 'b'])
    expect(cache.getConfirmedSnapshot().sources).toEqual(tree)
    expect(f.write).not.toHaveBeenCalled()
    child(true)
    parent(false)
    expect(cache.getSnapshot().sources.map(identity => identity.sourceRef)).toEqual(['self', 'default', 'a', 'b'])
    expect(f.getSaved()?.sources.send_to_self?.map(identity => identity.sourceRef)).toEqual(['self', 'default', 'a', 'b'])
  })
  it('keeps pending removals across older reads, does not persist them, and uses latest data on failure', async () => {
    const f = fixture({}), cache = f.make(), old = deferred<ArkmeSourceList>()
    f.load.mockReturnValueOnce(old.promise)
    const read = cache.ensure(true)
    const settle = cache.beginArchive(base[2]!)!
    const renamed = {...base[2]!, sourceRef: 'a-new-ref', displayName: '新名称'}
    old.resolve(page([...base.slice(0, 2), renamed, base[3]!])); await read
    expect(cache.getSnapshot().sources).not.toContainEqual(renamed)
    expect(f.getSaved()?.sources.send_to_self).toContainEqual(renamed)
    settle(false)
    expect(cache.getSnapshot().sources).toContainEqual(renamed)
  })
  it('retains successful removals against pre-commit reads and retires them after a fresh owner read', async () => {
    const f = fixture({}), cache = f.make(), old = deferred<ArkmeSourceList>()
    f.load.mockReturnValueOnce(old.promise)
    const read = cache.ensure(true)
    const settle = cache.beginArchive(base[2]!)!
    settle(true)
    old.resolve(page()); await read
    expect(cache.getSnapshot().sources).not.toContainEqual(base[2])
    expect(f.getSaved()?.sources.send_to_self).not.toContainEqual(base[2])
    // Another device can legitimately restore it before our next authoritative read.
    await cache.ensure(true)
    expect(cache.getSnapshot().sources).toContainEqual(base[2])
  })
  it('hides newly loaded descendants while a parent is pending and never restores rows cleared by privacy', async () => {
    const f = fixture({}), cache = f.make()
    const settle = cache.beginArchive(base[2]!)!
    f.load.mockResolvedValue(page([...base, {...source('child', 'topic'), parentTopicHierarchyKey: 'a'}]))
    await cache.ensure(true)
    expect(cache.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['self', 'default', 'b'])
    cache.invalidate(true)
    settle(false)
    expect(cache.getSnapshot().sources).toEqual([])
    cache.dispose()
  })
  it('deduplicates initial reads and keeps the flight across menu unmounts', async () => {
    const f = fixture(), cache = f.make(), pending = deferred<ArkmeSourceList>()
    f.load.mockReturnValue(pending.promise)
    const off = cache.subscribe(() => {}), first = cache.ensure()
    off()
    expect(cache.ensure()).toBe(first)
    await Promise.resolve(); expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.load.mock.calls[0]![1].aborted).toBe(false)
    pending.resolve(page()); await first
    await cache.ensure(); expect(f.load).toHaveBeenCalledTimes(1)
    expect(cache.getSnapshot()).toMatchObject({ complete: true, loading: false })
  })
  it('hydrates a full snapshot after restart and skips reads within the freshness window', async () => {
    const f = fixture(), first = f.make()
    await first.ensure()
    const restarted = f.make()
    expect(restarted.getSnapshot().sources).toEqual(base)
    await restarted.ensure()
    expect(f.load).toHaveBeenCalledTimes(1)
  })
  it('retains a complete list and its persisted copy through all refresh pages', async () => {
    const f = fixture({}), cache = f.make(), last = deferred<ArkmeSourceList>()
    f.advance(61_000)
    f.load.mockImplementation(async cursor => cursor ? last.promise : page(base.slice(0, 3), 'next'))
    const pending = cache.ensure(); await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(2))
    expect(cache.getSnapshot()).toMatchObject({ sources: base, loading: true, complete: true })
    expect(f.write).not.toHaveBeenCalled()
    last.resolve(page([source('b', 'topic', 21)])); await pending
    expect(cache.getSnapshot().sources.at(-1)?.recordCount).toBe(21)
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('publishes cold first pages as incomplete and never persists them as full results', async () => {
    const f = fixture(), cache = f.make(), last = deferred<ArkmeSourceList>()
    f.load.mockImplementation(async cursor => cursor ? last.promise : page(base.slice(0, 3), 'next'))
    const pending = cache.ensure(); await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(2))
    expect(cache.getSnapshot()).toMatchObject({ sources: base.slice(0, 3), complete: false, loading: true })
    expect(f.write).not.toHaveBeenCalled()
    last.resolve(page(base.slice(3))); await pending
    expect(f.getSaved()?.selfTopics?.complete).toBe(true)
  })
  it('keeps confirmed creation/rename results against an older in-flight refresh', async () => {
    const f = fixture({}), cache = f.make(), pending = deferred<ArkmeSourceList>()
    f.load.mockReturnValue(pending.promise)
    const task = cache.ensure(true)
    cache.upsert({ ...base[2]!, sourceRef: 'new-ref', displayName: 'renamed' })
    cache.upsert(source('new-topic', 'topic', 0))
    pending.resolve(page()); await task
    expect(cache.getSnapshot().sources.filter(item => item.topicHierarchyKey === 'a')).toEqual([
      expect.objectContaining({ sourceRef: 'new-ref', displayName: 'renamed', recordCount: 10 }),
    ])
    expect(cache.getSnapshot().sources.at(-1)?.sourceRef).toBe('new-topic')
  })
  it('retains known counts on network failure, and manual retry really revalidates', async () => {
    const f = fixture({}), cache = f.make()
    f.load.mockRejectedValueOnce(Error('offline'))
    await cache.ensure(true)
    expect(cache.getSnapshot()).toMatchObject({ sources: base, complete: true, error: 'offline', loading: false })
    await cache.ensure(true)
    expect(f.load.mock.lastCall?.[2]).toBe(true)
    expect(cache.getSnapshot().error).toBe('')
  })
  it('clears visibility immediately on hard invalidation and rejects late old results', async () => {
    const f = fixture({}), cache = f.make(), pending = deferred<ArkmeSourceList>()
    f.load.mockReturnValueOnce(pending.promise)
    const task = cache.ensure(true); await Promise.resolve()
    cache.invalidate(true)
    expect(cache.getSnapshot()).toMatchObject({ sources: [], complete: false })
    pending.resolve(page()); await task
    expect(cache.getSnapshot().sources).toEqual([])
    await cache.ensure()
    expect(cache.getSnapshot().complete).toBe(true)
  })
  it('coalesces mutation bursts and refreshes after an in-flight read without losing the invalidation', async () => {
    vi.useFakeTimers()
    const f = fixture({}), cache = f.make(), pending = deferred<ArkmeSourceList>()
    f.load.mockReturnValueOnce(pending.promise)
    const off = cache.subscribe(() => {})
    const task = cache.ensure(true); await Promise.resolve()
    cache.invalidate(); cache.invalidate(); cache.invalidate()
    await vi.advanceTimersByTimeAsync(250)
    expect(f.load).toHaveBeenCalledTimes(1)
    pending.resolve(page()); await task
    await vi.advanceTimersByTimeAsync(250)
    expect(f.load).toHaveBeenCalledTimes(2)
    off(); cache.dispose()
  })
  it('rejects foreign-environment, incomplete, legacy and expired freshness metadata', async () => {
    const f = fixture({})
    expect(f.make('test').getSnapshot().sources).toEqual([])
    const legacy = fixture({ selfTopics: undefined })
    expect(legacy.make().getSnapshot().complete).toBe(false)
    const incomplete = fixture({ selfTopics: { complete: false, environment: 'prod', refreshedAtMillis: 100_000 } })
    await incomplete.make().ensure(); expect(incomplete.load).toHaveBeenCalledOnce()
    f.advance(8 * 86_400_000)
    expect(f.make().getSnapshot().sources).toEqual([])
  })
  it('reports malformed pagination and stops the spinner instead of declaring partial counts complete', async () => {
    const f = fixture(), cache = f.make()
    f.load.mockResolvedValue({ ...page(), hasMore: true })
    await cache.ensure()
    expect(cache.getSnapshot()).toMatchObject({ loading: false, complete: false, error: '主题加载未完成，请重试' })
    expect(f.write).not.toHaveBeenCalled()
  })
})
