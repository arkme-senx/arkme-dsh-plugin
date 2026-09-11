import { describe, expect, it, vi } from 'vitest'
import * as attentionProjection from '../src/conversation-attention.js'
import { arkmeConversationBadgeTotal, visibleArkmeConversations, nextArkmeUnreadConversation } from '../src/conversation-attention.js'
import { arkmeBadgeUnreadCount } from '../src/chat-attention.js'
import { ArkmeChatDirectoryStore } from '../src/client/chat-directory-store.js'
import type { ArkmeBotSummary, ArkmeSourceItem } from '../src/types.js'

const source = (id: string, unreadCount: number, extra = {}): ArkmeSourceItem => ({ sourceKey: id, sourceRef: id,
  kind: 'private_chat', displayName: id, activeAtMillis: 1, latestSequence: 10, unreadCount, ...extra })

describe('conversation badge invariant', () => {
  it('sums visible rows exactly, deduplicates Chat Bots, and excludes muted and removed rows', () => {
    const sources = [source('a', 2), source('muted', 9, { isMuted: true }), source('hidden', 7), source('bot', 3)]
    const bots = [{ botRef: 'b', name: 'Bot', conversationProjection: 'chat', chatSourceKey: 'bot', unreadCount: 99 }] as ArkmeBotSummary[]
    const visibility = [...sources.map(row => ({ entryKind: 'source' as const, entryRef: row.sourceRef, hidden: row.sourceRef === 'hidden' })),
      { entryKind: 'bot' as const, entryRef: 'b', hidden: false }]
    const rows = visibleArkmeConversations(sources, bots, visibility)
    expect(arkmeConversationBadgeTotal(sources, bots, visibility)).toBe(5)
    expect(arkmeConversationBadgeTotal(sources, bots, visibility)).toBe([...rows.sources, ...rows.bots].reduce((n, row) => n + arkmeBadgeUnreadCount(row), 0))
    const store = new ArkmeChatDirectoryStore()
    store.activateAccount('test:1')
    store.applyHostPage({ directory: 'root', items: sources, hasMore: true,
      projection: { revision: 1, phase: 'syncing', cachedAtMillis: 1, bots, visibility } })
    expect(store.totalBadgeUnreadCount()).toBe(5)
    store.updateReadAck('a', 'a', 10, 0)
    expect(store.totalBadgeUnreadCount()).toBe(3)
    store.applyHostPage({ directory: 'root', items: [source('page2', 4)], hasMore: false,
      projection: { revision: 2, phase: 'complete', cachedAtMillis: 2, bots, visibility: [{ entryKind: 'source', entryRef: 'page2', hidden: false }] } })
    expect(store.totalBadgeUnreadCount()).toBe(7)
    store.updateReadAck('bot', 'bot', 10, 0)
    expect(store.totalBadgeUnreadCount()).toBe(4)
    store.activateAccount('test:2')
    expect(store.totalBadgeUnreadCount()).toBe(0)
  })
})


it('cycles numeric unread, muted unread, then top; an all-read list does not move', () => {
  const rows = [
    { key: 'read', unreadCount: 0 }, { key: 'muted-read', unreadCount: 0, isMuted: true },
    { key: 'muted-unread', unreadCount: 9, isMuted: true }, { key: 'a', unreadCount: 1 }, { key: 'b', unreadCount: 2 },
  ]
  expect(nextArkmeUnreadConversation(rows)).toEqual(rows[3])
  expect(nextArkmeUnreadConversation(rows, 'a')).toEqual(rows[4])
  expect(nextArkmeUnreadConversation(rows, 'b')).toEqual(rows[2])
  expect(nextArkmeUnreadConversation(rows, 'muted-unread')).toEqual({ top: true })
  expect(nextArkmeUnreadConversation(rows)).toEqual(rows[3])
  expect(nextArkmeUnreadConversation(rows.slice(0, 3))).toEqual(rows[2])
  expect(nextArkmeUnreadConversation(rows.slice(0, 3), 'muted-unread')).toEqual({ top: true })
  expect(nextArkmeUnreadConversation(rows.slice(0, 2))).toBeUndefined()
})


