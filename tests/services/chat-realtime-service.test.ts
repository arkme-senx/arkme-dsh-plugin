import { describe, expect, it, vi } from 'vitest'
import { ArkmeChatRealtimeRuntime } from '../../src/chat-realtime.js'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import {
  ChatRealtimeService,
  type ArkmeNativeAttentionDispatcher,
  type PendingChatProjection,
} from '../../src/services/chat-realtime-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'
import type { ArkmeChatClientEvent, ArkmeTimelineItem } from '../../src/types.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ChatRealtimeService', () => {
  it.each(['current', 'other-account', 'aborted'] as const)('routes annotation hints without body reads and rejects stale ownership: %s', async scenario => {
    const sessions: ArkmeSessionStore = {
      async read() { return {userId: 42, accessToken: 'access', refreshToken: 'refresh'} },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return {recordCount: 0, wordsCount: 0, totalSec: 0} }, recordItem() { return undefined },
    })
    const timeline = vi.fn(async () => [])
    const service = new ChatRealtimeService(runtime, source, {chatTimelineItems: timeline})
    const events: unknown[] = []
    service.subscribeChatRealtime(event => events.push(event))
    const controller = new AbortController()
    if (scenario === 'aborted') controller.abort()
    try {
      service.handleChatRealtimeNotice({cause: 'projection-invalidation', connectionUserId: scenario === 'other-account' ? 43 : 42,
        connectionSignal: controller.signal, state: {revision: 1, connected: true, connectionGeneration: 1},
        projectionInvalidation: {eventUid: 'mark-event', projection: 'message_annotations', eventAtMillis: 1}})
      await new Promise(resolve => setImmediate(resolve))
      expect(events).toEqual(scenario === 'current' ? [expect.objectContaining({type: 'projection-invalidated', projection: 'message_annotations'})] : [])
      expect(timeline).not.toHaveBeenCalled()
    } finally { service.dispose(); runtime.dispose() }
  })

  it('publishes directory-only archive changes without invalidating content or calendar', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return {userId: 42, accessToken: 'access', refreshToken: 'refresh'} },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return {recordCount: 0, wordsCount: 0, totalSec: 0} }, recordItem() { return undefined },
    })
    const directory = vi.spyOn(source, 'invalidateSourceListCache')
    const cacheInvalidation = vi.spyOn(runtime, 'invalidateKey')
    const service = new ChatRealtimeService(runtime, source, {chatTimelineItems: vi.fn(async () => [])})
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    service.handleChatRealtimeNotice({
      cause: 'projection-invalidation', state: {revision: 1, connected: true, connectionGeneration: 1},
      projectionInvalidation: {eventUid: 'archive-event', projection: 'entity_archive', eventAtMillis: 1},
    })
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(directory).toHaveBeenCalledWith(42, 'send_to_self')
    expect(events).toEqual([expect.objectContaining({type: 'projection-invalidated', projection: 'topic-directory'})])
    expect(cacheInvalidation.mock.calls.some(([, key]) => key === 'calendar:')).toBe(false)
    expect(cacheInvalidation).toHaveBeenCalledWith(runtime.requestScope(42), 'owner-read:archives:')
    service.dispose()
    runtime.dispose()
  })

  it('invalidates computed calendar months by date and timezone, with a full privacy fallback', () => {
    const runtime = new ServiceRuntime(config, {} as ArkmeSessionStore, {} as StateStore)
    const version = (start: string, end: string, zone = 'Asia/Shanghai') => runtime.calendarReadRevision('user:42', start, end, zone)
    const september = version('2026-09-01', '2026-09-30')
    const august = version('2026-08-01', '2026-08-31')
    runtime.invalidateCalendarDates('user:42', [Date.parse('2026-08-31T18:00:00Z')])
    expect(version('2026-09-01', '2026-09-30')).not.toBe(september)
    expect(version('2026-08-01', '2026-08-31')).toBe(august)
    expect(version('2026-08-01', '2026-08-31', 'UTC')).not.toBe(august)
    expect(runtime.calendarReadRevision('user:43', '2026-09-01', '2026-09-30', 'UTC')).toBe('0:0')
    runtime.invalidateKey('user:42', 'calendar:')
    expect(version('2026-08-01', '2026-08-31')).not.toBe(august)
    runtime.dispose()
  })

  it.each(['current', 'account-change', 'new-connection', 'final-connection-change', 'disconnected', 'disposed'] as const)(
    'recovers pin projections from the existing reconnect read: %s', async scenario => {
      let account = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
      let reads = 0
      const sessions: ArkmeSessionStore = {
        async read() {
          reads += 1
          if (scenario === 'final-connection-change' && reads === 3) {
            await Promise.resolve()
            state.mockReturnValue({ revision: 2, connected: true, connectionGeneration: 3 })
          }
          return account
        },
        async write() {}, async delete() {},
      }
      const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
      vi.spyOn(runtime, 'requireSession').mockImplementation(async () => account)
      const source = new SourceService(runtime, new ProfileService(runtime), {
        async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
      })
      const timeline = vi.fn(async () => [])
      const service = new ChatRealtimeService(runtime, source, { chatTimelineItems: timeline })
      const internals = service as unknown as {
        chatRealtime: { state(): { revision: number; connected: boolean; connectionGeneration: number } }
        reconcileChatConnectionBaseline(generation: number, userId: number): Promise<void>
      }
      const state = vi.spyOn(internals.chatRealtime, 'state').mockReturnValue({ revision: 1, connected: true, connectionGeneration: 2 })
      let release!: () => void
      const rows = [
        { sourceKey: 'bound-private', sourceRef: 'private-ref', kind: 'private_chat' as const,
          displayName: '私聊', activeAtMillis: 1, unreadCount: 0, isPinned: true, chatPolicyUpdatedAtMillis: 3000 },
        { sourceKey: 'bound-group', sourceRef: 'group-ref', kind: 'group_chat' as const,
          displayName: '群聊', activeAtMillis: 1, unreadCount: 5, isPinned: false, chatPolicyUpdatedAtMillis: 4000 },
      ]
      const list = vi.spyOn(source, 'listSources')
        .mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return { directory: 'root', items: [rows[0]!], hasMore: true, nextCursor: 'page-2' } })
        .mockResolvedValue({ directory: 'root', items: [rows[1]!], hasMore: false })
      vi.spyOn(source, 'openSourceRef').mockImplementation(async ref => ({ v: 1, userId: 42, kind: 'group_chat', ownerRef: ref }))
      const events: unknown[] = []
      service.subscribeChatRealtime(event => { events.push(event) })
      const pending = internals.reconcileChatConnectionBaseline(2, 42)
      await vi.waitFor(() => { expect(list).toHaveBeenCalledOnce() })
      if (scenario === 'account-change') account = { ...account, userId: 43 }
      if (scenario === 'new-connection') state.mockReturnValue({ revision: 2, connected: true, connectionGeneration: 3 })
      if (scenario === 'disconnected') state.mockReturnValue({ revision: 2, connected: false, connectionGeneration: 2 })
      if (scenario === 'disposed') service.dispose()
      release()
      await pending
      if (scenario === 'current') {
        expect(events).toEqual([{ type: 'chat-pins-reconciled', revision: 1, pins: [
          { sourceKey: 'bound-private', pinned: true, policyUpdatedAtMillis: 3000 },
          { sourceKey: 'bound-group', pinned: false, policyUpdatedAtMillis: 4000 },
        ] }])
        expect(list).toHaveBeenCalledTimes(2)
      } else {
        expect(events).toEqual([])
        expect(list).toHaveBeenCalledTimes(scenario === 'final-connection-change' ? 2 : 1)
      }
      expect(timeline).not.toHaveBeenCalled()
      service.dispose()
    },
  )

  it.each(['memberEvent', 'memberJoined'] as const)('projects %s without confusing roster and history or refreshing messages', async kind => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'test-key' } } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const timeline = vi.fn(async () => [])
    const service = new ChatRealtimeService(runtime, source, { chatTimelineItems: timeline })
    const schedule = vi.spyOn(service, 'scheduleChatSessionProjection').mockImplementation(() => {})
    const attention = vi.spyOn(service, 'refreshAttentionSummary')
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    service.handleChatRealtimeNotice({
      cause: 'chat-hint', state: { revision: 2, connected: true, connectionGeneration: 1 },
      [kind]: { eventUid: 'event-1', chatSessionUid: 'raw-group', eventAtMillis: 1234 },
    })
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toMatchObject({ ...(kind === 'memberEvent' ? { type: 'member-events-invalidated', eventId: 'event-1', occurredAtMillis: 1234 } : { type: 'members-invalidated' }),
      sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./) })
    expect(JSON.stringify(events[0])).not.toContain('raw-group')
    expect(timeline).not.toHaveBeenCalled()
    if (kind === 'memberJoined') expect(schedule).toHaveBeenCalledExactlyOnceWith('raw-group', 0, undefined, false, true, 1234)
    else expect(schedule).not.toHaveBeenCalled()
    expect(attention).not.toHaveBeenCalled()
    service.dispose()
  })

  it('starts in a disconnected state without opening a connection', () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })

    expect(service.chatRealtimeState().connected).toBe(false)
    service.dispose()
  })

  it('recovers the Record projection on reconnect without reusing Chat projection semantics', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const invalidate = vi.spyOn(source, 'invalidateSourceListCache')
    const invalidateKey = vi.spyOn(runtime, 'invalidateKey')
    vi.spyOn(service as unknown as { reconcileChatConnectionBaseline(generation: number): Promise<void> },
      'reconcileChatConnectionBaseline').mockResolvedValue()
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'reconcile',
      state: { revision: 1, connected: true, connectionGeneration: 1 },
    })

    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith(10001, 'send_to_self')
      expect(invalidateKey).toHaveBeenCalledWith('user:10001', 'calendar:')
      expect(events).toContainEqual(expect.objectContaining({ type: 'projection-invalidated', projection: 'record' }))
    })
    service.dispose()
  })

  it('projects another member cursor advance to an account-bound browser invalidation', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      readCursorAdvanced: {
        eventUid: 'read-event-1', chatSessionUid: 'raw-chat-session', readerUserId: 20002,
        readSequence: 9, readAtMillis: 123456, eventAtMillis: 123457,
      },
    })

    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toMatchObject({
      type: 'read-receipts-invalidated', revision: 1, throughSequence: 9,
      sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./),
    })
    expect(JSON.stringify(events[0])).not.toContain('raw-chat-session')
    expect(JSON.stringify(events[0])).not.toContain('20002')
    expect(JSON.stringify(events[0])).not.toContain('read-event-1')
    service.dispose()
  })

  it('projects a timeline change to opaque source and item keys without content', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const schedule = vi.spyOn(service, 'scheduleChatSessionProjection').mockImplementation(() => undefined)
    vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      timelineChanged: {
        eventUid: 'timeline-event-1', chatSessionUid: 'raw-chat-session', relationUid: 'raw-relation',
        latestSequence: 9, actorUserId: 10001, changeKind: 'deleted', changeVersion: 123456, relationTerminal: true,
        eventAtMillis: 123457,
      },
    })

    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toMatchObject({
      type: 'timeline-changed', changeKind: 'deleted', changeVersion: 123456, relationTerminal: true, throughSequence: 9,
      sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./),
      timelineItemKey: expect.stringMatching(/^arkme-chat-timeline-item-v1\./),
    })
    expect(JSON.stringify(events[0])).not.toContain('raw-chat-session')
    expect(JSON.stringify(events[0])).not.toContain('raw-relation')
    expect(schedule).toHaveBeenCalledWith('raw-chat-session', 9, undefined, false, true, 0, 123457)
    service.dispose()
  })

  it('drops a timeline invalidation when the authenticated account changes during key projection', async () => {
    let readCount = 0
    const sessions: ArkmeSessionStore = {
      async read() {
        readCount += 1
        return readCount === 1
          ? { userId: 10001, accessToken: 'old-access', refreshToken: 'old-refresh' }
          : { userId: 10002, accessToken: 'new-access', refreshToken: 'new-refresh' }
      },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const schedule = vi.spyOn(service, 'scheduleChatSessionProjection').mockImplementation(() => undefined)
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      timelineChanged: {
        eventUid: 'timeline-event-1', chatSessionUid: 'old-chat-session', relationUid: 'old-relation',
        latestSequence: 9, actorUserId: 10001, changeKind: 'deleted', changeVersion: 123456, relationTerminal: true,
        eventAtMillis: 123457,
      },
    })

    await vi.waitFor(() => { expect(readCount).toBeGreaterThanOrEqual(2) })
    expect(events).toEqual([])
    expect(schedule).not.toHaveBeenCalled()
    service.dispose()
  })

  it('refreshes the unread directory instead of emitting receipt data for the current user cursor', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const schedule = vi.spyOn(service, 'scheduleChatSessionProjection').mockImplementation(() => undefined)
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      readCursorAdvanced: {
        eventUid: 'read-event-self', chatSessionUid: 'chat-self', readerUserId: 10001,
        readSequence: 12, readAtMillis: 123456, eventAtMillis: 123457,
      },
    })

    await vi.waitFor(() => { expect(schedule).toHaveBeenCalledWith('chat-self', 12, undefined, false) })
    expect(events).toEqual([])
    service.dispose()
  })

  it('does not treat a Chat hint or another projection as a Record invalidation', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const invalidate = vi.spyOn(source, 'invalidateSourceListCache')

    service.handleChatRealtimeNotice({
      cause: 'projection-invalidation',
      state: { revision: 1, connected: true, connectionGeneration: 1 },
      projectionInvalidation: { eventUid: 'topic-1', projection: 'topic', eventAtMillis: 1 },
    })
    service.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      projectionInvalidation: { eventUid: 'record-1', projection: 'record', eventAtMillis: 2 },
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(invalidate).not.toHaveBeenCalled()
    service.dispose()
  })

  it('binds the first hint from a switched account to the new owner generation', () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10002, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    vi.spyOn(service as unknown as {
      reconcileChatConnectionBaseline(generation: number, userId?: number): Promise<void>
    }, 'reconcileChatConnectionBaseline').mockResolvedValue()
    vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
    vi.spyOn(service, 'invalidateRecordProjection').mockResolvedValue()
    const internals = service as unknown as {
      attentionOwnerUserId: number | undefined
      attentionOwnerGeneration: number
      pendingChatProjections: Map<string, PendingChatProjection>
    }
    internals.attentionOwnerUserId = 10001
    const connection = new AbortController()
    const connectionStartedAtMillis = Date.now()

    service.handleChatRealtimeNotice({
      cause: 'reconcile',
      state: { revision: 1, connected: true, connectionGeneration: 2 },
      connectionUserId: 10002,
      connectionSignal: connection.signal,
      connectionStartedAtMillis,
    })
    service.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: { revision: 2, connected: true, connectionGeneration: 2 },
      connectionUserId: 10002,
      connectionSignal: connection.signal,
      connectionStartedAtMillis,
      hint: {
        eventUid: 'new-account-event', chatSessionUid: 'new-account-chat', relationUid: 'new-account-relation',
        latestSequence: 1, senderUserId: 20002, eventAtMillis: connectionStartedAtMillis + 1,
      },
    })

    const candidate = internals.pendingChatProjections.get('new-account-chat')?.notificationHints[0]
    expect(internals.attentionOwnerUserId).toBe(10002)
    expect(internals.attentionOwnerGeneration).toBe(1)
    expect(candidate).toMatchObject({ accountUserId: 10002, accountOwnerGeneration: 1, baselinePassed: true })
    service.dispose()
  })

  it.each(['normal', 'held', 'disposed', 'account-changed'] as const)('bounds native notifications without blocking session updates: %s', async scenario => {
    const held = scenario !== 'normal'
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const chatSessionCount = 10
    const notificationsPerSession = 50
    const notificationCount = chatSessionCount * notificationsPerSession
    const bundles = Array.from({ length: chatSessionCount }, (_, index) => ({
      session: {
        chat_session_uid: `chat-bulk-notifications-${String(index)}`, session_kind: 1,
        last_seq: notificationsPerSession, last_active_at: 1_700_000_000_000 + index,
      },
      private_counterpart: { display_name_snapshot: `批量通知联系人 ${String(index)}` },
      current_policy: { mute_state: 1, notify_state: 1 },
      unread_snapshot: { unread_count: notificationsPerSession, session_last_seq: notificationsPerSession },
    }))
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/display-snapshots')) return new Response(JSON.stringify({ code: 200, data: { items: bundles } }))
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { chat_session_uid?: string }
        const sessionIndex = Number(body.chat_session_uid?.split('-').at(-1))
        return new Response(JSON.stringify({ code: 200, data: { items: Array.from(
          { length: notificationsPerSession },
          (_, index) => {
            const notificationIndex = sessionIndex * notificationsPerSession + index
            return { relation: {
              record_uid: `message-${String(sessionIndex)}-${String(index)}`,
              rel_uid: `relation-${String(notificationIndex)}`,
              sender_user_id: 20002,
              seq: index + 1,
            } }
          },
        ) } }))
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const timelineItemsByUid = new Map<string, ArkmeTimelineItem[]>(bundles.map((bundle, sessionIndex) => [
      bundle.session.chat_session_uid,
      Array.from({ length: notificationsPerSession }, (_, index) => ({
        itemUid: `message-${String(sessionIndex)}-${String(index)}`,
        senderName: '发送者', isMe: false,
        sendAtMillis: 1_700_000_000_000 + sessionIndex * notificationsPerSession + index,
        title: '', textContent: `消息 ${String(sessionIndex)}-${String(index)}`,
        ...(sessionIndex === 0 && index === 1
          ? { conversationPreview: '[图片]消息 0-1[jm_emoji:red_angry_face]' }
          : sessionIndex === 0 && index === 2
            ? { conversationPreview: '😠'.repeat(130) }
          : {}),
        status: 1, sequence: index + 1,
      })),
    ]))
    let releaseNative!: () => void
    const nativeHold = new Promise<void>(resolve => { releaseNative = resolve })
    let active = 0
    let maxActive = 0
    let releaseScheduled = false
    const startedKeys: string[] = []
    const nativeBodies = new Map<string, string>()
    const pendingResolvers: Array<() => void> = []
    const nativeAttention: ArkmeNativeAttentionDispatcher = {
      async showNotification(payload) {
        const index = Number(payload.idempotencyKey.slice('event-'.length))
        startedKeys.push(payload.idempotencyKey)
        nativeBodies.set(payload.idempotencyKey, payload.presentation.body)
        active += 1
        maxActive = Math.max(maxActive, active)
        if (held) await nativeHold
        await new Promise<void>(resolve => {
          pendingResolvers.push(() => {
            active -= 1
            resolve()
          })
          if (!releaseScheduled) {
            releaseScheduled = true
            queueMicrotask(() => {
              releaseScheduled = false
              for (const release of pendingResolvers.splice(0).reverse()) release()
            })
          }
        })
        if (index === 5) throw new Error('uncertain native delivery')
        return {
          fallbackToBrowser: index % 4 === 1,
          outcome: index % 4 === 1 ? 'unsupported' : 'accepted',
        }
      },
      async applyBadgeSummary() { return true },
    }
    const service = new ChatRealtimeService(runtime, source, {
      async chatTimelineItems(_data, _session, chatSessionUid, _sourceKind, bundle) {
        expect(bundle).toEqual(bundles.find(item => item.session.chat_session_uid === chatSessionUid))
        return timelineItemsByUid.get(chatSessionUid) ?? []
      },
    }, nativeAttention)
    vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
    const internals = service as unknown as {
      notificationBaselineGeneration: number
      notificationBaselineUserId: number | undefined
      notificationBaselineOwnerGeneration: number
      chatRealtime: { state(): { revision: number; connected: boolean; connectionGeneration: number } }
    }
    internals.notificationBaselineGeneration = 7
    internals.notificationBaselineUserId = 10001
    internals.notificationBaselineOwnerGeneration = 0
    vi.spyOn(internals.chatRealtime, 'state').mockReturnValue({
      revision: 1, connected: true, connectionGeneration: 7,
    })
    const events: Array<{ type: string; notification?: { eventUid: string; body: string } }> = []
    service.subscribeChatRealtime(event => { events.push(event as typeof events[number]) })
    const pending: Array<[string, PendingChatProjection]> = bundles.map((bundle, sessionIndex) => [
      bundle.session.chat_session_uid,
      {
        latestSequence: notificationsPerSession,
        notificationHints: Array.from({ length: notificationsPerSession }, (_, index) => {
          const notificationIndex = sessionIndex * notificationsPerSession + index
          return {
            hint: {
              eventUid: `event-${String(notificationIndex)}`,
              chatSessionUid: bundle.session.chat_session_uid,
              relationUid: `relation-${String(notificationIndex)}`,
              latestSequence: index + 1,
              senderUserId: 20002,
              eventAtMillis: 1_700_000_000_000 + notificationIndex,
            },
            connectionGeneration: 7,
            attempts: 0,
          }
        }),
      },
    ])

    const work = service.refreshChatSessionProjectionBatch(pending)
    try {
      if (held) {
        await vi.waitFor(() => expect(startedKeys).toHaveLength(3))
        await vi.waitFor(() => expect(events.filter(event => event.type === 'sessions-delta')
          .flatMap(event => (event as any).updates)).toHaveLength(chatSessionCount))
        if (scenario === 'disposed') service.dispose()
        if (scenario === 'account-changed') service.resetAttentionSummary()
      }
    } finally { releaseNative(); await work }
    expect(await work).toEqual([])
    if (scenario === 'disposed' || scenario === 'account-changed') {
      expect(startedKeys).toHaveLength(3)
      expect(events.filter(event => event.type === 'message-notification')).toEqual([])
      service.dispose(); runtime.dispose(); return
    }

    expect(maxActive).toBe(3)
    expect(active).toBe(0)
    expect([...startedKeys].sort()).toEqual(Array.from({ length: notificationCount }, (_, index) => `event-${String(index)}`).sort())
    for (let sessionIndex = 0; sessionIndex < bundles.length; sessionIndex++) {
      expect(startedKeys.filter(key => Math.floor(Number(key.slice(6)) / notificationsPerSession) === sessionIndex))
        .toEqual(Array.from({ length: notificationsPerSession }, (_, index) => `event-${sessionIndex * notificationsPerSession + index}`))
    }
    expect(events.filter(event => event.type === 'message-notification').map(event => event.notification?.eventUid).sort())
      .toEqual(Array.from({ length: notificationCount }, (_, index) => index)
        .filter(index => index % 4 === 1 && index !== 5)
        .map(index => `event-${String(index)}`).sort())
    expect(nativeBodies.get('event-1')).toBe('[图片]消息 0-1😠')
    expect(events.find(event => event.notification?.eventUid === 'event-1')?.notification?.body)
      .toBe(nativeBodies.get('event-1'))
    expect(nativeBodies.get('event-2')).toBe('😠'.repeat(120))
    service.dispose()
  })

  it('retries one resolved native notification without refetching its source or timeline', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let displayRequests = 0
    let tailRequests = 0
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        displayRequests += 1
        return new Response(JSON.stringify({ code: 200, data: { items: [{
          session: { chat_session_uid: 'chat-1', session_kind: 1, last_seq: 1, last_active_at: Date.now() },
          private_counterpart: { display_name_snapshot: '小林' },
          current_policy: { mute_state: 1, notify_state: 1 },
          unread_snapshot: { unread_count: 1, session_last_seq: 1 },
        }] } }))
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        tailRequests += 1
        return new Response(JSON.stringify({ code: 200, data: { items: [{ relation: {
          record_uid: 'message-1', rel_uid: 'relation-1', sender_user_id: 20002, seq: 1,
        } }] } }))
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const nativeAttempts: string[] = []
    const nativeAttention: ArkmeNativeAttentionDispatcher = {
      async showNotification(payload) {
        nativeAttempts.push(payload.idempotencyKey)
        return nativeAttempts.length === 1
          ? { fallbackToBrowser: false, outcome: 'rate-limited' }
          : { fallbackToBrowser: false, outcome: 'accepted' }
      },
      async applyBadgeSummary() { return true },
    }
    const service = new ChatRealtimeService(runtime, source, {
      async chatTimelineItems() {
        return [{
          itemUid: 'message-1', senderName: '小林', isMe: false, sendAtMillis: Date.now(),
          title: '', textContent: '重试通知', status: 1, sequence: 1,
        }]
      },
    }, nativeAttention)
    vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
    const now = Date.now()
    service.scheduleChatSessionProjection('chat-1', 1, {
      hint: {
        eventUid: 'event-native-retry', chatSessionUid: 'chat-1', relationUid: 'relation-1',
        latestSequence: 1, senderUserId: 20002, eventAtMillis: now,
      },
      connectionGeneration: 1,
      attempts: 0,
      receivedAtMillis: now,
      accountUserId: 10001,
      accountOwnerGeneration: 0,
      baselinePassed: true,
    })

    await vi.waitFor(() => { expect(nativeAttempts).toHaveLength(2) }, { timeout: 2_000 })
    expect(nativeAttempts).toEqual(['event-native-retry', 'event-native-retry'])
    expect(displayRequests).toBe(1)
    expect(tailRequests).toBe(1)
    service.dispose()
  })

  it('limits one session to fifty unresolved notification hints per timeline read', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const batchSizes: number[] = []
    vi.spyOn(service, 'refreshChatSessionProjectionBatch').mockImplementation(async pending => {
      batchSizes.push(pending[0]?.[1].notificationHints.length ?? 0)
      return []
    })
    const now = Date.now()
    for (let sequence = 1; sequence <= 51; sequence += 1) {
      service.scheduleChatSessionProjection('chat-1', sequence, {
        hint: {
          eventUid: `event-${String(sequence)}`, chatSessionUid: 'chat-1', relationUid: `relation-${String(sequence)}`,
          latestSequence: sequence, senderUserId: 20002, eventAtMillis: now,
        },
        connectionGeneration: 1,
        attempts: 0,
        receivedAtMillis: now,
        accountUserId: 10001,
        accountOwnerGeneration: 0,
        baselinePassed: true,
      })
    }

    await vi.waitFor(() => { expect(batchSizes).toHaveLength(2) }, { timeout: 2_000 })
    expect(batchSizes).toEqual([50, 1])
    service.dispose()
  })

  it('relays a same-account preference hint as Browser invalidation without owner payload', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })

    service.handleChatRealtimeNotice({
      cause: 'conversation-list-preference-invalidation',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      conversationListPreferenceUpdated: {
        eventUid: 'preference-event-1', userId: 10001,
        items: [{ entityKind: 1, entityUid: 'chat-secret', revision: 3 }],
        acceptedAtMillis: 123459, sourceClientId: 501,
      },
    })

    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toEqual({ type: 'conversation-list-preference-invalidated', revision: 1 })
    expect(JSON.stringify(events[0])).not.toContain('chat-secret')

    service.handleChatRealtimeNotice({
      cause: 'conversation-list-preference-invalidation',
      state: { revision: 2, connected: true, connectionGeneration: 1 },
      conversationListPreferenceUpdated: {
        eventUid: 'preference-event-other-account', userId: 20002,
        items: [{ entityKind: 1, entityUid: 'chat-secret', revision: 3 }],
        acceptedAtMillis: 123459, sourceClientId: 501,
      },
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(events).toHaveLength(1)
    service.dispose()
  })
})


