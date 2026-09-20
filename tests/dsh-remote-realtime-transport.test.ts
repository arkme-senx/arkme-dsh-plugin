import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ArkmeRemoteRealtimeTransport,
  dshRemoteFrameByteLengths,
  type DshRemoteSocketLike,
} from '../src/dsh-remote/realtime-transport.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import type { DshRemoteRuntimeTarget } from '../src/dsh-remote/types.js'

const preRegistrationTarget: DshRemoteRuntimeTarget = {
  runtimeRef: 'runtime-test-01',
  hostProfileRef: 'profile-test',
  hostClientRef: 'host-client-test',
  hostLeaseGeneration: 0,
}
const target: DshRemoteRuntimeTarget = { ...preRegistrationTarget, hostLeaseGeneration: 29 }

class FakeSocket implements DshRemoteSocketLike {
  readyState = 0
  readonly sent: string[] = []
  sendFailure: Error | undefined
  terminated = false
  heartbeat: (() => void) | undefined
  subscribeHeartbeat(listener: () => void): () => void { this.heartbeat = listener; return () => { this.heartbeat = undefined } }
  terminate(): void { this.terminated = true; this.readyState = 3 }
  private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>()

  open(): void { this.readyState = 1; this.emit('open', {}) }
  send(data: string): void {
    if (this.sendFailure !== undefined) {
      const error = this.sendFailure
      this.sendFailure = undefined
      throw error
    }
    this.sent.push(data)
    const frame = JSON.parse(data) as Record<string, unknown>
    const requestId = frame.request_id
    if (frame.type === 'connection.open') this.reply({ type: 'connection.ready', connection_generation: 11 })
    else if (frame.type === 'service.register') this.reply({
      type: 'service.registered', request_id: requestId, namespace: 'dsh_remote', service: 'host',
      protocol: 'dsh.remote', protocol_major: 1, connection_generation: 11, service_lease_generation: 29,
    })
    else if (frame.type === 'service.unregister') this.reply({
      type: 'service.unregistered', request_id: requestId, namespace: 'dsh_remote', service: 'host',
      protocol: 'dsh.remote', protocol_major: 1,
    })
    else if (frame.type === 'channel.subscribe') this.reply({
      type: 'channel.subscribed', request_id: requestId, namespace: 'dsh_remote',
      channel_ref: frame.channel_ref, seq: 1,
    })
    else if (frame.type === 'channel.publish') this.reply({
      type: 'channel.published', request_id: requestId, namespace: 'dsh_remote',
      channel_ref: frame.channel_ref, seq: 2,
    })
  }
  remoteEvent(payload: Record<string, unknown>, generation = 29): void {
    this.serverFrame({
      type: 'channel.event', namespace: 'dsh_remote', channel_ref: target.runtimeRef, seq: 3,
      event: {
        channel_ref: target.runtimeRef, command_id: 'command-controller-01', seq: 3,
        sender_role: 'controller', runtime_ref: target.runtimeRef, accepted_at: 1_000,
        target_host_lease_generation: generation, payload, created_at: 1_000,
      },
    })
  }
  serverFrame(frame: Record<string, unknown>): void { this.emit('message', { data: JSON.stringify(frame) }) }
  close(): void { this.readyState = 3 }
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  private reply(frame: Record<string, unknown>): void { queueMicrotask(() => { this.serverFrame(frame) }) }
  private emit(type: string, event: { data?: unknown }): void { for (const listener of this.listeners.get(type) ?? []) listener(event) }
}

async function connectedTransport(): Promise<{
  socket: FakeSocket
  transport: ArkmeRemoteRealtimeTransport
  controller: AbortController
  signal: AbortSignal
}> {
  const socket = new FakeSocket()
  const transport = new ArkmeRemoteRealtimeTransport(() => socket)
  const controller = new AbortController()
  const connected = transport.connect({ profileRef: target.hostProfileRef, clientRef: target.hostClientRef, signal: controller.signal })
  setTimeout(() => { socket.open() }, 0)
  await connected
  return { socket, transport, controller, signal: controller.signal }
}

