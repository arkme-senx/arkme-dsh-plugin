import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ArkmeInterwovenMention, ArkmeTimelineItem } from '../src/types.js'
import {
  ArkmeConversationMemoryCache,
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
})