describe('Chat policy invalidation', () => {
  it.each(['account-change', 'abort', 'dispose'] as const)('drops policy projection when %s occurs during the session read', async scenario => {
    const account = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    let release!: (value: typeof account) => void
    const sessions: ArkmeSessionStore = {
      read: vi.fn(async () => await new Promise(resolve => { release = resolve })),
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const source = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const invalidate = vi.spyOn(source, 'invalidateSourceListCache')
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const events: unknown[] = []
    const controller = new AbortController()
    service.subscribeChatRealtime(event => { events.push(event) })
    service.handleChatRealtimeNotice({
      cause: 'chat-policy-invalidation', state: { revision: 1, connected: true, connectionGeneration: 1 },
      connectionUserId: 42, connectionSignal: controller.signal,
      policyUpdated: { eventUid: 'policy-1', chatSessionUid: 'chat-1', userId: 42, pinState: 2, policyUpdateAtMillis: 1000, eventAtMillis: 1000 },
    })
    expect(sessions.read).toHaveBeenCalledOnce()
    if (scenario === 'abort') controller.abort()
    if (scenario === 'dispose') service.dispose()
    release({ ...account, userId: scenario === 'account-change' ? 43 : 42 })
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual([])
    expect(invalidate).not.toHaveBeenCalled()
    service.dispose()
  })

  it.each(['current', 'other-account', 'aborted', 'disposed'] as const)('invalidates only the active account directory: %s', async scenario => {
    const controller = new AbortController()
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: scenario === 'other-account' ? 43 : 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn() as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const source = new SourceService(runtime, new ProfileService(runtime), { async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined } })
    const invalidate = vi.spyOn(source, 'invalidateSourceListCache')
    const service = new ChatRealtimeService(runtime, source, { async chatTimelineItems() { return [] } })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    if (scenario === 'aborted') controller.abort()
    if (scenario === 'disposed') service.dispose()
    service.handleChatRealtimeNotice({
      cause: 'chat-policy-invalidation', state: { revision: 1, connected: true, connectionGeneration: 1 },
      connectionUserId: 42, connectionSignal: controller.signal,
      policyUpdated: { eventUid: 'policy-1', chatSessionUid: 'private-owner-uid', userId: 42, pinState: 2, policyUpdateAtMillis: 1000, eventAtMillis: 1000 },
    })
    if (scenario === 'current') {
      await vi.waitFor(() => { expect(events).toEqual([{ type: 'chat-policy-invalidated', revision: 1 }]) })
      expect(invalidate).toHaveBeenCalledExactlyOnceWith(42, 'root')
    } else {
      await Promise.resolve()
      await Promise.resolve()
      expect(events).toEqual([])
      expect(invalidate).not.toHaveBeenCalled()
    }
    expect(fetchImpl).not.toHaveBeenCalled()
    service.dispose()
  })
})


