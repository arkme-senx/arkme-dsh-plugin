import { describe, expect, it, vi } from 'vitest'
import {
  ARKME_CHAT_SSE_PATH, ArkmeChatRealtimeRuntime, decodeArkmeChatReceiveDataLine,
} from '../src/chat-realtime.js'

const chatHint = {
  t: 17,
  event_uid: 'event-1',
  chat_session_uid: 'chat-1',
  rel_uid: 'relation-1',
  latest_seq: 9,
  sender_user_id: 20002,
  event_at: 123456,
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

  it('connects with Host credentials and advances one revision per unique hint', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { stream = controller },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
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
    const unsubscribe = runtime.subscribe(notice => {
      observed.push(notice.state.revision)
      causes.push(notice.cause)
    })
    await vi.waitFor(() => { expect(runtime.state()).toMatchObject({ connected: true, revision: 1 }) })

    const encoder = new TextEncoder()
    stream.enqueue(encoder.encode(`data:\n\ndata: ${JSON.stringify(chatHint)}\n\n`))
    await vi.waitFor(() => { expect(runtime.state()).toMatchObject({ revision: 2, lastEventAtMillis: 123456 }) })
    stream.enqueue(encoder.encode(`data: ${JSON.stringify(chatHint)}\n\n`))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(runtime.state().revision).toBe(2)
    expect(observed).toEqual([1, 2])
    expect(causes).toEqual(['reconcile', 'hint'])

    const [input, init] = fetchImpl.mock.calls[0]!
    expect(String(input)).toBe(`https://im.example.test${ARKME_CHAT_SSE_PATH}`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-secret')
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
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { status: 200 })
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
    await vi.waitFor(() => { expect(runtime.state().connected).toBe(true) })
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
})
