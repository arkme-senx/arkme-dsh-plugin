import { arkmeAttentionSummary } from '../src/client/attention-summary-store.js'
import { createElement, useSyncExternalStore } from 'react'
import * as clientApi from '../src/client/api.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as providerInstance from '../src/client/provider-instance-runtime.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import { arkmeConversationMembers } from '../src/client/conversation-members-store.js'
import { arkmeMemberEvents } from '../src/client/member-event-cache.js'
import {
  arkmeChatDeltaCalendarDateStamps,
  arkmeChatDeltaSourceKeys,
  arkmeSelectedBotAffectedByChatDelta,
  useArkmeRealtimeClientEvents,
} from '../src/client/realtime-client-events.js'
import type { ArkmeAuthSnapshot, ArkmeBotSummary, ArkmeChatClientEvent } from '../src/types.js'

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

beforeEach(() => {
  arkmeChatDirectory.activateAccount(undefined)
  // These routing tests supply only sources.list responses; instance transport is independent.
  vi.spyOn(providerInstance, 'reconcileArkmeProviderInstance').mockResolvedValue(false)
})

afterEach(() => {
  arkmeMemberEvents.activateAccount(undefined)
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
  it('joins startup instance preparation on first connection without clearing a newly loaded directory', async () => {
    let channel!: { onopen: (() => void) | null }
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage = null
      constructor() { channel = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    const prepared = Promise.withResolvers<boolean>()
    vi.mocked(providerInstance.reconcileArkmeProviderInstance).mockReturnValue(prepared.promise)
    const reads = vi.spyOn(clientApi, 'callArkme').mockResolvedValue({ directory: 'root', items: [], hasMore: false })
    const readiness: boolean[] = []
    const unsubscribe = arkmeChatDirectory.subscribe(() => { readiness.push(arkmeChatDirectory.getSnapshot().baselineReady) })
    const auth: ArkmeAuthSnapshot = { status: 'authenticated', userId: 84, environment: 'test' }
    function Harness() { useArkmeRealtimeClientEvents(auth, 1, true); return null }
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(createElement(Harness)) })
      await act(async () => { channel.onopen?.(); channel.onopen?.() })
      expect(reads.mock.calls.filter(([operation]) => operation === 'sources.list')).toHaveLength(0)
      await act(async () => { prepared.resolve(true) })
      expect(reads.mock.calls.filter(([operation]) => operation === 'sources.list')).toHaveLength(1)
      expect(providerInstance.reconcileArkmeProviderInstance).toHaveBeenCalledTimes(1)
      expect(arkmeChatDirectory.getSnapshot().baselineReady).toBe(true)
      expect(readiness.slice(readiness.indexOf(true))).not.toContain(false)
    } finally {
      unsubscribe()
      if (renderer !== undefined) await act(async () => { renderer.unmount() })
    }
  })

  it('updates a mounted directory after a policy notification read fails transiently, without another event or focus', async () => {
    vi.useFakeTimers()
    let channel!: FakeWebSocket
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { channel = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    const row = { sourceKey: 'group', sourceRef: 'group-ref', kind: 'group_chat' as const,
      displayName: '群聊', activeAtMillis: 1, unreadCount: 3, latestPreview: '消息保持',
      isPinned: false, chatPolicyUpdatedAtMillis: 1000 }
    const read = vi.spyOn(clientApi, 'callArkme')
      .mockRejectedValueOnce(new clientApi.ArkmeClientError({ code: 'arkme-code-1002', message: '服务器繁忙', retryable: true }))
      .mockResolvedValue({ directory: 'root', items: [{ ...row, isPinned: true, chatPolicyUpdatedAtMillis: 2000 }], hasMore: false })
    const auth: ArkmeAuthSnapshot = { status: 'authenticated', userId: 42, environment: 'test' }
    function Harness() {
      useArkmeRealtimeClientEvents(auth, 1, false)
      const snapshot = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot)
      return createElement('div', null, snapshot.isRefreshing ? '刷新中' : snapshot.sources[0]?.isPinned ? '已置顶' : '未置顶')
    }
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(createElement(Harness)) })
      await act(async () => { arkmeChatDirectory.publish([row]) })
      await act(async () => {
        channel.onmessage?.({ data: JSON.stringify({ type: 'chat-policy-invalidated', revision: 1 }) } as MessageEvent<string>)
      })
      expect(renderer.toJSON()).toMatchObject({ children: ['未置顶'] })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(renderer.toJSON()).toMatchObject({ children: ['已置顶'] })
      expect(read).toHaveBeenCalledTimes(2)
      expect(read.mock.calls.every(([operation]) => operation === 'sources.list')).toBe(true)
      expect(arkmeChatDirectory.getSnapshot().sources[0]).toMatchObject({ latestPreview: '消息保持', unreadCount: 3 })
    } finally {
      if (renderer !== undefined) await act(async () => { renderer.unmount() })
      vi.useRealTimers()
    }
  })

  it('applies reconnect pins without triggering directory, message, receipt or notification refreshes', async () => {
    let channel!: FakeWebSocket
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { channel = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    const receipts = vi.spyOn(arkmeMessageReadReceipts, 'reconcile').mockImplementation(() => undefined)
    const interwoven = vi.spyOn(arkmeInterwovenInvalidation, 'invalidate')
    const refresh = vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
    function Harness() {
      useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 42, environment: 'test' }, 1, false)
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(Harness)) })
    const row = { sourceKey: 'bound-chat', sourceRef: 'current-ref', kind: 'group_chat' as const,
      displayName: '群聊', activeAtMillis: 1, unreadCount: 3, latestSequence: 10,
      isPinned: false, chatPolicyUpdatedAtMillis: 1000 }
    arkmeChatDirectory.publish([row])
    receipts.mockClear()
    interwoven.mockClear()
    await act(async () => {
      channel.onmessage?.({ data: JSON.stringify({ type: 'chat-pins-reconciled', revision: 1,
        pins: [{ sourceKey: 'bound-chat', pinned: true, policyUpdatedAtMillis: 3000 }] }) } as MessageEvent<string>)
    })
    expect(arkmeChatDirectory.getSnapshot().sources).toEqual([{ ...row, isPinned: true, chatPolicyUpdatedAtMillis: 3000 }])
    expect(refresh).not.toHaveBeenCalled()
    expect(receipts).not.toHaveBeenCalled()
    expect(interwoven).not.toHaveBeenCalled()
    await act(async () => { renderer.unmount() })
  })

  it('refreshes only the directory for a policy invalidation and deduplicates Browser revisions', async () => {
    let source!: FakeWebSocket
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { source = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    const receipts = vi.spyOn(arkmeMessageReadReceipts, 'reconcile').mockImplementation(() => undefined)
    const interwoven = vi.spyOn(arkmeInterwovenInvalidation, 'invalidate')
    const invalidate = vi.spyOn(arkmeChatDirectory, 'invalidateRoot')
    const refresh = vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
    function Harness() {
      useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 42, environment: 'test' }, 1, false)
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(createElement(Harness)) })
    receipts.mockClear()
    interwoven.mockClear()
    await act(async () => {
      const event = { data: JSON.stringify({ type: 'chat-policy-invalidated', revision: 1 }) } as MessageEvent<string>
      source.onmessage?.(event)
      source.onmessage?.(event)
    })
    expect(invalidate).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ force: true, silent: true })
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]!)
    expect(receipts).not.toHaveBeenCalled()
    expect(interwoven).not.toHaveBeenCalled()
    await act(async () => { renderer.unmount() })
  })

  it('clears member-event memory on logout even when no conversation is mounted',async()=>{
    class FakeWebSocket { onopen=null;onmessage=null;close(){} }
    vi.stubGlobal('WebSocket',FakeWebSocket)
    vi.spyOn(arkmeAuthStore,'refresh').mockResolvedValue()
    vi.spyOn(arkmeMessageReadReceipts,'reconcile').mockImplementation(()=>undefined)
    function Harness({auth}:{auth:ArkmeAuthSnapshot}) {useArkmeRealtimeClientEvents(auth,1,false);return null}
    const auth:ArkmeAuthSnapshot={status:'authenticated',userId:42,environment:'test'}
    let renderer!:ReactTestRenderer
    await act(async()=>{renderer=create(createElement(Harness,{auth}))})
    const initial=arkmeMemberEvents.attach('test:42','group',async()=>({items:[{eventId:'secret',occurredAtMillis:100,type:'left',displayName:'李四'}],hasMore:false}),()=>{})
    await initial.timeline.enterWindow(0,1000,'latest');initial.release()
    await act(async()=>{renderer.update(createElement(Harness,{auth:{status:'logged-out',environment:'test'}}))})
    await act(async()=>{renderer.update(createElement(Harness,{auth}))})
    const read=vi.fn(async()=>({items:[],hasMore:false}))
    const next=arkmeMemberEvents.attach('test:42','group',read,()=>{})
    await next.timeline.enterWindow(0,1000,'latest')
    expect(read).toHaveBeenCalledTimes(1)
    expect(next.timeline.snapshot().events).toEqual([])
    next.release()
    await act(async()=>{renderer.unmount()})
  })

  it('refreshes members for a join without invalidating historical leave rows', async () => {
    let socket!: FakeWebSocket
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { socket = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    const members = vi.spyOn(arkmeConversationMembers, 'invalidate').mockImplementation(() => {})
    const history = vi.spyOn(arkmeMemberEvents, 'invalidate')
    function Harness() { useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 42, environment: 'test' }, 1, false); return null }
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(createElement(Harness)) })
      await act(async () => { socket.onmessage?.({ data: JSON.stringify({ type: 'members-invalidated', revision: 1, sourceKey: 'group' }) } as MessageEvent<string>) })
      expect(members).toHaveBeenCalledWith('test:42', { sourceKey: 'group', sourceRef: '' })
      expect(history).not.toHaveBeenCalled()
    } finally { await act(async () => { renderer.unmount() }); arkmeConversationMembers.activateAccount(undefined) }
  })

  it('records a Host event hint for an inactive cached group without a background query',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    let source!:FakeWebSocket
    class FakeWebSocket {
      onopen:(()=>void)|null=null
      onmessage:((event:MessageEvent<string>)=>void)|null=null
      constructor(){source=this}
      close(){}
    }
    vi.stubGlobal('WebSocket',FakeWebSocket)
    vi.spyOn(arkmeAuthStore,'refresh').mockResolvedValue()
    vi.spyOn(arkmeMessageReadReceipts,'reconcile').mockImplementation(()=>undefined)
    const refresh=vi.spyOn(arkmeChatDirectory,'refreshRoot').mockResolvedValue([])
    function Harness(){useArkmeRealtimeClientEvents({status:'authenticated',userId:42,environment:'test'},1,false);return null}
    let renderer!:ReactTestRenderer
    await act(async()=>{renderer=create(createElement(Harness))})
    let reads=0
    const read=async()=>{reads++;return {items:[],hasMore:false}}
    const initial=arkmeMemberEvents.attach('test:42','group',read,()=>{})
    await initial.timeline.enterWindow(0,1000,'latest');initial.release()
    await act(async()=>{
      source.onmessage?.({data:JSON.stringify({type:'member-events-invalidated',revision:1,sourceKey:'group',eventId:'new',occurredAtMillis:1100})} as MessageEvent<string>)
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(reads).toBe(1)
    expect(refresh).not.toHaveBeenCalled()
    const next=arkmeMemberEvents.attach('test:42','group',read,()=>{})
    await next.timeline.enterWindow(0,4000,'latest')
    expect(reads).toBe(2)
    next.release()
    await act(async()=>{renderer.unmount()})
    vi.useRealTimers()
  })
  it('does not refresh the directory when 75-second or lease reconnects publish refresh none', async () => {
    let source!: FakeWebSocket
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor(readonly url: string) { source = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
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

  it('applies timeline deletions even when no conversation is in the foreground', async () => {
    let source!: FakeWebSocket
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor(readonly url: string) { source = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    vi.spyOn(arkmeMessageReadReceipts, 'reconcile').mockImplementation(() => undefined)
    const apply = vi.spyOn(arkmeChatTimelineDelta, 'applyTimelineChange')

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
        type: 'timeline-changed', revision: 1,
        sourceKey: 'opaque-source', timelineItemKey: 'opaque-item',
        changeKind: 'deleted', changeVersion: 123456, relationTerminal: true, throughSequence: 9,
      }) } as MessageEvent<string>)
    })
    expect(apply).toHaveBeenCalledWith({
      type: 'timeline-changed', revision: 1,
      sourceKey: 'opaque-source', timelineItemKey: 'opaque-item',
      changeKind: 'deleted', changeVersion: 123456, relationTerminal: true, throughSequence: 9,
    })
    await act(async () => { renderer.unmount() })
  })
})


