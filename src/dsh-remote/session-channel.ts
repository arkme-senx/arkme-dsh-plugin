import { createHash, randomUUID } from 'node:crypto'
import { parseDshDirectoryDelta, type DshDirectoryDelta } from './account-session-directory.js'
import { setTimeout as delay } from 'node:timers/promises'
import { DshRemoteError, asDshRemoteError } from './errors.js'
import { nativeRecord } from './native-transport.js'
import { parseDshRemoteRequest } from './protocol-v1.js'
import { DshRemoteFragmentReader, dshRemoteOutboundPayloads } from './transport-fragment.js'
import { DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES, type DshRemotePublishTiming, type DshRemoteRealtimeTransport, type DshRemoteRuntimeTarget, type DshRemoteTrustedEventMetadata, type DshRemoteRequest, type DshRemoteResponse } from './types.js'

type Json = Record<string, unknown>
type Address = { runtimeRef: string; sessionRef: string }
type Request = Address & { kind: 'session.request'; requestRef: string; expiresAt: number; body: Json; sharedFollowResponses?: true }
const validRef = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
const key = (address: Address) => JSON.stringify([address.runtimeRef, address.sessionRef])

/** Reuse the existing fragmentation and authenticated WebSocket, with no owner lookup. */
type PublishTiming = { payload_bytes: number; fragment_count: number; frame_ack_max_ms: number; publish_ack_ms: number; completed: boolean }
async function publish(transport: DshRemoteRealtimeTransport, target: DshRemoteRuntimeTarget, payload: Json, signal: AbortSignal, onTiming?: (timing: PublishTiming) => void, readSessionRef?: string): Promise<void> {
  const id = randomUUID()
  const frames = dshRemoteOutboundPayloads(payload, id)
  const envelope = nativeRecord(payload.envelope ?? {})
  // Typed mobile consumers advance the account cursor but need not assemble
  // desktop-native replies. Older consumers ignore this optional routing hint.
  if (payload.kind === 'session.response' && typeof payload.requestRef === 'string' && !payload.envelope && ('value' in payload || 'error' in payload)) {
    for (const frame of frames) if (frame.fragmentIndex !== undefined) frame.value = { ...nativeRecord(frame.value), nativeResponse: true }
  }
  // The existing reply fragments also identify their read. Peers retain the
  // pending request for failover, but need not repeat an in-flight large reply.
  const readResponse = frames.length > 1 && payload.kind === 'session.response' && envelope.kind === 'response' && envelope.operation === 'session.history' && validRef(readSessionRef)
    ? { runtimeRef: payload.runtimeRef, requestRef: envelope.request_ref, sessionRef: readSessionRef, operation: envelope.operation } : undefined
  if (readResponse) for (const frame of frames) frame.value = { ...nativeRecord(frame.value), readResponse }
  const started = performance.now()
  let maximumAck = 0, completed = false
  try {
    for (let offset = 0; offset < frames.length; offset += 8) await Promise.all(frames.slice(offset, offset + 8).map(async frame => {
      const frameStarted = performance.now()
      try { await transport.publish({
        target: { ...target, sessionChannel: true }, commandId: frame.commandId ?? id,
        direction: payload.kind === 'session.response' ? 'event' : 'request', payload: frame.value as Json, signal,
      }) } finally { maximumAck = Math.max(maximumAck, performance.now() - frameStarted) }
    }))
    completed = true
  } catch (error) {
    if (readResponse && !signal.aborted) {
      // A live producer can fail a partial publication without losing its lease.
      // Release only this read's existing standby; a dead producer is handled
      // by the ordinary authenticated service-offline event instead.
      try { await transport.publish({ target: { ...target, sessionChannel: true }, commandId: randomUUID(), direction: 'event', signal,
        payload: { kind: 'session.response', readResponseFailed: { ...readResponse, transferRef: nativeRecord(frames[0]!.value).transfer_ref } } }) }
      catch { /* No proven delivery: keep the original bounded request deadline. */ }
    }
    throw error
  } finally {
    try {
      const payloadBytes = frames.length > 1 ? Number((frames[0]!.value as Json).payload_bytes)
        : onTiming ? Buffer.byteLength(JSON.stringify(payload)) : 0
      onTiming?.({ payload_bytes: payloadBytes, fragment_count: frames.length,
        frame_ack_max_ms: Math.round(maximumAck), publish_ack_ms: Math.round(performance.now() - started), completed })
    }
    catch { /* Diagnostics cannot affect delivery. */ }
  }
}

/** One bounded producer per native subscription. Peers see requests, only the writer executes. */
export class DshSessionChannelHost {
  private readonly lifetime = new AbortController()
  private readonly streams = new Map<string, { request: Request; epoch: number; touched: number; controller: AbortController }>()
  private readonly followReplies = new Map<string, { payload: Json; streamRefs: string[]; bytes: number; done: Promise<void>; resolve(): void; reject(error: unknown): void }>()
  private followReplyBytes = 0
  private readonly pending = new Map<string, Request>()
  private readonly running = new Set<string>()
  private readonly commands = new Map<string, { runtimeRef: string; envelope: DshRemoteRequest;
    publisher?: { runtimeRef: string; leaseGeneration: number; transferRef: string; inactive?: boolean } }>()
  private readonly reader = new DshRemoteFragmentReader(128)
  private activated = false
  private readonly advertisedEpochs = new Map<string, number>()
  private directoryProjection: string | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private unsubscribe: (() => void) | undefined
  constructor(private readonly options: {
    transport: DshRemoteRealtimeTransport; target: DshRemoteRuntimeTarget
    epoch: (runtimeRef: string, sessionRef: string) => number | undefined
    recover?: (runtimeRef: string, sessionRef: string, body: Json, signal: AbortSignal) => Promise<void>
    native: (runtimeRef: string, sessionRef: string, body: Json, signal: AbortSignal) => Promise<unknown>
    call?: (request: Request, signal: AbortSignal) => Promise<unknown>
    command?: (runtimeRef: string, envelope: DshRemoteRequest, signal: AbortSignal) => Promise<DshRemoteResponse>
    canonicalRuntime?: (sessionRef: string) => string | undefined
    failed: (error: unknown) => void
    onDiagnostic?: (event: string, fields: Json) => void
  }) {}

