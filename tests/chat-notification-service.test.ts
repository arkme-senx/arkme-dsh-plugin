import { describe, expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

class MemorySessionStore {
  session: ArkmeSessionCredentials | undefined
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

class MinimalStateStore {
  async uniqueCode() { return 'notification-test-device' }
  async revision() { return 0 }
  async cachedProfile() { return { profile: null, cachedAtMillis: 0, revision: 0 } }
  async cacheProfile() { throw new Error('not used') }
  async cachedSnapshot() { return { items: [], hasMore: false, cachedAtMillis: 0, revision: 0 } }
  async cacheSummary() {}
  async cachePage() {}
  async queryCached() { return { items: [], hasMore: false, cachedAtMillis: 0, revision: 0 } }
  async listPending() { return [] }
  async putPending() {}
  async markAttempt() {}
  async markSynced() {}
}

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5_000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true,
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function privateBundle(lastSequence: number, unreadCount: number) {
  return {
    session: {
      chat_session_uid: 'chat-private-1', session_kind: 1,
      title: '', last_seq: lastSequence, last_active_at: 1_700_000_000_000,
    },
    private_counterpart: { display_name_snapshot: '小林' },
    private_supplement: { remark: '林溪' },
    current_policy: { mute_state: 1, notify_state: 1 },
    sort_active_at: 1_700_000_000_000,
    unread_snapshot: { unread_count: unreadCount, session_last_seq: lastSequence },
  }
}

function unreadSummary(badgeCount = 0): Response {
  return json({
    items: [], has_more: false,
    summary: {
      badge_count: badgeCount, muted_unread_count: 0, session_count_with_unread: badgeCount > 0 ? 1 : 0,
      has_attention: false, summary_version: Date.now(), updated_at: Date.now(),
    },
  })
}

describe('Arkme Chat message notification projection', () => {
  it('emits one notification for every peer hint after the authoritative session delta', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let sse!: ReadableStreamDefaultController<Uint8Array>
    const requestBodies: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requestBodies.push({ url, body })
      if (url === 'https://im.test/api/v1/sse/chat/noty') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            sse = controller
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'))
            }, { once: true })
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.endsWith('/api/v1/chats/unread-snapshot')) return unreadSummary()
      if (url.endsWith('/api/v1/chats/list')) {
        return json({ items: [privateBundle(8, 0)], has_more: false })
      }
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        return json({ items: [privateBundle(11, 3)] })
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        return json({ items: [
          {
            relation: {
              record_uid: 'record-9', rel_uid: 'relation-9', sender_user_id: 20002,
              display_name_snapshot: '小林', attach_at: 1_700_000_000_009, seq: 9,
            },
            record: { status: 1, payload: { text_content: '第一条消息' } },
          },
          {
            relation: {
              record_uid: 'record-10', rel_uid: 'wrong-relation-10', sender_user_id: 30003,
              display_name_snapshot: '错误发送者', attach_at: 1_700_000_000_009, seq: 9,
            },
            record: { status: 1, payload: { text_content: '不能借用的同记录消息' } },
          },
          {
            relation: {
              record_uid: 'record-10', rel_uid: 'relation-10', sender_user_id: 20002,
              display_name_snapshot: '小林', attach_at: 1_700_000_000_010, seq: 10,
            },
            record: { status: 1, payload: { text_content: '第二条消息' } },
          },
          {
            relation: {
              record_uid: 'record-11', rel_uid: 'relation-11', sender_user_id: 20002,
              display_name_snapshot: '小林', attach_at: 1_700_000_000_011, seq: 11,
            },
            record: { status: 1, payload: { title: '附件标题', file_uid: 'file-1' } },
          },
        ] })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, new MinimalStateStore(), fetchImpl)
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = service.subscribeChatRealtime(event => {
      events.push(event as unknown as Record<string, unknown>)
    })
    const stop = service.startChatRealtime()
    await vi.waitFor(() => {
      expect(requestBodies.some(request => request.url.endsWith('/api/v1/chats/list'))).toBe(true)
    })

    const encoder = new TextEncoder()
    const eventAtMillis = Date.now()
    for (const [eventUid, sequence, eventAt] of [
      ['event-9', 9, eventAtMillis + 9],
      ['event-10', 10, eventAtMillis + 10],
      ['event-11', 11, eventAtMillis + 11],
    ] as const) {
      sse.enqueue(encoder.encode(`data: ${JSON.stringify({
        t: 17,
        event_uid: eventUid,
        chat_session_uid: 'chat-private-1',
        rel_uid: `relation-${String(sequence)}`,
        latest_seq: sequence,
        sender_user_id: 20002,
        event_at: eventAt,
      })}\n\n`))
    }

    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'message-notification')).toHaveLength(3)
    }, { timeout: 2_000 })
    const deltaIndex = events.findIndex(event => event.type === 'sessions-delta')
    const notificationIndexes = events
      .map((event, index) => event.type === 'message-notification' ? index : -1)
      .filter(index => index >= 0)
    expect(notificationIndexes.every(index => index > deltaIndex)).toBe(true)
    expect(events.filter(event => event.type === 'message-notification').map(event => event.notification))
      .toEqual([
        expect.objectContaining({
          eventUid: 'event-9', title: '林溪', body: '第一条消息',
          sourceKey: expect.stringMatching(/^arkme-chat-source-v1\./),
        }),
        expect.objectContaining({ eventUid: 'event-10', title: '林溪', body: '第二条消息' }),
        expect.objectContaining({ eventUid: 'event-11', title: '林溪', body: '附件标题' }),
      ])
    expect(requestBodies.find(request => request.url.endsWith('/api/v1/chat/timeline/tail'))?.body)
      .toMatchObject({ chat_session_uid: 'chat-private-1', after_seq: 8, limit: 50 })
    unsubscribe()
    stop()
  })

  it('notifies peer message extensions while keeping other timeline changes silent', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let sse!: ReadableStreamDefaultController<Uint8Array>
    const eventAtMillis = Date.now()
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === 'https://im.test/api/v1/sse/chat/noty') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            sse = controller
            init?.signal?.addEventListener('abort', () => {
              try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* already closed */ }
            }, { once: true })
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.endsWith('/api/v1/chats/unread-snapshot')) return unreadSummary(3)
      if (url.endsWith('/api/v1/chats/list')) return json({ items: [privateBundle(8, 0)], has_more: false })
      if (url.endsWith('/api/v1/chats/display-snapshots')) return json({ items: [privateBundle(11, 3)] })
      if (url.endsWith('/api/v1/chat/timeline/tail')) return json({ items: [
        {
          relation: {
            record_uid: 'extension-9', rel_uid: 'extension-relation-9', sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: eventAtMillis + 9, seq: 9,
          },
          record: { status: 1, payload: { text_content: '[jm_emoji:angry_face]' } },
        },
        {
          relation: {
            record_uid: 'extension-10', rel_uid: 'extension-relation-10', sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: eventAtMillis + 10, seq: 10,
          },
          record: { status: 1, payload: { text_content: '[jm_emoji:cute_face]' } },
        },
        {
          relation: {
            record_uid: 'extension-11', rel_uid: 'extension-relation-11', sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: eventAtMillis + 11, seq: 11,
          },
          record: { status: 1, payload: { text_content: 'cash' } },
        },
      ] })
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, new MinimalStateStore(), fetchImpl)
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = service.subscribeChatRealtime(event => { events.push(event as unknown as Record<string, unknown>) })
    const stop = service.startChatRealtime()
    await vi.waitFor(() => {
      expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/api/v1/chats/list'))).toBe(true)
    })

    const encoder = new TextEncoder()
    for (const [sequence, eventUid] of [[9, 'extension-event-9'], [10, 'extension-event-10'], [11, 'extension-event-11']] as const) {
      sse.enqueue(encoder.encode(`data: ${JSON.stringify({
        t: 20,
        event_uid: eventUid,
        chat_session_uid: 'chat-private-1',
        rel_uid: `extension-relation-${String(sequence)}`,
        latest_seq: sequence,
        actor_user_id: 20002,
        change_kind: 4,
        change_version: eventAtMillis + sequence,
        relation_terminal: false,
        event_at: eventAtMillis + sequence,
        source_client_id: 0,
      })}\n\n`))
    }

    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'message-notification')).toHaveLength(3)
    }, { timeout: 2_000 })
    expect(events.filter(event => event.type === 'message-notification').map(event => event.notification))
      .toEqual([
        expect.objectContaining({ eventUid: 'extension-event-9', body: '😡' }),
        expect.objectContaining({ eventUid: 'extension-event-10', body: '🥹' }),
        expect.objectContaining({ eventUid: 'extension-event-11', body: 'cash' }),
      ])

    sse.enqueue(encoder.encode(`data: ${JSON.stringify({
      t: 20,
      event_uid: 'reedit-event-11',
      chat_session_uid: 'chat-private-1',
      rel_uid: 'extension-relation-11',
      latest_seq: 11,
      actor_user_id: 20002,
      change_kind: 3,
      change_version: eventAtMillis + 12,
      relation_terminal: false,
      event_at: eventAtMillis + 12,
      source_client_id: 0,
    })}\n\n`))
    await vi.waitFor(() => { expect(events.filter(event => event.type === 'timeline-changed')).toHaveLength(4) })
    expect(events.filter(event => event.type === 'message-notification')).toHaveLength(3)
    unsubscribe()
    stop()
  })

  it('filters self and muted messages and prefixes an unmuted group message with its sender', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let sse!: ReadableStreamDefaultController<Uint8Array>
    const bundles = [
      {
        session: { chat_session_uid: 'chat-self', session_kind: 1, last_seq: 4, last_active_at: 100 },
        private_counterpart: { display_name_snapshot: '我的其他设备' },
        current_policy: { mute_state: 1, notify_state: 1 },
        unread_snapshot: { unread_count: 0, session_last_seq: 4 },
      },
      {
        session: { chat_session_uid: 'group-muted', session_kind: 2, title: '免打扰群', last_seq: 4, last_active_at: 100 },
        current_policy: { mute_state: 2, notify_state: 1 },
        unread_snapshot: { unread_count: 1, session_last_seq: 4 },
      },
      {
        session: { chat_session_uid: 'group-live', session_kind: 2, title: '产品群', last_seq: 4, last_active_at: 100 },
        current_policy: { mute_state: 1, notify_state: 1 },
        unread_snapshot: { unread_count: 1, session_last_seq: 4 },
      },
      {
        session: { chat_session_uid: 'group-disabled', session_kind: 2, title: '关闭推送群', last_seq: 4, last_active_at: 100 },
        current_policy: { mute_state: 1, notify_state: 2 },
        unread_snapshot: { unread_count: 1, session_last_seq: 4 },
      },
    ]
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url === 'https://im.test/api/v1/sse/chat/noty') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            sse = controller
            init?.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'))
            }, { once: true })
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.endsWith('/api/v1/chats/unread-snapshot')) return unreadSummary(1)
      if (url.endsWith('/api/v1/chats/list')) return json({ items: bundles, has_more: false })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ items: [] })
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        const targets = body.chat_session_uids as string[]
        return json({ items: bundles.filter(bundle => targets.includes(bundle.session.chat_session_uid)).map(bundle => ({
          ...bundle,
          session: { ...bundle.session, last_seq: 5 },
          unread_snapshot: { unread_count: 1, session_last_seq: 5 },
        })) })
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        const uid = String(body.chat_session_uid)
        const senderUserId = uid === 'chat-self' ? 10001 : 20002
        return json({ items: [{
          relation: {
            record_uid: `record-${uid}`, sender_user_id: senderUserId,
            display_name_snapshot: uid === 'group-live' ? '周鹏' : '发送者', attach_at: 105, seq: 5,
          },
          record: { status: 1, payload: { text_content: uid === 'group-live' ? '群消息' : '不应通知' } },
        }] })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, new MinimalStateStore(), fetchImpl)
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = service.subscribeChatRealtime(event => { events.push(event as unknown as Record<string, unknown>) })
    const stop = service.startChatRealtime()
    await vi.waitFor(() => { expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/api/v1/chats/list'))).toBe(true) })

    const encoder = new TextEncoder()
    const eventAtMillis = Date.now()
    for (const [eventUid, uid, senderUserId] of [
      ['event-self', 'chat-self', 10001],
      ['event-muted', 'group-muted', 20002],
      ['event-disabled', 'group-disabled', 20002],
      ['event-group', 'group-live', 20002],
    ] as const) {
      sse.enqueue(encoder.encode(`data: ${JSON.stringify({
        t: 17, event_uid: eventUid, chat_session_uid: uid, rel_uid: `relation-${uid}`,
        latest_seq: 5, sender_user_id: senderUserId, event_at: eventAtMillis,
      })}\n\n`))
    }

    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'sessions-delta')).toHaveLength(1)
    }, { timeout: 8_000 })
    const delta = events.find(event => event.type === 'sessions-delta') as {
      updates: Array<{ source: { displayName: string; unreadCount: number; badgeUnreadCount?: number; notificationAllowed?: boolean } }>
    }
    expect(delta.updates.find(update => update.source.displayName === '免打扰群')?.source).toMatchObject({
      unreadCount: 1, badgeUnreadCount: 0, notificationAllowed: false,
    })
    expect(delta.updates.find(update => update.source.displayName === '关闭推送群')?.source).toMatchObject({
      unreadCount: 1, badgeUnreadCount: 0, notificationAllowed: false,
    })
    expect(delta.updates.find(update => update.source.displayName === '产品群')?.source).toMatchObject({
      unreadCount: 1, badgeUnreadCount: 1, notificationAllowed: true,
    })
    expect(events.filter(event => event.type === 'message-notification').map(event => event.notification))
      .toEqual([expect.objectContaining({ eventUid: 'event-group', title: '产品群', body: '周鹏：群消息' })])
    unsubscribe()
    stop()
  })

  it('keeps a post-connect live hint while the reconnect baseline is still loading', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let sse!: ReadableStreamDefaultController<Uint8Array>
    let baselineRequested = false
    const connectionStartedAtMillis = Math.floor(Date.now() / 1_000) * 1_000
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === 'https://im.test/api/v1/sse/chat/noty') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            sse = controller
            init?.signal?.addEventListener('abort', () => {
              try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* already closed */ }
            }, { once: true })
          },
        }), {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            Date: new Date(connectionStartedAtMillis).toUTCString(),
          },
        })
      }
      if (url.endsWith('/api/v1/chats/unread-snapshot')) return unreadSummary()
      if (url.endsWith('/api/v1/chats/list')) {
        baselineRequested = true
        await new Promise(resolve => { setTimeout(resolve, 600) })
        return json({ items: [privateBundle(9, 1)], has_more: false })
      }
      if (url.endsWith('/api/v1/chats/display-snapshots')) return json({ items: [privateBundle(9, 1)] })
      if (url.endsWith('/api/v1/chat/timeline/tail')) return json({ items: [
        {
          relation: {
            record_uid: 'record-replayed-8', rel_uid: 'relation-replayed-8', sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: connectionStartedAtMillis - 1_000, seq: 8,
          },
          record: { status: 1, payload: { text_content: '断连期间旧消息' } },
        },
        {
          relation: {
            record_uid: 'record-live-9', rel_uid: 'relation-live-9', sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: connectionStartedAtMillis + 1_000, seq: 9,
          },
          record: { status: 1, payload: { text_content: '建连后的新消息' } },
        },
      ] })
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, new MinimalStateStore(), fetchImpl)
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = service.subscribeChatRealtime(event => { events.push(event as unknown as Record<string, unknown>) })
    const stop = service.startChatRealtime()
    await vi.waitFor(() => {
      expect(sse).toBeDefined()
      expect(baselineRequested).toBe(true)
    })

    const encoder = new TextEncoder()
    sse.enqueue(encoder.encode(`data: ${JSON.stringify({
      t: 17, event_uid: 'event-replayed-8', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-replayed-8', latest_seq: 8, sender_user_id: 20002,
      event_at: connectionStartedAtMillis - 1_000,
    })}\n\ndata: ${JSON.stringify({
      t: 17, event_uid: 'event-live-9', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-live-9', latest_seq: 9, sender_user_id: 20002,
      event_at: connectionStartedAtMillis + 1_000,
    })}\n\n`))

    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'message-notification')).toHaveLength(1)
    }, { timeout: 2_000 })
    expect(events.find(event => event.type === 'message-notification')?.notification)
      .toEqual(expect.objectContaining({ eventUid: 'event-live-9', body: '建连后的新消息' }))
    await new Promise(resolve => { setTimeout(resolve, 700) })
    expect(events.filter(event => event.type === 'message-notification')).toHaveLength(1)
    unsubscribe()
    stop()
  })

  it('keeps a baseline-proven live hint across reconnect without notifying a replay', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const sseControllers: Array<ReadableStreamDefaultController<Uint8Array>> = []
    let authoritativeSequence = 8
    let projectedSequence = 8
    let baselineRequestCount = 0
    let timelineVisible = false
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url === 'https://im.test/api/v1/sse/chat/noty') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            sseControllers.push(controller)
            init?.signal?.addEventListener('abort', () => {
              try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* already closed */ }
            }, { once: true })
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.endsWith('/api/v1/chats/unread-snapshot')) return unreadSummary()
      if (url.endsWith('/api/v1/chats/list')) {
        baselineRequestCount += 1
        return json({ items: [privateBundle(authoritativeSequence, 0)], has_more: false })
      }
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        return json({ items: [privateBundle(projectedSequence, 1)] })
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        return json({ items: timelineVisible ? [{
          relation: {
            record_uid: `record-${String(projectedSequence)}`, rel_uid: `relation-${String(projectedSequence)}`,
            sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: projectedSequence, seq: projectedSequence,
          },
          record: { status: 1, payload: { text_content: `消息 ${String(projectedSequence)}` } },
        }] : [] })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, new MinimalStateStore(), fetchImpl)
    const realtime = (service as unknown as { realtime: {
      reconnect(): void
      handleChatRealtimeNotice(notice: unknown): void
    } }).realtime
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = service.subscribeChatRealtime(event => { events.push(event as unknown as Record<string, unknown>) })
    const stop = service.startChatRealtime()
    await vi.waitFor(() => {
      expect(sseControllers).toHaveLength(1)
      expect(baselineRequestCount).toBe(1)
    })

    const encoder = new TextEncoder()
    const eventAtMillis = Date.now()
    projectedSequence = 9
    sseControllers[0]?.enqueue(encoder.encode(`data: ${JSON.stringify({
      t: 17, event_uid: 'event-live-9', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-9', latest_seq: 9, sender_user_id: 20002, event_at: eventAtMillis,
    })}\n\n`))
    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'sessions-delta')).toHaveLength(1)
    }, { timeout: 2_000 })

    authoritativeSequence = 9
    realtime.reconnect()
    await vi.waitFor(() => {
      expect(sseControllers).toHaveLength(2)
      expect(baselineRequestCount).toBe(2)
    }, { timeout: 2_000 })
    timelineVisible = true
    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'message-notification')).toHaveLength(1)
    }, { timeout: 2_000 })
    expect(events.find(event => event.type === 'message-notification')?.notification)
      .toEqual(expect.objectContaining({ eventUid: 'event-live-9', body: '消息 9' }))

    sseControllers[1]?.enqueue(encoder.encode(`data: ${JSON.stringify({
      t: 17, event_uid: 'event-replayed-9', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-9', latest_seq: 9, sender_user_id: 20002, event_at: eventAtMillis,
    })}\n\n`))
    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'sessions-delta')).toHaveLength(2)
    }, { timeout: 2_000 })
    expect(events.filter(event => event.type === 'message-notification')).toHaveLength(1)

    projectedSequence = 10
    realtime.handleChatRealtimeNotice({
      cause: 'chat-hint',
      state: service.chatRealtimeState(),
      hint: {
        eventUid: 'event-missing-connection-user', chatSessionUid: 'chat-private-1',
        relationUid: 'relation-10', latestSequence: 10, senderUserId: 20002, eventAtMillis: eventAtMillis + 1,
      },
    })
    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'sessions-delta')).toHaveLength(3)
    }, { timeout: 2_000 })
    expect(events.filter(event => event.type === 'message-notification')).toHaveLength(1)
    unsubscribe()
    stop()
  })

  it('retries message projection up to the point where the hinted record becomes available', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let sse!: ReadableStreamDefaultController<Uint8Array>
    let tailRequests = 0
    let displayRequests = 0
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === 'https://im.test/api/v1/sse/chat/noty') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            sse = controller
            init?.signal?.addEventListener('abort', () => {
              try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* already closed */ }
            }, { once: true })
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.endsWith('/api/v1/chats/unread-snapshot')) return unreadSummary(1)
      if (url.endsWith('/api/v1/chats/list')) return json({ items: [privateBundle(8, 0)], has_more: false })
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        displayRequests += 1
        return json({ items: [privateBundle(9, 1)] })
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        tailRequests += 1
        return json({ items: tailRequests < 6 ? [] : [{
          relation: {
            record_uid: 'record-delayed', sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: 109, seq: 9,
          },
          record: { status: 1, payload: { text_content: '延迟投影消息' } },
        }] })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, new MinimalStateStore(), fetchImpl)
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = service.subscribeChatRealtime(event => { events.push(event as unknown as Record<string, unknown>) })
    const stop = service.startChatRealtime()
    await vi.waitFor(() => {
      expect(fetchImpl.mock.calls.some(call => String(call[0]).endsWith('/api/v1/chats/list'))).toBe(true)
    })
    const interactiveStartsBefore = service.requestStats()['interactive-read:chat']?.started ?? 0
    const eventAtMillis = Date.now()

    sse.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
      t: 17, event_uid: 'event-delayed', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-delayed', latest_seq: 9, sender_user_id: 20002, event_at: eventAtMillis,
    })}\n\n`))

    await vi.waitFor(() => {
      expect(
        events.filter(event => event.type === 'message-notification'),
        `tail requests: ${String(tailRequests)}; event types: ${events.map(event => String(event.type)).join(',')}`,
      ).toHaveLength(1)
    }, { timeout: 3_000 })
    expect(tailRequests).toBe(6)
    expect(displayRequests).toBe(1)
    expect((service.requestStats()['interactive-read:chat']?.started ?? 0) - interactiveStartsBefore).toBe(7)
    expect(events.find(event => event.type === 'message-notification')?.notification)
      .toEqual(expect.objectContaining({ eventUid: 'event-delayed', body: '延迟投影消息' }))
    unsubscribe()
    stop()
  }, 10_000)
})