describe('Host epoch recovery', () => {
  it('accepts a new Host zero baseline, rejects old Host frames, and keeps same-Host revision ordering', async () => {
    let channel!: FakeWebSocket
    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      constructor() { channel = this }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
    vi.spyOn(clientApi, 'callArkme').mockResolvedValue({ instanceId: 'host-for-recovery-test' })
    vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
    function Harness() {
      useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 789, environment: 'test' }, 1, false)
      return null
    }
    let renderer!: ReactTestRenderer
    const send = async (providerInstanceId: string, revision: number, count: number, type = 'attention-summary') => {
      const summary = { badgeCount: count, mutedUnreadCount: 0, sessionCountWithUnread: count > 0 ? 1 : 0,
        hasAttention: false, summaryVersion: 100 + revision, updatedAtMillis: 100 + revision }
      await act(async () => { channel.onmessage?.({ data: JSON.stringify({ providerInstanceId, revision, type,
        ...(type === 'reconcile' ? { refresh: 'none', attentionSummary: summary } : { summary }),
      }) } as MessageEvent<string>) })
    }
    try {
      await act(async () => { renderer = create(createElement(Harness)) })
      await send('old', 100, 3, 'reconcile')
      expect(arkmeAttentionSummary.getSnapshot().summary?.badgeCount).toBe(3)
      await act(async () => { channel.onopen?.() })
      await send('new', 1, 0, 'reconcile')
      expect(arkmeAttentionSummary.getSnapshot().summary?.badgeCount).toBe(0)
      await send('old', 101, 3)
      await send('new', 0, 9)
      expect(arkmeAttentionSummary.getSnapshot().summary?.badgeCount).toBe(0)
      await send('new', 2, 4)
      await act(async () => { channel.onopen?.() })
      await send('new', 1, 0, 'reconcile')
      expect(arkmeAttentionSummary.getSnapshot().summary?.badgeCount).toBe(4)
    } finally { await act(async () => { renderer?.unmount() }) }
  })
})