describe('Realtime login-only remote transport wire', () => {
  it('fails a silent pre-open socket instead of blocking Host startup', async () => {
    const socket = new FakeSocket()
    const transport = new ArkmeRemoteRealtimeTransport(() => socket, 1_000)
    await expect(transport.connect({
      profileRef: target.hostProfileRef, clientRef: target.hostClientRef, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_FAILED', retryable: true })
    expect(socket.readyState).toBe(3)
  })

  it('subscribes before registration and sends no Grant/authorization fields', async () => {
    const { socket, transport, signal } = await connectedTransport()
    await transport.subscribe({ target: preRegistrationTarget, onEvent: () => undefined, signal })
    await expect(transport.registerHost({ runtimeRef: target.runtimeRef, capabilities: ['session.list'], signal }))
      .resolves.toEqual({ serviceLeaseGeneration: 29 })
    const frames = socket.sent.map(value => JSON.parse(value) as Record<string, unknown>)
    const subscribe = frames.find(frame => frame.type === 'channel.subscribe')!
    const register = frames.find(frame => frame.type === 'service.register')!
    expect(frames.indexOf(subscribe)).toBeLessThan(frames.indexOf(register))
    expect(subscribe).toMatchObject({
      channel_ref: target.runtimeRef, runtime_ref: target.runtimeRef,
      host_profile_ref: target.hostProfileRef, host_client_ref: target.hostClientRef,
      host_lease_generation: 0,
    })
    expect(register).toMatchObject({ descriptor: { runtime_ref: target.runtimeRef, capabilities: ['session.list'] } })
    expect(JSON.stringify(frames)).not.toMatch(/grant|authorization_ref|remote_auth_epoch|credential_ref/)
  })

  it('publishes against the exact positive Host lease and enforces the complete 60 KiB frame', async () => {
    const { socket, transport, signal } = await connectedTransport()
    await expect(transport.publish({
      target, commandId: 'command-small', direction: 'response',
      payload: { blob: 'x'.repeat(40 * 1024) }, signal,
    })).resolves.toEqual({ sequence: 2 })
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      runtime_ref: target.runtimeRef, host_profile_ref: target.hostProfileRef,
      host_client_ref: target.hostClientRef, host_lease_generation: 29,
    })
    await expect(transport.publish({
      target, commandId: 'command-large', direction: 'response',
      payload: { blob: 'x'.repeat(60 * 1024) }, signal,
    })).rejects.toThrow(/publish\/event frame.*60KiB/)
  })

  it('removes the response waiter when socket send fails before channel abort', async () => {
    const { socket, transport, controller, signal } = await connectedTransport()
    socket.sendFailure = new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'socket send failed', true)

    await expect(transport.publish({
      target, commandId: 'command-send-failure', direction: 'response', payload: { text: 'test' }, signal,
    })).rejects.toMatchObject({ code: 'REMOTE_TRANSPORT_FAILED', message: 'socket send failed' })
    expect((transport as unknown as { waiters: Map<string, unknown> }).waiters.size).toBe(0)

    // A later channel shutdown must not reject an orphaned response Promise.
    controller.abort()
    await Promise.resolve()
  })

  it('keeps a maximum typed read projection inside publish and delivery wrappers', () => {
    const payload = {
      protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: 'r'.repeat(128),
      status: 'completed', host_generation: Number.MAX_SAFE_INTEGER, issued_at: Number.MAX_SAFE_INTEGER,
      operation: 'snapshot.get', body: {}, result: { blob: '四'.repeat(13_000) },
    }
    const sizes = dshRemoteFrameByteLengths({
      target: { ...target, runtimeRef: 'r'.repeat(128), hostProfileRef: 'p'.repeat(128), hostClientRef: 'c'.repeat(128) },
      commandId: `response_${'r'.repeat(119)}`, direction: 'response', payload, senderRole: 'host',
    })
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(40 * 1024)
    expect(sizes.publish).toBeLessThanOrEqual(60 * 1024)
    expect(sizes.event).toBeLessThanOrEqual(60 * 1024)
  })

  it('accepts flattened trusted metadata and ACKs the outer sequence', async () => {
    const { socket, transport, signal } = await connectedTransport()
    const received: Array<{ payload: Record<string, unknown>; metadata: Record<string, unknown> }> = []
    await transport.subscribe({
      target: preRegistrationTarget,
      afterSequence: 2,
      onEvent: (payload, metadata) => { received.push({ payload, metadata }) },
      signal,
    })
    socket.remoteEvent({ protocol: 'dsh.remote', protocol_major: 1, kind: 'request' })
    expect(received).toEqual([{
      payload: { protocol: 'dsh.remote', protocol_major: 1, kind: 'request' },
      metadata: {
        senderRole: 'controller', runtimeRef: target.runtimeRef, acceptedAtMillis: 1_000,
        targetHostLeaseGeneration: 29, transportSequence: 3,
      },
    }])
    expect(socket.sent.map(value => JSON.parse(value))).toContainEqual(expect.objectContaining({
      type: 'channel.ack', channel_ref: target.runtimeRef, seq: 3,
    }))
  })

  it('fails the physical connection when Realtime replaces the same client', async () => {
    const { socket, transport } = await connectedTransport()
    const disconnected: Array<{ code?: string; retryable?: boolean }> = []
    transport.subscribeDisconnect(error => {
      disconnected.push(error instanceof DshRemoteError ? { code: error.code, retryable: error.retryable } : {})
    })
    socket.serverFrame({ type: 'connection.replaced', connection_generation: 12 })
    expect(socket.readyState).toBe(3)
    expect(disconnected).toEqual([{ code: 'CONNECTION_REPLACED', retryable: false }])
  })

  it('fails the physical connection when a logical subscription reports an unsolicited error', async () => {
    const { socket, transport } = await connectedTransport()
    const disconnected: Array<{ code?: string; retryable?: boolean }> = []
    transport.subscribeDisconnect(error => {
      disconnected.push(error instanceof DshRemoteError ? { code: error.code, retryable: error.retryable } : {})
    })

    socket.serverFrame({
      type: 'error', channel_ref: target.runtimeRef,
      code: 'REPLAY_GAP', message: 'live channel sequence gap detected', retryable: true,
    })

    expect(socket.readyState).toBe(3)
    expect(disconnected).toEqual([{ code: 'REPLAY_GAP', retryable: true }])
  })
})


