import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import {
  ChatRealtimeService,
  type ArkmeNativeAttentionDispatcher,
  type PendingChatProjection,
} from '../../src/services/chat-realtime-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'
import type { ArkmeTimelineItem } from '../../src/types.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ChatRealtimeService', () => {
  it('projects a member event hint without reading messages or refreshing unread/attention state', async () => {
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
    const schedule = vi.spyOn(service, 'scheduleChatSessionProjection')
    const attention = vi.spyOn(service, 'refreshAttentionSummary')
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    service.handleChatRealtimeNotice({
      cause: 'chat-hint', state: { revision: 2, connected: true, connectionGeneration: 1 },
      memberEvent: { eventUid: 'leave-1', chatSessionUid: 'raw-group', eventAtMillis: 1234 },
    })
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toMatchObject({ type: 'member-events-invalidated', eventId: 'leave-1', occurredAtMillis: 1234,
      sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./) })
    expect(JSON.stringify(events[0])).not.toContain('raw-group')
    expect(timeline).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
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
    vi.spyOn(service as unknown as { reconcileChatNotificationBaseline(generation: number): Promise<void> },
      'reconcileChatNotificationBaseline').mockResolvedValue()
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
    expect(schedule).toHaveBeenCalledWith('raw-chat-session', 9)
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

    await vi.waitFor(() => { expect(schedule).toHaveBeenCalledWith('chat-self', 12) })
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
      reconcileChatNotificationBaseline(generation: number, userId?: number): Promise<void>
    }, 'reconcileChatNotificationBaseline').mockResolvedValue()
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

  it('bounds native notification delivery at three while preserving ordered Browser fallbacks', async () => {
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
      async chatTimelineItems(_data, _session, chatSessionUid) {
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

    await expect(service.refreshChatSessionProjectionBatch(pending)).resolves.toEqual([])

    expect(maxActive).toBe(3)
    expect(active).toBe(0)
    expect(startedKeys).toEqual(Array.from({ length: notificationCount }, (_, index) => `event-${String(index)}`))
    expect(events.filter(event => event.type === 'message-notification').map(event => event.notification?.eventUid))
      .toEqual(Array.from({ length: notificationCount }, (_, index) => index)
        .filter(index => index % 4 === 1 && index !== 5)
        .map(index => `event-${String(index)}`))
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