it('does not clear a new Host directory again when the slower provider-instance lookup completes', async () => {
  let channel!: { onopen: (() => void) | null; onmessage: ((event: MessageEvent<string>) => void) | null }
  vi.stubGlobal('WebSocket', class {
    onopen = null; onmessage = null
    constructor() { channel = this }
    close() {}
  })
  const provider = await import('../src/client/provider-instance-runtime.js')
  let release!: (changed: boolean) => void
  vi.spyOn(provider, 'reconcileArkmeProviderInstance').mockImplementation(() => new Promise(resolve => { release = resolve }))
  vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
  vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
  function Harness() { useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 3456, environment: 'test' }, 1, false); return null }
  let renderer!: ReactTestRenderer
  const emit = async (update: unknown) => { await act(async () => { channel.onmessage?.({ data: JSON.stringify(update) } as MessageEvent<string>) }) }
  try {
    await act(async () => { renderer = create(createElement(Harness)) })
    await emit({ type: 'reconcile', revision: 100, providerInstanceId: 'old', refresh: 'none' })
    await act(async () => { channel.onopen?.() })
    await emit({ type: 'reconcile', revision: 1, providerInstanceId: 'new', refresh: 'none' })
    await emit({ type: 'directory-update', revision: 2, providerInstanceId: 'new', page: { directory: 'root', items: [{ sourceRef: 'new-ref', sourceKey: 'stable-key', kind: 'private_chat', displayName: 'Recovered', unreadCount: 0, activeAtMillis: 1 }], hasMore: false,
      projection: { revision: 2, phase: 'complete', cachedAtMillis: 1, bots: [], visibility: [{ entryKind: 'source', entryRef: 'new-ref', hidden: false }] } } })
    await act(async () => { release(true) })
    expect(arkmeChatDirectory.getConversationSnapshot().sources).toHaveLength(1)
  } finally { await act(async () => { renderer.unmount() }) }
})

