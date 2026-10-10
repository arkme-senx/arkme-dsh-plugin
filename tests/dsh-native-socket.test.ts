import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { DshNativeSocket } from '../src/dsh-remote/native-socket.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop() })
async function fixture() {
  const native = vi.fn(async (_params: Record<string, unknown>, _signal: AbortSignal): Promise<unknown> => ({ items: [{ type: 'ready' }], sourceWritable: false }))
  const server = createServer((_req, res) => res.end('available'))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const carrier = new DshNativeSocket(() => ({ native }) as never, port)
  server.on('upgrade', carrier.handler)
  cleanup.push(async () => { carrier.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { native, carrier, origin: `http://127.0.0.1:${port}`, url: `ws://127.0.0.1:${port}/native-streams` }
}
const request = (id: string, mode = 'pull') => JSON.stringify({ id, params: { runtimeRef: 'owned', requestRef: id, body: { mode, streamRef: id, endpoint: '$events', payload: { args: {} } } } })
it('multiplexes long subscriptions while HTTP stays free, and aborts them on close', async () => {
  const f = await fixture(), signals: AbortSignal[] = []
  f.native.mockImplementation(async (_params, signal) => {
    signals.push(signal)
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    return { done: true }
  })
  const client = new WebSocket(f.url, { origin: f.origin }); await once(client, 'open')
  for (let i = 0; i < 8; i++) client.send(request(`request-${i}`))
  await vi.waitFor(() => expect(signals).toHaveLength(8))
  expect(await (await fetch(f.origin)).text()).toBe('available')
  const closed = once(client, 'close'); client.close(); await closed
  await vi.waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true))
})
it('retains native results, enforces owner authorization and rejects commands', async () => {
  const f = await fixture(), messages: any[] = []
  const client = new WebSocket(f.url, { origin: f.origin }); client.on('message', data => messages.push(JSON.parse(String(data)))); await once(client, 'open')
  client.send(request('one')); await vi.waitFor(() => expect(messages).toHaveLength(1))
  expect(messages[0]).toMatchObject({ id: 'one', ok: true, value: { items: [{ type: 'ready' }], sourceWritable: false } })
  f.native.mockRejectedValueOnce(new DshRemoteError('REMOTE_NOT_FOUND', '当前账号没有该实例'))
  client.send(request('two')); await vi.waitFor(() => expect(messages).toHaveLength(2))
  expect(messages[1]).toMatchObject({ id: 'two', ok: false, error: { code: 'REMOTE_NOT_FOUND' } })
  client.send(request('three', 'call')); await vi.waitFor(() => expect(messages).toHaveLength(3))
  expect(messages[2]).toMatchObject({ ok: false, error: { code: 'REMOTE_REQUEST_INVALID' } })
  expect(f.native).toHaveBeenCalledTimes(2)
})
it('cancels individual pulls without closing other subscriptions', async () => {
  const f = await fixture(), signals: AbortSignal[] = []
  f.native.mockImplementation(async (_params, signal) => { signals.push(signal); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve())); return {} })
  const client = new WebSocket(f.url, { origin: f.origin }); await once(client, 'open')
  client.send(request('one')); client.send(request('two')); await vi.waitFor(() => expect(signals).toHaveLength(2))
  client.send(JSON.stringify({ id: 'one', cancel: true })); await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true))
  expect(signals[1]?.aborted).toBe(false); expect(client.readyState).toBe(WebSocket.OPEN)
})
it.each([undefined, 'https://evil.example', 'http://127.0.0.1:1', 'null'])('rejects untrusted or absent origin %s', async origin => {
  const f = await fixture(), client = new WebSocket(f.url, origin ? { origin } : {})
  const [error] = await once(client, 'error'); expect(error.message).toContain('403'); expect(f.native).not.toHaveBeenCalled()
})

it('bounds pending requests and rejects duplicate ids without overwriting their cancellation owner', async () => {
  const f = await fixture(), messages: any[] = [], signals: AbortSignal[] = []
  f.native.mockImplementation(async (_params, signal) => { signals.push(signal); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve())); return {} })
  const client = new WebSocket(f.url, { origin: f.origin }); client.on('message', data => messages.push(JSON.parse(String(data)))); await once(client, 'open')
  for (let i = 0; i < 65; i++) client.send(request(`request-${i}`))
  await vi.waitFor(() => expect(messages).toHaveLength(1))
  expect(signals).toHaveLength(64)
  expect(messages[0]).toMatchObject({ id: 'request-64', ok: false, error: { code: 'RUNTIME_LIMIT_REACHED' } })
  const closed = once(client, 'close'); client.send(request('request-0'))
  expect((await closed)[0]).toBe(1008)
  await vi.waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true))
})
