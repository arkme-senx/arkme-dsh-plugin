import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectArkmeRealtime } from '../src/client/realtime-connection.js'

class FakeSocket {
  static sockets: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) { FakeSocket.sockets.push(this) }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeSocket.sockets = [] })
describe('realtime transport lifecycle', () => {
  it('reconnects, reconciles on each open and cancels reconnect on disposal', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const callbacks = { onOpen: vi.fn(), onMessage: vi.fn(), onDisconnect: vi.fn() }
    const connection = connectArkmeRealtime(callbacks)
    const first = FakeSocket.sockets[0]!
    expect(first.url).toBe('/arkme-self/api/events')
    first.onopen!()
    const event = { data: '{"revision":2}' } as MessageEvent<string>
    first.onmessage!(event)
    expect(callbacks.onMessage).toHaveBeenCalledWith(event)
    first.onclose!()
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.sockets).toHaveLength(2)
    const second = FakeSocket.sockets[1]!
    second.onopen!()
    expect(callbacks.onOpen).toHaveBeenCalledTimes(2)
    second.onclose!()
    connection.close()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(FakeSocket.sockets).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('detaches callbacks and closes an active socket on account change/unmount', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const connection = connectArkmeRealtime({ onOpen: vi.fn(), onMessage: vi.fn(), onDisconnect: vi.fn() })
    const socket = FakeSocket.sockets[0]!
    connection.close()
    expect(socket.close).toHaveBeenCalledOnce()
    expect(socket.onmessage).toBeNull()
    expect(socket.onclose).toBeNull()
  })
})
