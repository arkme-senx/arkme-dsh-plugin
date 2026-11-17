import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { DshNativeSocket } from '../src/dsh-remote/native-socket.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import { observeDshAccountSession } from '../src/dsh-remote/account-session-observer.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.unstubAllGlobals(); for (const stop of cleanup.splice(0).reverse()) await stop() })
async function fixture(observeHistorySync?: (notify: (event: any) => void, signal: AbortSignal) => Promise<void>, observations: Record<string, unknown> = {}) {
  const native = vi.fn(async (_params: Record<string, unknown>, _signal: AbortSignal): Promise<unknown> => ({ items: [{ type: 'ready' }], sourceWritable: false }))
  const server = createServer((_req, res) => res.end('available'))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const carrier = new DshNativeSocket(() => ({ native, observeHistorySync, ...observations }) as never, port)
  server.on('upgrade', carrier.handler)
  cleanup.push(async () => { carrier.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { native, carrier, origin: `http://127.0.0.1:${port}`, url: `ws://127.0.0.1:${port}/native-streams` }
}
const request = (id: string, mode = 'pull') => JSON.stringify({ id, params: { runtimeRef: 'owned', requestRef: id, body: { mode, streamRef: id, endpoint: '$events', payload: { args: {} } } } })
function browser(origin: string) {
  const root: any = { location: { protocol: 'http:', origin } }; root.parent = root
  vi.stubGlobal('window', root)
  vi.stubGlobal('WebSocket', class extends WebSocket {
    constructor(url: string) { super(url.replace(/^http/, 'ws'), { origin }); this.on('error', () => {}) }
  })
}
it('uses the existing account owner over WebSocket, with no HTTP subscription or duplicate history observer', async () => {
  let signal!: AbortSignal, notify!: () => void
  const observeDirectory = vi.fn(async (scoped: AbortSignal, changed: () => void) => {
    signal = scoped; notify = changed; changed()
    await new Promise<void>(resolve => scoped.addEventListener('abort', () => resolve(), { once: true }))
  })
  const history = vi.fn(async () => {})
  const f = await fixture(history, { observeDirectory }); browser(f.origin)
  const fetcher = vi.fn(), changed = vi.fn(), failed = vi.fn()
  const stop = observeDshAccountSession(`${f.origin}/arkme-self/api`, fetcher, undefined, changed, { onError: failed })
  try {
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    notify(); await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
    expect(observeDirectory).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled()
    expect(await (await fetch(f.origin)).text()).toBe('available')
  } finally { stop() }
  await vi.waitFor(() => expect(signal.aborted).toBe(true))
  expect(failed).not.toHaveBeenCalled()
})
it('does not fall back around an account authorization failure on the observation carrier', async () => {
  const f = await fixture(undefined, { observeDirectory: vi.fn(async () => { throw new DshRemoteError('REMOTE_LOGIN_REQUIRED', '请先登录') }) })
  browser(f.origin)
  const fetcher = vi.fn(), failed = vi.fn()
  const stop = observeDshAccountSession(`${f.origin}/arkme-self/api`, fetcher, undefined, vi.fn(), { onError: failed })
  try { await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce()); expect(fetcher).not.toHaveBeenCalled() }
  finally { stop() }
})
it('falls back once for an explicitly unsupported older carrier and cancels its bounded HTTP stream', async () => {
  const root: any = { location: { protocol: 'http:', origin: 'http://localhost:1234' } }; root.parent = root
  vi.stubGlobal('window', root)
  vi.stubGlobal('WebSocket', class {
    onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null
    onclose = null; onerror = null
    constructor() { queueMicrotask(() => this.onopen?.()) }
    send() { queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: 'observe', ok: false, error: { code: 'REMOTE_REQUEST_INVALID' } }) })) }
    close() {}
  })
  let signal!: AbortSignal
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
    signal = init.signal as AbortSignal
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"changed":true}\n'))
      signal.addEventListener('abort', () => controller.close(), { once: true })
    } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
  })
  const changed = vi.fn(), stop = observeDshAccountSession('/arkme-self/api', fetcher, undefined, changed)
  try { await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(fetcher).toHaveBeenCalledOnce() }
  finally { stop() }
  expect(signal.aborted).toBe(true)
})
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

it('preserves retryability across the browser carrier boundary', async () => {
  const f = await fixture(), client = new WebSocket(f.url, { origin: f.origin })
  await once(client, 'open')
  f.native.mockRejectedValueOnce(new DshRemoteError('HOST_GENERATION_STALE', 'host restarted', true))
  const message = once(client, 'message'); client.send(request('retry'))
  expect(JSON.parse(String((await message)[0]))).toMatchObject({ ok: false, error: { code: 'HOST_GENERATION_STALE', retryable: true } })
})

it('multiplexes slow readonly calls, cancels consumers, and keeps writes out of the carrier', async () => {
  const f = await fixture(), signals: AbortSignal[] = [], messages: any[] = []
  f.native.mockImplementation(async (_params, signal) => {
    signals.push(signal)
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    return { ok: true, value: [] }
  })
  const client = new WebSocket(f.url, { origin: f.origin })
  client.on('message', data => messages.push(JSON.parse(String(data)))); await once(client, 'open')
  for (let i = 0; i < 8; i++) client.send(JSON.stringify({ id: `read-${i}`, params: {
    runtimeRef: 'owned', sessionRef: 'old', requestRef: `read-${i}`, body: { mode: 'call', endpoint: 'schedule/list', payload: { args: {} } },
  } }))
  await vi.waitFor(() => expect(signals).toHaveLength(8))
  expect(await (await fetch(f.origin)).text()).toBe('available')
  client.send(JSON.stringify({ id: 'write', params: { body: { mode: 'call', endpoint: 'schedule/update' } } }))
  await vi.waitFor(() => expect(messages).toHaveLength(1))
  expect(messages[0]).toMatchObject({ id: 'write', ok: false, error: { code: 'REMOTE_REQUEST_INVALID' } })
  client.send(JSON.stringify({ id: 'read-0', cancel: true }))
  await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true))
  expect(signals.slice(1).every(signal => !signal.aborted)).toBe(true)
  client.close(); await once(client, 'close')
  await vi.waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true))
})


it('pushes account-scoped history receipts without a read and releases the observer on disconnect', async () => {
  let send!: (event: any) => void, signal!: AbortSignal
  const f = await fixture(async (notify, scoped) => {
    send = notify; signal = scoped
    await new Promise<void>(resolve => scoped.addEventListener('abort', () => resolve(), { once: true }))
  })
  const client = new WebSocket(f.url, { origin: f.origin }); await once(client, 'open')
  const received = once(client, 'message')
  send({ runtimeRef: 'canonical', sessionRef: 'old', status: { state: 'complete', nextSeq: 2, throughSeq: 1 }, revision: 3 })
  expect(JSON.parse(String((await received)[0]))).toMatchObject({ event: 'history-sync', revision: 3, status: { state: 'complete' } })
  expect(f.native).not.toHaveBeenCalled()
  client.close(); await once(client, 'close'); await vi.waitFor(() => expect(signal.aborted).toBe(true))
})
