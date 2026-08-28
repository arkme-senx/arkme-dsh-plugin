import { describe, expect, it } from 'vitest'
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
  private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>()

  open(): void { this.readyState = 1; this.emit('open', {}) }
  send(data: string): void {
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

async function connectedTransport(): Promise<{ socket: FakeSocket; transport: ArkmeRemoteRealtimeTransport; signal: AbortSignal }> {
  const socket = new FakeSocket()
  const transport = new ArkmeRemoteRealtimeTransport(() => socket)
  const controller = new AbortController()
  const connected = transport.connect({ profileRef: target.hostProfileRef, clientRef: target.hostClientRef, signal: controller.signal })
  setTimeout(() => { socket.open() }, 0)
  await connected
  return { socket, transport, signal: controller.signal }
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
    expect(disconnected).toEqual([{ code: 'CONNECTION_REPLACED', retryable: true }])
  })
})
