import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { asDshRemoteError, DshRemoteError } from './errors.js'
import { DshRemoteRuntimeSecretBroker } from './runtime-secret-broker.js'
import { dshRemoteOutboundPayloads } from './transport-fragment.js'
import type {
  DshRemoteRealtimePayload,
  DshRemoteRealtimeTransport,
  DshRemoteResponse,
  DshRemoteRuntimeTarget,
  DshRemoteTrustedEventMetadata,
} from './types.js'

export interface DshRemoteHostChannelManagerOptions {
  accountId: string
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
  private closed = false

  constructor(private readonly options: DshRemoteHostChannelManagerOptions) {
    this.target = {
      runtimeRef: options.runtimeRef,
      hostProfileRef: options.profileRef,
      hostClientRef: options.hostClientRef,
      hostLeaseGeneration: 0,
    }
  }

  async prepare(): Promise<void> {
    if (this.closed || this.unsubscribe !== undefined) throw new DshRemoteError('REMOTE_REQUEST_INVALID', 'Runtime channel 已准备')
    this.lastTransportSequence = await this.options.secretBroker.runtimeCursor({
      accountId: this.options.accountId,
      runtimeRef: this.options.runtimeRef,
      channelRef: this.options.runtimeRef,
    })
    this.persistedTransportSequence = this.lastTransportSequence
    const subscribe = async (afterSequence?: number): Promise<() => void> => await this.options.realtime.subscribe({
      target: this.target,
      ...(afterSequence === undefined ? {} : { afterSequence }),
      onEvent: (payload, metadata) => {
        void this.handle(payload, metadata).catch(error => {
          if (logicalPayloadTooLarge(error)) this.options.onProjectionError(error)
          else this.options.onFatal(error)
        })
      },
      signal: this.controller.signal,
    })
    try {
      this.unsubscribe = await subscribe(this.lastTransportSequence)
    } catch (error) {
      if (!(error instanceof DshRemoteError) || error.code !== 'REPLAY_GAP') throw error
      this.unsubscribe = await subscribe()
    }
  }

  async activate(serviceLeaseGeneration: number): Promise<void> {
    if (this.closed || this.unsubscribe === undefined || !Number.isSafeInteger(serviceLeaseGeneration) || serviceLeaseGeneration <= 0) {
      throw new DshRemoteError('HOST_CHANNEL_NOT_READY', 'Runtime channel 尚未完成 Host 注册', true)
    }
    this.target = { ...this.target, hostLeaseGeneration: serviceLeaseGeneration }
    for (const event of this.pendingEvents.splice(0)) await this.handle(event.payload, event.metadata)
  }

  status(): { runtimeRef: string; serviceLeaseGeneration: number; ready: boolean } {
    return {
      runtimeRef: this.options.runtimeRef,
      serviceLeaseGeneration: this.target.hostLeaseGeneration,
      ready: !this.closed && this.unsubscribe !== undefined && this.target.hostLeaseGeneration > 0,
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.lastTransportSequence > this.persistedTransportSequence) await this.persistCursor().catch(() => undefined)
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.controller.abort()
  }

  async publishProjectionEvent(envelope: Record<string, unknown>, commandId: string): Promise<void> {
    if (!this.status().ready) return
    await this.publishPayload(envelope, commandId, 'event')
  }

  private async handle(payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata): Promise<void> {
    if (this.closed) return
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
    let result: DshRemoteResponse
    try {
      // The Host owns correlated request and lease rejections. A stale
      // Controller must not restart the shared Host connection.
      result = await this.options.dispatch(payload, {
        serviceLeaseGeneration: this.target.hostLeaseGeneration,
        metadata,
      })
    } catch (error) {
      if (error instanceof DshRemoteError) return
      throw error
    }
    const responseCommandId = `response_${createHash('sha256').update(result.request_ref).digest('base64url')}`
    await this.publishPayload(result, responseCommandId, 'response')
  }

  private async publishPayload(
    envelope: unknown,
    commandId: string,
    direction: 'event' | 'response',
  ): Promise<void> {
    const publish = async (): Promise<void> => {
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
