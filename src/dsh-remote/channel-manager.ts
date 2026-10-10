import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { asDshRemoteError, DshRemoteError } from './errors.js'
import { dshRemoteRequestIdentity } from './protocol-v1.js'
import { DshRemoteRuntimeSecretBroker } from './runtime-secret-broker.js'
import { DshRemoteFragmentReader, dshRemoteOutboundPayloads } from './transport-fragment.js'
import type {
  DshRemoteRealtimePayload,
  DshRemoteRealtimeTransport,
  DshRemoteResponse,
  DshRemoteRuntimeTarget,
  DshRemoteTrustedEventMetadata,
} from './types.js'

export interface DshRemoteHostChannelManagerOptions {
  accountId: string
  signal?: AbortSignal
  profileRef: string
  hostClientRef: string
  runtimeRef: string
  realtime: DshRemoteRealtimeTransport
  secretBroker: DshRemoteRuntimeSecretBroker
  dispatch: (request: unknown, context: {
    serviceLeaseGeneration: number
    metadata: DshRemoteTrustedEventMetadata
  }) => Promise<DshRemoteResponse>
  onProjectionError: (error: unknown) => void
  onFatal: (error: unknown) => void
  onDiagnostic?: (event: string, fields: Record<string, unknown>) => void
}

function logicalPayloadTooLarge(error: unknown): boolean {
  return error instanceof DshRemoteError && error.details.logicalTooLarge === true
}

/**
 * Owns the single account-scoped Runtime channel. The Host subscribes with
 * generation 0 before registration, then activates the exact positive lease
 * returned by Realtime. No controller identity or pairing state exists here.
 */
export class DshRemoteHostChannelManager {
  private readonly controller = new AbortController()
  private unsubscribe: (() => void) | undefined
  private target: DshRemoteRuntimeTarget
  private lastTransportSequence = 0
  private persistedTransportSequence = 0
  private outboundTail: Promise<void> = Promise.resolve()
  private readonly pendingEvents: Array<{ payload: DshRemoteRealtimePayload; metadata: DshRemoteTrustedEventMetadata }> = []
  private readonly requestFragments = new DshRemoteFragmentReader()
  private closed = false
  private readonly detachParent: () => void

  constructor(private readonly options: DshRemoteHostChannelManagerOptions) {
    const abort = () => { this.controller.abort(); this.unsubscribe?.() }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    this.detachParent = () => { options.signal?.removeEventListener('abort', abort) }
    this.target = {
      runtimeRef: options.runtimeRef,
      hostProfileRef: options.profileRef,
      hostClientRef: options.hostClientRef,
      hostLeaseGeneration: 0,
    }
  }

