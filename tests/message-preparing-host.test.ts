import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeChatRealtimeRuntime, decodeArkmeChatMessagePreparingDataLine,
  type ArkmeChatRealtimeNotice,
} from '../src/chat-realtime.js'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'
import { ChatService } from '../src/services/chat-service.js'
import { ChatRealtimeService } from '../src/services/chat-realtime-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { SourceService } from '../src/services/source-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeChatClientEvent, ArkmeSourceKind } from '../src/types.js'

const wireHint = {
  t: 21, event_uid: 'preparing-event', chat_session_uid: 'raw-chat', actor_user_id: 82,
  prepare_at: 100_000, expire_at: 105_000, preparing_state: 1, state_version: 100_001,
  event_at: 100_002, source_client_id: 3,
}
const decodedHint = {
  eventUid: 'preparing-event', chatSessionUid: 'raw-chat', actorUserId: 82,
  prepareAtMillis: 100_000, expireAtMillis: 105_000, preparingState: 1 as const,
  stateVersion: 100_001, eventAtMillis: 100_002, sourceClientId: 3,
}
const line = (value: unknown) => `data: ${JSON.stringify(value)}`
const config = {
  chatBaseUrl: 'https://chat.test', authBaseUrl: 'https://auth.test', imBaseUrl: 'https://im.test', requestTimeoutMs: 5_000,
} as ArkmeServiceConfig

function fixture() {
  let session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  const sessions = { read: vi.fn(async () => session), async write() {}, async delete() {} }
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 }))
  const runtime = new ServiceRuntime(config, sessions, {
    async uniqueCode() { return 'preparing-device-secret' },
  } as StateStore, fetchImpl)
  const profile = new ProfileService(runtime)
  const source = new SourceService(runtime, profile, {
    async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
  })
  const chat = new ChatService(runtime, source, profile, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never)
  const projector = {
    chatTimelineItems: vi.fn(async () => []),
  }
  const actorPresentation = vi.spyOn(source, 'chatPreparingActorPresentation')
  const native = { showNotification: vi.fn(), applyBadgeSummary: vi.fn() }
  const realtime = new ChatRealtimeService(runtime, source, projector, native)
  const events: ArkmeChatClientEvent[] = []
  realtime.subscribeChatRealtime(event => { events.push(event) })
  const connection = new AbortController()
  const notice = (overrides: Partial<ArkmeChatRealtimeNotice> = {}): ArkmeChatRealtimeNotice => ({
    cause: 'chat-hint', state: { connected: true, connectionGeneration: 1, revision: 1 },
    connectionUserId: 42, connectionSignal: connection.signal,
    messagePreparing: decodedHint, ...overrides,
  })
  return { runtime, sessions, source, profile, chat, realtime, projector, actorPresentation, events, native, connection, notice, fetchImpl,
    switchAccount() { session = { ...session, userId: 43 } } }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Chat preparing metadata decoder', () => {
  it('decodes state/order metadata and tolerates ordinary extensions', () => {
    expect(decodeArkmeChatMessagePreparingDataLine(line({ ...wireHint, future_flag: true }))).toEqual(decodedHint)
    expect(decodeArkmeChatMessagePreparingDataLine(line({
      ...wireHint, preparing_state: 2, expire_at: wireHint.prepare_at, source_client_id: undefined,
    }))).toMatchObject({ preparingState: 2, expireAtMillis: wireHint.prepare_at, sourceClientId: 0 })
  })
  it.each([
    'record', 'record_body', 'record_uid', 'text_content', 'receiver_user_ids', 'payload', 'draft',
    'rm_subject_id', 'subject_id', 'root_rm_subject_id', 'shared_topic_id', 'sharedTopicId',
    'rel_uid', 'latest_seq', 'sender_user_id', 'change_kind', 'change_version', 'read_seq', 'read_at', 'unread_count',
  ])('rejects forbidden field %s', field => {
    expect(decodeArkmeChatMessagePreparingDataLine(line({ ...wireHint, [field]: null }))).toBeUndefined()
  })
  it.each([
    { t: 14 }, { t: 16 }, { event_uid: '' }, { chat_session_uid: ' ' }, { actor_user_id: 0 },
    { prepare_at: 0 }, { expire_at: 99_999 }, { preparing_state: 3 }, { state_version: 0 },
    { state_version: Number.MAX_SAFE_INTEGER + 1 }, { event_at: 1.5 }, { source_client_id: -1 },
  ])('rejects malformed metadata %j', patch => {
    expect(decodeArkmeChatMessagePreparingDataLine(line({ ...wireHint, ...patch }))).toBeUndefined()
  })
  it('delivers production SSE hints with their account and connection lifetime', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: config.imBaseUrl,
      readSession: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }),
      fetchImpl: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { stream = controller },
      }), { headers: { 'Content-Type': 'text/event-stream' } })),
    })
    const notices: ArkmeChatRealtimeNotice[] = []
    runtime.subscribe(notice => { notices.push(notice) })
    const stop = runtime.start()
    try {
      await vi.waitFor(() => { expect(runtime.state().connected).toBe(true) })
      stream.enqueue(new TextEncoder().encode(`${line(wireHint)}\n\n${line(wireHint)}\n\n`))
      await vi.waitFor(() => { expect(notices.filter(notice => notice.messagePreparing)).toHaveLength(1) })
      const notice = notices.find(notice => notice.messagePreparing)!
      expect(notice.messagePreparing).toEqual(decodedHint)
      expect(notice.connectionUserId).toBe(42)
      expect(notice.connectionSignal?.aborted).toBe(false)
      stop()
      expect(notice.connectionSignal?.aborted).toBe(true)
    } finally { stop(); stream.close() }
  })
})

