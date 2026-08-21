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
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
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
              record_uid: 'record-9', sender_user_id: 20002,
              display_name_snapshot: '小林', attach_at: 1_700_000_000_009, seq: 9,
            },
            record: { status: 1, payload: { text_content: '第一条消息' } },
          },
          {
            relation: {
              record_uid: 'record-10', sender_user_id: 20002,
              display_name_snapshot: '小林', attach_at: 1_700_000_000_010, seq: 10,
            },
            record: { status: 1, payload: { text_content: '第二条消息' } },
          },
          {
            relation: {
              record_uid: 'record-11', sender_user_id: 20002,
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
    for (const [eventUid, sequence, eventAt] of [
      ['event-9', 9, 1_700_000_000_009],
      ['event-10', 10, 1_700_000_000_010],
      ['event-11', 11, 1_700_000_000_011],
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
        expect.objectContaining({ eventUid: 'event-9', title: '林溪', body: '第一条消息' }),
        expect.objectContaining({ eventUid: 'event-10', title: '林溪', body: '第二条消息' }),
        expect.objectContaining({ eventUid: 'event-11', title: '林溪', body: '非文本内容' }),
      ])
    expect(requestBodies.find(request => request.url.endsWith('/api/v1/chat/timeline/tail'))?.body)
      .toMatchObject({ chat_session_uid: 'chat-private-1', after_seq: 8, limit: 50 })
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
    for (const [eventUid, uid, senderUserId] of [
      ['event-self', 'chat-self', 10001],
      ['event-muted', 'group-muted', 20002],
      ['event-disabled', 'group-disabled', 20002],
      ['event-group', 'group-live', 20002],
    ] as const) {
      sse.enqueue(encoder.encode(`data: ${JSON.stringify({
        t: 17, event_uid: eventUid, chat_session_uid: uid, rel_uid: `relation-${uid}`,
        latest_seq: 5, sender_user_id: senderUserId, event_at: 105,
      })}\n\n`))
    }

    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'sessions-delta')).toHaveLength(1)
    }, { timeout: 2_000 })
    expect(events.filter(event => event.type === 'message-notification').map(event => event.notification))
      .toEqual([expect.objectContaining({ eventUid: 'event-group', title: '产品群', body: '周鹏：群消息' })])
    unsubscribe()
    stop()
  })

  it('reconciles a reconnected generation without notifying replayed messages', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const sseControllers: Array<ReadableStreamDefaultController<Uint8Array>> = []
    let authoritativeSequence = 8
    let projectedSequence = 8
    let baselineRequestCount = 0
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
      if (url.endsWith('/api/v1/chats/list')) {
        baselineRequestCount += 1
        return json({ items: [privateBundle(authoritativeSequence, 0)], has_more: false })
      }
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        return json({ items: [privateBundle(projectedSequence, 1)] })
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        return json({ items: [{
          relation: {
            record_uid: `record-${String(projectedSequence)}`, sender_user_id: 20002,
            display_name_snapshot: '小林', attach_at: projectedSequence, seq: projectedSequence,
          },
          record: { status: 1, payload: { text_content: `消息 ${String(projectedSequence)}` } },
        }] })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, new MinimalStateStore(), fetchImpl)
    const events: Array<Record<string, unknown>> = []
    const unsubscribe = service.subscribeChatRealtime(event => { events.push(event as unknown as Record<string, unknown>) })
    const stop = service.startChatRealtime()
    await vi.waitFor(() => {
      expect(sseControllers).toHaveLength(1)
      expect(baselineRequestCount).toBe(1)
    })

    authoritativeSequence = 10
    projectedSequence = 10
    sseControllers[0]?.close()
    await vi.waitFor(() => {
      expect(sseControllers).toHaveLength(2)
      expect(baselineRequestCount).toBe(2)
    }, { timeout: 3_000 })

    const encoder = new TextEncoder()
    sseControllers[1]?.enqueue(encoder.encode(`data: ${JSON.stringify({
      t: 17, event_uid: 'event-replayed-10', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-10', latest_seq: 10, sender_user_id: 20002, event_at: 10,
    })}\n\n`))
    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'sessions-delta')).toHaveLength(1)
    }, { timeout: 2_000 })
    expect(events.filter(event => event.type === 'message-notification')).toHaveLength(0)

    projectedSequence = 11
    sseControllers[1]?.enqueue(encoder.encode(`data: ${JSON.stringify({
      t: 17, event_uid: 'event-live-11', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-11', latest_seq: 11, sender_user_id: 20002, event_at: 11,
    })}\n\n`))
    await vi.waitFor(() => {
      expect(events.filter(event => event.type === 'message-notification')).toHaveLength(1)
    }, { timeout: 2_000 })
    expect(events.find(event => event.type === 'message-notification')?.notification)
      .toEqual(expect.objectContaining({ eventUid: 'event-live-11', body: '消息 11' }))
    unsubscribe()
    stop()
  })

  it('retries message projection up to the point where the hinted record becomes available', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let sse!: ReadableStreamDefaultController<Uint8Array>
    let tailRequests = 0
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
      if (url.endsWith('/api/v1/chats/list')) return json({ items: [privateBundle(8, 0)], has_more: false })
      if (url.endsWith('/api/v1/chats/display-snapshots')) return json({ items: [privateBundle(9, 1)] })
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        tailRequests += 1
        return json({ items: tailRequests < 5 ? [] : [{
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

    sse.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
      t: 17, event_uid: 'event-delayed', chat_session_uid: 'chat-private-1',
      rel_uid: 'relation-delayed', latest_seq: 9, sender_user_id: 20002, event_at: 109,
    })}\n\n`))

    await vi.waitFor(() => {
      expect(
        events.filter(event => event.type === 'message-notification'),
        `tail requests: ${String(tailRequests)}; event types: ${events.map(event => String(event.type)).join(',')}`,
      ).toHaveLength(1)
    }, { timeout: 5_000 })
    expect(tailRequests).toBe(5)
    expect(events.find(event => event.type === 'message-notification')?.notification)
      .toEqual(expect.objectContaining({ eventUid: 'event-delayed', body: '延迟投影消息' }))
    unsubscribe()
    stop()
  })
})