  async prepare(): Promise<void> {
    this.controller.signal.throwIfAborted()
    if (this.closed || this.unsubscribe !== undefined) throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'Runtime channel 已准备')
    this.lastTransportSequence = await this.options.secretBroker.runtimeCursor({
      accountId: this.options.accountId,
      runtimeRef: this.options.runtimeRef,
      channelRef: this.options.runtimeRef,
    })
    this.controller.signal.throwIfAborted()
    this.persistedTransportSequence = this.lastTransportSequence
    const subscribe = async (afterSequence?: number): Promise<() => void> => await this.options.realtime.subscribe({
      target: this.target,
      ...(afterSequence === undefined ? {} : { afterSequence }),
      onEvent: (payload, metadata) => { this.consume(payload, metadata) },
      signal: this.controller.signal,
    })
    try {
      this.unsubscribe = await subscribe(this.lastTransportSequence)
    } catch (error) {
      if (!(error instanceof DshRemoteError) || error.code !== 'REPLAY_GAP') throw error
      this.diagnostic('wire_replay_gap', { runtime_ref: this.options.runtimeRef, after_seq: this.lastTransportSequence })
      await this.options.secretBroker.putRuntimeCursor({
        accountId: this.options.accountId, runtimeRef: this.options.runtimeRef,
        channelRef: this.options.runtimeRef, lastTransportSequence: 0, reset: true,
      })
      this.lastTransportSequence = this.persistedTransportSequence = 0
      this.controller.signal.throwIfAborted()
      this.unsubscribe = await subscribe()
    }
  }

  activate(serviceLeaseGeneration: number): void {
    this.controller.signal.throwIfAborted()
    if (this.closed || this.unsubscribe === undefined || !Number.isSafeInteger(serviceLeaseGeneration) || serviceLeaseGeneration <= 0) {
      throw new DshRemoteError('HOST_CHANNEL_NOT_READY', 'Runtime channel 尚未完成 Host 注册', true)
    }
    this.target = { ...this.target, hostLeaseGeneration: serviceLeaseGeneration }
    const pending = this.pendingEvents.splice(0)
    queueMicrotask(() => {
      for (const event of pending) {
        if (this.closed || this.controller.signal.aborted) return
        this.consume(event.payload, event.metadata)
      }
    })
  }

  status(): { runtimeRef: string; serviceLeaseGeneration: number; ready: boolean } {
    return {
      runtimeRef: this.options.runtimeRef,
      serviceLeaseGeneration: this.target.hostLeaseGeneration,
      ready: !this.closed && !this.controller.signal.aborted && this.unsubscribe !== undefined && this.target.hostLeaseGeneration > 0,
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.pendingEvents.length = 0
    this.detachParent()
    this.controller.abort()
    if (this.lastTransportSequence > this.persistedTransportSequence) await this.persistCursor().catch(() => undefined)
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  async publishProjectionEvent(envelope: Record<string, unknown>, commandId: string, onTiming?: (timing: { queueMs: number; publishMs: number; completed: boolean }) => void): Promise<void> {
    if (!this.status().ready) return
    await this.publishPayload(envelope, commandId, 'event', onTiming)
  }

  private consume(payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata): void {
    void this.handle(payload, metadata).catch(error => {
      if (this.closed || this.controller.signal.aborted) return
      if (logicalPayloadTooLarge(error)) this.options.onProjectionError(error)
      else this.options.onFatal(error)
    })
  }

  private async handle(payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata): Promise<void> {
    if (this.closed || this.controller.signal.aborted) return
    if (metadata.transportSequence !== undefined && metadata.transportSequence > this.lastTransportSequence) {
      this.lastTransportSequence = metadata.transportSequence
      if (this.lastTransportSequence - this.persistedTransportSequence >= 16) {
        this.persistedTransportSequence = this.lastTransportSequence
        void this.persistCursor().catch(error => { this.options.onFatal(error) })
      }
    }
    // Realtime broadcasts Host responses/events to every subscriber. They are
    // evidence for the controller only and never re-enter the command path.
    if (metadata.senderRole === 'host') return
    if (this.target.hostLeaseGeneration === 0) {
      if (this.pendingEvents.length >= 8) throw new DshRemoteError('HOST_CHANNEL_NOT_READY', 'Host 注册期间收到过多并发请求', true)
      this.pendingEvents.push({ payload, metadata })
      return
    }
    if (payload.protocol === 'dsh.remote-fragment') {
      if (metadata.senderRole !== 'controller' || metadata.runtimeRef !== this.options.runtimeRef || metadata.targetHostLeaseGeneration !== this.target.hostLeaseGeneration) {
        this.diagnostic('wire_fragment_rejected', {
          runtime_ref: this.options.runtimeRef, reason: 'fragment_target_mismatch',
          transport_seq: metadata.transportSequence, target_lease_generation: metadata.targetHostLeaseGeneration,
          lease_generation: this.target.hostLeaseGeneration, transfer_ref: payload.transfer_ref,
        })
        return
      }
      const assembled = this.requestFragments.accept(payload)
      if (!assembled) return
      payload = assembled
    }
    const identity = dshRemoteRequestIdentity(payload)
    // Successful stream polls are high-volume; retain failure diagnostics only.
    const body = 'body' in payload ? payload.body : undefined
    const traceRequest = !(identity?.operation === 'session.native' && body !== null && typeof body === 'object' && 'mode' in body && body.mode === 'pull')
    const startedAt = performance.now()
    const diagnostic = {
      user_id: this.options.accountId, runtime_ref: this.options.runtimeRef,
      request_ref: identity?.requestRef, operation: identity?.operation,
      lease_generation: this.target.hostLeaseGeneration, transport_seq: metadata.transportSequence,
    }
    if (traceRequest) this.diagnostic('host_request_received', diagnostic)
    let result: DshRemoteResponse
    try {
      // The Host owns correlated request and lease rejections. A stale
      // Controller must not restart the shared Host connection.
      result = await this.options.dispatch(payload, {
        serviceLeaseGeneration: this.target.hostLeaseGeneration,
        metadata,
      })
    } catch (error) {
      this.diagnostic('host_request_failed', { ...diagnostic, error_code: asDshRemoteError(error).code, duration_ms: Math.round(performance.now() - startedAt) })
      if (error instanceof DshRemoteError) return
      throw error
    }
    if (traceRequest || result.status === 'rejected') this.diagnostic('host_request_processed', {
      ...diagnostic, status: result.status, error_code: result.error?.code,
      duration_ms: Math.round(performance.now() - startedAt),
    })
    // Each request delivery needs a reply, including a ledger duplicate. Reuse
    // this ID only while retrying the same publish, not across later replies.
    const responseCommandId = `response_${randomUUID()}`
    try {
      let published = false
      await this.publishPayload(result, responseCommandId, 'response', timing => {
        published = timing.completed
        if (traceRequest || !timing.completed) this.diagnostic('host_response_publish_finished', {
          ...diagnostic, completed: timing.completed,
          queue_ms: Math.round(timing.queueMs), publish_ack_ms: Math.round(timing.publishMs),
        })
      })
      if (!published) this.diagnostic('host_response_publish_failed', { ...diagnostic, error_code: 'HOST_CHANNEL_NOT_READY', retryable: true })
    } catch (error) {
      this.diagnostic('host_response_publish_failed', { ...diagnostic, error_code: asDshRemoteError(error).code, retryable: asDshRemoteError(error).retryable })
      throw error
    }
  }

  private diagnostic(event: string, fields: Record<string, unknown>): void {
    try { this.options.onDiagnostic?.(event, fields) } catch { /* Diagnostics must not affect command delivery. */ }
  }

  private async publishPayload(
    envelope: unknown,
    commandId: string,
    direction: 'event' | 'response',
    onTiming?: (timing: { queueMs: number; publishMs: number; completed: boolean }) => void,
  ): Promise<void> {
    const queuedAt = performance.now()
    const publish = async (): Promise<void> => {
      const startedAt = performance.now()
      let completed = false
      try {
        const frames = dshRemoteOutboundPayloads(envelope, commandId)
        for (const frame of frames) {
          if (!this.status().ready) return
          const frameCommandId = frame.commandId ?? commandId
          for (let attempt = 0; ; attempt += 1) {
            try {
              await this.options.realtime.publish({
                target: this.target,
                commandId: frameCommandId,
                direction,
                payload: frame.value as Record<string, unknown>,
                signal: this.controller.signal,
              })
              break
            } catch (error) {
              const remote = asDshRemoteError(error)
              if (!remote.retryable || attempt >= 2 || this.controller.signal.aborted) throw error
              await delay(100 * (2 ** attempt), undefined, { signal: this.controller.signal })
            }
          }
        }
        completed = true
      } finally {
        try { onTiming?.({ queueMs: startedAt - queuedAt, publishMs: performance.now() - startedAt, completed }) }
        catch { /* Timing cannot affect delivery. */ }
      }
    }
    const result = this.outboundTail.then(publish)
    this.outboundTail = result.catch(() => undefined)
    await result
  }

  private async persistCursor(): Promise<void> {
    await this.options.secretBroker.putRuntimeCursor({
      accountId: this.options.accountId,
      runtimeRef: this.options.runtimeRef,
      channelRef: this.options.runtimeRef,
      lastTransportSequence: this.lastTransportSequence,
    })
  }
}