afterEach(() => { vi.useRealTimers() })

describe('remote transport liveness', () => {
  it('expires an OPEN socket without a close callback and releases its timers', async () => {
    vi.useFakeTimers()
    const pending = connectedTransport()
    await vi.advanceTimersByTimeAsync(0)
    const { transport, socket } = await pending
    const disconnected = vi.fn()
    transport.subscribeDisconnect(disconnected)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(socket.terminated).toBe(true)
    expect(disconnected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'REMOTE_TRANSPORT_FAILED', details: expect.objectContaining({ reason: 'liveness_expired' }) }))
    await transport.disconnect()
    expect(vi.getTimerCount()).toBe(0)
    expect(socket.heartbeat).toBeUndefined()
  })

  it('uses received server heartbeats rather than outgoing traffic as liveness', async () => {
    vi.useFakeTimers()
    const pending = connectedTransport()
    await vi.advanceTimersByTimeAsync(0)
    const { transport, socket } = await pending
    await vi.advanceTimersByTimeAsync(40_000)
    socket.heartbeat?.()
    await vi.advanceTimersByTimeAsync(40_000)
    expect(socket.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(socket.terminated).toBe(true)
    await transport.disconnect()
  })
})


it('does not let an old subscription cleanup remove a replacement connection subscription', async () => {
  const first = new FakeSocket()
  const second = new FakeSocket()
  let socket = first
  const transport = new ArkmeRemoteRealtimeTransport(() => socket)
  const input = { profileRef: target.hostProfileRef, clientRef: target.hostClientRef, signal: new AbortController().signal }
  let connecting = transport.connect(input)
  setTimeout(() => first.open(), 0)
  await connecting
  const oldUnsubscribe = await transport.subscribe({ target, onEvent: () => undefined, signal: input.signal })
  socket = second
  connecting = transport.connect(input)
  setTimeout(() => second.open(), 0)
  await connecting
  const received = vi.fn()
  await transport.subscribe({ target, onEvent: received, signal: input.signal })
  oldUnsubscribe()
  second.remoteEvent({ kind: 'test' })
  expect(received).toHaveBeenCalledOnce()
  expect(second.sent.some(x => JSON.parse(x).type === 'channel.unsubscribe')).toBe(false)
  await transport.disconnect()
})

it('keeps one liveness timer across 24 simulated hours of idle server heartbeats', async () => {
  vi.useFakeTimers()
  const pending = connectedTransport()
  await vi.advanceTimersByTimeAsync(0)
  const { transport, socket } = await pending
  for (let tick = 0; tick < 24 * 60 * 3; tick++) {
    await vi.advanceTimersByTimeAsync(20_000)
    socket.heartbeat?.()
  }
  expect(socket.terminated).toBe(false)
  expect(vi.getTimerCount()).toBe(1)
  await transport.disconnect()
  expect(vi.getTimerCount()).toBe(0)
})


it('an already-aborted request never writes a frame or creates a response waiter', async () => {
  const { transport, socket, controller, signal } = await connectedTransport()
  const before = socket.sent.length
  controller.abort(new Error('scope ended'))
  await expect(transport.registerHost({ runtimeRef: target.runtimeRef, capabilities: ['session.list'], signal })).rejects.toThrow('scope ended')
  expect(socket.sent).toHaveLength(before)
  await transport.disconnect()
})
