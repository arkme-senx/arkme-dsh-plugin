import { randomUUID } from 'node:crypto'
import WebSocket, { type RawData } from 'ws'
import type { ArkmeSessionStore } from '../keychain-store.js'
import { ArkmePluginError, type ServiceRuntime, objectValue, stringValue } from '../services/service.js'
import type { SourceService } from '../services/source-service.js'
import type {
  ArkmeExtensionRealtimeFacade,
  ArkmeRealtimeChannelEvent,
  ArkmeRealtimeHostService,
  ArkmeRealtimeInvite,
  ArkmeRealtimeInviteCard,
  ArkmeRealtimeInviteInput,
  ArkmeRealtimePublishResult,
  ArkmeRealtimeRoomSession,
  ArkmeRealtimeServiceDescriptor,
} from './types.js'

const INSTANCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SERVICE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const PROTOCOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const MAX_EVENT_BYTES = 64 * 1024

interface SocketFrame {
  type: string
  request_id?: string
  connection_generation?: number
  namespace?: string
  service?: string
  protocol?: string
  protocol_major?: number
  participant_min?: number
  participant_max?: number
  allow_observers?: boolean
  channel_ref?: string
  after_seq?: number
  seq?: number
  command_id?: string
  controller_generation?: number
  payload?: unknown
  duplicate?: boolean
  event?: {
    channel_ref?: string
    command_id?: string
    seq?: number
    sender_client_ref?: string
    controller_generation?: number
    payload?: unknown
    created_at?: number
  }
  code?: string
  message?: string
  retryable?: boolean
}

interface PendingRequest {
  expectedType: string
  resolve(frame: SocketFrame): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface ServiceLease {
  descriptor: ArkmeRealtimeServiceDescriptor
  references: number
}

interface ChannelSubscription {
  listeners: Set<(event: ArkmeRealtimeChannelEvent) => void>
  afterSequence: number
}

interface RealtimeEnvelope<T> {
  code: number
  message?: string
  data?: T
}

function descriptorKey(namespace: string, descriptor: ArkmeRealtimeServiceDescriptor): string {
  return `${namespace}\u0000${descriptor.service}\u0000${descriptor.protocolMajor}`
}

function validateExtensionId(value: string): string {
  const normalized = value.trim()
  if (!INSTANCE_REF_PATTERN.test(normalized)) {
    throw new ArkmePluginError('realtime-extension-id-invalid', '实时插件身份无效', false)
  }
  return normalized
}

function validateDescriptor(input: ArkmeRealtimeServiceDescriptor): ArkmeRealtimeServiceDescriptor {
  const descriptor = {
    service: input.service.trim(),
    protocol: input.protocol.trim(),
    protocolMajor: Math.trunc(input.protocolMajor),
    participantMin: Math.trunc(input.participantMin),
    participantMax: Math.trunc(input.participantMax),
    ...(input.allowObservers === true ? { allowObservers: true } : {}),
  }
  if (!SERVICE_PATTERN.test(descriptor.service) || !PROTOCOL_PATTERN.test(descriptor.protocol)
    || descriptor.protocolMajor < 1 || descriptor.participantMin < 2
    || descriptor.participantMax < descriptor.participantMin || descriptor.participantMax > 100) {
    throw new ArkmePluginError('realtime-service-invalid', '实时服务声明无效', false)
  }
  return descriptor
}

function websocketUrl(baseUrl: string): string {
  const url = new URL('/api/v1/realtime/connect', `${baseUrl.replace(/\/+$/, '')}/`)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new ArkmePluginError('realtime-url-invalid', '实时服务地址无效', false, 503)
  return url.href
}

function socketError(frame: SocketFrame): ArkmePluginError {
  return new ArkmePluginError(
    stringValue(frame.code).trim() || 'realtime-socket-error',
    stringValue(frame.message).trim() || '实时通道操作失败',
    frame.retryable === true,
    frame.retryable === true ? 503 : 409,
  )
}

function serializedPayload(value: unknown): unknown {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch (error) {
    throw new ArkmePluginError('realtime-payload-invalid', '实时事件必须可序列化为 JSON', false, 400, { cause: error })
  }
  if (encoded === undefined || Buffer.byteLength(encoded) > MAX_EVENT_BYTES) {
    throw new ArkmePluginError('realtime-payload-too-large', '实时事件不能超过 64 KiB', false, 413)
  }
  return JSON.parse(encoded) as unknown
}

class RealtimeSocketMultiplexer {
  private socket: WebSocket | undefined
  private socketUserId: number | undefined
  private ready: Promise<void> | undefined
  private resolveReady: (() => void) | undefined
  private rejectReady: ((error: Error) => void) | undefined
  private readonly pending = new Map<string, PendingRequest>()
  private readonly services = new Map<string, ServiceLease>()
  private readonly channels = new Map<string, ChannelSubscription>()
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectAttempt = 0
  private disposed = false
  private suspended = false

