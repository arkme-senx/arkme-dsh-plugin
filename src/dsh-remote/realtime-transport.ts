import { randomUUID } from 'node:crypto'
import { DshRemoteError } from './errors.js'
import type {
  DshRemoteCapability,
  DshRemotePublishDirection,
  DshRemoteRealtimePayload,
  DshRemoteRealtimeTransport,
  DshRemoteRuntimeTarget,
  DshRemoteTrustedEventMetadata,
} from './types.js'
import { DSH_REMOTE_MAX_FRAME_BYTES } from './types.js'

interface SocketEventLike { data?: unknown }
export interface DshRemoteSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: SocketEventLike) => void): void
  removeEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: SocketEventLike) => void): void
}

export type DshRemoteSocketFactory = (
  input: { profileRef: string; clientRef: string; signal: AbortSignal },
) => DshRemoteSocketLike | Promise<DshRemoteSocketLike>

interface ServerFrame extends Record<string, unknown> {
  type: string
  request_id?: string
}

const remoteDiagnosticsEnabled = process.env.ARKME_DSH_REMOTE_DIAGNOSTICS === '1'

function diagnosticRef(value: unknown): string {
  const normalized = typeof value === 'string' ? value : ''
  return normalized.length <= 8 ? normalized : normalized.slice(-8)
}

export interface DshRemoteFrameSizingInput {
  target: DshRemoteRuntimeTarget
  commandId: string
  direction: DshRemotePublishDirection
  payload: DshRemoteRealtimePayload
  senderRole: 'host' | 'controller'
}

/**
 * Mirrors jotmo-realtime's login-only channel.publish and channel.event
 * wrappers. Max-width sequence/timestamp values keep the check conservative.
 */
export function dshRemoteFrameByteLengths(input: DshRemoteFrameSizingInput): { publish: number; event: number } {
  const maxInt64 = 9_223_372_036_854_776_000
  const requestId = '00000000-0000-4000-8000-000000000000'
  const target = wireTarget(input.target)
  const publish = {
    type: 'channel.publish', namespace: 'dsh_remote', channel_ref: input.target.runtimeRef,
    ...target, direction: input.direction, command_id: input.commandId,
    payload: input.payload, request_id: requestId,
  }
  const event = {
    type: 'channel.event', namespace: 'dsh_remote', channel_ref: input.target.runtimeRef, seq: maxInt64,
    event: {
      channel_ref: input.target.runtimeRef, command_id: input.commandId, seq: maxInt64,
      sender_role: input.senderRole, runtime_ref: input.target.runtimeRef,
      accepted_at: maxInt64, target_host_lease_generation: input.target.hostLeaseGeneration,
      payload: input.payload, created_at: maxInt64,
    },
  }
  return {
    publish: Buffer.byteLength(JSON.stringify(publish)),
    event: Buffer.byteLength(JSON.stringify(event)),
  }
}

export function assertDshRemoteFramesFit(input: DshRemoteFrameSizingInput): void {
  const sizes = dshRemoteFrameByteLengths(input)
  if (sizes.publish > DSH_REMOTE_MAX_FRAME_BYTES || sizes.event > DSH_REMOTE_MAX_FRAME_BYTES) {
    throw new DshRemoteError(
      'REMOTE_REQUEST_INVALID',
      'Realtime publish/event frame 超过 60KiB',
      false,
      { frameTooLarge: true, publishBytes: sizes.publish, eventBytes: sizes.event },
    )
  }
}