  async start(): Promise<void> {
    this.unsubscribe = await this.options.transport.subscribe({ target: { ...this.options.target, sessionChannel: true },
      signal: this.lifetime.signal, onEvent: (raw, metadata) => {
        try {
          if (raw.readResponse !== undefined && metadata.senderRole !== 'host') return
          const value = this.reader.accept(raw, metadata.senderRole === 'host' ? { runtimeRef: metadata.runtimeRef, leaseGeneration: metadata.targetHostLeaseGeneration } : undefined)
          if (metadata.senderRole === 'host' && raw.kind === 'fragment' && raw.fragment_index === 0 && raw.readResponse) {
            const reply = nativeRecord(raw.readResponse)
            const queued = this.commands.get(JSON.stringify([reply.runtimeRef, reply.requestRef]))
            if (reply.operation === 'session.history' && queued?.envelope.operation === reply.operation && queued.envelope.body.session_ref === reply.sessionRef
              && validRef(metadata.runtimeRef) && Number.isSafeInteger(metadata.targetHostLeaseGeneration) && metadata.targetHostLeaseGeneration > 0) {
              const previous = queued.publisher
              if ((!previous || previous.inactive || !this.reader.hasTransfer(previous.transferRef))
                && (previous?.runtimeRef !== metadata.runtimeRef || previous.leaseGeneration !== metadata.targetHostLeaseGeneration)) {
                queued.publisher = { runtimeRef: metadata.runtimeRef, leaseGeneration: metadata.targetHostLeaseGeneration, transferRef: String(raw.transfer_ref) }
              }
            }
          }
          if (value) this.receive(value, metadata)
        }
        catch {
          // A rejected partial transfer cannot reserve this read indefinitely.
          for (const queued of this.commands.values()) {
            const publisher = queued.publisher
            if (publisher && publisher.transferRef === raw.transfer_ref) publisher.inactive = true
          }
        }
      } })
    this.timer = setInterval(() => this.tick(), 100); this.timer.unref()
  }
  activate(generation: number): void {
    this.options.target.hostLeaseGeneration = generation; this.tick()
    if (generation <= 0) {
      for (const stream of this.streams.values()) stream.controller.abort()
      return
    }
    if (this.activated) return
    this.activated = true
    void this.publish({ kind: 'session.response', runtimeRef: this.options.target.runtimeRef, ready: true }, this.lifetime.signal).catch(error => { if (!this.lifetime.signal.aborted) this.options.failed(error) })
  }
  async directoryChanged(sessionRefs: readonly string[] = [], projection?: string, directoryDelta?: DshDirectoryDelta, partial = false): Promise<void> {
    if (this.options.target.hostLeaseGeneration <= 0) return
    const nextEpochs = new Map<string, number>()
    let changed = false
    for (const sessionRef of sessionRefs) {
      const runtimeRef = this.options.canonicalRuntime?.(sessionRef) ?? this.options.target.runtimeRef
      const epoch = this.options.epoch(runtimeRef, sessionRef)
      if (!epoch || epoch < 0) continue
      nextEpochs.set(sessionRef, epoch)
      if (this.advertisedEpochs.get(sessionRef) === epoch) continue
      changed = true
    }
    if (projection !== undefined && projection === this.directoryProjection && !changed &&
        (partial || [...this.advertisedEpochs.keys()].every(id => nextEpochs.has(id)))) return
    await this.publish({ kind: 'session.response', directoryChanged: true,
      ...(directoryDelta === undefined ? {} : { directoryDelta }) }, this.lifetime.signal)
    // The catalog is committed already. Readers can load/select it while
    // existing observers receive their independent execution-change notices.
    for (const [sessionRef, epoch] of nextEpochs) {
      if (this.advertisedEpochs.get(sessionRef) === epoch) continue
      const runtimeRef = this.options.canonicalRuntime?.(sessionRef) ?? this.options.target.runtimeRef
      await this.publish({ kind: 'session.response', ready: true, runtimeRef, sessionRef, epoch }, this.lifetime.signal)
    }
    // Commit notification state only after delivery. A failed invalidation must
    // remain eligible on the next ordinary authoritative sync.
    this.directoryProjection = projection
    if (!partial || this.advertisedEpochs.size + nextEpochs.size > 10_000) this.advertisedEpochs.clear()
    for (const [id, epoch] of nextEpochs) this.advertisedEpochs.set(id, epoch)
  }
  async projection(envelope: Json, onTiming?: (timing: DshRemotePublishTiming) => void): Promise<void> {
    if (!this.options.command || this.options.target.hostLeaseGeneration <= 0) return
    const body = nativeRecord(envelope.body ?? {})
    const runtimeRef = typeof body.session_ref === 'string'
      ? this.options.canonicalRuntime?.(body.session_ref) ?? this.options.target.runtimeRef : this.options.target.runtimeRef
    await this.publish({ kind: 'session.response', runtimeRef, envelope }, this.lifetime.signal, undefined, onTiming)
  }
  private diagnostic(event: string, fields: Json): void {
    try { this.options.onDiagnostic?.(event, { runtime_ref: this.options.target.runtimeRef, stage: 'sessions_v1', ...fields }) }
    catch { /* Diagnostics cannot affect delivery. */ }
  }
  private publish(payload: Json, signal: AbortSignal, readSessionRef?: string, onTiming?: (timing: DshRemotePublishTiming) => void): Promise<void> {
    const envelope = nativeRecord(payload.envelope ?? {})
    return publish(this.options.transport, this.options.target, payload, signal, timing => {
      // Stable publication has no extra Host lane; transport admission is
      // included in the measured publish/ACK duration.
      onTiming?.({ queueMs: 0, publishMs: timing.publish_ack_ms, completed: timing.completed })
      // Preserve one summary per typed delivery; high-frequency native carrier
      // frames only need an incident row when large, slow, or unsuccessful.
      if (envelope.operation === undefined && timing.fragment_count <= 2 && timing.publish_ack_ms < 5000 && timing.completed) return
      this.diagnostic('host_response_publish_finished', { request_ref: envelope.request_ref ?? payload.requestRef,
        operation: envelope.operation ?? 'session.native', ...timing })
    }, readSessionRef)
  }
  close(): void {
    this.lifetime.abort(); clearInterval(this.timer); this.unsubscribe?.()
    for (const stream of this.streams.values()) stream.controller.abort()
    this.streams.clear(); this.pending.clear(); this.commands.clear()
  }
  private receive(value: Json, metadata: DshRemoteTrustedEventMetadata): void {
    if (metadata.senderRole === 'host' && value.kind === 'session.response' && value.readResponseFailed) {
      const reply = nativeRecord(value.readResponseFailed)
      this.reader.releaseReadResponse(reply, { runtimeRef: metadata.runtimeRef, leaseGeneration: metadata.targetHostLeaseGeneration })
      const queued = this.commands.get(JSON.stringify([reply.runtimeRef, reply.requestRef])), publisher = queued?.publisher
      if (queued?.envelope.operation === 'session.history' && reply.operation === queued.envelope.operation && reply.sessionRef === queued.envelope.body.session_ref
        && publisher?.runtimeRef === metadata.runtimeRef && publisher.leaseGeneration === metadata.targetHostLeaseGeneration
        && publisher.transferRef === reply.transferRef) publisher.inactive = true
      this.tick(); return
    }
    if (metadata.senderRole === 'service' && value.kind === 'session.presence' && value.runtimeRef === metadata.runtimeRef
      && Number.isSafeInteger(value.leaseGeneration) && typeof value.online === 'boolean') {
      this.reader.releaseProducer(metadata.runtimeRef, Number(value.leaseGeneration), value.online)
      for (const queued of this.commands.values()) {
        const publisher = queued.publisher
        if (publisher?.runtimeRef === metadata.runtimeRef && (Number(value.leaseGeneration) > publisher.leaseGeneration
          || value.online === false && value.leaseGeneration === publisher.leaseGeneration)) publisher.inactive = true
      }
      this.tick(); return
    }
    if (metadata.senderRole === 'host' && value.kind === 'session.response' && value.envelope) {
      const reply = nativeRecord(value.envelope)
      const id = JSON.stringify([value.runtimeRef, reply.request_ref])
      const queued = this.commands.get(id)
      if (queued && queued.runtimeRef === value.runtimeRef && queued.envelope.operation === reply.operation) this.commands.delete(id)
      return
    }
    if (metadata.senderRole === 'host' && value.kind === 'session.response' && validRef(value.requestRef)) {
      if (this.pending.get(value.requestRef)?.body.mode !== 'pull') this.pending.delete(value.requestRef)
      return
    }
    if (metadata.senderRole !== 'controller') return
    if (value.kind === 'session.command' && this.options.command && validRef(value.runtimeRef)) {
      // Validate the complete legacy operation/schema, but generation is not a
      // routing credential on the authenticated stable account channel.
      const raw = nativeRecord(value.envelope)
      const envelope = parseDshRemoteRequest(raw, { expectedHostGeneration: Number(raw.host_generation), nowMillis: Date.now() })
      if (envelope.operation === 'session.native') return // Native has its existing carrier.
      const session = envelope.body.session_ref
      if (typeof session === 'string' ? this.options.epoch(value.runtimeRef, session) === undefined : value.runtimeRef !== this.options.target.runtimeRef) return
      const id = JSON.stringify([value.runtimeRef, envelope.request_ref])
      if (this.running.has(id) || this.commands.has(id)) return
      if (!this.commands.has(id) && this.commands.size + this.pending.size + this.running.size >= 128) return
      this.diagnostic('host_request_received', { request_ref: envelope.request_ref, operation: envelope.operation, transport_seq: metadata.transportSequence })
      this.commands.set(id, { runtimeRef: value.runtimeRef, envelope })
      if (envelope.operation === 'session.history' && typeof session === 'string') {
        this.recoverOpening(id, { runtimeRef: value.runtimeRef, sessionRef: session }, { ...envelope.body, operation: envelope.operation }, envelope.execute_before, () => { this.commands.delete(id) })
      }
      this.tick(); return
    }
    if (value.kind === 'session.keepalive' && Array.isArray(value.streams) && value.streams.length <= 64) {
      const ids = new Set(value.streams)
      for (const [id, stream] of this.streams) if (ids.has(id)) stream.touched = Date.now()
      for (const request of this.pending.values()) if (request.body.mode === 'pull' && ids.has(request.body.streamRef)) request.expiresAt = Date.now() + 45_000
      return
    }
    if (value.kind !== 'session.request' || !validRef(value.runtimeRef) || !validRef(value.sessionRef) || !validRef(value.requestRef)
      || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= Date.now() || Number(value.expiresAt) > Date.now() + 5 * 60_000) return
    const request = value as Request
    // Native endpoint/schema validation remains shared with the legacy transport.
    parseDshRemoteRequest({ protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: request.requestRef,
      host_generation: 1, issued_at: Date.now(), execute_before: request.expiresAt, operation: 'session.native', body: request.body },
    { expectedHostGeneration: 1, nowMillis: Date.now() })
    if (request.body.mode === 'close') {
      for (const [id, pending] of this.pending) if (pending.body.streamRef === request.body.streamRef && key(pending) === key(request)) this.pending.delete(id)
      const stream = this.streams.get(String(request.body.streamRef))
      if (stream && key(stream.request) === key(request)) { this.streams.delete(String(request.body.streamRef)); stream.controller.abort() }
      return
    }
    const execution = this.options.epoch(request.runtimeRef, request.sessionRef)
    const queuedPrompt = request.body.mode === 'call' && request.body.endpoint === 'session/prompt'
      && nativeRecord(nativeRecord(nativeRecord(request.body.payload).args).request).mode === 'queue'
    if (execution === undefined || execution < 0 && request.body.mode !== 'pull' && !queuedPrompt || this.pending.has(request.requestRef) || this.running.has(request.requestRef)) return
    if (this.pending.size + this.running.size >= 128) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话请求积压超限')
    this.diagnostic('host_request_received', { request_ref: request.requestRef, operation: 'session.native', transport_seq: metadata.transportSequence })
    this.pending.set(request.requestRef, request)
    if (request.body.mode === 'pull' && request.body.endpoint === 'session/follow' || queuedPrompt) {
      this.recoverOpening(request.requestRef, request, request.body, request.expiresAt, () => { this.pending.delete(request.requestRef) })
    }
    this.tick()
  }
  private recoverOpening(id: string, address: Address, body: Json, expiresAt: number, failed: () => void): void {
    if (!this.options.recover || (this.options.epoch(address.runtimeRef, address.sessionRef) ?? 1) > 0) return
    // Recover once for this actual opening, not on the periodic producer
    // tick. The local owner checks the peer and the original DSH writer fence.
    this.running.add(id)
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(Math.max(1, expiresAt - Date.now()))])
    void this.options.recover(address.runtimeRef, address.sessionRef, body, signal)
      .catch(error => { failed(); if (!this.lifetime.signal.aborted) this.options.failed(error) })
      .finally(() => { this.running.delete(id); this.tick() })
  }
  private tick(): void {
    if (this.lifetime.signal.aborted || this.options.target.hostLeaseGeneration <= 0) return
    for (const [id, command] of this.commands) {
      if (command.envelope.execute_before <= Date.now()) { this.commands.delete(id); continue }
      if (this.running.has(id)) continue
      if (command.publisher && !command.publisher.inactive && this.reader.hasTransfer(command.publisher.transferRef)) continue
      const session = command.envelope.body.session_ref
      if (typeof session === 'string' && (this.options.epoch(command.runtimeRef, session) ?? -1) <= 0) continue
      this.commands.delete(id); this.running.add(id)
      const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(Math.max(1, command.envelope.execute_before - Date.now()))])
      const started = performance.now()
      void this.options.command!(command.runtimeRef, command.envelope, signal)
        .then(envelope => {
          this.diagnostic('host_request_processed', { request_ref: envelope.request_ref, operation: envelope.operation,
            status: envelope.status, error_code: envelope.error?.code, duration_ms: Math.round(performance.now() - started) })
          return this.options.target.hostLeaseGeneration > 0
            ? this.publish({ kind: 'session.response', runtimeRef: command.runtimeRef, envelope }, this.lifetime.signal, typeof session === 'string' ? session : undefined) : undefined
        })
        .catch(error => { if (!this.lifetime.signal.aborted) this.options.failed(error) })
        .finally(() => this.running.delete(id))
    }
    for (const stream of this.streams.values()) if (Date.now() - stream.touched > 45_000 || this.options.epoch(stream.request.runtimeRef, stream.request.sessionRef) !== stream.epoch) stream.controller.abort()
    for (const [id, request] of this.pending) {
      if (request.expiresAt <= Date.now()) { this.pending.delete(id); continue }
      if (this.running.has(id)) continue
      const epoch = this.options.epoch(request.runtimeRef, request.sessionRef)
      if (epoch === undefined || epoch <= 0) {
        if (epoch !== undefined && epoch < 0 && request.body.mode !== 'pull') this.pending.delete(id)
        continue
      }
      if (request.body.mode !== 'pull') this.pending.delete(id)
      this.running.add(id)
      void this.execute(request, epoch).catch(error => { if (!this.lifetime.signal.aborted) this.options.failed(error) }).finally(() => this.running.delete(id))
    }
  }
  private async respond(request: Request, epoch: number, value: unknown, error?: unknown): Promise<void> {
    if (this.options.target.hostLeaseGeneration <= 0) return
    const remote = error === undefined ? undefined : asDshRemoteError(error)
    const payload = { kind: 'session.response', runtimeRef: request.runtimeRef,
      sessionRef: request.sessionRef, requestRef: request.requestRef, ...(request.body.mode === 'pull' ? { streamRef: request.body.streamRef } : {}),
      epoch, ...(remote ? { error: { code: remote.code, message: remote.message, retryable: error instanceof DshRemoteError && remote.retryable } } : { value }) }
    if (request.sharedFollowResponses && request.body.mode === 'pull' && request.body.endpoint === 'session/follow' && !remote) {
      // Share bytes only, not native stream ownership. Exact same read result,
      // address and epoch can serve opt-in readers in this microtask batch.
      const encoded = JSON.stringify([request.runtimeRef, request.sessionRef, epoch, value])
      const bytes = Buffer.byteLength(encoded)
      const hash = createHash('sha256').update(encoded).digest('hex')
      const existing = this.followReplies.get(hash)
      if (existing && existing.streamRefs.length < 64 && !existing.streamRefs.includes(String(request.body.streamRef))) {
        existing.streamRefs.push(String(request.body.streamRef)); return existing.done
      }
      if (!existing && this.followReplies.size < 64 && this.followReplyBytes + bytes <= DSH_REMOTE_MAX_FRAGMENTED_PAYLOAD_BYTES - 32 * 1024) {
        const completion = Promise.withResolvers<void>()
        const first = this.followReplies.size === 0
        this.followReplies.set(hash, { payload, streamRefs: [String(request.body.streamRef)], bytes, done: completion.promise, resolve: completion.resolve, reject: completion.reject })
        this.followReplyBytes += bytes
        if (first) queueMicrotask(() => {
          const replies = [...this.followReplies.values()]
          this.followReplies.clear(); this.followReplyBytes = 0
          for (const reply of replies) {
            if (this.lifetime.signal.aborted) { reply.reject(this.lifetime.signal.reason); continue }
            if (this.options.epoch(String(reply.payload.runtimeRef), String(reply.payload.sessionRef)) !== reply.payload.epoch) {
              reply.reject(new DshRemoteError('SESSION_STATE_CHANGED', '会话执行权已改变', true)); continue
            }
            const { streamRef: _stream, ...common } = reply.payload
            const response = reply.streamRefs.length === 1 ? reply.payload : { ...common, streamRefs: reply.streamRefs }
            void this.publish(response, this.lifetime.signal).then(reply.resolve, reply.reject)
          }
        })
        return completion.promise
      }
    }
    await this.publish(payload, this.lifetime.signal)
  }
  private async execute(request: Request, epoch: number): Promise<void> {
    const body = request.body
    if (body.mode !== 'pull') {
      let value: unknown
      try {
        const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(Math.max(1, request.expiresAt - Date.now()))])
        value = await (this.options.call ? this.options.call(request, signal) : this.options.native(request.runtimeRef, request.sessionRef, body, signal))
      }
      catch (error) { await this.respond(request, epoch, undefined, error); return }
      // A lost publish ACK does not change an already-completed execution into
      // a failure. Let the existing transport failure owner observe it.
      await this.respond(request, epoch, value)
      return
    }
    const id = String(body.streamRef)
    if (this.streams.has(id)) return
    if (this.streams.size >= 64) { await this.respond(request, epoch, undefined, new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话订阅数量超限')); return }
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    const stream = { request, epoch, controller, touched: Date.now() }; this.streams.set(id, stream)
    try {
      let opening = true
      while (!signal.aborted) {
        const started = performance.now()
        const result = nativeRecord(await this.options.native(request.runtimeRef, request.sessionRef, opening ? body : { mode: 'pull', streamRef: id }, signal))
        if (opening) this.diagnostic('host_request_processed', { request_ref: request.requestRef, operation: 'session.native', duration_ms: Math.round(performance.now() - started) })
        opening = false
        await this.respond(request, epoch, result)
        if (result.done) return
        // At most 25 batches/sec per producer; preserve native frames verbatim.
        await delay(40, undefined, { signal })
      }
    } catch (error) {
      this.diagnostic('host_request_failed', { request_ref: request.requestRef, operation: 'session.native', error_code: asDshRemoteError(error).code })
      if (!this.lifetime.signal.aborted && this.streams.get(id) === stream) {
        if (this.options.epoch(request.runtimeRef, request.sessionRef) !== epoch) return
        if (controller.signal.aborted) await this.respond(request, epoch, { items: [], done: true })
        else await this.respond(request, epoch, undefined, error)
      }
    } finally {
      if (this.streams.get(id) === stream) this.streams.delete(id)
      if (this.options.epoch(request.runtimeRef, request.sessionRef) === epoch) this.pending.delete(request.requestRef)
      controller.abort()
    }
  }
}