describe('directory invalidation ownership', () => {
  it('routes raw targets only to the Host directory and does not trigger Browser rescans', async () => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const runtime = new ServiceRuntime(config, { read: async () => session } as ArkmeSessionStore, {} as StateStore)
    const source = { invalidateSourceListCache: vi.fn() } as unknown as SourceService
    const service = new ChatRealtimeService(runtime, source, { chatTimelineItems: async () => [] })
    const directory = vi.fn(async () => undefined)
    const browser = vi.fn()
    service.directoryInvalidation = directory
    service.subscribeChatRealtime(browser)
    const state = { revision: 1, connected: true, connectionGeneration: 1 }
    const preference = { eventUid: 'remove', userId: 42, items: [{ entityKind: 1 as const, entityUid: 'host-only-session', revision: 3 }], acceptedAtMillis: 1, sourceClientId: 1 }
    const policy = { eventUid: 'pin', userId: 42, chatSessionUid: 'host-only-session', pinState: 2 as const, policyUpdateAtMillis: 20, eventAtMillis: 1 }
    service.handleChatRealtimeNotice({ cause: 'conversation-list-preference-invalidation', state, conversationListPreferenceUpdated: preference })
    service.handleChatRealtimeNotice({ cause: 'chat-policy-invalidation', state, policyUpdated: policy, connectionUserId: 42, connectionSignal: new AbortController().signal })
    await vi.waitFor(() => expect(directory).toHaveBeenCalledTimes(2))
    expect(directory).toHaveBeenCalledWith(preference)
    expect(directory).toHaveBeenCalledWith(policy)
    expect(browser.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
      { type: 'conversation-list-preference-invalidated', revision: expect.any(Number), refresh: 'none' },
      { type: 'chat-policy-invalidated', revision: expect.any(Number), refresh: 'none' },
    ]))
    expect(JSON.stringify(browser.mock.calls)).not.toContain('host-only-session')
    service.dispose(); runtime.dispose()
  })
})

