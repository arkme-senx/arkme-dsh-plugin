import { describe, expect, it } from 'vitest'
import { arkmeOpenCalendarAffectedByChatDelta } from '../src/client/realtime-client-events.js'
import type { ArkmeChatClientEvent } from '../src/types.js'

const delta: Extract<ArkmeChatClientEvent, { type: 'sessions-delta' }> = {
  type: 'sessions-delta', revision: 1,
  updates: [{
    sourceKey: 'selected-chat-key',
    source: { sourceRef: 'source-ref', sourceKey: 'selected-chat-key', kind: 'private_chat', displayName: 'Chat', activeAtMillis: 1, unreadCount: 1 },
    timelineItems: [{
      itemUid: 'message-1', senderName: 'Bot', isMe: false, sendAtMillis: 1,
      title: '', textContent: '新的标准时间线消息', status: 1,
    }],
  }],
}

describe('standard Chat calendar realtime invalidation', () => {
  it('refreshes an open calendar for a canonical timeline delta without Bot bubble state', () => {
    expect(arkmeOpenCalendarAffectedByChatDelta(true, delta)).toBe(true)
    expect(arkmeOpenCalendarAffectedByChatDelta(false, delta)).toBe(false)
  })

  it('ignores directory-only deltas that do not carry timeline items', () => {
    expect(arkmeOpenCalendarAffectedByChatDelta(true, {
      ...delta,
      updates: [{ ...delta.updates[0]!, timelineItems: [] }],
    })).toBe(false)
    expect(arkmeOpenCalendarAffectedByChatDelta(true, {
      ...delta,
      updates: [],
    })).toBe(false)
  })
})