  constructor(
    private readonly baseUrl: string,
    private readonly sessionStore: ArkmeSessionStore,
    readonly profileRef: string,
    readonly clientRef: string,
    private readonly requestTimeoutMs: number,
  ) {}

  async provide(namespace: string, input: ArkmeRealtimeServiceDescriptor): Promise<() => void> {
    const descriptor = validateDescriptor(input)
    const key = descriptorKey(namespace, descriptor)
    const current = this.services.get(key)
    if (current !== undefined) {
      if (current.descriptor.protocol !== descriptor.protocol
        || current.descriptor.participantMin !== descriptor.participantMin
        || current.descriptor.participantMax !== descriptor.participantMax
        || current.descriptor.allowObservers !== descriptor.allowObservers) {
        throw new ArkmePluginError('realtime-service-conflict', '同一实时服务已有不同声明', false, 409)
      }
      current.references++
    } else {
      this.services.set(key, { descriptor, references: 1 })
      try {
        await this.register(namespace, descriptor)
      } catch (error) {
        this.services.delete(key)
        throw error
      }
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      const lease = this.services.get(key)
      if (lease === undefined) return
      lease.references--
      if (lease.references > 0) return
      this.services.delete(key)
      void this.unregister(namespace, descriptor).catch(() => undefined)
      this.closeWhenIdle()
    }
  }

  hasService(namespace: string, descriptor: ArkmeRealtimeServiceDescriptor): boolean {
    const normalized = validateDescriptor(descriptor)
    const lease = this.services.get(descriptorKey(namespace, normalized))
    return lease !== undefined && lease.descriptor.protocol === normalized.protocol
  }

  async subscribe(
    channelRefValue: string,
    listener: (event: ArkmeRealtimeChannelEvent) => void,
    afterSequenceValue = 0,
  ): Promise<() => void> {
    const channelRef = channelRefValue.trim()
    const afterSequence = Math.trunc(afterSequenceValue)
    if (!INSTANCE_REF_PATTERN.test(channelRef) || typeof listener !== 'function' || afterSequence < 0) {
      throw new ArkmePluginError('realtime-subscription-invalid', '实时频道订阅参数无效', false)
    }
    let subscription = this.channels.get(channelRef)
    if (subscription === undefined) {
      subscription = { listeners: new Set(), afterSequence }
      this.channels.set(channelRef, subscription)
      try {
        await this.request({ type: 'channel.subscribe', channel_ref: channelRef, after_seq: afterSequence }, 'channel.subscribed')
      } catch (error) {
        this.channels.delete(channelRef)
        throw error
      }
    }
    subscription.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      const current = this.channels.get(channelRef)
      current?.listeners.delete(listener)
      if (current !== undefined && current.listeners.size === 0) {
        this.channels.delete(channelRef)
        void this.request({ type: 'channel.unsubscribe', channel_ref: channelRef }, 'channel.unsubscribed').catch(() => undefined)
        this.closeWhenIdle()
      }
    }
  }

