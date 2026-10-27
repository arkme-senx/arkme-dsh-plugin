import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DICTATION_SUBPROTOCOL, RealtimeDictationService } from '../src/services/realtime-dictation-service.js'
import { DICTATION_MAX_MILLIS } from '../src/realtime-dictation-contract.js'

let server: Server, ws: WebSocketServer, owner: RealtimeDictationService, peer: WebSocket, headers: Record<string, unknown>, received: Buffer[], controls: any[], userId: number
let completeOnStop: boolean, readyMillis: number, availability: { enabled: boolean; allowed: boolean }, factory: ReturnType<typeof vi.fn>, runtime: any
const upstreamId = 'upstream-session-42'
const send = (value: object) => peer.send(JSON.stringify({ session_id: upstreamId, ...value }))
beforeEach(async () => {
  userId = 42; received = []; controls = []; completeOnStop = true; readyMillis = DICTATION_MAX_MILLIS; availability = { enabled: true, allowed: true }
  server = createServer(); ws = new WebSocketServer({ server, maxPayload: 16384 })
  ws.on('connection', (socket, request) => {
    peer = socket; headers = request.headers
    send({ type: 'prepared' })
    socket.on('message', (data, binary) => {
      if (binary) { received.push(Buffer.from(data as Buffer)); return }
      const value = JSON.parse(data.toString()); controls.push(value)
      expect(value.session_id).toBe(upstreamId)
      if (value.type === 'start') send({ type: 'ready', max_duration_ms: readyMillis })
      if (value.type === 'stop' && completeOnStop) {
        send({ type: 'finalizing' }); send({ type: 'result', revision: 3, text: '你好，世界。', is_final: true }); send({ type: 'done' })
      }
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  runtime = { config: { environment: 'prod', dshRemoteRealtimeBaseUrl: 'https://realtime.jotmo.cc' },
    requireSession: vi.fn(async () => ({ userId, accessToken: 'host-only-test-secret' })),
    authenticatedAuthReadPost: vi.fn(async () => availability) }
  factory = vi.fn((_url, options) => new WebSocket(`ws://127.0.0.1:${port}`, DICTATION_SUBPROTOCOL, options))
  owner = new RealtimeDictationService(runtime, factory as never)
})
afterEach(async () => { owner.dispose(); for (const client of ws.clients) client.terminate(); ws.close(); await new Promise<void>(resolve => server.close(() => resolve())); vi.useRealTimers() })
const settle = () => new Promise(resolve => setTimeout(resolve, 25))
it('matches the active mobile preflight, realtime endpoint, subprotocol and deferred prepared/start/ready handshake', async () => {
  const update = vi.fn(), snapshot = await owner.open(42, update)
  expect(runtime.authenticatedAuthReadPost).toHaveBeenCalledWith('/api/v1/dictation/check', {}, expect.anything(), undefined, { bypassCache: true })
  expect(String(factory.mock.calls[0]![0])).toBe('wss://realtime.jotmo.cc/api/v1/realtime/connect')
  expect(headers.authorization).toBe('Bearer host-only-test-secret')
  expect(headers['sec-websocket-protocol']).toBe('jotmo.dictation.v1')
  expect(headers['x-jotmo-dictation-start']).toBe('deferred')
  expect(controls).toEqual([{ type: 'start', session_id: upstreamId }])
  owner.audio(snapshot.streamRef, Buffer.alloc(3200, 3)); await settle()
  expect(received.map(frame => frame.length)).toEqual([3200])
  expect(Buffer.concat(received)).toEqual(Buffer.alloc(3200, 3))
  // Go omits is_final:false. Stale and wrong-session results must not roll back the draft.
  send({ type: 'result', revision: 1, text: '你好' }); send({ type: 'result', revision: 2, text: '你好世界' })
  send({ type: 'result', revision: 1, text: '过期结果' }); send({ type: 'result', session_id: 'other', revision: 99, text: '其他会话' }); await settle()
  expect(update.mock.calls.map(([value]) => value.text)).toEqual(['', '你好', '你好世界'])
  owner.finish(snapshot.streamRef); await settle()
  expect(controls[1]).toEqual({ type: 'stop', session_id: upstreamId })
  expect(update.mock.lastCall![0]).toMatchObject({ phase: 'finished', text: '你好，世界。' })
  expect(JSON.stringify(update.mock.calls)).not.toContain(upstreamId)
  expect(JSON.stringify(update.mock.calls)).not.toContain('host-only-test-secret')
})
it.each([{ enabled: false, allowed: false }, { enabled: true, allowed: false }])('honors availability and quota before opening a socket: %j', async value => {
  availability = value
  await expect(owner.open(42)).rejects.toThrow(value.enabled ? '额度已用完' : '暂未开放')
  expect(factory).not.toHaveBeenCalled()
})
it('uses the fresh token after preflight refreshed authentication', async () => {
  runtime.authenticatedAuthReadPost.mockImplementationOnce(async () => { runtime.requireSession.mockResolvedValue({ userId: 42, accessToken: 'fresh-host-token' }); return availability })
  await owner.open(42); expect(headers.authorization).toBe('Bearer fresh-host-token')
})
it('account-scopes opaque references and validates PCM and commands', async () => {
  const value = await owner.command({ action: 'start', expectedUserId: 42 })
  await expect(owner.command({ action: 'audio', streamRef: value.streamRef, pcm: 'invalid!' })).rejects.toThrow('音频格式')
  await expect(owner.command({ action: 'audio', streamRef: value.streamRef, pcm: Buffer.alloc(3202).toString('base64') })).rejects.toThrow('音频')
  await expect(owner.command({ action: 'other' } as never)).rejects.toThrow('操作')
  userId = 9
  await expect(owner.command({ action: 'status', streamRef: value.streamRef })).rejects.toThrow('账号')
  await expect(owner.open(42)).rejects.toThrow('账号')
})
it('bounds admission and cancels sockets/timers when account lifecycle is disposed', async () => {
  await owner.open(42); await owner.open(42)
  await expect(owner.open(42)).rejects.toThrow('其他听写')
  owner.dispose(); await settle(); expect(ws.clients.size).toBe(0); expect((owner as any).streams.size).toBe(0)
})
it('retains the latest partial text on premature close and never reconnects', async () => {
  const update = vi.fn(); await owner.open(42, update)
  send({ type: 'result', revision: 1, text: '保留这句话' }); await settle(); peer.close(); await settle()
  expect(update.mock.lastCall![0]).toMatchObject({ phase: 'failed', text: '保留这句话', error: { code: 'dictation-disconnected' } })
  expect(factory).toHaveBeenCalledTimes(1)
})
it('maps backend busy/quota/no-speech errors without exposing upstream payloads', async () => {
  const update = vi.fn(); await owner.open(42, update)
  send({ type: 'error', code: 'service_busy', secret: 'not-for-browser' }); await settle()
  expect(update.mock.lastCall![0]).toMatchObject({ phase: 'failed', error: { code: 'dictation-service_busy', message: '服务繁忙，请稍后重试' } })
  expect(JSON.stringify(update.mock.calls)).not.toContain('not-for-browser')
})
it('waits for a settled final result, bounds finalization, and clears retained state', async () => {
  const update = vi.fn(), value = await owner.open(42, update); completeOnStop = false
  vi.useFakeTimers(); owner.finish(value.streamRef)
  expect(update.mock.lastCall![0].phase).toBe('finishing')
  await vi.advanceTimersByTimeAsync(10_000)
  expect(update.mock.lastCall![0]).toMatchObject({ phase: 'failed', error: { code: 'dictation-timeout' } })
  await vi.advanceTimersByTimeAsync(30_000); expect((owner as any).streams.size).toBe(0)
})
it('fails closed under upstream backpressure without accumulating audio', async () => {
  const update = vi.fn(), value = await owner.open(42, update)
  Object.defineProperty((owner as any).streams.get(value.streamRef).socket, 'bufferedAmount', { get: () => 65536 })
  owner.audio(value.streamRef, Buffer.alloc(3200))
  expect(update.mock.lastCall![0]).toMatchObject({ phase: 'failed', error: { code: 'dictation-backpressure' } })
})
it('cancels before preflight when caller is already aborted', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(owner.open(42, vi.fn(), controller.signal)).rejects.toThrow()
  expect(runtime.authenticatedAuthReadPost).not.toHaveBeenCalled()
})
it('drains the capture tail at the duration boundary before sending JSON stop', async () => {
  vi.useFakeTimers(); const update = vi.fn(), value = await owner.open(42, update)
  for (let i = 0; i < 11; i++) { await vi.advanceTimersByTimeAsync(10_000); owner.audio(value.streamRef, Buffer.alloc(3200, 2)) }
  await vi.advanceTimersByTimeAsync(10_000); expect(update.mock.lastCall![0].phase).toBe('finishing')
  owner.audio(value.streamRef, Buffer.alloc(400, 7)); owner.finish(value.streamRef)
  vi.useRealTimers(); await settle()
  expect(received.at(-1)).toEqual(Buffer.alloc(400, 7)); expect(update.mock.lastCall![0].phase).toBe('finished')
})
it('honors the server duration and stops capture on server-initiated finalizing without replaying the tail', async () => {
  readyMillis = 1000
  const update = vi.fn(), value = await owner.open(42, update)
  send({ type: 'finalizing' }); await settle(); owner.audio(value.streamRef, Buffer.alloc(400)); owner.finish(value.streamRef)
  expect(update.mock.lastCall![0].phase).toBe('finishing'); expect(received).toHaveLength(0)
  expect(controls.filter(value => value.type === 'stop')).toHaveLength(0)
  send({ type: 'result', revision: 1, text: '最终文本', is_final: true }); await settle(); expect(update.mock.lastCall![0].phase).toBe('finished')
})