it('revalidates the local directory cache on same-Host reconnect without forcing an upstream scan', async () => {
  let channel!: { onopen: (() => void) | null; onmessage: ((event: MessageEvent<string>) => void) | null }
  vi.stubGlobal('WebSocket', class { onopen = null; onmessage = null; constructor() { channel = this } close() {} })
  const provider = await import('../src/client/provider-instance-runtime.js')
  vi.spyOn(provider, 'reconcileArkmeProviderInstance').mockResolvedValue(false)
  vi.spyOn(arkmeAuthStore, 'refresh').mockResolvedValue()
  const refresh = vi.spyOn(arkmeChatDirectory, 'refreshRoot').mockResolvedValue([])
  const invalidate = vi.spyOn(arkmeChatDirectory, 'invalidateRoot')
  function Harness() { useArkmeRealtimeClientEvents({ status: 'authenticated', userId: 4567, environment: 'test' }, 1, false); return null }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(createElement(Harness)) })
    await act(async () => { channel.onmessage?.({ data: JSON.stringify({ type: 'reconcile', revision: 1, providerInstanceId: 'same', refresh: 'none' }) } as MessageEvent<string>) })
    await act(async () => { channel.onopen?.() })
    await act(async () => { channel.onmessage?.({ data: JSON.stringify({ type: 'reconcile', revision: 2, providerInstanceId: 'same', refresh: 'if-stale' }) } as MessageEvent<string>) })
    expect(invalidate).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenLastCalledWith({ force: false })
  } finally { await act(async () => { renderer.unmount() }) }
})
