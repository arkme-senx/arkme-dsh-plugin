import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ArkmeInterwovenMention, ArkmeTimelineItem } from '../src/types.js'
import {
  ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS,
  ArkmeConversationMemoryCache,
  arkmeConversationRestoredScrollTop,
  arkmeConversationTimelineDeltaItems,
  arkmeConversationTimelineSequenceRange,
  arkmeConversationTimelineContentEqual,
  arkmeShouldRefreshConversationTimeline,
  type ArkmeConversationTimelineSnapshot,
} from '../src/client/conversation-memory-cache.js'

function timeline(itemUid: string): ArkmeConversationTimelineSnapshot {
  const item: ArkmeTimelineItem = {
    itemUid,
    senderName: '小林',
    isMe: false,
    sendAtMillis: 1,
    title: '',
    textContent: itemUid,
    status: 1,
  }
  return { items: [item], aiPolishNotices: [], hasMore: false }
}

function moment(momentId: string): ArkmeInterwovenMention {
  return {
    momentId,
    momentRef: `opaque-${momentId}`,
    occurredAtMillis: 2,
    groupName: '即我大群',
    senderName: '小林',
    senderIsMe: false,
    summary: '@我',
    degraded: false,
  }
}

describe('ArkmeConversationMemoryCache', () => {
  it('stages interwoven moments until the ordinary timeline is ready', () => {
    const cache = new ArkmeConversationMemoryCache()
    const moments = [moment('one')]

    expect(cache.storeInterwovenMoments('private-one', moments)).toBe(false)
    expect(cache.getInterwovenMoments('private-one')).toBeUndefined()
    expect(cache.storeTimeline('private-one', timeline('message-one'))).toEqual(moments)
    expect(cache.getInterwovenMoments('private-one')).toEqual(moments)
  })

  it('restores each source independently and clears account-owned data', () => {
    const cache = new ArkmeConversationMemoryCache()
    cache.storeTimeline('private-one', timeline('message-one'))
    cache.storeTimeline('private-two', timeline('message-two'))

    expect(cache.getTimeline('private-one')?.items[0]?.itemUid).toBe('message-one')
    expect(cache.getTimeline('private-two')?.items[0]?.itemUid).toBe('message-two')
    cache.clear()
    expect(cache.getTimeline('private-one')).toBeUndefined()
    expect(cache.getTimeline('private-two')).toBeUndefined()
  })

  it('replaces an authoritative first-page snapshot instead of retaining absent messages', () => {
    const cache = new ArkmeConversationMemoryCache()
    cache.storeTimeline('group-one', timeline('message-before-refresh'))

    cache.storeTimeline('group-one', timeline('message-after-refresh'))

    expect(cache.getTimeline('group-one')?.items.map(item => item.itemUid))
      .toEqual(['message-after-refresh'])
  })

  it('keeps interwoven loading and failures out of the conversation markup', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('正在加载交织瞬间')
    expect(source).not.toContain('interwovenLoading')
    expect(source).not.toContain('interwovenError')
  })

  it('reuses a fresh authoritative timeline until its revision or latest sequence advances', () => {
    const nowMillis = 1_000_000
    const snapshot: ArkmeConversationTimelineSnapshot = {
      ...timeline('message-one'),
      fetchedAtMillis: nowMillis,
      refreshRevision: 4,
      latestSequence: 8,
    }

    expect(arkmeShouldRefreshConversationTimeline(snapshot, {
      nowMillis: nowMillis + ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS - 1,
      refreshRevision: 4,
      latestSequence: 8,
    })).toBe(false)
    expect(arkmeShouldRefreshConversationTimeline(snapshot, {
      nowMillis: nowMillis + 1,
      refreshRevision: 5,
      latestSequence: 8,
    })).toBe(true)
    expect(arkmeShouldRefreshConversationTimeline(snapshot, {
      nowMillis: nowMillis + 1,
      refreshRevision: 4,
      latestSequence: 9,
    })).toBe(true)
    expect(arkmeShouldRefreshConversationTimeline(snapshot, {
      nowMillis: nowMillis + ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS,
      refreshRevision: 4,
      latestSequence: 8,
    })).toBe(true)
  })

  it('detects semantic timeline changes without treating refreshed metadata as new content', () => {
    const before = { ...timeline('message-one'), fetchedAtMillis: 100, refreshRevision: 1 }
    const refreshed = { ...timeline('message-one'), fetchedAtMillis: 200, refreshRevision: 2 }
    const changed = { ...timeline('message-two'), fetchedAtMillis: 200, refreshRevision: 2 }

    expect(arkmeConversationTimelineContentEqual(before, refreshed)).toBe(true)
    expect(arkmeConversationTimelineContentEqual(before, changed)).toBe(false)
  })

  it('treats an anchored around window as distinct from the live latest window', () => {
    const latest = { ...timeline('message-one'), mode: 'latest' as const }
    const around = { ...timeline('message-one'), mode: 'around' as const }

    expect(arkmeConversationTimelineContentEqual(latest, around)).toBe(false)
  })

  it('keeps the around server range fixed when optimistic items extend beyond the window', () => {
    const aroundItems = [10, 11, 12].map(sequence => ({
      itemUid: `around-${String(sequence)}`, senderName: '小林', isMe: false, sendAtMillis: sequence,
      title: '', textContent: String(sequence), status: 1 as const, sequence,
    }))
    const range = arkmeConversationTimelineSequenceRange(aroundItems)
    const optimisticItem: ArkmeTimelineItem = {
      itemUid: 'optimistic-50', senderName: '我', isMe: true, sendAtMillis: 50,
      title: '', textContent: '本地发送', status: 1, sequence: 50,
    }
    const retainedMiddleItem: ArkmeTimelineItem = {
      itemUid: 'retained-20', senderName: '小林', isMe: false, sendAtMillis: 20,
      title: '', textContent: '不连续的实时数据', status: 1, sequence: 20,
    }

    expect(range).toEqual({ minimumSequence: 10, maximumSequence: 12 })
    expect(arkmeConversationTimelineDeltaItems(
      'around', range, [...aroundItems, optimisticItem], [retainedMiddleItem],
    )).toEqual([])
  })

  it('persists around mode, range and both paging cursors through local cache writes', () => {
    const cache = new ArkmeConversationMemoryCache()
    const base = timeline('message-one')
    cache.storeTimeline('private-one', {
      ...base,
      mode: 'around',
      aroundSequenceRange: { minimumSequence: 10, maximumSequence: 12 },
      hasMore: true,
      nextCursor: { beforeSequence: 10 },
      newerHasMore: true,
      newerCursor: { afterSequence: 12 },
    })

    cache.storeTimeline('private-one', {
      ...base,
      mode: 'around',
      hasMore: true,
      nextCursor: { beforeSequence: 10 },
      newerHasMore: true,
      newerCursor: { afterSequence: 12 },
    })

    expect(cache.getTimeline('private-one')).toMatchObject({
      mode: 'around',
      aroundSequenceRange: { minimumSequence: 10, maximumSequence: 12 },
      nextCursor: { beforeSequence: 10 },
      newerCursor: { afterSequence: 12 },
    })
  })

  it('restores each conversation viewport and keeps bottom-pinned conversations at the bottom', () => {
    const cache = new ArkmeConversationMemoryCache()
    cache.storeViewport('private-one', {
      scrollTop: 320,
      stickToBottom: false,
      anchorId: 'message:one',
      anchorOffset: 18,
    })

    const saved = cache.getViewport('private-one')
    expect(saved).toEqual({
      scrollTop: 320,
      stickToBottom: false,
      anchorId: 'message:one',
      anchorOffset: 18,
    })
    expect(arkmeConversationRestoredScrollTop(saved, {
      currentScrollTop: 320,
      scrollHeight: 1_400,
      anchorOffset: 38,
    })).toBe(340)
    expect(arkmeConversationRestoredScrollTop({ scrollTop: 0, stickToBottom: true }, {
      currentScrollTop: 0,
      scrollHeight: 1_400,
    })).toBe(1_400)
  })

  it('refreshes interwoven moments only after their explicit revision changes', () => {
    const cache = new ArkmeConversationMemoryCache()
    cache.storeTimeline('private-one', timeline('message-one'))
    cache.storeInterwovenMoments('private-one', [moment('one')], 3)

    expect(cache.isInterwovenFresh('private-one', 3)).toBe(true)
    expect(cache.isInterwovenFresh('private-one', 4)).toBe(false)
    expect(cache.isInterwovenFresh('private-two', 3)).toBe(false)
  })

  it('keeps async refreshes behind freshness checks and centralizes viewport writes', () => {
    const source = readFileSync(new URL('../src/client/ArkmeSidebar.tsx', import.meta.url), 'utf8')

    expect(source).toContain('arkmeShouldRefreshConversationTimeline(cachedTimeline')
    expect(source).toContain("setTimelineSkeletonSourceRef")
    expect(source).toContain('}, 120)')
    expect(source.match(/\.scrollTop\s*=/g)).toHaveLength(1)
    expect(source).toContain('arkmeConversationRestoredScrollTop')
  })
})
