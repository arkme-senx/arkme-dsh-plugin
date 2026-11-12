import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchPrivateInteractionDirectory } from '../src/client/use-private-interaction-directory.js'
import { groupInteractionPeers } from '../src/services/chat-realtime-service.js'
import { ArkmeInterwovenInvalidationStore } from '../src/client/chat-directory-store.js'
import type { ArkmePrivateInteractionDirectoryPage, ArkmeSourceItem } from '../src/types.js'

const row = (key: string): ArkmeSourceItem => ({ sourceKey: key, sourceRef: key, kind: 'private_chat', displayName: key, activeAtMillis: 1, unreadCount: 0 })
const page = (key: string, more = false): ArkmePrivateInteractionDirectoryPage => ({
  contractVersion: 1, sourceScope: 'chat_group_mentions', scopeComplete: true, uncoveredSources: [],
  version: 'a'.repeat(64), items: [row(key)], hasMore: more, ...(more ? { nextCursor: 'next' } : {}),
})
const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers() })
function start(read: Parameters<typeof watchPrivateInteractionDirectory>[0]['read']) {
  let invalidate!: () => void
  const publish = vi.fn()
  const watcher = watchPrivateInteractionDirectory({ read, publish, subscribe: listener => { invalidate = listener; return vi.fn() } })
  stops.push(() => watcher.dispose())
  return { publish, invalidate, stop: () => watcher.dispose(), retry: () => watcher.retry() }
}
describe('private interaction directory refresh', () => {
  it('routes a complete group tail to only the affected private contacts', async () => {
    const entry = (seq: number, sender_user_id: number, targets: number[]) => ({
      relation: { seq, sender_user_id },
      record: { status: 1, payload: { content_payload: { mention_metadata: { human_mentions: targets.map(user_id => ({ user_id })) } } } },
    })
    const normal = { items: [entry(2, 11, [0, 12])] }
    const tail = { items: [...normal.items, entry(3, 10, [12]), entry(4, 13, [10]), entry(5, 13, [10])] }
    expect(groupInteractionPeers(normal, 10, 1, 2)?.map(String)).toEqual([])
    expect(groupInteractionPeers(tail, 10, 1, 6)).toBeUndefined()
    const invalidation = new ArkmeInterwovenInvalidationStore()
    const read = vi.fn().mockResolvedValue(page('existing'))
    const readPeer = vi.fn(async (key: string) => ({ key, row: row(key) }))
    const publish = vi.fn()
    const watcher = watchPrivateInteractionDirectory({ read, readPeer, publish,
      subscribe: listener => invalidation.subscribeDirectory(listener) })
    stops.push(watcher.dispose)
    invalidation.invalidate('group', groupInteractionPeers(normal, 10, 1, 2)?.map(String))
    invalidation.invalidate('group', groupInteractionPeers(tail, 10, 1, 5)?.map(String))
    await vi.waitFor(() => expect(publish).toHaveBeenLastCalledWith([row('existing'), row('12'), row('13')]))
    expect(read).toHaveBeenCalledTimes(1)
    expect(readPeer.mock.calls.map(([peer]) => peer)).toEqual(['12', '13'])
  })

  it('publishes a live contact while directory pages are blocked and keeps it over the late snapshot', async () => {
    const first = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const older = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(older.promise)
    const live = { ...row('peer'), latestPreview: 'live' }
    const readPeer = vi.fn(async () => ({ key: 'peer', row: live }))
    const publish = vi.fn()
    const store = new ArkmeInterwovenInvalidationStore()
    const watcher = watchPrivateInteractionDirectory({ read, readPeer, publish,
      subscribe: listener => store.subscribeDirectory(listener) })
    stops.push(watcher.dispose)
    store.invalidate('group', ['peer'])
    await vi.waitFor(() => expect(publish).toHaveBeenLastCalledWith([live]))
    first.resolve(page('peer', true))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(publish).toHaveBeenLastCalledWith([live])
    older.resolve(page('other'))
    await vi.waitFor(() => expect(publish).toHaveBeenLastCalledWith([live, row('other')]))
  })

  it('does not cancel the targeted request when the same group queues a directory refresh', async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const live = Promise.withResolvers<{ key: string; row: ArkmeSourceItem }>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(page('fallback'))
    const readPeer = vi.fn((_key, _rows, _signal: AbortSignal) => live.promise)
    const publish = vi.fn()
    const store = new ArkmeInterwovenInvalidationStore()
    const watcher = watchPrivateInteractionDirectory({ read, readPeer, publish,
      subscribe: listener => store.subscribeDirectory(listener) })
    stops.push(watcher.dispose)
    store.invalidate('group', ['peer'])
    store.invalidate('group')
    expect(readPeer.mock.calls[0]?.[2].aborted).toBe(false)
    live.resolve({ key: 'peer', row: row('peer') })
    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenLastCalledWith([row('peer')])
    expect(read).toHaveBeenCalledTimes(1)
    first.resolve(page('stale'))
    await vi.advanceTimersByTimeAsync(151)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('discards an in-flight contact summary when permissions change and revalidates that contact', async () => {
    const stale = Promise.withResolvers<{ key: string; row: ArkmeSourceItem }>()
    const read = vi.fn().mockResolvedValue(page('other'))
    const readPeer = vi.fn((_key: string, _rows: readonly ArkmeSourceItem[], _signal: AbortSignal) =>
      Promise.resolve({ key: 'peer' })).mockReturnValueOnce(stale.promise)
    const publish = vi.fn()
    const store = new ArkmeInterwovenInvalidationStore()
    const watcher = watchPrivateInteractionDirectory({ read, readPeer, publish,
      subscribe: listener => store.subscribeDirectory(listener) })
    stops.push(watcher.dispose)
    store.invalidate('group', ['peer'])
    store.invalidate('group', undefined, true)
    expect(readPeer.mock.calls[0]?.[2].aborted).toBe(true)
    stale.resolve({ key: 'peer', row: row('forbidden') })
    await vi.waitFor(() => expect(readPeer).toHaveBeenCalledTimes(2))
    expect(publish.mock.calls.flatMap(([rows]) => rows)).not.toContainEqual(row('forbidden'))
  })

  it('waits for a quiet version after a conflict overtaken by continuous invalidations', async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(page('fresh'))
    const { publish, invalidate } = start(read)
    invalidate()
    first.reject(new Error('interaction-version-changed'))
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 100; i++) { invalidate(); await vi.advanceTimersByTimeAsync(i % 10 === 0 ? 3000 : 1500) }
    expect(read).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenLastCalledWith([], expect.any(String))
    invalidate(); await vi.advanceTimersByTimeAsync(4999)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith([row('fresh')])
  })

  it('lets explicit retry bypass conflict quiet-time and cancels its old timer', async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(page('fresh'))
    const { publish, invalidate, retry } = start(read)
    invalidate(); first.reject(new Error('interaction-version-changed'))
    await vi.advanceTimersByTimeAsync(0)
    retry(); await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1]?.[3]).toBe('foreground')
    expect(publish).toHaveBeenLastCalledWith([row('fresh')])
    await vi.advanceTimersByTimeAsync(6000)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('publishes recent contacts before the remaining pages finish', async () => {
    const older = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockResolvedValueOnce(page('recent', true)).mockReturnValueOnce(older.promise)
    const { publish } = start(read)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(publish).toHaveBeenLastCalledWith([row('recent')])
    expect(read.mock.calls[1]?.slice(0, 2)).toEqual(['next', 'a'.repeat(64)])
    older.resolve(page('older'))
    await vi.waitFor(() => expect(publish).toHaveBeenLastCalledWith([row('recent'), row('older')]))
  })
  it('coalesces invalidations without aborting in-flight work and discards its stale response', async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(page('latest'))
    const { publish, invalidate } = start(read)
    invalidate(); invalidate(); invalidate()
    expect(read.mock.calls[0]?.[2].aborted).toBe(false)
    first.resolve(page('stale'))
    await vi.advanceTimersByTimeAsync(151)
    expect(read).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenLastCalledWith([row('latest')])
  })
  it('clears an obsolete projection on permission/read failure and supports retry', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockResolvedValueOnce(page('peer')).mockRejectedValueOnce(new Error('403')).mockResolvedValue(page('peer'))
    const { publish, invalidate } = start(read)
    await vi.advanceTimersByTimeAsync(1)
    invalidate(); await vi.advanceTimersByTimeAsync(151)
    expect(publish).toHaveBeenLastCalledWith([], expect.any(String))
    invalidate(); await vi.advanceTimersByTimeAsync(151)
    expect(publish).toHaveBeenLastCalledWith([row('peer')])
  })
  it('drops late account responses and cancels the transport on disposal', async () => {
    const pending = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockReturnValue(pending.promise)
    const { publish, stop } = start(read)
    stop(); pending.resolve(page('old-account'))
    await Promise.resolve()
    expect(read.mock.calls[0]?.[2].aborted).toBe(true)
    expect(publish).not.toHaveBeenCalled()
  })
  it('restarts version conflicts from page one, but bounds repeated failures', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockRejectedValue(new Error('interaction-version-changed'))
    const { publish } = start(read)
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls.every(call => call[0] === undefined && call[1] === undefined)).toBe(true)
    expect(publish).toHaveBeenLastCalledWith([], expect.any(String))
  })

  it('revalidates recent contacts after repeated older-page conflicts instead of rolling them back', async () => {
    vi.useFakeTimers()
    const read = vi.fn()
      .mockResolvedValueOnce(page('old', true)).mockRejectedValueOnce(new Error('version_changed'))
      .mockResolvedValueOnce(page('old', true)).mockRejectedValueOnce(new Error('version_changed'))
      .mockResolvedValueOnce(page('fresh', true))
    const { publish } = start(read)
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(5)
    expect(read.mock.calls[4]?.slice(0, 2)).toEqual([undefined, undefined])
    expect(publish).toHaveBeenLastCalledWith([row('fresh')], '较早群互动暂未加载，点击重试')
  })

  it('does not retain earlier-page content if fresh permission revalidation fails', async () => {
    vi.useFakeTimers()
    const read = vi.fn()
      .mockResolvedValueOnce(page('old', true)).mockRejectedValueOnce(new Error('version_changed'))
      .mockResolvedValueOnce(page('old', true)).mockRejectedValueOnce(new Error('version_changed'))
      .mockRejectedValueOnce(new Error('403'))
    const { publish } = start(read)
    await vi.advanceTimersByTimeAsync(1000)
    expect(publish).toHaveBeenLastCalledWith([], '群互动同步暂未完成，点击重试')
  })

  it('replaces background reads for explicit retry and ignores a late old completion', async () => {
    vi.useFakeTimers()
    const old = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const current = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockResolvedValue(page('after-event'))
    const { publish, retry, invalidate } = start(read)
    retry(); retry()
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0]?.[2].aborted).toBe(true)
    expect(read.mock.calls[1]?.[3]).toBe('foreground')
    old.resolve(page('obsolete'))
    await vi.advanceTimersByTimeAsync(0)
    invalidate(); invalidate()
    await vi.advanceTimersByTimeAsync(200)
    expect(read).toHaveBeenCalledTimes(2) // The old finally cannot mark the new run idle.
    expect(publish).not.toHaveBeenCalled()
    current.resolve(page('also-obsolete'))
    await vi.advanceTimersByTimeAsync(200)
    expect(read).toHaveBeenCalledTimes(3)
    expect(read.mock.calls[2]?.[3]).toBe('foreground')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenLastCalledWith([row('after-event')])
    invalidate(); await vi.advanceTimersByTimeAsync(200)
    expect(read.mock.calls[3]?.[3]).toBe('background')
  })

  it('keeps explicit retry priority through pagination, version recovery and permission revalidation', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page('old', true)).mockRejectedValueOnce(new Error('version_changed'))
      .mockResolvedValueOnce(page('old', true)).mockRejectedValueOnce(new Error('version_changed'))
      .mockResolvedValueOnce(page('fresh', true))
    const { publish, retry } = start(read)
    await vi.advanceTimersByTimeAsync(0)
    retry()
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(6)
    expect(read.mock.calls[0]?.[3]).toBe('background')
    expect(read.mock.calls.slice(1).every(call => call[3] === 'foreground')).toBe(true)
    expect(publish).toHaveBeenLastCalledWith([row('fresh')], '较早群互动暂未加载，点击重试')
  })

  it('cancels a scheduled automatic refresh on retry and cancels the replacement on disposal', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<ArkmePrivateInteractionDirectoryPage>()
    const read = vi.fn().mockResolvedValueOnce(page('old')).mockReturnValueOnce(pending.promise)
    const { publish, invalidate, retry, stop } = start(read)
    await vi.advanceTimersByTimeAsync(0)
    invalidate(); retry()
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(2)
    stop(); retry()
    expect(read.mock.calls[1]?.[2].aborted).toBe(true)
    pending.resolve(page('late'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
