import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeMessageReadReceiptDetail, ArkmeMessageReadReceiptSummaryList } from '../src/types.js'
import {
  ArkmeMessageReadReceiptStore,
  type ArkmeMessageReadReceiptTarget,
} from '../src/client/message-read-receipt-store.js'

function target(sequence: number, sourceKey = 'source-key-1'): ArkmeMessageReadReceiptTarget {
  return {
    sourceRef: 'source-ref-1', sourceKey, conversationKind: 'group_chat',
    itemUid: `item-${String(sequence)}`, sequence,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('Arkme message read receipt store', () => {
  it('cancels a queued detail refresh when the page becomes hidden', async () => {
    vi.useFakeTimers()
    const store = new ArkmeMessageReadReceiptStore()
    store.activateAccount(42)
    const refresh = vi.fn()
    const release = store.observeDetail(target(8), refresh)
    store.invalidate('source-key-1', 8)
    store.setForeground(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(refresh).not.toHaveBeenCalled()
    store.setForeground(true)
    await vi.advanceTimersByTimeAsync(180)
    expect(refresh).toHaveBeenCalledOnce()
    release(); store.activateAccount(undefined)
  })
  it('notifies open details once for a burst of hints and releases the final consumer', async () => {
    vi.useFakeTimers()
    const store = new ArkmeMessageReadReceiptStore()
    store.activateAccount(10001)
    const message = target(8)
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = store.observeDetail(message, first)
    const releaseSecond = store.observeDetail(message, second)
    for (let index = 0; index < 20; index++) store.invalidate(message.sourceKey, 8)
    releaseFirst()
    await vi.advanceTimersByTimeAsync(180)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    store.invalidate(message.sourceKey, 8)
    releaseSecond()
    await vi.advanceTimersByTimeAsync(180)
    expect(second).toHaveBeenCalledTimes(1)
    store.activateAccount(undefined)
  })

  it('rejects stale detail results and synchronizes the summary from fresh detail', async () => {
    let finish!: (value: ArkmeMessageReadReceiptDetail) => void
    let signal!: AbortSignal
    const loadDetail = vi.fn(async (sourceRef: string, itemUid: string, sequence: number, abort: AbortSignal) => {
      signal = abort
      return await new Promise<ArkmeMessageReadReceiptDetail>(resolve => { finish = resolve })
    })
    const store = new ArkmeMessageReadReceiptStore({ loadDetail })
    store.activateAccount(10001)
    const message = target(8)
    const stale = store.detail(message)
    store.invalidate(message.sourceKey, 8)
    expect(signal.aborted).toBe(true)
    const detail = { sourceRef: message.sourceRef, itemUid: message.itemUid, sequence: 8,
      readCount: 1, unreadCount: 0, totalMemberCount: 1, items: [] }
    finish(detail)
    await expect(stale).rejects.toThrow('已读详情已失效')
    loadDetail.mockResolvedValue(detail)
    await store.detail(message)
    expect(store.get(message)?.summary).toMatchObject({ readCount: 1, unreadCount: 0, status: 'read' })
    store.activateAccount(undefined)
  })

  it('keeps a slow detail single-flight beyond its cache TTL and cancels on final detach', async () => {
    let now = 0
    let signal!: AbortSignal
    const loadDetail = vi.fn(async (_source: string, _uid: string, _seq: number, abort: AbortSignal) => {
      signal = abort
      return await new Promise<never>((_resolve, reject) => abort.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    const store = new ArkmeMessageReadReceiptStore({ loadDetail, now: () => now })
    store.activateAccount(10001)
    const message = target(8)
    const release = store.observeDetail(message, vi.fn())
    const first = store.detail(message).catch(error => error)
    now = 60_000
    const second = store.detail(message).catch(error => error)
    expect(loadDetail).toHaveBeenCalledTimes(1)
    release()
    expect(signal.aborted).toBe(true)
    await Promise.all([first, second])
    store.activateAccount(undefined)
  })

  it('does not let an older summary overwrite a newer detail result', async () => {
    vi.useFakeTimers()
    let finish!: (value: ArkmeMessageReadReceiptSummaryList) => void
    const store = new ArkmeMessageReadReceiptStore({
      loadSummaries: async () => await new Promise<ArkmeMessageReadReceiptSummaryList>(resolve => { finish = resolve }),
      loadDetail: async (sourceRef, itemUid, sequence) => ({ sourceRef, itemUid, sequence,
        readCount: 1, unreadCount: 0, totalMemberCount: 1, items: [] }),
    })
    store.activateAccount(10001)
    const message = target(8)
    store.register(message); store.setVisible(message, true)
    await vi.advanceTimersByTimeAsync(180)
    await store.detail(message)
    finish({ sourceRef: message.sourceRef, conversationKind: 'group_chat', items: [{ itemUid: message.itemUid,
      sequence: 8, readCount: 0, unreadCount: 1, totalMemberCount: 1, status: 'unread' }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.get(message)?.summary?.readCount).toBe(1)
    store.activateAccount(undefined)
  })

  it('isolates the same user between environments and bounds closed detail caches', async () => {
    const loadDetail = vi.fn(async (sourceRef: string, itemUid: string, sequence: number) => ({ sourceRef, itemUid, sequence,
      readCount: 1, unreadCount: 0, totalMemberCount: 1, items: [] }))
    const store = new ArkmeMessageReadReceiptStore({ loadDetail })
    store.activateAccount(10001, 'test:10001')
    for (let index = 1; index <= 101; index++) await store.detail(target(index))
    await store.detail(target(1))
    expect(loadDetail).toHaveBeenCalledTimes(102)
    store.activateAccount(10001, 'prod:10001')
    expect(store.get(target(1))).toBeUndefined()
    await store.detail(target(1))
    expect(loadDetail).toHaveBeenCalledTimes(103)
    store.activateAccount(undefined)
  })

  it('keeps child registrations made before the parent account effect activates', async () => {
    vi.useFakeTimers()
    const loadSummaries = vi.fn(async (sourceRef: string, items: readonly { itemUid: string; sequence: number }[]) => ({
      sourceRef,
      conversationKind: 'private_chat' as const,
      items: items.map(item => ({
        ...item, readCount: 0, unreadCount: 1, totalMemberCount: 1, status: 'unread' as const,
      })),
    }))
    const store = new ArkmeMessageReadReceiptStore({ loadSummaries })
    const message = { ...target(8), conversationKind: 'private_chat' as const }
    store.register(message)
    store.setVisible(message, true)

    store.activateAccount(10001)
    await vi.advanceTimersByTimeAsync(0)

    expect(loadSummaries).toHaveBeenCalledOnce()
    expect(store.get(message)?.status).toBe('ready')
  })

  it('batches visible summaries in bounded groups and keeps HTTP results as truth', async () => {
    vi.useFakeTimers()
    const loadSummaries = vi.fn(async (sourceRef: string, items: readonly { itemUid: string; sequence: number }[]) => ({
      sourceRef,
      conversationKind: 'group_chat' as const,
      items: items.map(item => ({
        ...item, readCount: 1, unreadCount: 1, totalMemberCount: 2, status: 'partially_read' as const,
      })),
    }))
    const store = new ArkmeMessageReadReceiptStore({ loadSummaries })
    store.activateAccount(10001)
    const targets = Array.from({ length: 51 }, (_value, index) => target(index + 1))
    const unregister = targets.map(item => store.register(item))
    for (const item of targets) store.setVisible(item, true)

    await vi.advanceTimersByTimeAsync(180)

    expect(loadSummaries).toHaveBeenCalledTimes(2)
    expect(loadSummaries.mock.calls.map(call => call[1].length)).toEqual([50, 1])
    expect(store.get(targets[0]!)).toMatchObject({
      status: 'ready', summary: { readCount: 1, unreadCount: 1, totalMemberCount: 2 },
    })
    unregister.forEach(dispose => { dispose() })
  })

  it('invalidates only matching messages at or below the realtime cursor', () => {
    vi.useFakeTimers()
    const store = new ArkmeMessageReadReceiptStore()
    store.activateAccount(10001)
    const before = target(8)
    const after = target(12)
    store.provision(before)
    store.provision(after)
    const unregisterBefore = store.register(before)
    const unregisterAfter = store.register(after)
    store.setVisible(before, true)
    store.setVisible(after, true)

    store.invalidate('source-key-1', 9)

    expect(store.get(before)?.status).toBe('stale')
    expect(store.get(after)?.status).toBe('provisional')
    unregisterBefore()
    unregisterAfter()
  })

  it('aborts in-flight work and drops cached state when the account changes', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    const loadSummaries = vi.fn(async (
      _sourceRef: string,
      _items: readonly { itemUid: string; sequence: number }[],
      signal: AbortSignal,
    ) => {
      observedSignal = signal
      return await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
    })
    const store = new ArkmeMessageReadReceiptStore({ loadSummaries })
    store.activateAccount(10001)
    const message = target(8)
    store.register(message)
    store.setVisible(message, true)
    await vi.advanceTimersByTimeAsync(180)
    expect(loadSummaries).toHaveBeenCalledOnce()

    store.activateAccount(20002)
    await Promise.resolve()

    expect(observedSignal?.aborted).toBe(true)
    expect(store.get(message)).toBeUndefined()
  })

  it('coalesces group member detail and expires it when realtime invalidates the message', async () => {
    const loadDetail = vi.fn(async (sourceRef: string, itemUid: string, sequence: number) => ({
      sourceRef, itemUid, sequence, readCount: 1, unreadCount: 1, totalMemberCount: 2,
      items: [{ memberRef: 'member-1', displayName: '成员一', readStatus: 'read' as const }],
    }))
    const store = new ArkmeMessageReadReceiptStore({ loadDetail })
    store.activateAccount(10001)
    const message = target(8)

    const [first, second] = await Promise.all([store.detail(message), store.detail(message)])
    expect(first).toEqual(second)
    expect(loadDetail).toHaveBeenCalledOnce()
    store.invalidate(message.sourceKey, message.sequence)
    await store.detail(message)
    expect(loadDetail).toHaveBeenCalledTimes(2)
  })
})
