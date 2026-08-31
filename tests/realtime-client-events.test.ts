import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import {
  arkmeSelectedBotAffectedByChatDelta, useArkmeRealtimeClientEvents,
} from '../src/client/realtime-client-events.js'
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

describe('realtime reconcile routing', () => {
  it('does not refresh the directory when 75-second or lease reconnects publish refresh none', async () => {
    let source!: FakeEventSource
    class FakeEventSource {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor(readonly url: string) { source = this }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    const refreshRoot = vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
    const invalidate = vi.spyOn(arkmeInterwovenInvalidation, 'invalidate')
    vi.spyOn(arkmeMessageReadReceipts, 'reconcile').mockImplementation(() => undefined)

    function Harness() {
      useArkmeRealtimeClientEvents({ status: 'authenticated', revision: 1, userId: 10001 }, 1, false)
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(Harness)) })

    await act(async () => {
      source.onmessage?.({ data: JSON.stringify({
        type: 'reconcile', revision: 1, connected: true, connectionGeneration: 2, refresh: 'none',
      }) } as MessageEvent<string>)
    })

    expect(source.url).toBe('/arkme-self/api/events')
    expect(invalidate).toHaveBeenCalledOnce()
    expect(refreshRoot).not.toHaveBeenCalled()
    renderer.unmount()
  })
})
