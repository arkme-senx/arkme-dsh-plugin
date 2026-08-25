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
    expect(store.getSnapshot()).toEqual({ revision: 1, sources: [source], baselineReady: true, isRefreshing: false })
    expect(listener).toHaveBeenCalledOnce()

    store.upsert({ ...source, unreadCount: 3, activeAtMillis: 2 })
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 3, activeAtMillis: 2 })

    store.clear()
    expect(store.getSnapshot()).toEqual({ revision: 3, sources: [], baselineReady: false, isRefreshing: false })
  })

  it('can exclude muted conversations from an unread total', () => {
    const store = new ArkmeChatDirectoryStore()
    store.publish([{
      sourceRef: 'private-chat-1', kind: 'private_chat', displayName: '联系人',
      activeAtMillis: 2, unreadCount: 4,
    }, {
      sourceRef: 'muted-group-1', kind: 'group_chat', displayName: '免打扰群',
      activeAtMillis: 1, unreadCount: 120, isMuted: true,
    }])

    expect(store.totalUnreadCount()).toBe(124)
    expect(store.totalUnreadCount({ excludeMuted: true })).toBe(4)
  })

  it('keeps stable server order for unread-only updates and equal activity times', () => {
    const store = new ArkmeChatDirectoryStore()
    const first = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '第一',
      activeAtMillis: 10, unreadCount: 1,
    }
    const second = { ...first, sourceRef: 'source-2', displayName: '第二', unreadCount: 0 }
    store.publish([first, second])

    store.updateReadAck('source-1', 'chat:source-1', 10, 0)
    store.upsert({ ...second, unreadCount: 2 })
    expect(store.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['source-1', 'source-2'])
    expect(store.getSnapshot().sources[1]?.unreadCount).toBe(2)

    store.upsert({ ...second, activeAtMillis: 11 })
    expect(store.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['source-2', 'source-1'])
  })

  it('promotes a successfully sent chat message into the directory immediately', () => {
    const store = new ArkmeChatDirectoryStore()
    const target = {
      sourceRef: 'source-harness', sourceKey: 'chat:harness', kind: 'private_chat' as const, displayName: 'Harness4',
      latestPreview: '@狗才 1', activeAtMillis: 22, unreadCount: 0, latestSequence: 8,
    }
    const other = {
      sourceRef: 'source-other', sourceKey: 'chat:other', kind: 'private_chat' as const, displayName: '其他会话',
      latestPreview: '稍新的消息', activeAtMillis: 40, unreadCount: 1, latestSequence: 4,
    }
    store.publish([other, target])

    expect(store.recordSent(target, {
      latestPreview: '测试', activeAtMillis: 48, latestSequence: 9,
    })).toBe(true)

    expect(store.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['source-harness', 'source-other'])
    expect(store.getSnapshot().sources[0]).toMatchObject({
      latestPreview: '测试', activeAtMillis: 48, unreadCount: 0, latestSequence: 9,
    })

    store.upsert({ ...target, latestPreview: '@狗才 1', activeAtMillis: 22, latestSequence: 9 })
    expect(store.getSnapshot().sources[0]).toMatchObject({
      latestPreview: '测试', activeAtMillis: 48, unreadCount: 0, latestSequence: 9,
    })

    store.publish([other, { ...target, latestPreview: '@狗才 1', activeAtMillis: 22, latestSequence: 9 }])
    expect(store.getSnapshot().sources.map(item => item.sourceRef)).toEqual(['source-harness', 'source-other'])
    expect(store.getSnapshot().sources[0]).toMatchObject({
      latestPreview: '测试', activeAtMillis: 48, unreadCount: 0, latestSequence: 9,
    })
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

  it('publishes refresh state while a directory request is in flight', async () => {
    const page = {
      directory: 'root' as const,
      items: [{ sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '第一', activeAtMillis: 1, unreadCount: 0 }],
      hasMore: false,
    }
    let resolvePage!: (page: typeof page) => void
    const store = new ArkmeChatDirectoryStore({
      loadPage: async () => await new Promise<typeof page>(resolve => { resolvePage = resolve }),
    })

    const pending = store.refreshRoot()
    expect(store.getSnapshot()).toMatchObject({ baselineReady: false, isRefreshing: true, sources: [] })

    resolvePage(page)
    await pending
    expect(store.getSnapshot()).toMatchObject({ baselineReady: true, isRefreshing: false, sources: page.items })
  })

  it('holds realtime mutations until the authoritative directory baseline is available', () => {
    const store = new ArkmeChatDirectoryStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const baseline = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '原会话',
      activeAtMillis: 10, unreadCount: 2,
    }
    const realtime = {
      sourceRef: 'source-2', kind: 'private_chat' as const, displayName: '新消息会话',
      activeAtMillis: 20, unreadCount: 1,
    }
    const latestRealtime = { ...realtime, activeAtMillis: 21, unreadCount: 2 }

    store.upsert(realtime)
    expect(store.unreadCount('source-2')).toBe(1)
    store.upsert(latestRealtime)
    expect(store.unreadCount('source-2')).toBe(2)
    store.updateReadAck('source-1', 'chat:source-1', 10, 0)
    expect(store.getSnapshot()).toEqual({ revision: 0, sources: [], baselineReady: false, isRefreshing: false })
    expect(listener).not.toHaveBeenCalled()

    store.publish([baseline])
    expect(store.getSnapshot()).toEqual({
      revision: 1,
      sources: [latestRealtime, { ...baseline, unreadCount: 0 }],
      baselineReady: true,
      isRefreshing: false,
    })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('keeps read acknowledgements authoritative over stale realtime projections', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', kind: 'group_chat' as const, displayName: '项目群',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])

    store.updateReadAck('source-1', 'chat:group-1', 8, 0)
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, latestSequence: 8 })
    expect(store.totalUnreadCount()).toBe(0)

    store.upsert({ ...source, unreadCount: 2, activeAtMillis: 11, latestSequence: 8 }, 'chat:group-1')
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, latestSequence: 8 })
    expect(store.totalUnreadCount()).toBe(0)
  })

  it('keeps the read watermark when a renamed projection changes sourceRef', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-old-name', kind: 'group_chat' as const, displayName: '旧群名',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.updateReadAck('source-old-name', 'chat:group-1', 8, 0)

    store.upsert({
      ...source,
      sourceRef: 'source-new-name',
      displayName: '新群名',
      activeAtMillis: 11,
      unreadCount: 2,
      latestSequence: 8,
    }, 'chat:group-1')

    expect(store.getSnapshot().sources).toHaveLength(1)
    expect(store.getSnapshot().sources[0]).toMatchObject({
      sourceRef: 'source-new-name',
      displayName: '新群名',
      unreadCount: 0,
      latestSequence: 8,
    })
    expect(store.unreadCount('source-old-name')).toBe(0)
    expect(store.unreadCount('source-new-name')).toBe(0)
  })

  it('keeps the read watermark when a refreshed source list changes sourceRef after rename', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-old-name', sourceKey: 'chat:group-1', kind: 'group_chat' as const, displayName: '旧群名',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.updateReadAck('source-old-name', undefined, 8, 0)

    store.publish([{
      ...source,
      sourceRef: 'source-new-name',
      displayName: '新群名',
      activeAtMillis: 11,
      unreadCount: 2,
      latestSequence: 8,
    }])

    expect(store.getSnapshot().sources).toHaveLength(1)
    expect(store.getSnapshot().sources[0]).toMatchObject({
      sourceRef: 'source-new-name',
      sourceKey: 'chat:group-1',
      displayName: '新群名',
      unreadCount: 0,
      latestSequence: 8,
    })
    expect(store.totalUnreadCount()).toBe(0)
  })

  it('allows unread badges to return when a realtime projection moves beyond the read watermark', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.updateReadAck('source-1', 'chat:private-1', 8, 0)

    store.upsert({ ...source, latestPreview: '新消息', activeAtMillis: 12, unreadCount: 1, latestSequence: 9 }, 'chat:private-1')
    expect(store.getSnapshot().sources[0]).toMatchObject({ latestPreview: '新消息', unreadCount: 1, latestSequence: 9 })
    expect(store.totalUnreadCount()).toBe(1)
  })

  it('clears unread badges immediately for an optimistic read intent and confirms it with the server ack', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', sourceKey: 'chat:private-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])

    expect(store.markReadOptimistic(source, 'chat:private-1', 8)).toBe(true)
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, latestSequence: 8 })
    expect(store.totalUnreadCount()).toBe(0)
    expect(store.hasOptimisticRead('source-1', 'chat:private-1', 8)).toBe(true)

    store.updateReadAck('source-1', 'chat:private-1', 8, 0)
    expect(store.hasOptimisticRead('source-1', 'chat:private-1', 8)).toBe(false)
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, latestSequence: 8 })
  })

  it('clears unread badges immediately even before the root directory baseline is published', () => {
    const store = new ArkmeChatDirectoryStore()
    const cachedSource = {
      sourceRef: 'cached-source-1', sourceKey: 'chat:cached-private-1', kind: 'private_chat' as const, displayName: '缓存联系人',
      activeAtMillis: 20, unreadCount: 3, latestSequence: 12,
    }
    const otherCachedSource = {
      sourceRef: 'cached-source-2', sourceKey: 'chat:cached-private-2', kind: 'private_chat' as const, displayName: '另一个缓存联系人',
      activeAtMillis: 19, unreadCount: 4, latestSequence: 10,
    }

    expect(store.markReadOptimistic(cachedSource, 'chat:cached-private-1', 12, [cachedSource, otherCachedSource])).toBe(true)
    expect(store.getSnapshot().sources).toHaveLength(2)
    expect(store.getSnapshot().sources[0]).toMatchObject({
      sourceRef: 'cached-source-1',
      unreadCount: 0,
      latestSequence: 12,
    })
    expect(store.getSnapshot().sources[1]).toMatchObject({
      sourceRef: 'cached-source-2',
      unreadCount: 4,
      latestSequence: 10,
    })
    expect(store.totalUnreadCount()).toBe(4)

    store.publish([{ ...cachedSource, unreadCount: 3 }, otherCachedSource])
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, latestSequence: 12 })
    expect(store.getSnapshot().sources[1]).toMatchObject({ unreadCount: 4, latestSequence: 10 })
  })

  it('applies server ack unread count when confirmation arrives before the root baseline', () => {
    const store = new ArkmeChatDirectoryStore()
    const cachedSource = {
      sourceRef: 'cached-source-1', sourceKey: 'chat:cached-private-1', kind: 'private_chat' as const, displayName: '缓存联系人',
      activeAtMillis: 20, unreadCount: 3, latestSequence: 12,
    }

    store.markReadOptimistic(cachedSource, 'chat:cached-private-1', 12, [cachedSource])
    store.updateReadAck('cached-source-1', 'chat:cached-private-1', 12, 1)

    expect(store.hasOptimisticRead('cached-source-1', 'chat:cached-private-1', 12)).toBe(false)
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 1, latestSequence: 12 })
    expect(store.totalUnreadCount()).toBe(1)

    store.publish([{ ...cachedSource, unreadCount: 3 }])
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 1, latestSequence: 12 })
  })

  it('keeps stale projections from reviving an optimistically cleared unread badge', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', sourceKey: 'chat:private-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.markReadOptimistic(source, 'chat:private-1', 8)

    store.upsert({ ...source, activeAtMillis: 11, unreadCount: 2, latestSequence: 8 })
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, latestSequence: 8 })
    expect(store.totalUnreadCount()).toBe(0)
  })

  it('lets newer realtime projections show unread even while an older optimistic read is pending', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', sourceKey: 'chat:private-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.markReadOptimistic(source, 'chat:private-1', 8)

    store.upsert({ ...source, latestPreview: '新消息', activeAtMillis: 12, unreadCount: 1, latestSequence: 9 })
    expect(store.getSnapshot().sources[0]).toMatchObject({ latestPreview: '新消息', unreadCount: 1, latestSequence: 9 })
    expect(store.totalUnreadCount()).toBe(1)
  })

  it('removes only the optimistic watermark when the mark-read request fails before confirmation', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', sourceKey: 'chat:private-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.markReadOptimistic(source, 'chat:private-1', 8)

    expect(store.rejectOptimisticRead('source-1', 'chat:private-1', 8)).toBe(true)
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 2, latestSequence: 8 })
    expect(store.totalUnreadCount()).toBe(2)
  })

  it('does not restore stale source fields when rejecting an optimistic read after a newer projection arrived', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', sourceKey: 'chat:private-1', kind: 'private_chat' as const, displayName: '联系人',
      latestPreview: '旧消息', activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.markReadOptimistic(source, 'chat:private-1', 8)
    store.upsert({ ...source, latestPreview: '当前投影', activeAtMillis: 11, unreadCount: 2, latestSequence: 8 })

    expect(store.rejectOptimisticRead('source-1', 'chat:private-1', 8)).toBe(true)
    expect(store.getSnapshot().sources[0]).toMatchObject({
      latestPreview: '当前投影',
      activeAtMillis: 11,
      unreadCount: 2,
      latestSequence: 8,
    })
  })

  it('does not let lower-sequence projections clear newer unread state', () => {
    const store = new ArkmeChatDirectoryStore()
    const source = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 10, unreadCount: 2, latestSequence: 8,
    }
    store.publish([source])
    store.updateReadAck('source-1', 'chat:private-1', 8, 0)
    store.upsert({ ...source, latestPreview: '新消息', activeAtMillis: 12, unreadCount: 1, latestSequence: 9 }, 'chat:private-1')

    store.upsert({ ...source, latestPreview: '旧消息', activeAtMillis: 13, unreadCount: 0, latestSequence: 8 }, 'chat:private-1')
    expect(store.getSnapshot().sources[0]).toMatchObject({
      activeAtMillis: 12,
      latestPreview: '新消息',
      unreadCount: 1,
      latestSequence: 9,
    })
    expect(store.totalUnreadCount()).toBe(1)
  })

  it('drops pending realtime mutations and stale refresh results when the account changes', async () => {
    let resolveFirst: ((value: {
      directory: 'root'; items: Array<{
        sourceRef: string; kind: 'private_chat'; displayName: string; activeAtMillis: number; unreadCount: number
      }>; hasMore: false
    }) => void) | undefined
    const firstPage = new Promise<{
      directory: 'root'; items: Array<{
        sourceRef: string; kind: 'private_chat'; displayName: string; activeAtMillis: number; unreadCount: number
      }>; hasMore: false
    }>(resolve => { resolveFirst = resolve })
    const loadPage = vi.fn(async () => await firstPage)
    const store = new ArkmeChatDirectoryStore({ loadPage })
    store.activateAccount(1001)
    store.upsert({
      sourceRef: 'account-a-realtime', kind: 'private_chat', displayName: '账号 A', activeAtMillis: 2, unreadCount: 1,
    })
    const staleRefresh = store.refreshRoot()

    store.activateAccount(2002)
    resolveFirst?.({
      directory: 'root',
      items: [{ sourceRef: 'account-a-baseline', kind: 'private_chat', displayName: '账号 A', activeAtMillis: 1, unreadCount: 0 }],
      hasMore: false,
    })
    await staleRefresh

    expect(store.getSnapshot().sources).toEqual([])
    expect(store.unreadCount('account-a-realtime')).toBe(0)
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