it('starts tails alongside one display batch and delivers fast sessions while a slow tail is pending', async () => {
  const session = {userId:42,accessToken:'access',refreshToken:'refresh'}
  const runtime = new ServiceRuntime(config, {read:async()=>session,write:async()=>{},delete:async()=>{}}, {} as StateStore)
  const source = new SourceService(runtime, new ProfileService(runtime), {
    async summary() { return {recordCount:0,wordsCount:0,totalSec:0} }, recordItem() { return undefined },
  })
  let releaseDisplay!: () => void, releaseSlow!: () => void
  const display = new Promise<void>(resolve => { releaseDisplay = resolve })
  const slow = new Promise<void>(resolve => { releaseSlow = resolve })
  const started: string[] = [], delivered: string[] = []
  let active = 0, maxActive = 0
  const post = vi.spyOn(runtime, 'authenticatedChatPost').mockImplementation(async (path, params: any) => {
    if (path.endsWith('display-snapshots')) {
      await display
      return {items: ['slow','fast','third','fourth'].map(uid => ({session:{chat_session_uid:uid,session_kind:1}}))}
    }
    const uid = params.chat_session_uid
    started.push(uid); active++; maxActive = Math.max(active,maxActive)
    if (uid === 'slow') await slow
    active--; return {items:[]}
  })
  vi.spyOn(source, 'chatSourceFromBundle').mockImplementation(async (bundle: any) => ({
    sourceKey:bundle.session.chat_session_uid,sourceRef:'ref',kind:'private_chat',displayName:'test',
  }))
  const service = new ChatRealtimeService(runtime, source, {chatTimelineItems:async()=>[]})
  vi.spyOn(service,'refreshAttentionSummary').mockResolvedValue()
  service.subscribeChatRealtime(event => {
    if (event.type === 'sessions-delta') delivered.push(...event.updates.map(update=>update.sourceKey))
  })
  const work = service.refreshChatSessionProjectionBatch(['slow','fast','third','fourth'].map(uid=>[uid,{latestSequence:1,notificationHints:[]}]))
  await vi.waitFor(()=>expect(started).toEqual(['slow','fast','third']))
  expect(delivered).toEqual([])
  releaseDisplay()
  await vi.waitFor(()=>expect(delivered).toEqual(expect.arrayContaining(['fast','third','fourth'])))
  expect(delivered).not.toContain('slow')
  releaseSlow(); expect(await work).toEqual([])
  expect(delivered).toHaveLength(4); expect(maxActive).toBeLessThanOrEqual(3)
  expect(post.mock.calls.filter(([path])=>path.endsWith('display-snapshots'))).toHaveLength(1)
  service.dispose(); runtime.dispose()
})


