import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { arkmeCalendarInvalidations } from '../src/client/calendar-invalidation-store.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import {
  arkmeChatDeltaCalendarDateStamps,
  arkmeChatDeltaSourceKeys,
  useArkmeRealtimeClientEvents,
} from '../src/client/realtime-client-events.js'
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('standard Chat realtime invalidation', () => {
  it('derives the exact scoped invalidation keys carried by a sessions delta', () => {
    expect(arkmeChatDeltaSourceKeys({
      ...delta,
      updates: [
        delta.updates[0]!,
        { ...delta.updates[0]!, sourceKey: 'other-key', source: { ...delta.updates[0]!.source, sourceKey: 'stale-key' } },
        delta.updates[0]!,
      ],
    })).toEqual(['selected-chat-key', 'other-key'])
  })

  it('derives Calendar dates from authoritative source and timeline timestamps', () => {
    expect(arkmeChatDeltaCalendarDateStamps({
      ...delta,
      updates: [{
        ...delta.updates[0]!,
        source: { ...delta.updates[0]!.source, activeAtMillis: 100 },
        timelineItems: [{
          itemUid: 'message-1', senderName: '联系人', isMe: false, sendAtMillis: 200,
          title: '', textContent: '消息', status: 1, sequence: 1,
        }, {
          itemUid: 'message-2', senderName: '联系人', isMe: false, sendAtMillis: 200,
          title: '', textContent: '重复日期提示', status: 1, sequence: 2,
        }],
      }],
    })).toEqual([100, 200])
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
      useArkmeRealtimeClientEvents({
        status: 'authenticated', revision: 1, userId: 10001, environment: 'prod',
      }, 1, false)
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
    await act(async () => { renderer.unmount() })
  })

  it('routes a standard Chat Bot timeline delta into scoped Calendar invalidation', async () => {
    let source!: FakeEventSource
    class FakeEventSource {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor(readonly url: string) { source = this }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    vi.spyOn(arkmeMessageReadReceipts, 'reconcile').mockImplementation(() => undefined)
    const publishCalendar = vi.spyOn(arkmeCalendarInvalidations, 'publish')

    function Harness() {
      useArkmeRealtimeClientEvents({
        status: 'authenticated', revision: 1, userId: 10001, environment: 'prod',
      }, 1, false)
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(Harness)) })

    await act(async () => {
      source.onmessage?.({ data: JSON.stringify(delta) } as MessageEvent<string>)
      await Promise.resolve()
    })

    expect(publishCalendar).toHaveBeenCalledWith({ dateStamp: 1 })
    await act(async () => { renderer.unmount() })
  })
})