  async publish(
    channelRefValue: string,
    controllerGenerationValue: number,
    commandIdValue: string,
    payload: unknown,
  ): Promise<ArkmeRealtimePublishResult> {
    const channelRef = channelRefValue.trim()
    const commandId = commandIdValue.trim()
    const controllerGeneration = Math.trunc(controllerGenerationValue)
    if (!INSTANCE_REF_PATTERN.test(channelRef) || !INSTANCE_REF_PATTERN.test(commandId) || controllerGeneration < 1) {
      throw new ArkmePluginError('realtime-publish-invalid', '实时事件发布参数无效', false)
    }
    const frame = await this.request({
      type: 'channel.publish', channel_ref: channelRef, command_id: commandId,
      controller_generation: controllerGeneration, payload: serializedPayload(payload),
    }, 'channel.published')
    return {
      channelRef,
      sequence: Math.trunc(frame.seq ?? 0),
      duplicate: frame.duplicate === true,
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.services.clear()
    this.channels.clear()
    this.failPending(new ArkmePluginError('realtime-disposed', '实时运行时已停止', false, 503))
    this.socket?.close(1000, 'Arkme realtime disposed')
    this.socket = undefined
  }

  suspend(): void {
    if (this.disposed) return
    this.suspended = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.channels.clear()
    this.socketUserId = undefined
    const error = new ArkmePluginError('login-required', '请先登录 Arkme', false, 401)
    this.rejectReady?.(error)
    this.resolveReady = undefined
    this.rejectReady = undefined
    this.ready = undefined
    this.failPending(error)
    const socket = this.socket
    this.socket = undefined
    socket?.close(1000, 'Arkme account unavailable')
  }

  resume(): void {
    if (this.disposed || !this.suspended) return
    this.suspended = false
    if (this.services.size > 0) this.scheduleReconnect()
  }

  authenticationChanged(userId: number | undefined): void {
    if (userId === undefined) {
      this.suspend()
      return
    }
    if (this.socketUserId !== undefined && this.socketUserId !== userId) {
      this.suspend()
      this.resume()
      return
    }
    this.resume()
  }

  private async register(namespace: string, descriptor: ArkmeRealtimeServiceDescriptor): Promise<void> {
    await this.request({
      type: 'service.register', namespace, service: descriptor.service, protocol: descriptor.protocol,
      protocol_major: descriptor.protocolMajor, participant_min: descriptor.participantMin,
      participant_max: descriptor.participantMax, allow_observers: descriptor.allowObservers === true,
    }, 'service.registered')
  }

  private async unregister(namespace: string, descriptor: ArkmeRealtimeServiceDescriptor): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    await this.request({
      type: 'service.unregister', namespace, service: descriptor.service,
      protocol: descriptor.protocol, protocol_major: descriptor.protocolMajor,
    }, 'service.unregistered')
  }

