import { afterEach, expect, it, vi } from 'vitest'
import { once } from 'node:events'
const target = vi.hoisted(() => ({ url: '' }))
vi.mock('ws', async () => {
  const actual = await vi.importActual<typeof import('ws')>('ws')
  return { ...actual, default: class extends actual.default {
    constructor(_url: string, options: any) { super(target.url, options) }
  } }
})
import { WebSocketServer } from 'ws'
import { DeviceControlRealtime } from '../src/services/device-control-realtime.js'
const owners: DeviceControlRealtime[] = []
afterEach(() => owners.splice(0).forEach(owner => owner.close()))

it('real sockets survive idle heartbeats, repeated connect calls, loss and 30 close/reopen cycles', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  target.url = `ws://127.0.0.1:${(server.address() as any).port}`
  let accepted = 0
  server.on('connection', (socket, request) => {
    accepted++
    expect(request.headers.authorization).toBe('Bearer test-only')
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString())
      const type = ({ 'connection.open': 'connection.ready', 'channel.subscribe': 'channel.subscribed', 'service.register': 'service.registered' } as Record<string,string>)[frame.type]
      socket.send(JSON.stringify({ type, request_id: frame.request_id }))
    })
  })
  const heartbeat = setInterval(() => server.clients.forEach(socket => socket.ping()), 1000)
  const owner = new DeviceControlRealtime('https://network-test.invalid', () => {}); owners.push(owner)
  const connect = () => owner.connect(42, 'network_session_000001', 'test-only')
  try {
    connect()
    await vi.waitFor(() => expect(owner.connected).toBe(true))
    for (let n=0;n<1000;n++) connect()
    expect(accepted).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 47000))
    expect(owner.connected).toBe(true)
    expect(server.clients.size).toBe(1)
    server.clients.forEach(socket => socket.terminate())
    await vi.waitFor(() => expect(owner.connected).toBe(false))
    connect(); expect(accepted).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 5100))
    connect(); await vi.waitFor(() => expect(owner.connected).toBe(true))
    for (let n=0;n<30;n++) {
      owner.close()
      await vi.waitFor(() => expect(server.clients.size).toBe(0))
      connect()
      await vi.waitFor(() => expect(owner.connected).toBe(true))
      expect(server.clients.size).toBe(1)
    }
    owner.close()
    await vi.waitFor(() => expect(server.clients.size).toBe(0))
    expect(accepted).toBe(32)
  } finally { clearInterval(heartbeat); owner.close(); server.clients.forEach(s => s.terminate()); await new Promise<void>(resolve => server.close(() => resolve())) }
}, 70000)