it('refreshes only the directory for read-cursor changes while retaining a concurrent body invalidation', async () => {
  const session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('display-snapshots')) return { items: [{ session: { chat_session_uid: 'chat', session_kind: 1 } }] }
    if (path.endsWith('timeline/tail')) return { items: [] }
    throw Error('unexpected request')
  })
  const runtime = { config, requireSession: async () => session, authenticatedChatPost: post,
    requestScope: () => 'scope', invalidateCalendarDates() {}, sessionStore: { read: async () => session } }
  const source = { cachedChatSourceByKey: () => undefined, chatSourceFromBundle: async () => ({
    sourceRef: 'ref', sourceKey: 'key', kind: 'private_chat', displayName: '同事', activeAtMillis: 1, unreadCount: 0,
  }), setChatSourceByKey() {}, invalidateSourceListCache() {} }
  const reader = { chatTimelineItems: vi.fn(async () => []) }
  const service = new ChatRealtimeService(runtime as never, source as never, reader)
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  try {
    await service.refreshChatSessionProjectionBatch([['chat', { latestSequence: 9, notificationHints: [], refreshTimeline: false }]])
    expect(post.mock.calls.map(call => call[0])).toEqual(['/api/v1/chats/display-snapshots'])
    expect(reader.chatTimelineItems).not.toHaveBeenCalled()
    post.mockClear()
    service.scheduleChatSessionProjection('chat', 10)
    service.scheduleChatSessionProjection('chat', 9, undefined, false)
    await vi.waitFor(() => expect(post.mock.calls.some(call => call[0].endsWith('timeline/tail'))).toBe(true))
    expect(reader.chatTimelineItems).toHaveBeenCalledOnce()
  } finally { service.dispose() }
})


it('deduplicates local cursor echoes across response ordering and recovers uncertain writes', async () => {
  const session = { userId: 10001 }
  const runtime = { config, sessionStore: { read: async () => session } }
  const service = new ChatRealtimeService(runtime as never, {} as never, {} as never)
  const schedule = vi.spyOn(service, 'scheduleChatSessionProjection').mockImplementation(() => {})
  ;(service as any).activateAttentionOwner(session.userId)
  const hint = async (sequence: number) => {
    service.handleChatRealtimeNotice({ cause: 'chat-hint', state: { revision: sequence, connected: true, connectionGeneration: 1 },
      readCursorAdvanced: { eventUid: `event-${sequence}`, chatSessionUid: 'chat', readerUserId: session.userId,
        readSequence: sequence, readAtMillis: 1, eventAtMillis: 1 } })
    await Promise.resolve(); await Promise.resolve()
  }
  try {
    const first = service.beginLocalReadCursor(session.userId, 'chat', 10)
    await hint(10)
    first(10)
    await hint(10)
    expect(schedule).not.toHaveBeenCalled()
    await hint(11)
    expect(schedule).toHaveBeenLastCalledWith('chat', 11, undefined, false)
    schedule.mockClear()
    const uncertain = service.beginLocalReadCursor(session.userId, 'chat', 12)
    await hint(12)
    uncertain(); uncertain()
    expect(schedule).toHaveBeenCalledExactlyOnceWith('chat', 12, undefined, false)
    for (let n = 0; n < 600; n++) service.beginLocalReadCursor(session.userId, `chat-${n}`, 1)(1)
    expect((service as any).localReadCursors.size).toBeLessThanOrEqual(512)
    const pending = Array.from({ length: 130 }, (_, n) => service.beginLocalReadCursor(session.userId, 'pending', n + 1))
    expect((service as any).localReadCursors.get('pending').pending.size).toBe(128)
    service.resetAttentionSummary()
    expect((service as any).localReadCursors.size).toBe(0)
    schedule.mockClear()
    ;(service as any).activateAttentionOwner(session.userId + 1)
    for (const finish of pending) finish()
    service.beginLocalReadCursor(session.userId, 'stale-account', 130)()
    expect((service as any).attentionOwnerUserId).toBe(session.userId + 1)
    expect((service as any).localReadCursors.size).toBe(0)
    expect(schedule).not.toHaveBeenCalled()
  } finally { service.dispose() }
})

function projectionScheduler() {
  const session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
  const runtime = new ServiceRuntime(config, { read: async () => session } as ArkmeSessionStore, {} as StateStore)
  const service = new ChatRealtimeService(runtime, {} as SourceService, { chatTimelineItems: async () => [] })
  const batch = vi.spyOn(service, 'refreshChatSessionProjectionBatch')
  return { service, batch, close: () => { service.dispose(); runtime.dispose() } }
}

