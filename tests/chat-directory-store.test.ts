import { describe, expect, it, vi } from 'vitest'

const { callArkmeMock } = vi.hoisted(() => ({ callArkmeMock: vi.fn() }))

vi.mock('../src/client/api.js', () => ({ callArkme: callArkmeMock }))

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

  it('deduplicates rotated capability refs for the same stable chat across directory pages', async () => {
    const loadPage = vi.fn(async (cursor?: string) => cursor === undefined
      ? {
          directory: 'root' as const,
          items: [{
            sourceRef: 'source-current', sourceKey: 'chat:stable', kind: 'group_chat' as const,
            displayName: '项目群', activeAtMillis: 2, unreadCount: 0,
          }],
          hasMore: true,
          nextCursor: 'next',
        }
      : {
          directory: 'root' as const,
          items: [{
            sourceRef: 'source-stale', sourceKey: 'chat:stable', kind: 'group_chat' as const,
            displayName: '项目群', activeAtMillis: 1, unreadCount: 0,
          }],
          hasMore: false,
        })
    const store = new ArkmeChatDirectoryStore({ loadPage })

    await expect(store.refreshRoot()).resolves.toMatchObject([{ sourceRef: 'source-current' }])
    expect(store.getSnapshot().sources).toHaveLength(1)
  })

  it('loads the root directory in 20-item pages while continuing through the server cursor', async () => {
    callArkmeMock.mockReset()
      .mockResolvedValueOnce({
        directory: 'root',
        items: [{ sourceRef: 'source-1', kind: 'private_chat', displayName: '第一', activeAtMillis: 2, unreadCount: 0 }],
        hasMore: true,
        nextCursor: 'next-page',
      })
      .mockResolvedValueOnce({
        directory: 'root',
        items: [{ sourceRef: 'source-2', kind: 'group_chat', displayName: '第二', activeAtMillis: 1, unreadCount: 0 }],
        hasMore: false,
      })
    const store = new ArkmeChatDirectoryStore()

    await expect(store.refreshRoot({ force: true })).resolves.toHaveLength(2)
    expect(callArkmeMock).toHaveBeenNthCalledWith(1, 'sources.list', {
      directory: 'root', limit: 20, refresh: true,
    })
    expect(callArkmeMock).toHaveBeenNthCalledWith(2, 'sources.list', {
      directory: 'root', limit: 20, cursor: 'next-page', refresh: true,
    })
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

  it('keeps the directory snapshot stable when a silent refresh only advances avatar computation time', async () => {
    const source = {
      sourceRef: 'group-1', sourceKey: 'chat:group-1', kind: 'group_chat' as const, displayName: '项目群',
      activeAtMillis: 10, unreadCount: 0,
      groupAvatar: {
        memberCount: 1, strategy: 'owner_recent_speakers_v1', computedAtMillis: 1,
        slots: [{ avatarRef: 'avatar-a' }],
      },
    }
    const store = new ArkmeChatDirectoryStore({
      loadPage: async () => ({
        directory: 'root', items: [{
          ...source,
          groupAvatar: { ...source.groupAvatar, computedAtMillis: 2 },
        }], hasMore: false,
      }),
    })
    store.publish([source])
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    await store.refreshRoot({ force: true, silent: true })

    expect(store.getSnapshot()).toBe(before)
    expect(store.getSnapshot().sources[0]).toBe(source)
    expect(listener).not.toHaveBeenCalled()
  })

  it('publishes one silent-refresh revision and preserves unchanged row identities for real directory changes', async () => {
    const unchanged = {
      sourceRef: 'private-1', sourceKey: 'chat:private-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 20, unreadCount: 0, avatarRef: 'avatar-a',
    }
    const changed = {
      sourceRef: 'group-1', sourceKey: 'chat:group-1', kind: 'group_chat' as const, displayName: '旧群名',
      activeAtMillis: 10, unreadCount: 0,
    }
    const store = new ArkmeChatDirectoryStore({
      loadPage: async () => ({
        directory: 'root', items: [unchanged, { ...changed, displayName: '新群名' }], hasMore: false,
      }),
    })
    store.publish([unchanged, changed])
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    await store.refreshRoot({ force: true, silent: true })

    const after = store.getSnapshot()
    expect(after.revision).toBe(before.revision + 1)
    expect(after.isRefreshing).toBe(false)
    expect(after.sources[0]).toBe(before.sources[0])
    expect(after.sources[1]).not.toBe(before.sources[1])
    expect(after.sources[1]?.displayName).toBe('新群名')
    expect(listener).toHaveBeenCalledOnce()
  })

  it('compares ordered avatarRefs and structured groupAvatar as separate projections', async () => {
    const source = {
      sourceRef: 'group-1', sourceKey: 'chat:group-1', kind: 'group_chat' as const, displayName: '项目群',
      activeAtMillis: 10, unreadCount: 0, avatarRefs: ['legacy-a'],
      groupAvatar: {
        memberCount: 1, strategy: 'owner_recent_speakers_v1', computedAtMillis: 1,
        slots: [{ avatarRef: 'avatar-a', fallback: { kind: 'default' as const } }],
      },
    }
    let incoming = { ...source, avatarRefs: ['legacy-b'] }
    const store = new ArkmeChatDirectoryStore({
      loadPage: async () => ({ directory: 'root', items: [incoming], hasMore: false }),
    })
    store.publish([source])
    const initialRevision = store.getSnapshot().revision

    await store.refreshRoot({ force: true, silent: true })
    expect(store.getSnapshot().revision).toBe(initialRevision + 1)
    expect(store.getSnapshot().sources[0]?.avatarRefs).toEqual(['legacy-b'])

    incoming = {
      ...incoming,
      groupAvatar: {
        ...source.groupAvatar,
        computedAtMillis: 2,
        slots: [{ avatarRef: 'avatar-b', fallback: { kind: 'default' as const } }],
      },
    }
    await store.refreshRoot({ force: true, silent: true })
    expect(store.getSnapshot().revision).toBe(initialRevision + 2)
    expect(store.getSnapshot().sources[0]?.groupAvatar?.slots[0]?.avatarRef).toBe('avatar-b')

    incoming = {
      ...incoming,
      groupAvatar: {
        ...incoming.groupAvatar,
        computedAtMillis: 3,
        slots: [{ avatarRef: 'avatar-b', fallback: { kind: 'phone_default' as const, colorIndex: 3, label: 'B' } }],
      },
    }
    await store.refreshRoot({ force: true, silent: true })
    expect(store.getSnapshot().revision).toBe(initialRevision + 3)
    expect(store.getSnapshot().sources[0]?.groupAvatar?.slots[0]?.fallback).toEqual({
      kind: 'phone_default', colorIndex: 3, label: 'B',
    })
  })

  it('keeps the last good directory usable after a silent refresh failure and allows retry', async () => {
    const source = {
      sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '联系人',
      activeAtMillis: 1, unreadCount: 0,
    }
    const loadPage = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ directory: 'root', items: [{ ...source, displayName: '新联系人' }], hasMore: false })
    const store = new ArkmeChatDirectoryStore({ loadPage })
    store.publish([source])
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)

    await expect(store.refreshRoot({ force: true, silent: true })).rejects.toThrow('offline')
    expect(store.getSnapshot()).toBe(before)
    expect(store.getSnapshot().isRefreshing).toBe(false)
    expect(listener).not.toHaveBeenCalled()

    await expect(store.refreshRoot({ force: true, silent: true })).resolves.toMatchObject([{ displayName: '新联系人' }])
    expect(loadPage).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().sources[0]?.displayName).toBe('新联系人')
  })

  it('shows user-requested refresh feedback when it joins a silent refresh already in flight', async () => {
    const page = {
      directory: 'root' as const,
      items: [{
        sourceRef: 'source-1', kind: 'private_chat' as const, displayName: '联系人',
        activeAtMillis: 1, unreadCount: 0,
      }],
      hasMore: false,
    }
    let resolvePage!: (value: typeof page) => void
    const store = new ArkmeChatDirectoryStore({
      loadPage: async () => await new Promise<typeof page>(resolve => { resolvePage = resolve }),
    })
    store.publish(page.items)

    const background = store.refreshRoot({ force: true, silent: true })
    expect(store.getSnapshot().isRefreshing).toBe(false)
    const userRefresh = store.refreshRoot({ force: true })
    expect(store.getSnapshot().isRefreshing).toBe(true)

    resolvePage(page)
    await Promise.all([background, userRefresh])
    expect(store.getSnapshot().isRefreshing).toBe(false)
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
      activeAtMillis: 10, unreadCount: 2, hasUnreadMention: true, latestSequence: 8,
    }
    store.publish([source])

    store.updateReadAck('source-1', 'chat:group-1', 8, 0)
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, hasUnreadMention: false, latestSequence: 8 })
    expect(store.totalUnreadCount()).toBe(0)

    store.upsert({ ...source, unreadCount: 2, activeAtMillis: 11, latestSequence: 8 }, 'chat:group-1')
    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 0, hasUnreadMention: false, latestSequence: 8 })
    expect(store.totalUnreadCount()).toBe(0)
  })

  it('preserves unread mention flags when realtime projections omit the backend flag', () => {
    const store = new ArkmeChatDirectoryStore()
    const mentioned = {
      sourceRef: 'source-1', sourceKey: 'chat:group-1', kind: 'group_chat' as const, displayName: '项目群',
      activeAtMillis: 10, unreadCount: 1, hasUnreadMention: true, latestSequence: 8,
    }
    store.publish([mentioned])

    store.upsert({
      sourceRef: 'source-1', sourceKey: 'chat:group-1', kind: 'group_chat' as const, displayName: '项目群',
      activeAtMillis: 11, unreadCount: 1, latestSequence: 9,
    }, 'chat:group-1')

    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 1, hasUnreadMention: true, latestSequence: 9 })
  })

  it('clears an old unread mention flag when a newer projection explicitly says false', () => {
    const store = new ArkmeChatDirectoryStore()
    store.publish([{
      sourceRef: 'source-1', sourceKey: 'chat:group-1', kind: 'group_chat', displayName: '项目群',
      activeAtMillis: 10, unreadCount: 2, hasUnreadMention: true, latestSequence: 8,
    }])

    store.upsert({
      sourceRef: 'source-1', sourceKey: 'chat:group-1', kind: 'group_chat', displayName: '项目群',
      activeAtMillis: 11, unreadCount: 1, hasUnreadMention: false, latestSequence: 9,
    }, 'chat:group-1')

    expect(store.getSnapshot().sources[0]).toMatchObject({ unreadCount: 1, hasUnreadMention: false, latestSequence: 9 })
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
    store.publish([{ source: { sourceRef: 'source-1', sourceKey: 'chat:stable-1' }, items: [{
      itemUid: 'item-1', senderName: '联系人', isMe: false, sendAtMillis: 1,
      title: '', textContent: '新消息', status: 1, sequence: 9,
    }] }])
    expect(store.getSnapshot()).toMatchObject({ revision: 1 })
    expect(store.getSnapshot().itemsBySourceKey['chat:stable-1']?.[0]).toMatchObject({ itemUid: 'item-1', sequence: 9 })
  })

  it('keeps a source delta snapshot stable when only another conversation changes', () => {
    const store = new ArkmeChatTimelineDeltaStore()
    store.publish([{ source: { sourceRef: 'source-1', sourceKey: 'chat:stable-1' }, items: [{
      itemUid: 'item-1', senderName: '联系人', isMe: false, sendAtMillis: 1,
      title: '', textContent: '第一条', status: 1, sequence: 1,
    }] }])
    const selected = store.getSnapshotForSource('chat:stable-1')

    store.publish([{ source: { sourceRef: 'source-2', sourceKey: 'chat:stable-2' }, items: [{
      itemUid: 'item-2', senderName: '其他人', isMe: false, sendAtMillis: 2,
      title: '', textContent: '其他会话', status: 1, sequence: 2,
    }] }])

    expect(store.getSnapshotForSource('chat:stable-1')).toBe(selected)
    expect(store.getSnapshotForSource('chat:stable-2').items[0]).toMatchObject({ itemUid: 'item-2' })
  })

  it('clears timeline deltas when the authenticated account changes', () => {
    const store = new ArkmeChatTimelineDeltaStore()
    store.activateAccount(1001)
    store.publish([{ source: { sourceRef: 'source-a', sourceKey: 'chat:shared-key' }, items: [{
      itemUid: 'account-a-item', senderName: '账号 A', isMe: false, sendAtMillis: 1,
      title: '', textContent: '账号 A 的消息', status: 1, sequence: 9,
    }] }])

    store.activateAccount(2002)

    expect(store.getSnapshot()).toEqual({ revision: 2, itemsBySourceKey: {} })
  })

  it('treats the same numeric user id in different environments as different accounts', () => {
    const directory = new ArkmeChatDirectoryStore()
    const deltas = new ArkmeChatTimelineDeltaStore()
    directory.activateAccount('test:42')
    deltas.activateAccount('test:42')
    directory.publish([{
      sourceRef: 'source-test', sourceKey: 'chat:same', kind: 'private_chat', displayName: '测试环境',
      activeAtMillis: 1, unreadCount: 0,
    }])
    deltas.publish([{ source: { sourceRef: 'source-test', sourceKey: 'chat:same', latestSequence: 1 }, items: [{
      itemUid: 'item-test', senderName: '测试', isMe: false, sendAtMillis: 1,
      title: '', textContent: '测试环境', status: 1, sequence: 1,
    }] }])

    directory.activateAccount('prod:42')
    deltas.activateAccount('prod:42')

    expect(directory.getSnapshot().sources).toEqual([])
    expect(deltas.getSnapshotForSource('chat:same').items).toEqual([])
  })

  it('clears both aggregate and source-scoped delta snapshots explicitly', () => {
    const store = new ArkmeChatTimelineDeltaStore()
    store.publish([{ source: { sourceRef: 'source-a', sourceKey: 'chat:a', latestSequence: 1 }, items: [{
      itemUid: 'item-a', senderName: '账号 A', isMe: false, sendAtMillis: 1,
      title: '', textContent: '消息', status: 1, sequence: 1,
    }] }])

    store.publish([])

    expect(store.getSnapshot().itemsBySourceKey).toEqual({})
    expect(store.getSnapshotForSource('chat:a')).toMatchObject({ revision: 0, items: [] })
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

  it('scopes interwoven invalidation snapshots to the affected source', () => {
    const store = new ArkmeInterwovenInvalidationStore()
    store.activateAccount(1001)
    const selected = store.getSnapshotForSource('chat:selected')
    const other = store.getSnapshotForSource('chat:other')

    store.invalidate('chat:other')

    expect(store.getSnapshotForSource('chat:selected')).toBe(selected)
    expect(store.getSnapshotForSource('chat:other')).not.toBe(other)

    const beforeGlobal = store.getSnapshotForSource('chat:selected')
    store.invalidate()
    expect(store.getSnapshotForSource('chat:selected')).not.toBe(beforeGlobal)
  })

  it('never reuses a lower scoped revision after bounded source eviction', () => {
    const store = new ArkmeInterwovenInvalidationStore()
    store.activateAccount(1001)
    store.invalidate('chat:selected')
    const firstRevision = store.getSnapshotForSource('chat:selected').revision
    for (let index = 0; index < 300; index += 1) store.invalidate(`chat:other:${String(index)}`)

    store.invalidate('chat:selected')

    expect(store.getSnapshotForSource('chat:selected').revision).toBeGreaterThan(firstRevision)
  })
})