const SERVER_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  'connection.ready': new Set(['type', 'connection_generation']),
  'connection.replaced': new Set(['type', 'connection_generation']),
  'service.registered': new Set(['type', 'request_id', 'namespace', 'service', 'protocol', 'protocol_major', 'connection_generation', 'service_lease_generation', 'duplicate']),
  'service.unregistered': new Set(['type', 'request_id', 'namespace', 'service', 'protocol', 'protocol_major', 'duplicate']),
  'channel.subscribed': new Set(['type', 'request_id', 'namespace', 'channel_ref', 'seq', 'duplicate']),
  'channel.unsubscribed': new Set(['type', 'request_id', 'namespace', 'channel_ref', 'duplicate']),
  'channel.published': new Set(['type', 'request_id', 'namespace', 'channel_ref', 'seq', 'duplicate']),
  'channel.event': new Set(['type', 'namespace', 'channel_ref', 'seq', 'event']),
  error: new Set(['type', 'request_id', 'channel_ref', 'code', 'message', 'retryable']),
}

function validServerFrame(frame: ServerFrame): boolean {
  const allowed = SERVER_FIELDS[frame.type]
  if (allowed === undefined || Object.keys(frame).some(key => !allowed.has(key))) return false
  if (frame.type === 'connection.ready') return positiveInteger(frame.connection_generation)
  if (frame.type === 'connection.replaced') return true
  if (frame.type === 'error') {
    return (frame.request_id === undefined || validRef(frame.request_id))
      && typeof frame.code === 'string' && typeof frame.message === 'string'
      && typeof frame.retryable === 'boolean'
  }
  if (frame.type === 'channel.event') return frame.namespace === 'dsh_remote'
    && validRef(frame.channel_ref) && positiveInteger(frame.seq)
    && frame.event !== null && typeof frame.event === 'object' && !Array.isArray(frame.event)
  return validRef(frame.request_id)
}

function remoteError(frame: ServerFrame): DshRemoteError {
  const code = typeof frame.code === 'string' ? frame.code : 'REMOTE_TRANSPORT_FAILED'
  const supported = new Set([
    'REMOTE_LOGIN_REQUIRED', 'RUNTIME_OFFLINE', 'HOST_CHANNEL_NOT_READY',
    'CONNECTION_REPLACED', 'HOST_GENERATION_STALE', 'REMOTE_PROTOCOL_UNSUPPORTED',
    'REMOTE_REQUEST_INVALID', 'REMOTE_TRANSPORT_FAILED', 'REPLAY_GAP',
  ])
  return new DshRemoteError(
    (supported.has(code) ? code : 'REMOTE_TRANSPORT_FAILED') as ConstructorParameters<typeof DshRemoteError>[0],
    typeof frame.message === 'string' && frame.message.trim() !== '' ? frame.message : 'Realtime 远控操作失败',
    frame.retryable === true,
  )
}

function positive(frame: ServerFrame, key: string): number {
  const value = frame[key]
  if (!positiveInteger(value)) throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', `Realtime ${key} 无效`, true)
  return value
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validRef(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}

function validateTarget(target: DshRemoteRuntimeTarget, allowUnregisteredHost: boolean): void {
  if (!validRef(target.runtimeRef) || !validRef(target.hostProfileRef) || !validRef(target.hostClientRef)
    || !Number.isSafeInteger(target.hostLeaseGeneration) || target.hostLeaseGeneration < 0
    || (!allowUnregisteredHost && target.hostLeaseGeneration <= 0)) {
    throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'Realtime Runtime 目标无效')
  }
}

function wireTarget(target: DshRemoteRuntimeTarget): Record<string, unknown> {
  return {
    runtime_ref: target.runtimeRef,
    host_profile_ref: target.hostProfileRef,
    host_client_ref: target.hostClientRef,
    host_lease_generation: target.hostLeaseGeneration,
  }
}

/** Exact adapter for jotmo-realtime's login-only DSH Remote contract. */
export class ArkmeRemoteRealtimeTransport implements DshRemoteRealtimeTransport {
  private socket: DshRemoteSocketLike | undefined
  private connectionGeneration = 0
  private serviceLeaseGeneration = 0
  private readonly waiters = new Map<string, { resolve: (frame: ServerFrame) => void; reject: (error: Error) => void }>()
  private readonly channelListeners = new Map<string, (frame: ServerFrame) => void>()
  private readonly disconnectListeners = new Set<(error: Error) => void>()
  private onMessage: ((event: SocketEventLike) => void) | undefined
  private onClose: ((event: SocketEventLike) => void) | undefined