it('continues preferred chat arrivals while another chat projection is blocked, without overlapping the same chat', async () => {
  vi.useFakeTimers()
  const { service, batch, close } = projectionScheduler()
  let releaseBackground!: (value: []) => void
  let releasePreferred!: (value: []) => void
  batch.mockImplementation(async pending => pending[0]![0] === 'background'
    ? await new Promise<[]>(resolve => { releaseBackground = resolve })
    : await new Promise<[]>(resolve => { releasePreferred = resolve }))
  try {
    service.preferChatProjection(10001, 'current')
    service.scheduleChatSessionProjection('background', 1)
    await vi.advanceTimersByTimeAsync(1)
    service.scheduleChatSessionProjection('current', 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(batch.mock.calls.map(([items]) => items.map(([uid]) => uid))).toEqual([['background'], ['current']])
    for (let sequence = 2; sequence <= 100; sequence++) service.scheduleChatSessionProjection('current', sequence)
    await vi.advanceTimersByTimeAsync(1000)
    expect(batch).toHaveBeenCalledTimes(2)
    releasePreferred([])
    await vi.advanceTimersByTimeAsync(1)
    expect(batch).toHaveBeenCalledTimes(3)
    expect(batch.mock.calls[2]![0][0]![1].latestSequence).toBe(100)
    releasePreferred([])
    await vi.advanceTimersByTimeAsync(1)
    service.scheduleChatSessionProjection('current', 101)
    await vi.advanceTimersByTimeAsync(1)
    expect(batch).toHaveBeenCalledTimes(4)
    releasePreferred([]); releaseBackground([])
    await vi.advanceTimersByTimeAsync(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally { close(); vi.useRealTimers() }
})

it('isolates failed-chat backoff while retaining retry and letting a fresh hint supersede it', async () => {
  vi.useFakeTimers()
  const { service, batch, close } = projectionScheduler()
  batch.mockImplementation(async pending => pending[0]![0] === 'background' ? pending : [])
  try {
    service.preferChatProjection(10001, 'current')
    service.scheduleChatSessionProjection('background', 1)
    await vi.advanceTimersByTimeAsync(1)
    service.scheduleChatSessionProjection('current', 1)
    await vi.advanceTimersByTimeAsync(1)
    expect(batch.mock.calls.map(([items]) => items[0]![0])).toEqual(['background', 'current'])
    await vi.advanceTimersByTimeAsync(100)
    expect(batch).toHaveBeenCalledTimes(2)
    service.scheduleChatSessionProjection('background', 2)
    await vi.advanceTimersByTimeAsync(1)
    expect(batch).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(650)
    expect(batch).toHaveBeenCalledTimes(4)
  } finally { close(); vi.useRealTimers() }
})

it.each(['reset', 'dispose'] as const)('drops a completed stale flight after %s instead of requeuing it', async action => {
  vi.useFakeTimers()
  const { service, batch, close } = projectionScheduler()
  let release!: (value: Array<[string, PendingChatProjection]>) => void
  batch.mockImplementation(() => new Promise(resolve => { release = resolve }))
  try {
    service.preferChatProjection(10001, 'current')
    service.scheduleChatSessionProjection('current', 1)
    await vi.advanceTimersByTimeAsync(1)
    const old = batch.mock.calls[0]![0]
    if (action === 'reset') service.resetAttentionSummary(); else service.dispose()
    release(old)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(batch).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  } finally { close(); vi.useRealTimers() }
})

it('expires the single read priority hint and cannot promote a different account', async () => {
  vi.useFakeTimers()
  const { service, batch, close } = projectionScheduler()
  batch.mockResolvedValue([])
  try {
    ;(service as unknown as { activateAttentionOwner(userId: number): void }).activateAttentionOwner(10001)
    service.preferChatProjection(10001, 'current')
    service.preferChatProjection(99999, 'background')
    service.scheduleChatSessionProjection('background', 1)
    service.scheduleChatSessionProjection('current', 1)
    await vi.advanceTimersByTimeAsync(3)
    expect(batch.mock.calls.map(([items]) => items.map(([uid]) => uid))).toEqual([['current'], ['background']])
    batch.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    service.scheduleChatSessionProjection('background', 2)
    service.scheduleChatSessionProjection('current', 2)
    await vi.advanceTimersByTimeAsync(3)
    expect(batch.mock.calls.map(([items]) => items.map(([uid]) => uid))).toEqual([['background', 'current']])
  } finally { close(); vi.useRealTimers() }
})

it('publishes consecutive preferred-chat bodies while another HTTP tail is unresolved, within the existing lane budgets', async () => {
  const session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
  let releaseBackground!: () => void
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('display-snapshots')) return { items: (body.chat_session_uids as string[]).map(uid => ({ session: { chat_session_uid: uid, session_kind: 1 } })) }
    if (body.chat_session_uid === 'background') await new Promise<void>(resolve => { releaseBackground = resolve })
    return { items: [] }
  })
  const runtime = { config, requireSession: async () => session, authenticatedChatPost: post,
    requestScope: () => 'scope', invalidateCalendarDates() {}, sessionStore: { read: async () => session } }
  const source = { cachedChatSourceByKey: () => undefined, chatSourceFromBundle: async (bundle: { session: { chat_session_uid: string } }) => ({
    sourceRef: bundle.session.chat_session_uid, sourceKey: bundle.session.chat_session_uid,
    kind: 'private_chat', displayName: '同事', activeAtMillis: 1, unreadCount: 0,
  }), setChatSourceByKey() {}, invalidateSourceListCache() {} }
  const service = new ChatRealtimeService(runtime as never, source as never, { chatTimelineItems: async () => [] })
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  const updates: string[] = []
  service.subscribeChatRealtime(event => { if (event.type === 'sessions-delta') updates.push(...event.updates.map(update => update.sourceKey)) })
  const arrive = (uid: string, sequence: number) => service.scheduleChatSessionProjection(uid, sequence, {
    hint: { eventUid: `${uid}-${sequence}`, chatSessionUid: uid, relationUid: `rel-${sequence}`, latestSequence: sequence,
      senderUserId: 20002, eventAtMillis: Date.now() }, connectionGeneration: 1, attempts: 0,
    baselinePassed: true, accountUserId: 10001, accountOwnerGeneration: 0,
  })
  try {
    service.preferChatProjection(10001, 'current')
    arrive('background', 1)
    await vi.waitFor(() => expect(releaseBackground).toBeTypeOf('function'))
    arrive('current', 1)
    await vi.waitFor(() => expect(updates).toEqual(['current']))
    arrive('current', 2)
    await vi.waitFor(() => expect(updates).toEqual(['current', 'current']))
    const calls = post.mock.calls as unknown as Array<[string, Record<string, unknown>, unknown, unknown, { lane: string }]>
    for (const [, body, , , options] of calls) {
      const uid = body.chat_session_uid ?? (body.chat_session_uids as string[])[0]
      expect(options.lane).toBe(uid === 'current' ? 'interactive-read' : 'background-read')
    }
    releaseBackground()
    await vi.waitFor(() => expect(updates).toEqual(['current', 'current', 'background']))
  } finally { service.dispose() }
})

it.each(['current', 'reset'] as const)('does not hold confirmed human-direct bodies behind a blocked directory response: %s', async scenario => {
  const session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
  const row = { sourceRef: 'dynamic', conversationRef: 'stable', sourceKey: 'chat-key', kind: 'private_chat',
    directMessageAdmissionApplicable: true, displayName: '同事', activeAtMillis: 1, unreadCount: 0 }
  let releaseDisplay!: (value: unknown) => void
  let releaseBody!: (value: ArkmeTimelineItem[]) => void
  const runtime = { config, requireSession: async () => session,
    authenticatedChatPost: vi.fn(async (path: string) => path.endsWith('display-snapshots')
      ? await new Promise(resolve => { releaseDisplay = resolve }) : { items: [] }),
    requestScope: () => 'scope', invalidateCalendarDates() {}, sessionStore: { read: async () => session } }
  const source = { cachedChatSourceByKey: () => row, chatSourceFromBundle: async () => row,
    setChatSourceByKey() {}, invalidateSourceListCache() {} }
  const reader = { chatTimelineItems: vi.fn(() => new Promise<ArkmeTimelineItem[]>(resolve => { releaseBody = resolve })) }
  const service = new ChatRealtimeService(runtime as never, source as never, reader)
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  const events: ArkmeChatClientEvent[] = []
  service.subscribeChatRealtime(event => {
    if (event.type === 'timeline-items' || event.type === 'sessions-delta') events.push(event)
  })
  try {
    service.preferChatProjection(10001, 'chat')
    const work = service.refreshChatSessionProjectionBatch([['chat', { latestSequence: 1, notificationHints: [] }]])
    await vi.waitFor(() => expect(releaseBody).toBeTypeOf('function'))
    if (scenario === 'reset') service.resetAttentionSummary()
    const items = [{ itemUid: 'message-1', sequence: 1, senderName: '同事', isMe: false, sendAtMillis: 1, textContent: '正文', status: 1 }]
    releaseBody(items)
    if (scenario === 'current') await vi.waitFor(() => expect(events).toEqual([{
      type: 'timeline-items', revision: 1, source: { sourceRef: 'stable', sourceKey: 'chat-key', latestSequence: 1 }, items,
    }]))
    else { await Promise.resolve(); expect(events).toEqual([]) }
    releaseDisplay({ items: [{ session: { chat_session_uid: 'chat', session_kind: 1 } }] })
    await work
    expect(reader.chatTimelineItems).toHaveBeenCalledOnce()
    if (scenario === 'current') expect(events.map(event => event.type)).toEqual(['timeline-items', 'sessions-delta'])
    else expect(events).toEqual([])
  } finally { service.dispose() }
})

