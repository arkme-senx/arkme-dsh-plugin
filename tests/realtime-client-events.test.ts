import { describe, expect, it } from 'vitest'
import { arkmeSelectedBotAffectedByChatDelta } from '../src/client/realtime-client-events.js'
import type { ArkmeBotSummary, ArkmeChatClientEvent } from '../src/types.js'

const selectedBot: ArkmeBotSummary = {
  botRef: 'bot-ref', name: 'Chat Bot', provider: 'webhook', description: '', status: 'online',
  directChatAvailable: true, privateChatOutboundEnabled: true, conversationProjection: 'chat',
  chatSourceKey: 'selected-chat-key',
}
const delta: Extract<ArkmeChatClientEvent, { type: 'sessions-delta' }> = {
  type: 'sessions-delta', revision: 1,
  updates: [{
    sourceKey: 'selected-chat-key',
    source: { sourceRef: 'source-ref', sourceKey: 'selected-chat-key', kind: 'private_chat', displayName: 'Chat', activeAtMillis: 1, unreadCount: 1 },
    timelineItems: [],
  }],
}

describe('Chat-owned Bot realtime invalidation', () => {
  it('matches only an exact opaque source key for the currently selected Chat Bot', () => {
    expect(arkmeSelectedBotAffectedByChatDelta(selectedBot, delta)).toBe(true)
    expect(arkmeSelectedBotAffectedByChatDelta(
      { ...selectedBot, chatSourceKey: 'other-key' }, delta,
    )).toBe(false)
    expect(arkmeSelectedBotAffectedByChatDelta(
      { ...selectedBot, conversationProjection: 'record', chatSourceKey: undefined }, delta,
    )).toBe(false)
    expect(arkmeSelectedBotAffectedByChatDelta(undefined, delta)).toBe(false)
  })

  it('does not infer identity from source refs or missing keys', () => {
    expect(arkmeSelectedBotAffectedByChatDelta(selectedBot, {
      ...delta,
      updates: [{ ...delta.updates[0]!, sourceKey: undefined, source: { ...delta.updates[0]!.source, sourceRef: 'selected-chat-key', sourceKey: undefined } }],
    })).toBe(false)
    expect(arkmeSelectedBotAffectedByChatDelta(selectedBot, {
      ...delta,
      updates: [{ ...delta.updates[0]!, source: { ...delta.updates[0]!.source, kind: 'group_chat' } }],
    })).toBe(false)
  })
})
