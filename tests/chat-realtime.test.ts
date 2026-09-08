import { describe, expect, it, vi } from 'vitest'
import {
  ARKME_CHAT_READ_CURSOR_ADVANCED_BIZ_TYPE, ARKME_CHAT_SSE_PATH,
  ARKME_CHAT_TIMELINE_CHANGED_BIZ_TYPE,
  ARKME_CONVERSATION_LIST_PREFERENCE_UPDATED_BIZ_TYPE,
  ARKME_PROJECTION_INVALIDATED_BIZ_TYPE, ARKME_RUNTIME_INSTANCE_ID_HEADER,
  ARKME_SSE_IDENTITY_VERSION, ARKME_SSE_IDENTITY_VERSION_HEADER, ArkmeChatRealtimeRuntime,
  decodeArkmeChatReadCursorAdvancedDataLine, decodeArkmeChatReceiveDataLine,
  decodeArkmeChatTimelineChangedDataLine, decodeArkmeChatPolicyUpdatedDataLine,
  decodeArkmeConversationListPreferenceUpdatedDataLine,
  decodeArkmeProjectionInvalidatedDataLine, decodeArkmeMemberJoinedDataLine,
} from '../src/chat-realtime.js'
import { ARKME_RUNTIME_INSTANCE_ID } from '../src/runtime-instance.js'

const chatHint = {
  t: 17,
  event_uid: 'event-1',
  chat_session_uid: 'chat-1',
  rel_uid: 'relation-1',
  latest_seq: 9,
  sender_user_id: 20002,
  event_at: 123456,
}

const recordProjectionHint = {
  t: ARKME_PROJECTION_INVALIDATED_BIZ_TYPE,
  event_uid: 'projection-event-1',
  projection: 'record',
  event_at: 123457,
}

const readCursorHint = {
  t: ARKME_CHAT_READ_CURSOR_ADVANCED_BIZ_TYPE,
  event_uid: 'read-event-1',
  chat_session_uid: 'chat-1',
  reader_user_id: 20002,
  read_seq: 9,
  read_at: 123457,
  event_at: 123458,
  source_client_id: 0,
}

const timelineChangedHint = {
  t: ARKME_CHAT_TIMELINE_CHANGED_BIZ_TYPE,
  event_uid: 'timeline-event-1',
  chat_session_uid: 'chat-1',
  rel_uid: 'relation-1',
  latest_seq: 9,
  actor_user_id: 10001,
  change_kind: 1,
  change_version: 123450,
  relation_terminal: true,
  event_at: 123458,
  source_client_id: 0,
}