describe('Chat preparing Host writes', () => {
  it.each(['private_chat', 'group_chat'] as const)('reports/cancels %s through Chat without content or client actor fields', async kind => {
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, kind, 'raw-chat', '同事')
    const prepareAt = Date.now()
    await f.chat.reportMessagePreparing(ref, prepareAt)
    await f.chat.cancelMessagePreparing(ref, prepareAt)
    expect(f.fetchImpl).toHaveBeenCalledTimes(2)
    const [report, cancel] = f.fetchImpl.mock.calls as unknown as Array<[URL, RequestInit]>
    expect(String(report![0])).toBe('https://chat.test/api/v1/chats/messages/preparing')
    expect(JSON.parse(String(report![1].body))).toEqual({ chat_session_uid: 'raw-chat', prepare_at: prepareAt, expire_at: prepareAt + 5_000 })
    expect(String(cancel![0])).toBe('https://chat.test/api/v1/chats/messages/preparing/cancel')
    expect(JSON.parse(String(cancel![1].body))).toEqual({ chat_session_uid: 'raw-chat', cancel_at: prepareAt })
    expect(f.events).toEqual([])
    f.realtime.dispose()
  })
  it.each(['send_to_self', 'topic', 'default_category'] as ArkmeSourceKind[])('rejects non-chat source %s', async kind => {
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, kind, 'raw-chat', '话题')
    await expect(f.chat.reportMessagePreparing(ref, Date.now())).rejects.toMatchObject({ code: 'message-preparing-unsupported' })
    await expect(f.chat.cancelMessagePreparing(ref, Date.now())).rejects.toMatchObject({ code: 'message-preparing-unsupported' })
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
  it('rejects another account capability and elapsed report before network', async () => {
    const f = fixture()
    const oldRef = await f.source.sealSourceRef(41, 'private_chat', 'raw-chat', '同事')
    const ref = await f.source.sealSourceRef(42, 'private_chat', 'raw-chat', '同事')
    await expect(f.chat.reportMessagePreparing(oldRef, Date.now())).rejects.toMatchObject({ code: 'source-ref-invalid' })
    await expect(f.chat.reportMessagePreparing(ref, Date.now() - 5_000)).rejects.toMatchObject({ code: 'message-preparing-expired' })
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.NaN]) {
      await expect(f.chat.reportMessagePreparing(ref, invalid)).rejects.toMatchObject({ code: 'message-preparing-time-invalid' })
    }
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
  it('rejects far-future versions instead of pinning another client in a permanent preparing state', async () => {
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, 'private_chat', 'raw-chat', '同事')
    const future = Date.now() + 60_000
    await expect(f.chat.reportMessagePreparing(ref, future)).rejects.toMatchObject({ code: 'message-preparing-time-invalid' })
    await expect(f.chat.cancelMessagePreparing(ref, future)).rejects.toMatchObject({ code: 'message-preparing-time-invalid' })
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
  it('forwards cancellation and expires a report waiting in the existing coordinator', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, 'private_chat', 'raw-chat', '同事')
    const blocked: Array<() => void> = []
    const blockers = Array.from({ length: 4 }, async () => await f.runtime.requestCoordinator.run({
      scope: 'test-blocker', lane: 'write', service: 'chat',
      operation: async () => await new Promise<void>(resolve => { blocked.push(resolve) }),
    }))
    await vi.advanceTimersByTimeAsync(0)
    const report = f.chat.reportMessagePreparing(ref, Date.now())
    const rejected = expect(report).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(5_001)
    await rejected
    blocked.forEach(resolve => { resolve() })
    await Promise.all(blockers)
    expect(f.fetchImpl).not.toHaveBeenCalled()
    const controller = new AbortController()
    controller.abort()
    await expect(f.chat.cancelMessagePreparing(ref, Date.now(), { signal: controller.signal })).rejects.toBeDefined()
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
  it('rejects a report that expires during the final account read', async () => {
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, 'private_chat', 'raw-chat', '同事')
    const session = await f.runtime.requireSession()
    vi.spyOn(f.runtime, 'requireSession').mockResolvedValue(session)
    const now = Date.now()
    const time = vi.spyOn(Date, 'now').mockReturnValue(now)
    f.sessions.read.mockImplementationOnce(async () => {
      time.mockReturnValue(now + 5_001)
      return session
    })
    await expect(f.chat.reportMessagePreparing(ref, now)).rejects.toMatchObject({ code: 'message-preparing-expired' })
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
  it.each([
    ['reportMessagePreparing', 401], ['reportMessagePreparing', 403],
    ['cancelMessagePreparing', 401], ['cancelMessagePreparing', 403],
  ] as const)('%s HTTP %s drops optional presence without credential refresh or retry', async (method, status) => {
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, 'private_chat', 'raw-chat', '同事')
    const refresh = vi.spyOn(f.runtime, 'refreshAccessToken')
    f.fetchImpl
      .mockResolvedValueOnce(new Response('{}', { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { access_token: 'renewed' } })))
    try {
      await expect(f.chat[method](ref, Date.now())).rejects.toMatchObject({ code: `auth-http-${String(status)}` })
      expect(refresh).not.toHaveBeenCalled()
      expect(f.fetchImpl).toHaveBeenCalledTimes(1)
      expect(f.runtime.requestStats()['auth:auth']).toBeUndefined()
    } finally {
      f.runtime.dispose()
      f.realtime.dispose()
    }
  })
  it.each([401, 403])('normal Chat HTTP %s still refreshes credentials and retries', async status => {
    const f = fixture()
    const session = await f.runtime.requireSession()
    const refresh = vi.spyOn(f.runtime, 'refreshAccessToken')
    f.fetchImpl
      .mockResolvedValueOnce(new Response('{}', { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { access_token: 'renewed' } })))
    try {
      await expect(f.runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, session)).resolves.toEqual({})
      expect(refresh).toHaveBeenCalledExactlyOnceWith(session)
      const calls = f.fetchImpl.mock.calls as unknown as Array<[string | URL, RequestInit]>
      expect(calls.map(([url]) => String(url))).toEqual([
        'https://chat.test/api/v1/chats/records/send',
        'https://auth.test/api/public/v1/auth/new-short',
        'https://chat.test/api/v1/chats/records/send',
      ])
      expect(calls[2]?.[1].headers).toMatchObject({ Authorization: 'Bearer renewed' })
      expect(f.runtime.requestStats()['auth:auth']?.started).toBe(1)
      expect(f.runtime.requestStats()['write:chat']?.started).toBe(2)
    } finally {
      f.runtime.dispose()
      f.realtime.dispose()
    }
  })
  it.each([
    ['reportMessagePreparing', 429], ['reportMessagePreparing', 503],
    ['cancelMessagePreparing', 429], ['cancelMessagePreparing', 503],
  ] as const)('%s HTTP %s does not publish a service cooldown that blocks normal send', async (method, status) => {
    vi.useFakeTimers()
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, 'private_chat', 'raw-chat', '同事')
    const session = await f.runtime.requireSession()
    const controller = new AbortController()
    let send: Promise<unknown> | undefined
    try {
      f.fetchImpl.mockResolvedValueOnce(new Response('{}', { status, headers: { 'Retry-After': '5' } }))
      await expect(f.chat[method](ref, Date.now())).rejects.toMatchObject({ upstreamStatus: status, retryAfterMillis: 5_000 })
      send = f.runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, session, controller.signal)
        .catch(error => error)
      await vi.advanceTimersByTimeAsync(100)
      expect(f.fetchImpl).toHaveBeenCalledTimes(2)
      expect(String((f.fetchImpl.mock.calls as unknown as Array<[string]>)[1]?.[0]))
        .toBe('https://chat.test/api/v1/chats/records/send')
      await expect(send).resolves.toEqual({})
      expect(f.runtime.requestStats()['write:chat']?.started).toBe(2)
    } finally {
      controller.abort()
      await send
      f.runtime.requestCoordinator.dispose()
      f.realtime.dispose()
    }
  })
  it.each([429, 503])('normal Chat HTTP %s still cools normal and optional requests for Retry-After', async status => {
    vi.useFakeTimers()
    const f = fixture()
    const ref = await f.source.sealSourceRef(42, 'private_chat', 'raw-chat', '同事')
    const session = await f.runtime.requireSession()
    const controller = new AbortController()
    const pending: Array<Promise<unknown>> = []
    try {
      f.fetchImpl.mockResolvedValueOnce(new Response('{}', { status, headers: { 'Retry-After': '5' } }))
      await expect(f.runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, session))
        .rejects.toMatchObject({ upstreamStatus: status, retryAfterMillis: 5_000 })
      pending.push(f.runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, session, controller.signal)
        .catch(error => error))
      await vi.advanceTimersByTimeAsync(1_000)
      pending.push(f.chat.reportMessagePreparing(ref, Date.now(), { signal: controller.signal }).catch(error => error))
      await vi.advanceTimersByTimeAsync(3_999)
      expect(f.fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(Promise.all(pending)).resolves.toEqual([{}, undefined])
      expect(f.fetchImpl).toHaveBeenCalledTimes(3)
      expect(f.runtime.requestStats()['write:chat']?.started).toBe(3)
    } finally {
      controller.abort()
      await Promise.all(pending)
      f.runtime.requestCoordinator.dispose()
      f.realtime.dispose()
    }
  })
  it('requires the current DSH Browser origin for ephemeral presence writes', async () => {
    const service = { reportMessagePreparing: vi.fn(), cancelMessagePreparing: vi.fn() } as unknown as ArkmeService
    const server = createServer(createArkmeHostApi(service, { expectedPort: 3080, allowNonLoopback: false }))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server address missing')
    try {
      for (const operation of ['source.message-preparing.report', 'source.message-preparing.cancel']) {
        const timestampKey = operation === 'source.message-preparing.report' ? 'prepareAtMillis' : 'cancelAtMillis'
        const response = await fetch(`http://127.0.0.1:${String(address.port)}/arkme-self/api`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation, params: { sourceRef: 'ref', [timestampKey]: 100_000 } }),
        })
        expect(response.status).toBe(403)
      }
      expect(service.reportMessagePreparing).not.toHaveBeenCalled()
      expect(service.cancelMessagePreparing).not.toHaveBeenCalled()
    } finally { server.close(); await once(server, 'close') }
  })
  it('accepts only sourceRef and the operation-specific timestamp without aliases at the browser boundary', async () => {
    const service = { reportMessagePreparing: vi.fn(), cancelMessagePreparing: vi.fn() } as unknown as ArkmeService
    const signal = new AbortController().signal
    for (const operation of ['source.message-preparing.report', 'source.message-preparing.cancel'] as const) {
      const timestampKey = operation === 'source.message-preparing.report' ? 'prepareAtMillis' : 'cancelAtMillis'
      const otherTimestampKey = operation === 'source.message-preparing.report' ? 'cancelAtMillis' : 'prepareAtMillis'
      await dispatchArkmeHostOperation(service, operation, { sourceRef: ' ref ', [timestampKey]: 100_000 },
        undefined, undefined, undefined, undefined, signal)
      for (const params of [
        { sourceRef: 'ref', [timestampKey]: '100000' }, { sourceRef: 'ref', [timestampKey]: 0 },
        { sourceRef: 'ref', [timestampKey]: 1.5 }, { sourceRef: '', [timestampKey]: 100_000 },
        { sourceRef: 'ref', [timestampKey]: 100_000, actorUserId: 99 },
        { sourceRef: 'ref', [timestampKey]: 100_000, draft: '秘密草稿' },
        { sourceRef: 'ref', [timestampKey]: 100_000, sourceClientId: 8 },
        { sourceRef: 'ref', [otherTimestampKey]: 100_000 },
        { sourceRef: 'ref', [timestampKey]: 100_000, [otherTimestampKey]: 100_000 },
      ]) await expect(dispatchArkmeHostOperation(service, operation, params)).rejects.toMatchObject({ code: 'message-preparing-invalid' })
    }
    expect(service.reportMessagePreparing).toHaveBeenCalledExactlyOnceWith('ref', 100_000, { signal })
    expect(service.cancelMessagePreparing).toHaveBeenCalledExactlyOnceWith('ref', 100_000, { signal })
  })
})