  private async request(frame: SocketFrame, expectedType: string): Promise<SocketFrame> {
    await this.ensureReady()
    const requestId = randomUUID()
    return await new Promise<SocketFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new ArkmePluginError('realtime-request-timeout', '实时通道请求超时', true, 504))
      }, this.requestTimeoutMs)
      this.pending.set(requestId, { expectedType, resolve, reject, timer })
      this.socket!.send(JSON.stringify({ ...frame, request_id: requestId }), error => {
        if (error == null) return
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new ArkmePluginError('realtime-network-error', '实时通道写入失败', true, 502, { cause: error }))
      })
    })
  }

  private async ensureReady(): Promise<void> {
    if (this.disposed) throw new ArkmePluginError('realtime-disposed', '实时运行时已停止', false, 503)
    this.suspended = false
    if (this.socket?.readyState === WebSocket.OPEN && this.ready !== undefined) return await this.ready
    if (this.ready !== undefined) return await this.ready
    const session = await this.sessionStore.read()
    if (session === undefined) throw new ArkmePluginError('login-required', '请先登录 Arkme', false, 401)
    this.socketUserId = session.userId
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    const socket = new WebSocket(websocketUrl(this.baseUrl), {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      handshakeTimeout: this.requestTimeoutMs,
      maxPayload: MAX_EVENT_BYTES * 2,
    })
    this.socket = socket
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'connection.open', profile_ref: this.profileRef, client_ref: this.clientRef }))
    })
    socket.on('message', data => { this.handleMessage(data) })
    socket.once('error', error => { this.rejectReady?.(error) })
    socket.once('close', () => { this.handleClose(socket) })
    return await this.ready
  }

  private handleMessage(data: RawData): void {
    let frame: SocketFrame
    try {
      frame = JSON.parse(data.toString()) as SocketFrame
    } catch {
      this.socket?.close(1002, 'invalid realtime frame')
      return
    }
    if (frame.type === 'connection.ready') {
      this.reconnectAttempt = 0
      this.resolveReady?.()
      this.resolveReady = undefined
      this.rejectReady = undefined
      return
    }
    if (frame.type === 'connection.replaced') {
      this.socket?.close(1000, 'connection replaced')
      return
    }
    if (frame.type === 'channel.event') {
      this.deliverEvent(frame)
      return
    }
    const requestId = stringValue(frame.request_id).trim()
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    if (frame.type === 'error') pending.reject(socketError(frame))
    else if (frame.type !== pending.expectedType) {
      pending.reject(new ArkmePluginError('realtime-protocol-error', '实时服务响应类型不匹配', true, 502))
    } else pending.resolve(frame)
  }

  private deliverEvent(frame: SocketFrame): void {
    const raw = frame.event
    const channelRef = stringValue(raw?.channel_ref ?? frame.channel_ref).trim()
    const sequence = Math.trunc(raw?.seq ?? frame.seq ?? 0)
    const subscription = this.channels.get(channelRef)
    if (subscription === undefined || sequence <= subscription.afterSequence) return
    subscription.afterSequence = sequence
    const event: ArkmeRealtimeChannelEvent = {
      channelRef,
      commandId: stringValue(raw?.command_id),
      sequence,
      senderClientRef: stringValue(raw?.sender_client_ref),
      controllerGeneration: Math.trunc(raw?.controller_generation ?? 0),
      payload: raw?.payload ?? null,
      createdAtMillis: Math.trunc(raw?.created_at ?? 0),
    }
    for (const listener of [...subscription.listeners]) {
      try { listener(event) } catch { /* One plugin listener cannot break the shared socket. */ }
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'channel.ack', channel_ref: channelRef, seq: sequence }))
    }
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return
    this.socket = undefined
    const error = new ArkmePluginError('realtime-disconnected', '实时连接已断开', true, 503)
    this.rejectReady?.(error)
    this.resolveReady = undefined
    this.rejectReady = undefined
    this.ready = undefined
    this.failPending(error)
    if (!this.disposed && !this.suspended && (this.services.size > 0 || this.channels.size > 0)) this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined) return
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt++, 6))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.restore().catch(() => { this.scheduleReconnect() })
    }, delay + Math.floor(Math.random() * Math.min(500, delay / 2)))
  }

  private async restore(): Promise<void> {
    const current = await this.sessionStore.read()
    if (current === undefined || (this.socketUserId !== undefined && current.userId !== this.socketUserId)) {
      this.services.clear()
      this.channels.clear()
      return
    }
    await this.ensureReady()
    for (const [key, lease] of this.services) {
      const namespace = key.split('\u0000')[0]!
      await this.register(namespace, lease.descriptor)
    }
    for (const [channelRef, subscription] of this.channels) {
      await this.request({
        type: 'channel.subscribe', channel_ref: channelRef, after_seq: subscription.afterSequence,
      }, 'channel.subscribed')
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private closeWhenIdle(): void {
    if (this.services.size === 0 && this.channels.size === 0) {
      this.socket?.close(1000, 'realtime idle')
    }
  }
}

export class ArkmeRealtimeService implements ArkmeRealtimeHostService {
  private readonly socket: RealtimeSocketMultiplexer

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
    sessionStore: ArkmeSessionStore,
    options: { profileRef?: string; clientRef?: string } = {},
  ) {
    const baseUrl = runtime.config.realtimeBaseUrl?.trim() ?? ''
    if (baseUrl === '') throw new ArkmePluginError('realtime-service-disabled', '实时服务尚未配置', false, 503)
    this.socket = new RealtimeSocketMultiplexer(
      baseUrl,
      sessionStore,
      options.profileRef ?? `arkme-profile-${randomUUID()}`,
      options.clientRef ?? `arkme-client-${randomUUID()}`,
      runtime.config.requestTimeoutMs,
    )
  }

  forExtension(extensionIdValue: string): ArkmeExtensionRealtimeFacade {
    const extensionId = validateExtensionId(extensionIdValue)
    const facade: ArkmeExtensionRealtimeFacade = {
      provide: async descriptor => await this.socket.provide(extensionId, descriptor),
      invite: async input => await this.invite(extensionId, input),
      enter: async (card, options) => await this.enter(extensionId, card, options),
      subscribe: async (channelRef, listener, options) => await this.socket.subscribe(
        channelRef, listener, options?.afterSequence ?? 0,
      ),
      publish: async (session, payload, options) => await this.socket.publish(
        session.channelRef, session.controllerGeneration, options?.commandId ?? randomUUID(), payload,
      ),
      close: async channelRef => await this.close(channelRef),
    }
    return Object.freeze(facade)
  }

  dispose(): void { this.socket.dispose() }

  authenticationChanged(): void {
    void this.runtime.sessionStore.read().then(session => {
      this.socket.authenticationChanged(session?.userId)
    }).catch(() => { this.socket.suspend() })
  }

  private async invite(extensionId: string, input: ArkmeRealtimeInviteInput): Promise<ArkmeRealtimeInvite> {
    const descriptor = validateDescriptor(input)
    if (!this.socket.hasService(extensionId, descriptor)) {
      throw new ArkmePluginError('realtime-service-offline', '请先注册实时服务再发起邀请', true, 409)
    }
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(input.sourceRef, session.userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('realtime-source-unsupported', '实时邀请只支持私聊或群聊', false, 400)
    }
    const fallbackText = input.fallbackText.trim()
    const participantLimit = Math.trunc(input.participantLimit)
    if (fallbackText === '' || Array.from(fallbackText).length > 240
      || participantLimit < descriptor.participantMin || participantLimit > descriptor.participantMax) {
      throw new ArkmePluginError('realtime-invite-invalid', '实时邀请参数无效', false)
    }
    const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/realtime-invites/send',
      {
        chat_session_uid: source.ownerRef,
        extension_id: extensionId,
        namespace: extensionId,
        service: descriptor.service,
        protocol: descriptor.protocol,
        protocol_major: descriptor.protocolMajor,
        participant_limit: participantLimit,
        ...(input.expiresAtMillis === undefined ? {} : { expires_at: Math.trunc(input.expiresAtMillis) }),
        fallback_text: fallbackText,
        client_mutation_id: input.clientMutationId?.trim() || randomUUID(),
      },
      session,
    )
    const invite = objectValue(data.invite)
    const inviteRef = stringValue(invite.invite_ref).trim()
    const expiresAtMillis = Math.trunc(Number(invite.expires_at ?? 0))
    if (inviteRef === '' || expiresAtMillis <= Date.now()) {
      throw new ArkmePluginError('realtime-invite-contract-invalid', '实时邀请响应不完整', true, 502)
    }
    return {
      inviteRef,
      state: stringValue(data.state).trim() || stringValue(invite.delivery_state).trim(),
      expiresAtMillis,
      participantLimit: Math.trunc(Number(invite.participant_limit ?? participantLimit)),
    }
  }

  private async enter(
    extensionId: string,
    card: ArkmeRealtimeInviteCard,
    options: { allowObserver?: boolean } = {},
  ): Promise<ArkmeRealtimeRoomSession> {
    if (card.schemaVersion !== 1 || card.extensionId !== extensionId || !INSTANCE_REF_PATTERN.test(card.inviteRef)
      || !SERVICE_PATTERN.test(card.service) || !PROTOCOL_PATTERN.test(card.protocol) || card.protocolMajor < 1) {
      throw new ArkmePluginError('realtime-card-invalid', '实时邀请卡片无效', false)
    }
    const session = await this.runtime.requireSession()
    const grantData = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/realtime-invites/join-grant',
      {
        invite_ref: card.inviteRef, extension_id: extensionId, service: card.service,
        protocol: card.protocol, protocol_major: card.protocolMajor,
      },
      session,
    )
    const joinGrant = stringValue(grantData.join_grant).trim()
    if (joinGrant === '') throw new ArkmePluginError('realtime-grant-contract-invalid', '实时加入授权响应不完整', true, 502)
    const accepted = await this.realtimePost<Record<string, unknown>>('/api/v1/realtime/invites/accept', {
      join_grant: joinGrant,
      profile_instance: this.socket.profileRef,
      client_instance: this.socket.clientRef,
      ...(options.allowObserver === true ? { allow_observer: true } : {}),
    }, session)
    const result: ArkmeRealtimeRoomSession = {
      inviteRef: stringValue(accepted.invite_ref).trim(),
      roomRef: stringValue(accepted.room_ref).trim(),
      channelRef: stringValue(accepted.channel_ref).trim(),
      seatRef: stringValue(accepted.seat_ref).trim(),
      controllerGeneration: Math.trunc(Number(accepted.controller_generation ?? 0)),
      state: stringValue(accepted.state).trim(),
    }
    if (result.inviteRef !== card.inviteRef || !INSTANCE_REF_PATTERN.test(result.roomRef)
      || !INSTANCE_REF_PATTERN.test(result.channelRef) || !INSTANCE_REF_PATTERN.test(result.seatRef)
      || result.controllerGeneration < 1) {
      throw new ArkmePluginError('realtime-accept-contract-invalid', '实时房间响应不完整', true, 502)
    }
    return result
  }

  private async close(channelRefValue: string): Promise<{ channelRef: string; state: string; idempotent: boolean }> {
    const channelRef = channelRefValue.trim()
    if (!INSTANCE_REF_PATTERN.test(channelRef)) throw new ArkmePluginError('realtime-channel-invalid', '实时频道无效', false)
    const data = await this.realtimePost<Record<string, unknown>>('/api/v1/realtime/channels/close', {
      channel_ref: channelRef,
    })
    return {
      channelRef: stringValue(data.channel_ref).trim(),
      state: stringValue(data.state).trim(),
      idempotent: data.idempotent === true,
    }
  }

  private async realtimePost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: Awaited<ReturnType<ServiceRuntime['requireSession']>>,
  ): Promise<T> {
    const baseUrl = this.runtime.config.realtimeBaseUrl?.trim() ?? ''
    let session = initialSession ?? await this.runtime.requireSession()
    const request = async (): Promise<T> => await this.runtime.post<T>(
      baseUrl, path, body, session.accessToken, [200], undefined, false,
      { scope: this.runtime.requestScope(session.userId), lane: 'write', service: 'other' }, true, true,
    )
    try {
      return await request()
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) throw error
      session = await this.runtime.refreshAccessToken(session)
      return await request()
    }
  }
}
