import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeArkoConversationPreviewSync,
  type ArkmeArkoPreviewVisibilityTarget,
} from '../src/client/arko-conversation-preview-sync.js'
import { ArkmeArkoConversationPreviewStore } from '../src/client/arko-conversation-preview-store.js'
import type { ArkmeArkoHistoryItem, ArkmeArkoHistoryPage } from '../src/types.js'

class FakeVisibilityTarget implements ArkmeArkoPreviewVisibilityTarget {
  visibilityState = 'visible'
  private readonly listeners = new Set<() => void>()

  addEventListener(_type: 'visibilitychange', listener: () => void): void { this.listeners.add(listener) }
  removeEventListener(_type: 'visibilitychange', listener: () => void): void { this.listeners.delete(listener) }
  dispatch(): void { for (const listener of this.listeners) listener() }
}

function historyItem(messageId: number, text: string, createdAtMillis: number): ArkmeArkoHistoryItem {
  return {
    messageId,
    sessionId: 88,
    role: 'assistant',
    text,
    reasoning: '',
    createdAtMillis,
    status: 1,
    createdRecordUids: [],
  }
}

function page(item: ArkmeArkoHistoryItem): ArkmeArkoHistoryPage {
  return { items: [item], hasMore: false }
}

describe('Arko conversation preview sync', () => {
  it('polls while visible and refreshes immediately when the page becomes visible again', async () => {
    vi.useFakeTimers()
    try {
      const store = new ArkmeArkoConversationPreviewStore()
      const visibility = new FakeVisibilityTarget()
      let current = page(historyItem(101, '第一条消息', 1000))
      const loadHistory = vi.fn(async (_signal: AbortSignal) => current)
      const sync = new ArkmeArkoConversationPreviewSync(store, loadHistory, 1000, visibility)
      const stop = sync.start(1001)
      await sync.refresh()

      expect(loadHistory).toHaveBeenCalledOnce()
      expect(store.getSnapshot()).toMatchObject({ latestPreview: '第一条消息', latestAtMillis: 1000 })

      visibility.visibilityState = 'hidden'
      current = page(historyItem(102, '后台的新消息', 2000))
      await vi.advanceTimersByTimeAsync(1000)
      expect(loadHistory).toHaveBeenCalledOnce()

      visibility.visibilityState = 'visible'
      visibility.dispatch()
      await sync.refresh()
      expect(loadHistory).toHaveBeenCalledTimes(2)
      expect(store.getSnapshot()).toMatchObject({ latestPreview: '后台的新消息', latestAtMillis: 2000 })

      current = page(historyItem(103, '轮询拿到的消息', 3000))
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
      expect(loadHistory).toHaveBeenCalledTimes(3)
      expect(store.getSnapshot()).toMatchObject({ latestPreview: '轮询拿到的消息', latestAtMillis: 3000 })

      stop()
      await vi.advanceTimersByTimeAsync(2000)
      expect(loadHistory).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let a stopped account request update the next account preview', async () => {
    let resolveFirst!: (page: ArkmeArkoHistoryPage) => void
    const store = new ArkmeArkoConversationPreviewStore()
    const visibility = new FakeVisibilityTarget()
    const loadHistory = vi.fn((_signal: AbortSignal) => new Promise<ArkmeArkoHistoryPage>(resolve => {
      resolveFirst = resolve
    }))
    const sync = new ArkmeArkoConversationPreviewSync(store, loadHistory, 60_000, visibility)
    const stop = sync.start(1001)
    stop()
    store.activateUser(2002)
    resolveFirst(page(historyItem(101, '账号 A 的迟到消息', 1000)))
    await Promise.resolve()
    await Promise.resolve()

    expect(store.getSnapshot()).toEqual({ revision: 2, userId: 2002 })
  })
})