it.each(['current', 'reset', 'bounded'] as const)('keeps receiving bodies while the same conversation display retries: %s', async scenario => {
  const session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
  const row = { sourceRef: 'ref', sourceKey: 'chat-key', kind: 'private_chat', directMessageAdmissionApplicable: true,
    displayName: '同事', activeAtMillis: 1, unreadCount: 0 }
  let release!: () => void
  const display = new Promise<void>(resolve => { release = resolve })
  const tailSequences: number[] = []
  const runtime = { config, requireSession: async () => session, requestScope: () => 'scope',
    invalidateCalendarDates() {}, sessionStore: { read: async () => session },
    authenticatedChatPost: vi.fn(async (path: string, body: { after_seq: number }) => {
      if (path.endsWith('display-snapshots')) { await display; return { items: [{ session: { chat_session_uid: 'chat', session_kind: 1 } }] } }
      const sequence = body.after_seq + 1
      tailSequences.push(sequence)
      return { items: [{ relation: { rel_uid: `rel-${sequence}`, record_uid: `message-${sequence}`, seq: sequence, sender_user_id: 20002 } }] }
    }) }
  const source = { cachedChatSourceByKey: () => row, chatSourceFromBundle: async () => row,
    setChatSourceByKey() {}, invalidateSourceListCache() {} }
  const reader = { chatTimelineItems: async (data: Record<string, unknown>) => (data.items as Array<{ relation: { seq: number } }>).map(item => ({
    itemUid: `message-${item.relation.seq}`, sequence: item.relation.seq, senderName: '同事', isMe: false,
    sendAtMillis: 1, textContent: '正文', status: 1,
  })) }
  const service = new ChatRealtimeService(runtime as never, source as never, reader)
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  const events: ArkmeChatClientEvent[] = []
  service.subscribeChatRealtime(event => { events.push(event) })
  try {
    service.preferChatProjection(10001, 'chat')
    const count = scenario === 'bounded' ? 51 : 3
    for (let sequence = 1; sequence <= count; sequence++) {
      service.scheduleChatSessionProjection('chat', sequence, { attempts: 0, connectionGeneration: 1,
        accountUserId: 10001, accountOwnerGeneration: 0, baselinePassed: true,
        hint: { eventUid: `event-${sequence}`, chatSessionUid: 'chat', relationUid: `rel-${sequence}`, latestSequence: sequence,
          senderUserId: 20002, eventAtMillis: Date.now() } })
      if (sequence <= 50) await vi.waitFor(() => expect(events.filter(event => event.type === 'timeline-items')).toHaveLength(sequence))
    }
    expect(events.every(event => event.type === 'timeline-items')).toBe(true)
    expect(tailSequences).toEqual(Array.from({ length: Math.min(count, 50) }, (_, index) => index + 1))
    if (scenario === 'reset') service.resetAttentionSummary()
    release()
    if (scenario !== 'reset') {
      await vi.waitFor(() => expect(events.some(event => event.type === 'sessions-delta')).toBe(true))
      await vi.waitFor(() => expect(tailSequences).toHaveLength(count))
    } else {
      await Promise.resolve(); await Promise.resolve()
      expect(events.some(event => event.type === 'sessions-delta')).toBe(false)
    }
    expect(tailSequences).toEqual(Array.from({ length: count }, (_, index) => index + 1))
  } finally { release(); service.dispose() }
})

it.each(['held', 'reset', 'dispose', 'stop', 'multiple-sessions'] as const)('keeps body flights independent of bounded native notification delivery: %s', async scenario => {
  const session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
  const row = { sourceRef: 'ref', sourceKey: 'chat-key', kind: 'private_chat', directMessageAdmissionApplicable: true,
    displayName: '同事', activeAtMillis: 1, unreadCount: 0, notificationAllowed: true }
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const tailKeys: string[] = []
  const nativeKeys: string[] = []
  let active = 0
  let peak = 0
  const runtime = { config, requireSession: async () => session, requestScope: () => 'scope',
    invalidateCalendarDates() {}, sessionStore: { read: async () => session },
    authenticatedChatPost: vi.fn(async (path: string, body: { chat_session_uids: string[]; chat_session_uid: string; after_seq: number }) => {
      if (path.endsWith('display-snapshots')) return { items: body.chat_session_uids.map(uid => ({ session: { chat_session_uid: uid, session_kind: 1 } })) }
      const sequence = body.after_seq + 1
      const id = `${body.chat_session_uid}-${sequence}`
      tailKeys.push(id)
      return { items: [{ relation: { rel_uid: id, record_uid: id, seq: sequence, sender_user_id: 20002 } }] }
    }) }
  const source = { cachedChatSourceByKey: () => row, chatSourceFromBundle: async () => row,
    setChatSourceByKey() {}, invalidateSourceListCache() {} }
  const reader = { chatTimelineItems: async (data: Record<string, unknown>) => (data.items as Array<{ relation: { seq: number; record_uid: string } }>).map(item => ({
    itemUid: item.relation.record_uid, sequence: item.relation.seq, senderName: '同事', isMe: false,
    sendAtMillis: Date.now(), textContent: '正文', status: 1,
  })) }
  const service = new ChatRealtimeService(runtime as never, source as never, reader, {
    applyBadgeSummary: async () => true,
    showNotification: async payload => {
      nativeKeys.push(payload.idempotencyKey)
      peak = Math.max(peak, ++active)
      await hold
      active--
      return { outcome: 'unsupported' as const, fallbackToBrowser: true }
    },
  })
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  let stop: (() => void) | undefined
  if (scenario === 'stop') {
    const realtime = (service as unknown as { chatRealtime: { start(): () => void; subscribe(listener: unknown): () => void } }).chatRealtime
    vi.spyOn(realtime, 'start').mockReturnValue(() => {})
    vi.spyOn(realtime, 'subscribe').mockReturnValue(() => {})
    stop = service.startChatRealtime()
  }
  const bodies: string[] = []
  const browser: string[] = []
  service.subscribeChatRealtime(event => {
    if (event.type === 'sessions-delta') bodies.push(...event.updates.flatMap(update => update.timelineItems ?? []).map(item => item.itemUid))
    if (event.type === 'message-notification') browser.push(event.notification.eventUid)
  })
  const multiple = scenario === 'multiple-sessions'
  const expected = Array.from({ length: 12 }, (_, index) => `${multiple ? `chat-${index % 4}` : 'chat'}-${multiple ? Math.floor(index / 4) + 1 : index + 1}`)
  try {
    service.preferChatProjection(10001, 'chat')
    for (let index = 0; index < expected.length; index++) {
      const uid = multiple ? `chat-${index % 4}` : 'chat'
      const sequence = multiple ? Math.floor(index / 4) + 1 : index + 1
      service.scheduleChatSessionProjection(uid, sequence, { attempts: 0, connectionGeneration: 1,
        accountUserId: 10001, accountOwnerGeneration: 0, baselinePassed: true,
        hint: { eventUid: expected[index]!, chatSessionUid: uid, relationUid: expected[index]!, latestSequence: sequence,
          senderUserId: 20002, eventAtMillis: Date.now() } })
      await vi.waitFor(() => expect(bodies).toHaveLength(index + 1))
    }
    expect(bodies).toEqual(expected)
    expect(tailKeys).toEqual(expected)
    expect(peak).toBe(multiple ? 3 : 1)
    expect(nativeKeys).toHaveLength(multiple ? 3 : 1)
    const internals = service as unknown as { projectionTimer: unknown; nativeNotificationFlights: Map<string, unknown> }
    await vi.waitFor(() => expect(internals.projectionTimer).toBeUndefined())
    if (scenario === 'reset') service.resetAttentionSummary()
    if (scenario === 'dispose') service.dispose()
    if (scenario === 'stop') stop?.()
    release()
    if (scenario === 'held' || multiple) {
      await vi.waitFor(() => expect(browser).toHaveLength(12))
      expect(new Set(nativeKeys).size).toBe(12)
      expect(tailKeys).toEqual(expected)
      if (!multiple) expect(nativeKeys).toEqual(expected)
    } else {
      await vi.waitFor(() => expect(active).toBe(0))
      expect(browser).toEqual([])
      expect(nativeKeys).toHaveLength(1)
    }
    await vi.waitFor(() => expect(internals.nativeNotificationFlights.size).toBe(0))
  } finally { release(); service.dispose() }
})