it('shares a computed row/total snapshot, ignores metadata-only updates, and invalidates on unread/visibility/account changes', () => {
  const store = new ArkmeChatDirectoryStore()
  store.activateAccount('test:computed')
  const rows = [source('a', 2), source('b', 3)]
  store.applyHostPage({ directory: 'root', items: rows, hasMore: true, projection: {
    revision: 1, phase: 'syncing', cachedAtMillis: 1, bots: [],
    visibility: rows.map(row => ({ entryKind: 'source', entryRef: row.sourceRef, hidden: false })),
  } })
  const project = vi.spyOn(attentionProjection, 'projectArkmeConversationAttention')
  try {
    const first = store.getConversationSnapshot()
    expect(first.badgeCount).toBe(5)
    for (let i = 0; i < 1000; i++) {
      expect(store.getConversationSnapshot()).toBe(first)
      expect(store.totalBadgeUnreadCount('test:computed')).toBe(5)
    }
    store.applyHostPage({ directory: 'root', items: [], hasMore: false,
      projection: { revision: 2, phase: 'complete', cachedAtMillis: 2, bots: [], visibility: [] } })
    expect(store.getConversationSnapshot()).toBe(first)
    expect(project).toHaveBeenCalledTimes(1)
    store.updateReadAck('a', 'a', 10, 0)
    const afterRead = store.getConversationSnapshot()
    expect(afterRead.badgeCount).toBe(3)
    expect(afterRead.badgeCount).toBe([...afterRead.sources, ...afterRead.bots].reduce((sum, row) => sum + arkmeBadgeUnreadCount(row), 0))
    store.applyHostPage({ directory: 'root', items: [], hasMore: false, projection: { revision: 3, phase: 'complete', cachedAtMillis: 3, bots: [],
      visibility: [{ entryKind: 'source', entryRef: 'b', hidden: true }] } })
    expect(store.getConversationSnapshot().badgeCount).toBe(0)
    expect(project).toHaveBeenCalledTimes(3)
    store.activateAccount('test:other')
    expect(store.getConversationSnapshot()).toMatchObject({ sources: [], bots: [], badgeCount: 0, accountScope: 'test:other' })
    expect(store.totalBadgeUnreadCount('test:computed')).toBe(0)
  } finally { project.mockRestore() }
})

it('computes once for repeated reads of 10000 conversations (timings are informational)', () => {
  const count = 10000, reads = 200
  const rows = Array.from({ length: count }, (_, i) => source(String(i), 1))
  const visibility = rows.map(row => ({ entryKind: 'source' as const, entryRef: row.sourceRef, hidden: false }))
  const bots: ArkmeBotSummary[] = []
  const store = new ArkmeChatDirectoryStore()
  store.activateAccount('test:performance')
  store.publish(rows)
  store.applyHostPage({ directory: 'root', items: [], hasMore: false,
    projection: { revision: 1, phase: 'complete', cachedAtMillis: 1, bots, visibility } })
  let start = performance.now()
  for (let i = 0; i < reads; i++) expect(arkmeConversationBadgeTotal(rows, bots, visibility)).toBe(count)
  const uncachedMs = performance.now() - start
  const project = vi.spyOn(attentionProjection, 'projectArkmeConversationAttention')
  try {
    start = performance.now()
    for (let i = 0; i < reads; i++) expect(store.totalBadgeUnreadCount('test:performance')).toBe(count)
    const cachedMs = performance.now() - start
    expect(project).toHaveBeenCalledTimes(1)
    process.stdout.write(JSON.stringify({ workload: 'computed-unread', conversations: count, reads, computations: project.mock.calls.length, uncachedMs, cachedMs }) + '\n')
  } finally { project.mockRestore() }
}, 10000)


