import { afterEach, describe, expect, it, vi } from 'vitest'
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