it('coalesces lifecycle preview reads, clears deleted content, and keeps the existing three-worker bound', async () => {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  let active = 0, maxActive = 0
  const post = vi.fn(async (path: string, body: { chat_session_uid: string }) => {
    expect(path).toBe('/api/v1/chats/detail')
    active++; maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return { session: { chat_session_uid: body.chat_session_uid, session_kind: 1, last_seq: 9 },
      unread_snapshot: { unread_count: 0, session_last_seq: 9 },
      latest_preview: { record: { status: 'missing', payload: {} } } }
  })
  const runtime = { config, requireSession: async () => session, authenticatedChatPost: post,
    stateStore: { uniqueCode: async () => 'fixture-key' }, requestScope: () => 'scope', invalidateKey() {}, invalidateCalendarDates() {}, sessionStore: { read: async () => session } }
  const source = new SourceService(runtime as never, {} as never, {} as never)
  for (let i = 0; i < 10; i++) source.setChatSource(42, `chat-${i}`, { sourceRef: `ref-${i}`, kind: 'private_chat', displayName: '同事', activeAtMillis: 1, unreadCount: 1, latestSequence: 9, latestPreview: '已删除消息' })
  const reader = { chatTimelineItems: vi.fn(async () => []) }
  const service = new ChatRealtimeService(runtime as never, source, reader)
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  const events: ArkmeChatClientEvent[] = []
  service.subscribeChatRealtime(event => events.push(event))
  try {
    for (let i = 0; i < 10; i++) for (let duplicate = 0; duplicate < 3; duplicate++) {
      service.scheduleChatSessionProjection(`chat-${i}`, 9, undefined, false, true)
    }
    await vi.waitFor(() => expect(events.filter(event => event.type === 'sessions-delta')).toHaveLength(10))
    expect(post).toHaveBeenCalledTimes(10)
    expect(maxActive).toBe(3)
    expect(reader.chatTimelineItems).not.toHaveBeenCalled()
    for (let i = 0; i < 10; i++) expect(source.cachedChatSource(42, `chat-${i}`)?.latestPreview ?? '').toBe('')
    expect(events.some(event => event.type === 'message-notification')).toBe(false)
    const options = (post.mock.calls as unknown as Array<unknown[]>).map(call => call[4])
    expect(options).toEqual(Array.from({ length: 10 }, () => expect.objectContaining({ traffic: 'message-sync', bypassCache: true })))
  } finally { service.dispose() }
})

it('projects current counterpart names through realtime display refresh without rewriting historical senders', async () => {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  const runtime = new ServiceRuntime(config, { read: async () => session, write: async () => {}, delete: async () => {} }, { uniqueCode: async () => 'current-name-fixture' } as unknown as StateStore)
  const source = new SourceService(runtime, new ProfileService(runtime), {
    async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
  })
  const bundle = { session: { chat_session_uid: 'chat', session_kind: 1 },
    private_counterpart: { user_id: 17, display_name_snapshot: '当前昵称' },
    private_supplement: { remark: '', counterpart_name_snapshot: '当前昵称' },
    unread_snapshot: { session_last_seq: 7, unread_count: 0 } }
  const post = vi.spyOn(runtime, 'authenticatedChatPost').mockImplementation(async path => {
    if (path.endsWith('display-snapshots')) return { items: [bundle] }
    throw new Error('name refresh must not fetch historical bodies')
  })
  const reader = { chatTimelineItems: vi.fn(async () => []) }
  const service = new ChatRealtimeService(runtime, source, reader)
  vi.spyOn(service, 'refreshAttentionSummary').mockResolvedValue()
  const updates: Array<{ displayName: string; privateNickname?: string }> = []
  const stop = service.subscribeChatRealtime(event => {
    if (event.type === 'sessions-delta') updates.push(...event.updates.map(update => update.source))
  })
  try {
    for (const nickname of ['当前昵称', '改名后的昵称']) {
      bundle.private_counterpart.display_name_snapshot = nickname
      bundle.private_supplement.counterpart_name_snapshot = nickname
      expect(await service.refreshChatSessionProjectionBatch([['chat', { latestSequence: 7, notificationHints: [], refreshTimeline: false }]])).toEqual([])
      expect(updates.at(-1)).toMatchObject({ displayName: nickname, privateNickname: nickname })
    }
    bundle.private_supplement.remark = '我的备注'
    await service.refreshChatSessionProjectionBatch([['chat', { latestSequence: 7, notificationHints: [], refreshTimeline: false }]])
    expect(updates.at(-1)).toMatchObject({ displayName: '我的备注', privateNickname: '改名后的昵称' })
    expect(post).toHaveBeenCalledTimes(3)
    expect(reader.chatTimelineItems).not.toHaveBeenCalled()
  } finally { stop(); service.dispose(); runtime.dispose() }
})

it.each(['current','other-account','aborted','disposed'] as const)('fences native annotation hints to the receiving login: %s', async scenario => {
 const runtime=new ServiceRuntime(config,{async read(){return {userId:42,accessToken:'access',refreshToken:'refresh'}},async write(){},async delete(){}} as ArkmeSessionStore,{} as StateStore)
 const source=new SourceService(runtime,new ProfileService(runtime),{async summary(){return {recordCount:0,wordsCount:0,totalSec:0}},recordItem(){return undefined}})
 const service=new ChatRealtimeService(runtime,source,{chatTimelineItems:vi.fn(async()=>[])})
 const events:ArkmeChatClientEvent[]=[];service.subscribeChatRealtime(event=>events.push(event))
 const controller=new AbortController();if(scenario==='aborted')controller.abort()
 if(scenario==='disposed')service.dispose()
 service.handleChatRealtimeNotice({cause:'projection-invalidation',state:{revision:1,connected:true,connectionGeneration:1},connectionUserId:scenario==='other-account'?43:42,connectionSignal:controller.signal,projectionInvalidation:{eventUid:'annotation-event',projection:'dsh_annotations',eventAtMillis:1}})
 await new Promise(resolve=>setTimeout(resolve,10))
 if(scenario==='current')expect(events).toEqual([expect.objectContaining({type:'projection-invalidated',projection:'dsh_annotations'})]);else expect(events).toEqual([])
 service.dispose();runtime.dispose()
})

it('forwards a real annotation SSE frame through the receiving account fence', async () => {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  const runtime = new ServiceRuntime(config, {
    async read() { return session }, async write() {}, async delete() {},
  } as ArkmeSessionStore, {} as StateStore)
  const source = new SourceService(runtime, new ProfileService(runtime), {
    async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
  })
  const service = new ChatRealtimeService(runtime, source, { chatTimelineItems: vi.fn(async () => []) })
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const realtime = new ArkmeChatRealtimeRuntime({
    imBaseUrl: config.imBaseUrl, readSession: async () => session,
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }),
      { headers: { 'Content-Type': 'text/event-stream' } }),
  })
  const events: ArkmeChatClientEvent[] = []
  const unsubscribe = service.subscribeChatRealtime(event => events.push(event))
  const disconnect = realtime.subscribe(notice => {
    if (notice.cause === 'projection-invalidation') service.handleChatRealtimeNotice(notice)
  })
  const stop = realtime.start()
  try {
    await vi.waitFor(() => expect(realtime.state().connected).toBe(true))
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
      t: 25, event_uid: 'native-annotation-sse', projection: 'dsh_annotations', event_at: 1,
    })}\n\n`))
    await vi.waitFor(() => expect(events).toEqual([
      expect.objectContaining({ type: 'projection-invalidated', projection: 'dsh_annotations' }),
    ]))
    expect(events[0]).not.toHaveProperty('connectionUserId')
    expect(events[0]).not.toHaveProperty('connectionSignal')
  } finally {
    stop(); disconnect(); unsubscribe(); stream.close(); service.dispose(); runtime.dispose()
  }
})
