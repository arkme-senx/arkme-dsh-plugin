import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeChatDirectoryStore, ArkmeChatTimelineDeltaStore, ArkmeInterwovenInvalidationStore,
} from '../src/client/chat-directory-store.js'

describe('ArkmeChatDirectoryStore', () => {
  it('publishes one authoritative source snapshot to every Chat surface', () => {
    const store = new ArkmeChatDirectoryStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const source = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 1, unreadCount: 2, latestSequence: 9,
    }

    store.publish([source])
    expect(store.getSnapshot()).toEqual({ revision: 1, sources: [source] })
    expect(listener).toHaveBeenCalledOnce()

    store.upsert({ ...source, unreadCount: 3, activeAtMillis: 2 })
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 3, activeAtMillis: 2 })

    store.clear()
    expect(store.getSnapshot()).toEqual({ revision: 3, sources: [] })
  })

  it('keeps stable server order for unread-only updates and equal activity times', () => {
    const store = new ArkmeChatDirectoryStore()
    const first = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '第一',
      activeAtMillis: 10, unreadCount: 1,
    }
    const second = { ...first, sourceRef: 'source-2', displayName: '第二', unreadCount: 0 }
    store.publish([first, second])

    store.updateUnread('source-1', 0)
    store.upsert({ ...second, unreadCount: 2 })
    expect(store.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['source-1', 'source-2'])
    expect(store.getSnapshot().sources[1]?.unreadCount).toBe(2)

    store.upsert({ ...second, activeAtMillis: 11 })
    expect(store.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['source-2', 'source-1'])
  })

  it('single-flights a paginated refresh and reuses its last-success TTL cache', async () => {
    const loadPage = vi.fn(async (cursor?: string) => cursor === undefined
      ? {
          directory: 'root' as const,
          items: [{ sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '第一', activeAtMillis: 2, unreadCount: 0 }],
          hasMore: true,
          nextCursor: 'next',
        }
      : {
          directory: 'root' as const,
          items: [{ sourceRef: 'source-2', kind: 'group_chat' as const, displayName: '第二', activeAtMillis: 1, unreadCount: 0 }],
          hasMore: false,
        })
    const store = new ArkmeChatDirectoryStore({ loadPage, maxAgeMs: 60_000 })

    const [first, concurrent] = await Promise.all([store.refreshRoot(), store.refreshRoot()])
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(first.map(item => item.sourceRef)).toEqual(['source-1', 'source-2'])
    expect(concurrent).toEqual(first)

    await expect(store.refreshRoot()).resolves.toEqual(first)
    expect(loadPage).toHaveBeenCalledTimes(2)
    await store.refreshRoot({ force: true })
    expect(loadPage).toHaveBeenCalledTimes(4)
  })

  it('publishes timeline deltas independently from directory snapshots', () => {
    const store = new ArkmeChatTimelineDeltaStore()
    store.publish([{ sourceRef: 'source-1', items: [{
      itemUid: 'item-1', senderName: '联系人', isMe: false, sendAtMillis: 1,
      title: '', textContent: '新消息', status: 1, sequence: 9,
    }] }])
    expect(store.getSnapshot()).toMatchObject({ revision: 1 })
    expect(store.getSnapshot().itemsBySourceRef['source-1']?.[0]).toMatchObject({ itemUid: 'item-1', sequence: 9 })
  })

  it('publishes revision-only interwoven invalidations without carrying realtime content', () => {
    const store = new ArkmeInterwovenInvalidationStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.invalidate()
    store.invalidate()

    expect(store.getSnapshot()).toEqual({ revision: 2 })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(store.getSnapshot())).not.toContain('content')
  })
})