  constructor(
    private readonly createSocket: DshRemoteSocketFactory,
    private readonly requestTimeoutMillis = 10_000,
  ) {
    if (!Number.isSafeInteger(requestTimeoutMillis) || requestTimeoutMillis < 1_000 || requestTimeoutMillis > 60_000) {
      throw new TypeError('Realtime request timeout must be between 1000 and 60000 milliseconds')
    }
  }

  async connect(input: { profileRef: string; clientRef: string; signal: AbortSignal }): Promise<void> {
    await this.disconnect()
    if (input.signal.aborted) throw input.signal.reason
    const socket = await this.createSocket(input)
    this.socket = socket
    this.onMessage = event => { this.receive(event.data) }
    this.onClose = () => {
      if (this.socket !== socket) return
      this.failConnection(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Realtime 连接意外关闭', true), false)
    }
    socket.addEventListener('message', this.onMessage)
    socket.addEventListener('close', this.onClose)
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve() }
      const onError = () => { cleanup(); reject(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Realtime 连接失败', true)) }
      const onEarlyClose = () => { cleanup(); reject(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Realtime 在握手前关闭', true)) }
      const onAbort = () => { cleanup(); socket.close(1000, 'aborted'); reject(input.signal.reason) }
      const cleanup = () => {
        clearTimeout(timer)
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
        socket.removeEventListener('close', onEarlyClose)
        input.signal.removeEventListener('abort', onAbort)
      }
      const timer = setTimeout(() => {
        cleanup()
        socket.close(1000, 'handshake timeout')
        reject(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Realtime 连接握手超时', true))
      }, this.requestTimeoutMillis)
      timer.unref()
      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
      socket.addEventListener('close', onEarlyClose)
      input.signal.addEventListener('abort', onAbort, { once: true })
    })
    const ready = this.waitForType('connection.ready', input.signal)
    this.send({ type: 'connection.open', profile_ref: input.profileRef, client_ref: input.clientRef })
    this.connectionGeneration = positive(await ready, 'connection_generation')
  }

  async disconnect(): Promise<void> {
    this.failConnection(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Realtime 连接已关闭', true), true)
  }

  subscribeDisconnect(listener: (error: Error) => void): () => void {
    this.disconnectListeners.add(listener)
    return () => { this.disconnectListeners.delete(listener) }
  }

  async registerHost(input: { runtimeRef: string; capabilities: DshRemoteCapability[]; signal: AbortSignal }): Promise<{ serviceLeaseGeneration: number }> {
    if (!validRef(input.runtimeRef) || input.capabilities.some(capability => !/^[A-Za-z0-9._:-]{1,128}$/.test(capability))) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'Realtime Host 服务描述无效')
    }
    const frame = await this.request({
      type: 'service.register', namespace: 'dsh_remote', service: 'host', protocol: 'dsh.remote', protocol_major: 1,
      descriptor: { runtime_ref: input.runtimeRef, capabilities: [...new Set(input.capabilities)].sort() },
    }, 'service.registered', input.signal)
    this.serviceLeaseGeneration = positive(frame, 'service_lease_generation')
    return { serviceLeaseGeneration: this.serviceLeaseGeneration }
  }

  async unregisterHost(signal?: AbortSignal): Promise<void> {
    if (this.socket === undefined) { this.serviceLeaseGeneration = 0; return }
    try {
      await this.request({
        type: 'service.unregister', namespace: 'dsh_remote', service: 'host', protocol: 'dsh.remote', protocol_major: 1,
      }, 'service.unregistered', signal ?? new AbortController().signal)
    } finally {
      this.serviceLeaseGeneration = 0
    }
  }

  async subscribe(input: {
    target: DshRemoteRuntimeTarget
    afterSequence?: number
    onEvent: (payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata) => void
    signal: AbortSignal
  }): Promise<() => void> {
    validateTarget(input.target, true)
    if (input.afterSequence !== undefined
      && (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0)) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'Realtime after_seq 无效')
    }
    await this.request({
      type: 'channel.subscribe', namespace: 'dsh_remote', channel_ref: input.target.runtimeRef,
      ...wireTarget(input.target),
      ...(input.afterSequence === undefined ? {} : { after_seq: input.afterSequence }),
    }, 'channel.subscribed', input.signal)
    this.channelListeners.set(input.target.runtimeRef, frame => {
      const event = frame.event
      if (event === null || typeof event !== 'object' || Array.isArray(event)) return
      const source = event as Record<string, unknown>
      if (source.payload === null || typeof source.payload !== 'object' || Array.isArray(source.payload)) return
      if (source.sender_role !== 'host' && source.sender_role !== 'controller') return
      if (source.runtime_ref !== input.target.runtimeRef
        || !positiveInteger(source.accepted_at)
        || !Number.isSafeInteger(source.target_host_lease_generation)
        || (source.target_host_lease_generation as number) < 0) return
      input.onEvent(source.payload as Record<string, unknown>, {
        senderRole: source.sender_role,
        runtimeRef: source.runtime_ref,
        acceptedAtMillis: source.accepted_at,
        targetHostLeaseGeneration: source.target_host_lease_generation as number,
        ...(positiveInteger(source.seq) ? { transportSequence: source.seq } : {}),
      })
      if (positiveInteger(source.seq)) this.send({
        type: 'channel.ack', request_id: randomUUID(), namespace: 'dsh_remote',
        channel_ref: input.target.runtimeRef, seq: source.seq,
      })
    })
    let unsubscribed = false
    const unsubscribe = () => {
      if (unsubscribed) return
      unsubscribed = true
      input.signal.removeEventListener('abort', unsubscribe)
      this.channelListeners.delete(input.target.runtimeRef)
      if (this.socket !== undefined) this.send({
        type: 'channel.unsubscribe', request_id: randomUUID(), namespace: 'dsh_remote',
        channel_ref: input.target.runtimeRef,
      })
    }
    input.signal.addEventListener('abort', unsubscribe, { once: true })
    return unsubscribe
  }