type Inbox = Address & { opened?: boolean; ended?: boolean; reopening?: ReturnType<typeof setTimeout>; opening: Request; queue: Json[]; bytes: number; wake?: () => void; failure?: unknown; touched: number; epoch: number; busy: boolean }
export class DshSessionChannelClient {
  private readonly lifetime = new AbortController()
  private readonly streams = new Map<string, Inbox>()
  private readonly calls = new Map<string, { address: Address; operation?: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  private reader = new DshRemoteFragmentReader(128)
  private readonly target: DshRemoteRuntimeTarget = { sessionChannel: true, runtimeRef: 'sessions_v1', hostProfileRef: 'session-observer', hostClientRef: 'session-observer', hostLeaseGeneration: 0 }
  private readonly directoryListeners = new Set<(delta?: DshDirectoryDelta) => void>()
  private readonly observers = new Map<string, Set<() => void>>()
  private bufferedBytes = 0
  private lastSequence = 0
  private readonly ready: Promise<void>
  private readonly heartbeat: ReturnType<typeof setInterval>
  constructor(private readonly transport: DshRemoteRealtimeTransport, connected: (signal: AbortSignal) => Promise<void>, private readonly disconnected: () => void, private readonly executorReady?: (address: Address) => void) {
    const stop = transport.subscribeDisconnect(error => this.fail(error))
    this.lifetime.signal.addEventListener('abort', stop, { once: true })
    this.ready = (async () => {
      await connected(this.lifetime.signal)
      await transport.subscribe({ target: this.target, signal: this.lifetime.signal, onError: error => this.recover(error), onEvent: (raw, metadata) => {
        if (metadata.transportSequence !== undefined) {
          if (metadata.transportSequence <= this.lastSequence) return
          if (this.lastSequence && metadata.transportSequence !== this.lastSequence + 1) this.recover(new DshRemoteError('REPLAY_GAP', '会话增量缺失，恢复原生历史', true))
          this.lastSequence = metadata.transportSequence
        }
        if (metadata.senderRole === 'service' && raw.kind === 'session.presence') {
          if (raw.runtimeRef === metadata.runtimeRef && Number.isSafeInteger(raw.leaseGeneration) && typeof raw.online === 'boolean') {
            this.reader.releaseProducer(metadata.runtimeRef, Number(raw.leaseGeneration), raw.online)
          }
          for (const changed of this.directoryListeners) changed()
          return
        }
        if (metadata.senderRole !== 'host') return
        try {
          const value = this.reader.accept(raw, { runtimeRef: metadata.runtimeRef, leaseGeneration: metadata.targetHostLeaseGeneration })
          if (value?.kind === 'session.response' && value.readResponseFailed) this.reader.releaseReadResponse(nativeRecord(value.readResponseFailed), { runtimeRef: metadata.runtimeRef, leaseGeneration: metadata.targetHostLeaseGeneration })
          if (value) this.receive(value)
        } catch (error) { this.recover(error, typeof raw.runtimeRef === 'string' && typeof raw.sessionRef === 'string' ? raw as Address : undefined) }
      } })
    })().catch(error => { this.fail(error); throw error })
    void this.ready.catch(() => undefined)
    this.heartbeat = setInterval(() => {
      for (const [id, stream] of this.streams) if (Date.now() - stream.touched > 45_000) { this.streams.delete(id); this.bufferedBytes -= stream.bytes; stream.failure = new DshRemoteError('REMOTE_NOT_FOUND', '会话订阅已释放', true); stream.wake?.() }
      if (this.streams.size && !this.lifetime.signal.aborted) void this.ready.then(() => publish(transport, this.target, { kind: 'session.keepalive', streams: [...this.streams.keys()] }, this.lifetime.signal)).catch(error => this.fail(error))
    }, 15_000); this.heartbeat.unref()
  }
  close(): void { this.fail(new DshRemoteError('REMOTE_TRANSPORT_FAILED', '会话连接已关闭', true)) }
  private fail(error: unknown): void {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort(error); clearInterval(this.heartbeat)
    for (const call of this.calls.values()) call.reject(error)
    this.calls.clear()
    for (const stream of this.streams.values()) { clearTimeout(stream.reopening); stream.failure = error; stream.wake?.() }
    this.streams.clear(); this.bufferedBytes = 0
    this.disconnected()
  }
  async observeDirectory(signal: AbortSignal, changed: (delta?: DshDirectoryDelta) => void): Promise<void> {
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    await this.ready
    combined.throwIfAborted()
    if (this.directoryListeners.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话目录观察数量超限')
    this.directoryListeners.add(changed)
    try {
      changed() // Subscribe first, then read the authoritative directory.
      await new Promise<void>((resolve, reject) => {
        const abort = () => signal.aborted ? resolve() : reject(combined.reason)
        if (combined.aborted) abort(); else combined.addEventListener('abort', abort, { once: true })
      })
    } finally { this.directoryListeners.delete(changed) }
  }
  async observe(address: Address, signal: AbortSignal, changed: () => void): Promise<void> {
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    await this.ready; combined.throwIfAborted()
    const identity = key(address)
    if (this.observers.size >= 64 && !this.observers.has(identity)) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话观察数量超限')
    let listeners = this.observers.get(identity)
    if (!listeners) this.observers.set(identity, listeners = new Set())
    if (listeners.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话观察数量超限')
    listeners.add(changed)
    try {
      changed()
      await new Promise<void>((resolve, reject) => {
        const abort = () => signal.aborted ? resolve() : reject(combined.reason)
        if (combined.aborted) abort(); else combined.addEventListener('abort', abort, { once: true })
      })
    } finally { listeners.delete(changed); if (!listeners.size) this.observers.delete(identity) }
  }
  private recover(error: unknown, address?: Address): void {
    if (!address && error instanceof DshRemoteError && error.code === 'REPLAY_GAP') {
      // Transport has discarded its old replay cursor. The account consumer
      // must discard the same cursor/partial frames before accepting a new cut.
      this.lastSequence = 0
      this.reader = new DshRemoteFragmentReader(128)
    }
    // The socket is healthy. End only affected native generations so their
    // existing consumers reconcile authoritative history; never replay writes.
    for (const stream of this.streams.values()) if (!address || key(stream) === key(address)) {
      this.bufferedBytes -= stream.bytes
      stream.ended = true
      stream.queue = [{ items: [], done: true }]
      stream.bytes = Buffer.byteLength(JSON.stringify(stream.queue[0])); this.bufferedBytes += stream.bytes
      stream.wake?.()
    }
    for (const call of this.calls.values()) if (!address || key(call.address) === key(address)) call.reject(error)
    if (!address) for (const changed of this.directoryListeners) changed()
  }
  private receive(value: Json): void {
    if (this.lifetime.signal.aborted) return
    if (value.kind !== 'session.response') return
    if (value.streamRefs !== undefined) {
      if (!Array.isArray(value.streamRefs) || value.streamRefs.length < 1 || value.streamRefs.length > 64
        || !value.streamRefs.every(validRef) || new Set(value.streamRefs).size !== value.streamRefs.length) return
      for (const streamRef of value.streamRefs) if (this.streams.has(streamRef)) this.receive({ ...value, streamRefs: undefined, streamRef })
      return
    }
    if (value.directoryChanged === true) {
      const delta = parseDshDirectoryDelta(value.directoryDelta)
      for (const changed of this.directoryListeners) changed(delta)
      return
    }
    if (value.ready === true) {
      if (validRef(value.runtimeRef) && validRef(value.sessionRef) && Number.isSafeInteger(value.epoch) && Number(value.epoch) > 0) this.executorReady?.(value as Address)
      // An unrelated executor/lease must not refresh every observed session.
      if (validRef(value.runtimeRef)) void this.resubscribe(value.runtimeRef, validRef(value.sessionRef) ? value.sessionRef : undefined).catch(error => this.recover(error))
      return
    }
    if (validRef(value.runtimeRef) && value.envelope) {
      const envelope = nativeRecord(value.envelope)
      if (envelope.kind === 'event' || envelope.kind === 'snapshot') {
        const body = nativeRecord(envelope.body)
        for (const [identity, listeners] of this.observers) {
          const [runtime, session] = JSON.parse(identity)
          if (runtime === value.runtimeRef && (body.session_ref === undefined || body.session_ref === session)) for (const changed of listeners) changed()
        }
        return
      }
      const call = this.calls.get(String(envelope.request_ref))
      if (!call || !call.operation || call.address.runtimeRef !== value.runtimeRef || call.operation !== envelope.operation || envelope.kind !== 'response') return
      if (envelope.status === 'rejected') {
        const error = nativeRecord(envelope.error)
        call.reject(new DshRemoteError(String(error.code) as ConstructorParameters<typeof DshRemoteError>[0], String(error.message), error.retryable === true))
      } else if (['accepted', 'completed', 'duplicate'].includes(String(envelope.status))) call.resolve(envelope.result)
      return
    }
    if (value.kind !== 'session.response' || !validRef(value.runtimeRef) || !validRef(value.sessionRef) || !validRef(value.requestRef) || !Number.isSafeInteger(value.epoch) || Number(value.epoch) <= 0) return
    const address = value as Address, rawError = value.error ? nativeRecord(value.error) : undefined
    const error = rawError ? new DshRemoteError(String(rawError.code) as ConstructorParameters<typeof DshRemoteError>[0], String(rawError.message), rawError.retryable === true) : undefined
    if (typeof value.streamRef === 'string') {
      const stream = this.streams.get(value.streamRef)
      if (!stream || key(stream) !== key(address) || Number(value.epoch) < stream.epoch) return
      if (stream.ended) return
      stream.epoch = Number(value.epoch)
      if (error?.code === 'REMOTE_NOT_FOUND' && error.retryable) {
        // Only observation is reopened. Keep the consumer and its applied cursor;
        // command calls still fail without retry when their outcome is unknown.
        this.reopen(stream); return
      }
      if (error) stream.failure = error
      else {
        const raw = nativeRecord(value.value)
        const items = Array.isArray(raw.items) ? raw.items : []
        if (raw.done === true && !items.length) { this.reopen(stream); return }
        const opening = items.some(item => ['snapshot', 'baseline', 'ready'].includes(String(nativeRecord(item).type)))
        // Wait for the successor's opening before replacing the native logical
        // generation. DSH then seeds its complete baseline and retains history;
        // never flatten a baseline into deltas or rewrite native sequence IDs.
        const frame = opening && stream.opened ? { items: [], done: true } : { ...raw, done: false }
        if (opening && stream.opened) stream.ended = true
        if (opening) stream.opened = true
        const bytes = Buffer.byteLength(JSON.stringify(frame))
        if (stream.queue.length >= 256 || this.bufferedBytes + bytes > 64 * 1024 * 1024) stream.failure = new DshRemoteError('REMOTE_TRANSPORT_FAILED', '会话增量积压超限，请恢复历史', true)
        else { stream.queue.push(frame); stream.bytes += bytes; this.bufferedBytes += bytes }
        if (!stream.ended && raw.done === true) this.reopen(stream)
      }
      stream.wake?.()
    } else {
      const call = this.calls.get(value.requestRef)
      if (!call || key(call.address) !== key(address)) return
      if (error) call.reject(error); else call.resolve(value.value)
    }
  }
  private reopen(stream: Inbox): void {
    if (stream.reopening || this.lifetime.signal.aborted) return
    stream.reopening = setTimeout(() => {
      delete stream.reopening
      if (stream.ended || this.streams.get(String(stream.opening.body.streamRef)) !== stream) return
      void this.openAgain(stream).catch(error => { stream.failure = error; stream.wake?.() })
    }, 100)
    stream.reopening.unref()
  }
  private async openAgain(stream: Inbox): Promise<void> {
    await publish(this.transport, this.target, { ...stream.opening, expiresAt: Date.now() + 30_000,
      body: stream.opening.body }, this.lifetime.signal)
  }
  private async resubscribe(runtimeRef: string, sessionRef?: string): Promise<void> {
    for (const stream of this.streams.values()) if (!stream.ended && stream.runtimeRef === runtimeRef && (sessionRef === undefined || stream.sessionRef === sessionRef)) await this.openAgain(stream)
  }
  async command(runtimeRef: string, envelope: DshRemoteRequest, signal: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(Math.max(1, envelope.execute_before - Date.now()))])
    await this.ready; deadline.throwIfAborted()
    if (this.calls.size >= 128 || this.calls.has(envelope.request_ref)) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话请求数量超限或请求正在执行')
    return await new Promise((resolve, reject) => {
      const finish = (action: () => void) => { this.calls.delete(envelope.request_ref); deadline.removeEventListener('abort', abort); action() }
      const abort = () => finish(() => reject(deadline.reason))
      this.calls.set(envelope.request_ref, { address: { runtimeRef, sessionRef: String(envelope.body.session_ref ?? '') }, operation: envelope.operation,
        resolve: value => finish(() => resolve(value)), reject: error => finish(() => reject(error)) })
      deadline.addEventListener('abort', abort, { once: true })
      if (deadline.aborted) { abort(); return }
      void publish(this.transport, this.target, { kind: 'session.command', runtimeRef, envelope }, deadline).catch(error => finish(() => reject(error)))
    })
  }
  async request(address: Address, body: Json, requestRef: string, signal: AbortSignal): Promise<unknown> {
    const scoped = AbortSignal.any([signal, this.lifetime.signal])
    scoped.throwIfAborted(); await this.ready; scoped.throwIfAborted()
    const id = String(body.streamRef ?? '')
    const request: Request = { kind: 'session.request', ...address, requestRef, expiresAt: Date.now() + 30_000, body,
      ...(body.mode === 'pull' && body.endpoint === 'session/follow' ? { sharedFollowResponses: true } : {}) }
    if (body.mode === 'close') {
      const stream = this.streams.get(id)
      if (stream && key(stream) !== key(address)) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '会话订阅身份不匹配')
      if (stream) { this.bufferedBytes -= stream.bytes; clearTimeout(stream.reopening) }
      this.streams.delete(id)
      await publish(this.transport, this.target, request, scoped); return { done: true }
    }
    if (body.mode === 'call') {
      if (this.calls.size >= 128) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话请求数量超限')
      const deadline = AbortSignal.any([scoped, AbortSignal.timeout(30_000)])
      return new Promise((resolve, reject) => {
        const abort = () => finish(() => reject(deadline.reason))
        const finish = (action: () => void) => { this.calls.delete(requestRef); deadline.removeEventListener('abort', abort); action() }
        this.calls.set(requestRef, { address, resolve: value => finish(() => resolve(value)), reject: error => finish(() => reject(error)) })
        deadline.addEventListener('abort', abort, { once: true })
        if (deadline.aborted) { abort(); return }
        void publish(this.transport, this.target, request, deadline).catch(error => finish(() => reject(error)))
      })
    }
    let stream = this.streams.get(id)
    if (!stream) {
      if (body.endpoint === undefined) throw new DshRemoteError('REMOTE_NOT_FOUND', '会话订阅已结束', true)
      if (this.streams.size >= 64) throw new DshRemoteError('RUNTIME_LIMIT_REACHED', '会话订阅数量超限')
      stream = { ...address, opening: request, queue: [], bytes: 0, touched: Date.now(), epoch: 0, busy: false }; this.streams.set(id, stream)
      try { await publish(this.transport, this.target, request, scoped) } catch (error) { this.streams.delete(id); throw error }
    }
    if (key(stream) !== key(address) || stream.busy) throw new DshRemoteError('REMOTE_REQUEST_INVALID', '会话订阅请求冲突')
    stream.busy = true; stream.touched = Date.now()
    const waiting = stream, deadline = AbortSignal.any([scoped, AbortSignal.timeout(20_000)])
    const wake = () => waiting.wake?.()
    deadline.addEventListener('abort', wake, { once: true })
    try {
      while (!deadline.aborted && !waiting.failure && waiting.queue.length === 0) await new Promise<void>(resolve => { waiting.wake = resolve })
      scoped.throwIfAborted()
      if (waiting.failure) throw waiting.failure
      if (deadline.aborted && waiting.epoch === 0) throw new DshRemoteError('RUNTIME_OFFLINE', '当前执行者尚未接收会话订阅', true)
      const received = waiting.queue.shift()
      const bytes = received ? Buffer.byteLength(JSON.stringify(received)) : 0
      waiting.bytes -= bytes; this.bufferedBytes = Math.max(0, this.bufferedBytes - bytes)
      const value = received ?? { items: [] }
      return value
    } finally { waiting.busy = false; waiting.touched = Date.now(); delete waiting.wake; deadline.removeEventListener('abort', wake) }
  }
}
