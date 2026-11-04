import { expect, it } from 'vitest'
import { decodeThoughtNotification } from '../src/services/thought-realtime-service.js'
import { decodeArkmeChatThoughtChangedDataLine } from '../src/chat-realtime.js'
const line = (value: unknown) => `data: ${JSON.stringify(value)}`
it('decodes both private and public chat invalidations without trusting pushed content', () => {
  const event = { event_uid: 'event', chat_session_uid: 'chat', rel_uid: 'rel', scene: 2, status: 4, generation: 2, event_at: 100 }
  expect(decodeArkmeChatThoughtChangedDataLine(line({ ...event, t: 23, content: 'never forward' }))).toEqual({ eventUid: 'event', chatSessionUid: 'chat', relationUid: 'rel', scene: 2, status: 4, generation: 2, eventAtMillis: 100 })
  expect(decodeThoughtNotification(line({ biz_type: 7, data: JSON.stringify(event) }), 'notify')).toEqual({ chat: { session: 'chat', relation: 'rel', clear: true } })
  expect(decodeArkmeChatThoughtChangedDataLine(line({ ...event, t: 23, generation: 0 }))).toBeUndefined()
  expect(decodeThoughtNotification(line({ biz_type: 7, data: { ...event, status: 99 } }), 'notify')).toBeUndefined()
})
it('accepts self response deltas, ignores legacy chat content and never displays upstream errors', () => {
  const event = { msg_id: 'stream', kind: 8, payload: { source_version:1,record_uid: 'note', msg_id: 'stream', delta: '你好', content_len: 6, status: 'running' } }
  expect(decodeThoughtNotification(line(event), 'global')).toMatchObject({ stream: { recordUid: 'note', streamId: 'stream', delta: '你好', contentBytes: 6, phase: 'generating', biz: 2 } })
  expect(decodeThoughtNotification(line({ ...event, payload: { ...event.payload, chat_type: 2, group_id: 12 } }), 'global')).toBeUndefined()
  expect(decodeThoughtNotification(line({ ...event, payload: { ...event.payload, chat_type: 1 } }), 'global')).toBeUndefined()
  expect(decodeThoughtNotification(line({ ...event, payload: { ...event.payload, error: true, delta: 'provider key secret' } }), 'global')).toMatchObject({ stream: { delta: '', phase: 'failed' } })
  expect(decodeThoughtNotification('data: broken', 'global')).toBeUndefined()
})

it('uses receive-only Intelligent streams, refreshes the existing event channel and fences account changes', async () => {
  const { ThoughtRealtimeService } = await import('../src/services/thought-realtime-service.js')
  const { vi } = await import('vitest')
  let userId = 42
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [], requests: Array<{ path: string; method?: string | undefined; body?: unknown }> = []
  const emit = vi.fn(), encoder = new TextEncoder()
  const runtime = { config: { environment: 'production', intelligentBaseUrl: 'https://intelligent.test' }, sessionStore: { read: async () => ({ userId, accessToken: 'fixture' }) },
    fetchImpl: async (url: URL, init: RequestInit) => {
      requests.push({ path: url.pathname, method: init.method, body: init.body })
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller) }, cancel() {} }), { headers: { 'content-type': 'text/event-stream' } })
    } }
  const source = { chatDirectorySourceKey: async () => 'opaque-source', chatTimelineItemKey: async () => 'opaque-message' }
  const service = new ThoughtRealtimeService(runtime as never, source as never, emit)
  try {
    service.start(); service.start()
    await vi.waitFor(() => expect(controllers).toHaveLength(2))
    expect(requests.map(request => [request.path, request.method, request.body])).toEqual([['/api/v1/ainotify/sse/ai', 'GET', undefined], ['/api/v1/qa/global-stream', 'GET', undefined]])
    emit.mockClear()
    controllers[0]!.enqueue(encoder.encode(`${line({ biz_type: 7, data: { chat_session_uid: 'chat', rel_uid: 'rel', scene: 3, status: 2, generation: 1 } })}\n\n`))
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith({ type: 'thought-invalidated', accountScope: 'production:42', sourceKey: 'opaque-source', timelineItemKey: 'opaque-message', clear: false }))
    emit.mockClear(); userId = 7
    controllers[0]!.enqueue(encoder.encode(`${line({ biz_type: 1, data: { record_uids: ['note'] } })}\n\n`))
    await new Promise(resolve => setTimeout(resolve, 15)); expect(emit).not.toHaveBeenCalled()
  } finally { service.dispose(); controllers.forEach(controller => { try { controller.close() } catch {} }) }
})