  async publish(input: {
    target: DshRemoteRuntimeTarget
    commandId: string
    direction: DshRemotePublishDirection
    payload: DshRemoteRealtimePayload
    signal: AbortSignal
  }): Promise<{ sequence: number }> {
    validateTarget(input.target, false)
    if (!validRef(input.commandId)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'Realtime command_id 无效')
    const senderRole = input.target.hostProfileRef === '' ? 'controller' : 'host'
    assertDshRemoteFramesFit({
      target: input.target, commandId: input.commandId, direction: input.direction,
      payload: input.payload, senderRole,
    })
    const frame = await this.request({
      type: 'channel.publish', namespace: 'dsh_remote', channel_ref: input.target.runtimeRef,
      ...wireTarget(input.target), direction: input.direction,
      command_id: input.commandId, payload: input.payload,
    }, 'channel.published', input.signal)
    return { sequence: positive(frame, 'seq') }
  }

  private async request(frame: Record<string, unknown>, expectedType: string, signal: AbortSignal): Promise<ServerFrame> {
    const requestId = randomUUID()
    const response = this.waitForRequest(requestId, expectedType, signal)
    try {
      this.send({ ...frame, request_id: requestId })
    } catch (error) {
      // The waiter must be installed before send because a test socket (and a
      // sufficiently fast in-process transport) may answer synchronously. If
      // send itself fails, however, leaving that waiter behind turns the next
      // channel abort into an unhandled rejection and can terminate DSH via
      // app-boot's fail-loud handler.
      const waiter = this.waiters.get(requestId)
      if (waiter !== undefined) {
        this.waiters.delete(requestId)
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    return await response
  }

  private waitForRequest(requestId: string, expectedType: string, signal: AbortSignal): Promise<ServerFrame> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => { this.waiters.delete(requestId); cleanup(); reject(signal.reason) }
      const timer = setTimeout(() => {
        this.waiters.delete(requestId)
        cleanup()
        reject(new DshRemoteError('REMOTE_TRANSPORT_FAILED', `Realtime ${expectedType} 响应超时`, true))
      }, this.requestTimeoutMillis)
      timer.unref()
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiters.set(requestId, {
        resolve: frame => {
          cleanup()
          if (frame.type !== expectedType) reject(remoteError(frame))
          else resolve(frame)
        },
        reject: error => { cleanup(); reject(error) },
      })
    })
  }

  private waitForType(type: string, signal: AbortSignal): Promise<ServerFrame> {
    return this.waitForRequest(`@type:${type}`, type, signal)
  }

  private receive(data: unknown): void {
    let frame: ServerFrame
    try {
      const raw = typeof data === 'string' ? data : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : String(data)
      if (Buffer.byteLength(raw) > DSH_REMOTE_MAX_FRAME_BYTES) return
      const parsed = JSON.parse(raw) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as { type?: unknown }).type !== 'string') return
      frame = parsed as ServerFrame
    } catch { return }
    if (remoteDiagnosticsEnabled) {
      console.info('dsh-arkme: remote_wire_frame', {
        type: frame.type,
        requestRef: diagnosticRef(frame.request_id),
        channelRef: diagnosticRef(frame.channel_ref),
        fields: Object.keys(frame).sort(),
      })
    }
    if (!validServerFrame(frame)) {
      if (remoteDiagnosticsEnabled) {
        console.warn('dsh-arkme: remote_wire_frame_rejected', {
          type: frame.type,
          requestRef: diagnosticRef(frame.request_id),
          fields: Object.keys(frame).sort(),
        })
      }
      return
    }
    if (frame.type === 'connection.replaced') {
      this.failConnection(new DshRemoteError('CONNECTION_REPLACED', 'Realtime 连接已被同一客户端的新连接替换', true), false)
      return
    }
    const requestId = frame.request_id
    const waiterKey = typeof requestId === 'string' && this.waiters.has(requestId) ? requestId : `@type:${frame.type}`
    const waiter = this.waiters.get(waiterKey)
    if (waiter !== undefined) {
      this.waiters.delete(waiterKey)
      waiter.resolve(frame)
      return
    }
    if (frame.type === 'error') {
      this.failConnection(remoteError(frame), false)
      return
    }
    if (frame.type === 'channel.event' && typeof frame.channel_ref === 'string') this.channelListeners.get(frame.channel_ref)?.(frame)
  }

  private failConnection(error: DshRemoteError, expected: boolean): void {
    const socket = this.socket
    if (socket !== undefined && this.onMessage !== undefined) socket.removeEventListener('message', this.onMessage)
    if (socket !== undefined && this.onClose !== undefined) socket.removeEventListener('close', this.onClose)
    this.socket = undefined
    this.onMessage = undefined
    this.onClose = undefined
    this.connectionGeneration = 0
    this.serviceLeaseGeneration = 0
    socket?.close(1000, expected ? 'remote host stopped' : 'remote connection failed')
    for (const waiter of this.waiters.values()) waiter.reject(error)
    this.waiters.clear()
    this.channelListeners.clear()
    if (!expected) for (const listener of this.disconnectListeners) listener(error)
  }

  private send(frame: Record<string, unknown>): void {
    if (this.socket === undefined || this.socket.readyState !== 1) throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Realtime 尚未连接', true)
    const encoded = JSON.stringify(frame)
    if (Buffer.byteLength(encoded) > DSH_REMOTE_MAX_FRAME_BYTES) throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'Realtime frame 超过 60KiB')
    this.socket.send(encoded)
  }
}