describe('Arkme Chat realtime', () => {
  it('decodes only complete Chat receive hints and ignores heartbeats', () => {
    expect(decodeArkmeChatReceiveDataLine('data:')).toBeUndefined()
    expect(decodeArkmeChatReceiveDataLine('data: {"t":18}')).toBeUndefined()
    expect(decodeArkmeChatReceiveDataLine(`data: ${JSON.stringify(chatHint)}`)).toEqual({
      eventUid: 'event-1', chatSessionUid: 'chat-1', relationUid: 'relation-1',
      latestSequence: 9, senderUserId: 20002, eventAtMillis: 123456,
    })
    expect(decodeArkmeChatReceiveDataLine(`data: ${JSON.stringify({ ...chatHint, t: '17', latest_seq: '9' })}`))
      .toMatchObject({ latestSequence: 9 })
  })

  it('decodes only metadata-only projection invalidations', () => {
    expect(decodeArkmeProjectionInvalidatedDataLine(`data: ${JSON.stringify(recordProjectionHint)}`)).toEqual({
      eventUid: 'projection-event-1', projection: 'record', eventAtMillis: 123457,
    })
    expect(decodeArkmeProjectionInvalidatedDataLine(`data: ${JSON.stringify({
      ...recordProjectionHint, record_uid: 'must-not-cross-the-realtime-boundary',
    })}`)).toBeUndefined()
    expect(decodeArkmeProjectionInvalidatedDataLine(`data: ${JSON.stringify({
      ...recordProjectionHint, projection: 'Record With Spaces',
    })}`)).toBeUndefined()
  })

  it('decodes metadata-only read cursor advances and rejects embedded receipt truth', () => {
    expect(decodeArkmeChatReadCursorAdvancedDataLine(`data: ${JSON.stringify(readCursorHint)}`)).toEqual({
      eventUid: 'read-event-1', chatSessionUid: 'chat-1', readerUserId: 20002,
      readSequence: 9, readAtMillis: 123457, eventAtMillis: 123458,
    })
    expect(decodeArkmeChatReadCursorAdvancedDataLine(`data: ${JSON.stringify({
      ...readCursorHint, unread_count: 1,
    })}`)).toBeUndefined()
    expect(decodeArkmeChatReadCursorAdvancedDataLine(`data: ${JSON.stringify({
      ...readCursorHint, receiver_user_ids: [20001],
    })}`)).toBeUndefined()
    expect(decodeArkmeChatReadCursorAdvancedDataLine(`data: ${JSON.stringify({
      ...readCursorHint, source_client_id: -1,
    })}`)).toBeUndefined()
  })

  it('decodes metadata-only timeline changes without leaking message content', () => {
    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify(timelineChangedHint)}`)).toEqual({
      eventUid: 'timeline-event-1', chatSessionUid: 'chat-1', relationUid: 'relation-1',
      latestSequence: 9, actorUserId: 10001, changeKind: 'deleted',
      changeVersion: 123450, relationTerminal: true, eventAtMillis: 123458,
    })
    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify({
      ...timelineChangedHint, change_kind: 3,
    })}`)).toBeUndefined()
    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify({
      ...timelineChangedHint, change_kind: 3, relation_terminal: false,
    })}`)).toMatchObject({ changeKind: 'reedited', relationTerminal: false })

    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify({
      ...timelineChangedHint, relation_terminal: 'true',
    })}`)).toBeUndefined()
    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify({
      ...timelineChangedHint, record_body: { text: 'must-not-cross' },
    })}`)).toBeUndefined()
    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify({
      ...timelineChangedHint, receiver_user_ids: [10001],
    })}`)).toBeUndefined()
    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify({
      ...timelineChangedHint, message_preview: 'unknown content-like fields are also rejected',
    })}`)).toBeUndefined()
    expect(decodeArkmeChatTimelineChangedDataLine(`data: ${JSON.stringify({
      ...timelineChangedHint, change_kind: 9,
    })}`)).toBeUndefined()
  })

  it('decodes only metadata-only typed conversation preference invalidations', () => {
    const hint = {
      t: ARKME_CONVERSATION_LIST_PREFERENCE_UPDATED_BIZ_TYPE,
      event_uid: 'conversation-preference-event-1',
      user_id: 10001,
      items: [
        { entity_kind: 1, entity_uid: 'chat-1', revision: 3 },
        { entity_kind: 2, entity_uid: 'bot-1', revision: 4 },
      ],
      accepted_at: 123459,
      source_client_id: 501,
    }
    expect(decodeArkmeConversationListPreferenceUpdatedDataLine(
      `data: ${JSON.stringify(hint)}`,
    )).toEqual({
      eventUid: 'conversation-preference-event-1',
      userId: 10001,
      items: [
        { entityKind: 1, entityUid: 'chat-1', revision: 3 },
        { entityKind: 2, entityUid: 'bot-1', revision: 4 },
      ],
      acceptedAtMillis: 123459,
      sourceClientId: 501,
    })
    for (const extra of [
      { visibility_state: 2 },
      { dismissed_through_seq: 9 },
      { unread_count: 1 },
      { receiver_user_ids: [10001] },
    ]) {
      expect(decodeArkmeConversationListPreferenceUpdatedDataLine(
        `data: ${JSON.stringify({ ...hint, ...extra })}`,
      )).toBeUndefined()
    }
  })

  it('connects with Host credentials and advances one revision per unique hint', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const connectionDate = 'Sun, 07 Sep 2026 04:00:00 GMT'
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { stream = controller },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream', Date: connectionDate } }))
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: 'https://im.example.test',
      readSession: async () => ({ userId: 10001, accessToken: 'access-secret', refreshToken: 'refresh-secret' }),
      fetchImpl,
      inactivityTimeoutMs: 10_000,
      leaseDurationMs: 10_000,
    })
    const stop = runtime.start()
    const observed: number[] = []
    const causes: string[] = []
    const cursorSequences: number[] = []
    let reconcileConnection: { userId?: number; startedAtMillis?: number }
    const unsubscribe = runtime.subscribe(notice => {
      observed.push(notice.state.revision)
      causes.push(notice.cause)
      if (notice.cause === 'reconcile') {
        reconcileConnection = {
          userId: notice.connectionUserId,
          startedAtMillis: notice.connectionStartedAtMillis,
        }
      }
      if (notice.readCursorAdvanced !== undefined) cursorSequences.push(notice.readCursorAdvanced.readSequence)
    })
    await vi.waitFor(() => {
      expect(runtime.state()).toMatchObject({ connected: true, revision: 1, connectionGeneration: 1 })
    })
    expect(reconcileConnection!).toEqual({ userId: 10001, startedAtMillis: Date.parse(connectionDate) })

    const encoder = new TextEncoder()
    stream.enqueue(encoder.encode(`data:\n\ndata: ${JSON.stringify(chatHint)}\n\n`))
    await vi.waitFor(() => { expect(runtime.state()).toMatchObject({ revision: 2, lastEventAtMillis: 123456 }) })
    stream.enqueue(encoder.encode(`data: ${JSON.stringify(chatHint)}\n\n`))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(runtime.state().revision).toBe(2)
    stream.enqueue(encoder.encode(`data: ${JSON.stringify(readCursorHint)}\n\n`))
    await vi.waitFor(() => { expect(runtime.state()).toMatchObject({ revision: 3, lastEventAtMillis: 123458 }) })
    stream.enqueue(encoder.encode(`data: ${JSON.stringify(recordProjectionHint)}\n\n`))
    await vi.waitFor(() => { expect(runtime.state()).toMatchObject({ revision: 4, lastEventAtMillis: 123457 }) })
    stream.enqueue(encoder.encode(`data: ${JSON.stringify({
      t: ARKME_CONVERSATION_LIST_PREFERENCE_UPDATED_BIZ_TYPE,
      event_uid: 'conversation-preference-event-runtime',
      user_id: 10001,
      items: [{ entity_kind: 1, entity_uid: 'chat-1', revision: 3 }],
      accepted_at: 123459,
      source_client_id: 501,
    })}\n\n`))
    await vi.waitFor(() => { expect(runtime.state()).toMatchObject({ revision: 5, lastEventAtMillis: 123459 }) })
    expect(observed).toEqual([1, 2, 3, 4, 5])
    expect(causes).toEqual([
      'reconcile', 'chat-hint', 'chat-hint', 'projection-invalidation',
      'conversation-list-preference-invalidation',
    ])
    expect(cursorSequences).toEqual([9])

    const [input, init] = fetchImpl.mock.calls[0]!
    expect(String(input)).toBe(`https://im.example.test${ARKME_CHAT_SSE_PATH}`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-secret')
    expect(new Headers(init?.headers).get(ARKME_RUNTIME_INSTANCE_ID_HEADER)).toBe(ARKME_RUNTIME_INSTANCE_ID)
    expect(ARKME_RUNTIME_INSTANCE_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    stream.close()
    unsubscribe()
    stop()
  })

  it('refreshes one rejected access token and reconnects with the shared session', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const refreshed = { userId: 10001, accessToken: 'renewed-access', refreshToken: 'refresh-secret' }
    let currentSession = { ...refreshed, accessToken: 'expired-access' }
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization')
      if (authorization === 'Bearer expired-access') return new Response(null, { status: 403 })
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    const refreshSession = vi.fn(async () => {
      currentSession = refreshed
      return refreshed
    })
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: 'https://im.example.test',
      readSession: async () => currentSession,
      refreshSession,
      fetchImpl,
      retryBaseMs: 5,
      inactivityTimeoutMs: 10_000,
      leaseDurationMs: 10_000,
    })

    const stop = runtime.start()
    await vi.waitFor(() => {
      expect(runtime.state()).toMatchObject({ connected: true, connectionGeneration: 1 })
    })
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls.map(call => new Headers(call[1]?.headers).get('Authorization'))).toEqual([
      'Bearer expired-access', 'Bearer renewed-access',
    ])
    stream.close()
    stop()
  })

  it('pauses a rejected session instead of retrying the same credential every second', async () => {
    const session = { userId: 10001, accessToken: 'rejected-access', refreshToken: 'refresh-secret' }
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }))
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: 'https://im.example.test',
      readSession: async () => session,
      refreshSession: async () => undefined,
      fetchImpl,
      idlePollMs: 5,
      retryBaseMs: 5,
    })

    const stop = runtime.start()
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledOnce() })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchImpl).toHaveBeenCalledOnce()
    stop()
  })

  it('does not refresh forever when a newly issued token is also rejected', async () => {
    let session = { userId: 10001, accessToken: 'expired-access', refreshToken: 'refresh-secret' }
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }))
    const refreshSession = vi.fn(async () => {
      session = { ...session, accessToken: 'renewed-but-rejected' }
      return session
    })
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: 'https://im.example.test',
      readSession: async () => session,
      refreshSession,
      fetchImpl,
      idlePollMs: 5,
      retryBaseMs: 5,
    })

    const stop = runtime.start()
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledTimes(2) })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(refreshSession).toHaveBeenCalledOnce()
    stop()
  })

  it('backs off exponentially when a nominal SSE response closes before becoming stable', async () => {
    vi.useFakeTimers()
    try {
      const attempts: number[] = []
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        attempts.push(Date.now())
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.close() } }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
      const runtime = new ArkmeChatRealtimeRuntime({
        imBaseUrl: 'https://im.example.test',
        readSession: async () => ({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' }),
        fetchImpl,
        retryBaseMs: 100,
        maxRetryMs: 1_000,
        stableConnectionMs: 10_000,
        random: () => 0.5,
      })

      const stop = runtime.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(99)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(199)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(attempts.map(value => value - attempts[0]!)).toEqual([0, 100, 300])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a successful non-SSE response and applies the same bounded backoff', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      const runtime = new ArkmeChatRealtimeRuntime({
        imBaseUrl: 'https://im.example.test',
        readSession: async () => ({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' }),
        fetchImpl,
        retryBaseMs: 100,
        maxRetryMs: 1_000,
        random: () => 0.5,
      })

      const stop = runtime.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchImpl).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(100)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('increments the connection generation after a broken stream reconnects', async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const diagnostics: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streams.push(controller)
        init?.signal?.addEventListener('abort', () => {
          try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* already closed */ }
        }, { once: true })
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: 'https://im.example.test',
      readSession: async () => ({ userId: 10001, accessToken: 'access-secret', refreshToken: 'refresh-secret' }),
      fetchImpl,
      retryBaseMs: 5,
      inactivityTimeoutMs: 10_000,
      leaseDurationMs: 10_000,
      random: () => 0.5,
      diagnostic: event => { diagnostics.push(event) },
    })
    const stop = runtime.start()
    await vi.waitFor(() => {
      expect(runtime.state()).toMatchObject({ connected: true, connectionGeneration: 1 })
    })

    streams[0]!.close()

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(runtime.state()).toMatchObject({ connected: true, connectionGeneration: 2 })
    })
    expect(diagnostics).toContain('reconnect_attempt')
    expect(diagnostics).toContain('sse_disconnected')
    expect(fetchImpl.mock.calls.map(call => new Headers(call[1]?.headers).get(ARKME_RUNTIME_INSTANCE_ID_HEADER)))
      .toEqual([ARKME_RUNTIME_INSTANCE_ID, ARKME_RUNTIME_INSTANCE_ID])
    stop()
  })

  it('accepts legacy identity capability and observes a later version-2 upgrade', async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const capabilities: string[] = []
    let attempt = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      attempt += 1
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { streams.push(controller) },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          ...(attempt === 1 ? {} : { [ARKME_SSE_IDENTITY_VERSION_HEADER]: ARKME_SSE_IDENTITY_VERSION }),
        },
      })
    })
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: 'https://im.example.test',
      readSession: async () => ({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' }),
      fetchImpl,
      retryBaseMs: 5,
      inactivityTimeoutMs: 10_000,
      leaseDurationMs: 10_000,
      random: () => 0.5,
      diagnostic: (event, details) => {
        if (event === 'sse_identity_capability' && details.identityVersion !== undefined) {
          capabilities.push(details.identityVersion)
        }
      },
    })

    const stop = runtime.start()
    await vi.waitFor(() => { expect(runtime.state().connectionGeneration).toBe(1) })
    streams[0]!.close()
    await vi.waitFor(() => { expect(runtime.state().connectionGeneration).toBe(2) })
    expect(capabilities).toEqual(['legacy', '2'])
    streams[1]!.close()
    stop()
  })

  it('honors capacity Retry-After and releases the rejected response body', async () => {
    vi.useFakeTimers()
    try {
      const canceled = vi.fn()
      let attempt = 0
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        attempt += 1
        if (attempt === 1) {
          return new Response(new ReadableStream<Uint8Array>({ cancel: canceled }), {
            status: 429,
            headers: { 'Retry-After': '30' },
          })
        }
        return new Response(new ReadableStream<Uint8Array>(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
      const runtime = new ArkmeChatRealtimeRuntime({
        imBaseUrl: 'https://im.example.test',
        readSession: async () => ({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' }),
        fetchImpl,
        retryBaseMs: 100,
        maxRetryMs: 1_000,
        random: () => 0,
      })

      const stop = runtime.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchImpl).toHaveBeenCalledOnce()
      expect(canceled).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(29_999)
      expect(fetchImpl).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets an explicit reconnect interrupt a capacity Retry-After wait without leaving a stale reconnect flag', async () => {
    vi.useFakeTimers()
    try {
      let attempt = 0
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        attempt += 1
        if (attempt === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '30' } })
        return new Response(new ReadableStream<Uint8Array>(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
      const runtime = new ArkmeChatRealtimeRuntime({
        imBaseUrl: 'https://im.example.test',
        readSession: async () => ({ userId: 10001, accessToken: 'access', refreshToken: 'refresh' }),
        fetchImpl,
        retryBaseMs: 100,
        random: () => 0.5,
      })

      const stop = runtime.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchImpl).toHaveBeenCalledOnce()
      runtime.reconnect()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(runtime.state().connectionGeneration).toBe(1)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('manual reconnect bypasses the network backoff', async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streams.push(controller)
        init?.signal?.addEventListener('abort', () => {
          try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* already closed */ }
        }, { once: true })
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const runtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: 'https://im.example.test',
      readSession: async () => ({ userId: 10001, accessToken: 'access-secret', refreshToken: 'refresh-secret' }),
      fetchImpl,
      retryBaseMs: 5_000,
      inactivityTimeoutMs: 10_000,
      leaseDurationMs: 10_000,
    })
    const stop = runtime.start()
    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledTimes(1) })

    runtime.reconnect()

    await vi.waitFor(() => { expect(fetchImpl).toHaveBeenCalledTimes(2) }, { timeout: 500 })
    expect(runtime.state().connectionGeneration).toBe(2)
    stop()
  })

  it('applies the lower jitter bound to retry delays', async () => {
    vi.useFakeTimers()
    try {
      let attempt = 0
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        attempt += 1
        if (attempt === 1) throw new Error('offline')
        return new Response(new ReadableStream<Uint8Array>(), {
          status: 200, headers: { 'Content-Type': 'text/event-stream' },
        })
      })
      const runtime = new ArkmeChatRealtimeRuntime({
        imBaseUrl: 'https://im.example.test',
        readSession: async () => ({ userId: 10001, accessToken: 'access-secret', refreshToken: 'refresh-secret' }),
        fetchImpl,
        retryBaseMs: 100,
        random: () => 0,
        inactivityTimeoutMs: 10_000,
        leaseDurationMs: 10_000,
      })
      const stop = runtime.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(79)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['connect-timeout', 'inactivity-timeout', 'lease-rotation'] as const)(
    'reconnects after %s',
    async failureMode => {
      vi.useFakeTimers()
      try {
        const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
          if (failureMode === 'connect-timeout') {
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('aborted', 'AbortError'))
              }, { once: true })
            })
          }
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () => {
                try { controller.error(new DOMException('aborted', 'AbortError')) } catch { /* already closed */ }
              }, { once: true })
            },
          }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        })
        const runtime = new ArkmeChatRealtimeRuntime({
          imBaseUrl: 'https://im.example.test',
          readSession: async () => ({ userId: 10001, accessToken: 'access-secret', refreshToken: 'refresh-secret' }),
          fetchImpl,
          retryBaseMs: 10,
          random: () => 0.5,
          connectTimeoutMs: failureMode === 'connect-timeout' ? 20 : 1_000,
          inactivityTimeoutMs: failureMode === 'inactivity-timeout' ? 20 : 1_000,
          leaseDurationMs: failureMode === 'lease-rotation' ? 20 : 1_000,
        })
        const stop = runtime.start()
        await vi.advanceTimersByTimeAsync(31)
        expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2)
        stop()
      } finally {
        vi.useRealTimers()
      }
    },
  )
})


