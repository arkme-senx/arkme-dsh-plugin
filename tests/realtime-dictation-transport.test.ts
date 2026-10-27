import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DICTATION_SUBPROTOCOL, RealtimeDictationService } from '../src/services/realtime-dictation-service.js'
import { RealtimeDictationSocket } from '../src/realtime-dictation-socket.js'
import { connectRealtimeDictation } from '../src/realtime-dictation-client.js'

let upstream: Server, local: Server, upstreamWs: WebSocketServer, carrier: RealtimeDictationSocket, owner: RealtimeDictationService, origin: string, peer: WebSocket
const settle = () => new Promise(resolve => setTimeout(resolve, 30))
beforeEach(async () => {
  upstream = createServer(); upstreamWs = new WebSocketServer({ server: upstream, maxPayload: 16384 })
  upstreamWs.on('connection', socket => {
    peer = socket
    const session_id = 'transport-session', send = value => socket.send(JSON.stringify({ session_id, ...value }))
    send({ type: 'prepared' })
    socket.on('message', (data, binary) => {
      if (binary) { send({ type: 'result', revision: 1, text: '实时结果' }); return }
      const message = JSON.parse(data.toString())
      if (message.type === 'start') send({ type: 'ready', max_duration_ms: 120000 })
      if (message.type === 'stop') { send({ type: 'finalizing' }); send({ type: 'result', revision: 2, text: '最后的结果。', is_final: true }) }
    })
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  owner = new RealtimeDictationService({ config: {}, requireSession: async () => ({ userId: 42, accessToken: 'secret' }), authenticatedAuthReadPost: async () => ({ enabled: true, allowed: true }) } as never,
    (_url, options) => new WebSocket(`ws://127.0.0.1:${(upstream.address() as any).port}`, DICTATION_SUBPROTOCOL, options))
  local = createServer(); local.listen(0, '127.0.0.1'); await once(local, 'listening')
  const port = (local.address() as any).port; origin = `http://127.0.0.1:${port}`
  carrier = new RealtimeDictationSocket(owner, port)
  local.on('upgrade', carrier.handler)
  class BrowserSocket extends WebSocket { constructor(url: string) { super(new URL(url, origin.replace('http:', 'ws:')), { headers: { Origin: origin } }) } }
  vi.stubGlobal('WebSocket', BrowserSocket)
})
afterEach(async () => {
  carrier.close(); owner.dispose(); for (const client of upstreamWs.clients) client.terminate(); upstreamWs.close()
  await Promise.all([new Promise<void>(resolve => local.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]); vi.unstubAllGlobals()
})
it('carries raw browser audio through authenticated Host WS and waits for final transcript', async () => {
  const update = vi.fn(), error = vi.fn()
  const handle = await connectRealtimeDictation('/provider', { expectedUserId: 42, onUpdate: update, onError: error })
  handle.send(new ArrayBuffer(3200)); await settle()
  expect(update.mock.lastCall![0]).toMatchObject({ text: '实时结果', phase: 'listening' })
  handle.finish(); await settle()
  expect(update.mock.lastCall![0]).toMatchObject({ text: '最后的结果。', phase: 'finished' })
  expect(error).not.toHaveBeenCalled(); await settle(); expect(upstreamWs.clients.size).toBe(0)
})
it('rejects unauthenticated account bindings before allowing audio', async () => {
  await expect(connectRealtimeDictation('/provider', { expectedUserId: 99, onUpdate: vi.fn(), onError: vi.fn() })).rejects.toThrow('登录账号已变化')
  expect(upstreamWs.clients.size).toBe(0)
})
it('disposes browser and upstream on caller cancellation and creates no reconnect', async () => {
  const controller = new AbortController(), update = vi.fn()
  await connectRealtimeDictation('/provider', { expectedUserId: 42, signal: controller.signal, onUpdate: update, onError: vi.fn() })
  controller.abort(); await settle()
  expect(upstreamWs.clients.size).toBe(0); expect((owner as any).streams.size).toBe(1)
  expect(update).toHaveBeenCalledTimes(1)
})
it('reports premature upstream close exactly once', async () => {
  const error = vi.fn()
  await connectRealtimeDictation('/provider', { expectedUserId: 42, onUpdate: value => { if (value.phase === 'failed') error(value.error) }, onError: error })
  peer.close(); await settle()
  expect(error).toHaveBeenCalledTimes(1)
})
it.each([undefined, 'https://attacker.invalid'])('rejects missing or foreign Origin %s', async originHeader => {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/provider/dictation`, { headers: originHeader ? { Origin: originHeader } : {} })
  const response = await new Promise<number>(resolve => { socket.on('unexpected-response', (_req, res) => { resolve(res.statusCode!); res.resume(); socket.terminate() }); socket.on('error', () => {}) })
  expect(response).toBe(403); expect(upstreamWs.clients.size).toBe(0)
})
