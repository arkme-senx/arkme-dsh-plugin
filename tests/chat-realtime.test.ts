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
})