describe('Chat policy realtime contract', () => {
  const policy = { t: 19, event_uid: 'policy-1', chat_session_uid: 'chat-1', user_id: 42, pin_state: 2, policy_update_at: 1000, event_at: 1000, source_client_id: 9 }
  it.each([1, 2])('decodes pin state %s without treating it as message content', pinState => {
    expect(decodeArkmeChatPolicyUpdatedDataLine(`data: ${JSON.stringify({ ...policy, pin_state: pinState })}`))
      .toEqual({ eventUid: 'policy-1', chatSessionUid: 'chat-1', userId: 42, pinState, policyUpdateAtMillis: 1000, eventAtMillis: 1000 })
  })
  it.each([{ t: 26 }, { pin_state: 0 }, { user_id: 0 }, { policy_update_at: 0 }, { chat_session_uid: '' }, { source_client_id: -1 }, { rel_uid: 'message-1' }, { unread_count: 3 }, { payload: {} }])('rejects malformed or mixed policy metadata %j', extra => {
    expect(decodeArkmeChatPolicyUpdatedDataLine(`data: ${JSON.stringify({ ...policy, ...extra })}`)).toBeUndefined()
  })
  it('routes each same-account event once and ignores other-account or aborted-connection hints', () => {
    const runtime = new ArkmeChatRealtimeRuntime({ imBaseUrl: 'https://unused.test', async readSession() { return undefined } })
    const notices: unknown[] = []
    runtime.subscribe(notice => { notices.push(notice) })
    const receiver = runtime as unknown as { acceptLine(line: string, userId: number, signal: AbortSignal): void }
    const controller = new AbortController()
    const receive = (value: typeof policy) => { receiver.acceptLine(`data: ${JSON.stringify(value)}`, 42, controller.signal) }
    receive({ ...policy, user_id: 43 })
    receive(policy)
    receive(policy)
    expect(notices).toEqual([expect.objectContaining({ cause: 'chat-policy-invalidation', connectionUserId: 42, policyUpdated: expect.objectContaining({ userId: 42 }) })])
    controller.abort()
    receive({ ...policy, event_uid: 'policy-2' })
    expect(notices).toHaveLength(1)
  })
})


