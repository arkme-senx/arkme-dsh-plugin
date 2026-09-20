import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchPrivateInteractionDirectory } from '../src/client/use-private-interaction-directory.js'
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
  const stop = watchPrivateInteractionDirectory({ read, publish, subscribe: listener => { invalidate = listener; return vi.fn() } })
  stops.push(stop)
  return { publish, invalidate, stop }
}
describe('private interaction directory refresh', () => {
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
})