it('keeps confirmed visibility across capability rotation until an explicit new visibility result arrives', () => {
  const store = new ArkmeChatDirectoryStore()
  store.activateAccount('test:ref-rotation')
  const original = source('stable-chat', 2, { sourceRef: 'capability-seq10', avatarRef: 'same-avatar' })
  store.applyHostPage({ directory: 'root', items: [original], hasMore: false, projection: {
    revision: 1, phase: 'complete', cachedAtMillis: 1, bots: [],
    visibility: [{ entryKind: 'source', entryRef: original.sourceRef, hidden: false }],
  } })
  const totals: number[] = []
  const stop = store.subscribe(() => { totals.push(store.getConversationSnapshot().badgeCount) })
  const updated = { ...original, sourceRef: 'capability-seq11', latestSequence: 11, unreadCount: 3, activeAtMillis: 2 }
  store.upsert(updated)
  expect(store.getConversationSnapshot().sources).toHaveLength(1)
  expect(store.getConversationSnapshot().sources[0]).toMatchObject({ sourceRef: updated.sourceRef, avatarRef: 'same-avatar' })
  expect(totals).toEqual([3])
  store.applyHostPage({ directory: 'root', items: [updated], hasMore: false, projection: {
    revision: 2, phase: 'complete', cachedAtMillis: 2, bots: [],
    visibility: [{ entryKind: 'source', entryRef: updated.sourceRef, hidden: false }],
  } })
  expect(totals).not.toContain(0)
  const hidden = { ...updated, sourceRef: 'capability-seq12', latestSequence: 12 }
  store.applyHostPage({ directory: 'root', items: [hidden], hasMore: false, projection: {
    revision: 3, phase: 'complete', cachedAtMillis: 3, bots: [],
    visibility: [{ entryKind: 'source', entryRef: hidden.sourceRef, hidden: true }],
  } })
  expect(store.getConversationSnapshot().sources).toHaveLength(0)
  store.upsert({ ...hidden, sourceRef: 'capability-seq13', latestSequence: 13 })
  expect(store.getConversationSnapshot().sources).toHaveLength(0)
  expect(store.getSnapshot().projection?.visibility).toEqual([{ entryKind: 'source', entryRef: 'capability-seq13', hidden: true }])
  stop()
})

it('loads and replays a full cached directory without changing the computed result (workload)', () => {
  const size = 2000
  const rows = Array.from({ length: size }, (_, i) => source(String(i), 1, { activeAtMillis: size - i }))
  const visibility = rows.map(row => ({ entryKind: 'source' as const, entryRef: row.sourceRef, hidden: false }))
  const page = { directory: 'root' as const, items: rows, hasMore: false, projection: { revision: 1, phase: 'complete' as const, cachedAtMillis: 1, bots: [], visibility } }
  const store = new ArkmeChatDirectoryStore()
  store.activateAccount('test:bulk')
  let start = performance.now()
  store.applyHostPage(page)
  const coldMs = performance.now() - start
  const computed = store.getConversationSnapshot()
  expect(computed.badgeCount).toBe(size)
  start = performance.now()
  store.applyHostPage(structuredClone(page))
  const replayMs = performance.now() - start
  expect(store.getConversationSnapshot()).toBe(computed)
  process.stdout.write(JSON.stringify({ workload: 'full-cached-directory', size, coldMs, replayMs }) + '\n')
}, 10000)

it('retains a Bot visibility decision when its opaque handle changes but its stable directory key does not', () => {
  const store = new ArkmeChatDirectoryStore()
  store.activateAccount('test:bot-rotation')
  const bot = { botRef: 'old', directoryKey: 'stable-bot', name: 'Bot', unreadCount: 2 } as ArkmeBotSummary
  store.updateBots([bot])
  store.hydrateVisibility([{ entryKind: 'bot', entryRef: 'old', hidden: false }])
  store.updateBots([{ ...bot, botRef: 'new' }])
  expect(store.getConversationSnapshot().badgeCount).toBe(2)
  expect(store.getConversationSnapshot().bots[0]?.botRef).toBe('new')
  expect(store.getConversationSnapshot().visibility).toEqual([{ entryKind: 'bot', entryRef: 'new', hidden: false }])
})