it('routes t=24 joins once as roster invalidation, separate from t=27 history and t=17 messages', async () => {
  const frame = { t: 24, event_uid: 'group:2:123:member-joined', chat_session_uid: 'group', actor_user_id: 1,
    member_user_id: 2, join_at: 123, event_at: 124, source_client_id: 0 }
  expect(decodeArkmeMemberJoinedDataLine(`data: ${JSON.stringify(frame)}`)).toEqual({ eventUid: frame.event_uid, chatSessionUid: 'group', eventAtMillis: 124 })
  for (const invalid of [{ ...frame, member_user_id: 0 }, { ...frame, unread_count: 9 }, { ...frame, display_name: 'private' }]) {
    expect(decodeArkmeMemberJoinedDataLine(`data: ${JSON.stringify(invalid)}`)).toBeUndefined()
  }
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const runtime = new ArkmeChatRealtimeRuntime({ imBaseUrl: 'https://im.test',
    readSession: async () => ({ userId: 1, accessToken: 'synthetic', refreshToken: 'synthetic' }),
    fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'text/event-stream' } }),
  })
  const notices: import('../src/chat-realtime.js').ArkmeChatRealtimeNotice[] = []
  const release = runtime.subscribe(notice => { if (notice.cause === 'chat-hint') notices.push(notice) })
  const stop = runtime.start()
  try {
    await vi.waitFor(() => expect(runtime.state().connected).toBe(true))
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)
    stream.enqueue(bytes); stream.enqueue(bytes)
    await vi.waitFor(() => expect(notices).toHaveLength(1))
    expect(notices[0]).toMatchObject({ memberJoined: { chatSessionUid: 'group' }, connectionUserId: 1 })
    expect(notices[0]?.memberEvent).toBeUndefined()
    expect(notices[0]?.hint).toBeUndefined()
  } finally { stop(); release() }
})