describe('Chat preparing realtime projection', () => {
  it('projects preparing from Source without adding a timeline projection dependency', async () => {
    const f = fixture()
    const timeline = { chatTimelineItems: vi.fn(async () => []) }
    const realtime = new ChatRealtimeService(f.runtime, f.source, timeline, f.native)
    const events: ArkmeChatClientEvent[] = []
    realtime.subscribeChatRealtime(event => { events.push(event) })
    try {
      realtime.handleChatRealtimeNotice(f.notice())
      await vi.waitFor(() => { expect(events).toHaveLength(1) })
      expect(events[0]).toEqual({
        type: 'message-preparing', revision: 1,
        sourceKey: await f.source.chatDirectorySourceKey(42, 'raw-chat'),
        actorKey: await f.source.chatPreparingActorKey(42, 'raw-chat', 82),
        avatarRef: await f.profile.sealProfileImageRef(42, 82),
        prepareAtMillis: 100_000, expireAtMillis: 105_000, preparingState: 1,
        stateVersion: 100_001, eventAtMillis: 100_002,
      })
      expect(timeline.chatTimelineItems).not.toHaveBeenCalled()
      expect(f.fetchImpl).not.toHaveBeenCalled()
    } finally {
      realtime.dispose()
      f.realtime.dispose()
    }
  })
  it('creates account/chat/actor bound non-capability identity with the explicit HMAC domain', async () => {
    const f = fixture()
    const key = await f.source.chatPreparingActorKey(42, 'raw-chat', 82)
    const expected = createHmac('sha256', 'preparing-device-secret').update('chat-preparing-actor-v1:42:raw-chat:82').digest('base64url')
    expect(key).toBe(`arkme-chat-preparing-actor-v1.${expected}`)
    expect(await f.source.chatPreparingActorKey(42, 'raw-chat', 82)).toBe(key)
    for (const [viewer, chat, actor] of [[43, 'raw-chat', 82], [42, 'other-chat', 82], [42, 'raw-chat', 83]] as const) {
      expect(await f.source.chatPreparingActorKey(viewer, chat, actor)).not.toBe(key)
    }
    f.realtime.dispose()
  })
  it('emits only opaque metadata with sealed avatar and no directory/read/notification work', async () => {
    const f = fixture()
    const schedule = vi.spyOn(f.realtime, 'scheduleChatSessionProjection')
    const attention = vi.spyOn(f.realtime, 'refreshAttentionSummary')
    f.realtime.handleChatRealtimeNotice(f.notice())
    await vi.waitFor(() => { expect(f.events).toHaveLength(1) })
    expect(f.events[0]).toEqual({
      type: 'message-preparing', revision: 1,
      sourceKey: await f.source.chatDirectorySourceKey(42, 'raw-chat'),
      actorKey: await f.source.chatPreparingActorKey(42, 'raw-chat', 82),
      avatarRef: await f.profile.sealProfileImageRef(42, 82),
      prepareAtMillis: 100_000, expireAtMillis: 105_000, preparingState: 1, stateVersion: 100_001, eventAtMillis: 100_002,
    })
    expect(JSON.stringify(f.events)).not.toContain('raw-chat')
    expect(f.fetchImpl).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
    expect(attention).not.toHaveBeenCalled()
    expect(f.native.showNotification).not.toHaveBeenCalled()
    expect(f.native.applyBadgeSummary).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
  it('ignores self, mismatched account, aborted connection and absent connection evidence before projection', async () => {
    const f = fixture()
    f.realtime.handleChatRealtimeNotice(f.notice({ messagePreparing: { ...decodedHint, actorUserId: 42 } }))
    f.realtime.handleChatRealtimeNotice(f.notice({ connectionUserId: 41 }))
    f.realtime.handleChatRealtimeNotice(f.notice({ connectionSignal: undefined }))
    f.connection.abort()
    f.realtime.handleChatRealtimeNotice(f.notice())
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(f.events).toEqual([])
    expect(f.actorPresentation).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
  it.each(['account', 'connection', 'dispose'] as const)('drops a late identity projection after %s change', async change => {
    const f = fixture()
    let release!: () => void
    f.actorPresentation.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve })
      return { actorKey: 'opaque-actor', avatarRef: 'opaque-avatar' }
    })
    f.realtime.handleChatRealtimeNotice(f.notice())
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    if (change === 'account') f.switchAccount()
    if (change === 'connection') f.connection.abort()
    if (change === 'dispose') f.realtime.dispose()
    release()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(f.events).toEqual([])
    f.realtime.dispose()
  })
  it('t17 emits actor-specific arrival while preserving normal chat projection', async () => {
    const f = fixture()
    const schedule = vi.spyOn(f.realtime, 'scheduleChatSessionProjection').mockImplementation(() => {})
    f.realtime.handleChatRealtimeNotice(f.notice({ messagePreparing: undefined, hint: {
      eventUid: 'message-event', chatSessionUid: 'raw-chat', relationUid: 'raw-relation', latestSequence: 3,
      senderUserId: 82, eventAtMillis: 100_100,
    } }))
    await vi.waitFor(() => { expect(f.events).toHaveLength(1) })
    expect(f.events[0]).toEqual({
      type: 'message-arrived', revision: 1, sourceKey: await f.source.chatDirectorySourceKey(42, 'raw-chat'),
      actorKey: await f.source.chatPreparingActorKey(42, 'raw-chat', 82), eventAtMillis: 100_100,
    })
    expect(schedule).toHaveBeenCalledOnce()
    expect(f.actorPresentation).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.realtime.dispose()
  })
})
