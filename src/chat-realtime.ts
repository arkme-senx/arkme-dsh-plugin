import type { ArkmeSessionCredentials } from './keychain-store.js'
import type { ArkmeChatRealtimeState } from './types.js'

export const ARKME_CHAT_SSE_PATH = '/api/v1/sse/chat/noty'
export const ARKME_CHAT_RECEIVE_BIZ_TYPE = 17
export const ARKME_PROJECTION_INVALIDATED_BIZ_TYPE = 25

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_INACTIVITY_TIMEOUT_MS = 75_000
const DEFAULT_LEASE_DURATION_MS = 9 * 60_000 + 30_000
const DEFAULT_IDLE_POLL_MS = 2_000
const DEFAULT_RETRY_BASE_MS = 1_000
const DEFAULT_MAX_RETRY_MS = 15_000
const DEFAULT_STABLE_CONNECTION_MS = 30_000
const MAX_SEEN_EVENTS = 256

type FetchLike = typeof fetch

export interface ArkmeChatReceiveHint {
  eventUid: string
  chatSessionUid: string
  relationUid: string
  latestSequence: number
  senderUserId: number
  eventAtMillis: number
}

export interface ArkmeProjectionInvalidatedHint {
  eventUid: string
  projection: string
  eventAtMillis: number
}

export interface ArkmeChatRealtimeNotice {
  state: ArkmeChatRealtimeState
  cause: 'reconcile' | 'hint' | 'local'
  hint?: ArkmeChatReceiveHint
  projectionInvalidation?: ArkmeProjectionInvalidatedHint
}

export interface ArkmeChatRealtimeRuntimeOptions {
  imBaseUrl: string
  readSession(): Promise<ArkmeSessionCredentials | undefined>
  refreshSession?(session: ArkmeSessionCredentials): Promise<ArkmeSessionCredentials | undefined>
  fetchImpl?: FetchLike
  connectTimeoutMs?: number
  inactivityTimeoutMs?: number
  leaseDurationMs?: number
  idlePollMs?: number
  retryBaseMs?: number
  maxRetryMs?: number
  stableConnectionMs?: number
  random?: () => number
  now?: () => number
  diagnostic?(
    event: 'sse_disconnected' | 'reconnect_attempt',
    details: { connectionGeneration: number },
  ): void
}

class ArkmeChatRealtimeAuthError extends Error {}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function decodeDataLine(line: string): Record<string, unknown> | undefined {
  const normalized = line.trimStart()
  if (!normalized.startsWith('data:')) return undefined
  const payload = normalized.slice('data:'.length).trim()
  if (payload === '') return undefined
  let value: unknown
  try { value = JSON.parse(payload) }
  catch { return undefined }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Decode one server data line. Heartbeats, malformed frames, and non-Chat hints are ignored. */
export function decodeArkmeChatReceiveDataLine(line: string): ArkmeChatReceiveHint | undefined {
  const source = decodeDataLine(line)
  if (source === undefined) return undefined
  if (positiveInteger(source.t) !== ARKME_CHAT_RECEIVE_BIZ_TYPE) return undefined
  const eventUid = nonEmptyString(source.event_uid)
  const chatSessionUid = nonEmptyString(source.chat_session_uid)
  const relationUid = nonEmptyString(source.rel_uid)
  const latestSequence = positiveInteger(source.latest_seq)
  const senderUserId = positiveInteger(source.sender_user_id)
  const eventAtMillis = positiveInteger(source.event_at)
  if (eventUid === undefined || chatSessionUid === undefined || relationUid === undefined
    || latestSequence === undefined || senderUserId === undefined || eventAtMillis === undefined) return undefined
  return { eventUid, chatSessionUid, relationUid, latestSequence, senderUserId, eventAtMillis }
}

const PROJECTION_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/
const PROJECTION_INVALIDATION_FORBIDDEN_FIELDS = [
  'receiver_user_ids', 'source_client_id', 'record_uid', 'record_body', 'topic_uid',
  'payload', 'revision', 'change_kind',
] as const

/** Decode one metadata-only projection invalidation from the shared user realtime stream. */
export function decodeArkmeProjectionInvalidatedDataLine(line: string): ArkmeProjectionInvalidatedHint | undefined {
  const source = decodeDataLine(line)
  if (source === undefined || positiveInteger(source.t) !== ARKME_PROJECTION_INVALIDATED_BIZ_TYPE) return undefined
  if (PROJECTION_INVALIDATION_FORBIDDEN_FIELDS.some(field => Object.hasOwn(source, field))) return undefined
  const eventUid = nonEmptyString(source.event_uid)
  const projection = nonEmptyString(source.projection)
  const eventAtMillis = positiveInteger(source.event_at)
  if (eventUid === undefined || projection === undefined || eventAtMillis === undefined
    || !PROJECTION_NAME_PATTERN.test(projection)) return undefined
  return { eventUid, projection, eventAtMillis }
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  controller: AbortController,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error('chat SSE inactivity timeout'))
          reject(new Error('chat SSE inactivity timeout'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export class ArkmeChatRealtimeRuntime {
  private readonly fetchImpl: FetchLike
  private readonly connectTimeoutMs: number
  private readonly inactivityTimeoutMs: number
  private readonly leaseDurationMs: number
  private readonly idlePollMs: number
  private readonly retryBaseMs: number
  private readonly maxRetryMs: number
  private readonly stableConnectionMs: number
  private readonly random: () => number
  private readonly now: () => number
  private rootController: AbortController | undefined
  private connectionController: AbortController | undefined
  private waitController: AbortController | undefined
  private loop: Promise<void> | undefined
  private revision = 0
  private connected = false
  private lastAcceptedAccessToken: string | undefined
  private lastConnectionLifetimeMs = 0
  private connectionGeneration = 0
  private forceReconnectRequested = false
  private lastEventAtMillis: number | undefined
  private readonly seenEventUids = new Set<string>()
  private readonly listeners = new Set<(notice: ArkmeChatRealtimeNotice) => void>()

  constructor(private readonly options: ArkmeChatRealtimeRuntimeOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS
    this.idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    this.maxRetryMs = Math.max(this.retryBaseMs, options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS)
    this.stableConnectionMs = Math.max(0, options.stableConnectionMs ?? DEFAULT_STABLE_CONNECTION_MS)
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
  }

  start(): () => void {
    if (this.loop !== undefined) return () => { this.stop() }
    const root = new AbortController()
    this.rootController = root
    const loop = this.run(root.signal).catch(() => undefined)
    this.loop = loop
    void loop.finally(() => {
      if (this.loop === loop) this.loop = undefined
      if (this.rootController === root) this.rootController = undefined
      this.connected = false
    })
    return () => { this.stop() }
  }

  stop(): void {
    this.rootController?.abort()
    this.connectionController?.abort()
    this.waitController?.abort()
  }

  reconnect(): void {
    if (this.loop === undefined) return
    this.forceReconnectRequested = true
    this.connectionController?.abort()
    this.waitController?.abort()
  }

  state(): ArkmeChatRealtimeState {
    return {
      revision: this.revision,
      connected: this.connected,
      connectionGeneration: this.connectionGeneration,
      ...(this.lastEventAtMillis === undefined ? {} : { lastEventAtMillis: this.lastEventAtMillis }),
    }
  }

  subscribe(listener: (notice: ArkmeChatRealtimeNotice) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  invalidate(): void {
    this.advanceRevision('local')
  }

  private async run(signal: AbortSignal): Promise<void> {
    let retryMs = this.retryBaseMs
    let blockedAccessToken: string | undefined
    let refreshedButUnacceptedToken: string | undefined
    while (!signal.aborted) {
      const session = await this.options.readSession()
      if (session === undefined) {
        this.connected = false
        blockedAccessToken = undefined
        await this.wait(this.idlePollMs, signal)
        continue
      }
      if (blockedAccessToken === session.accessToken) {
        this.connected = false
        await this.wait(this.idlePollMs, signal)
        continue
      }
      blockedAccessToken = undefined
      let stableConnection = false
      this.options.diagnostic?.('reconnect_attempt', {
        connectionGeneration: this.connectionGeneration + 1,
      })
      try {
        await this.consume(session, signal)
        stableConnection = this.lastConnectionLifetimeMs >= this.stableConnectionMs
        if (this.lastAcceptedAccessToken === session.accessToken) refreshedButUnacceptedToken = undefined
        if (stableConnection) retryMs = this.retryBaseMs
      } catch (error) {
        if (signal.aborted) break
        stableConnection = this.lastConnectionLifetimeMs >= this.stableConnectionMs
        if (stableConnection) retryMs = this.retryBaseMs
        if (this.lastAcceptedAccessToken === session.accessToken) refreshedButUnacceptedToken = undefined
        if (error instanceof ArkmeChatRealtimeAuthError) {
          if (refreshedButUnacceptedToken === session.accessToken) {
            blockedAccessToken = session.accessToken
            refreshedButUnacceptedToken = undefined
            await this.wait(this.idlePollMs, signal)
            continue
          }
          let refreshed: ArkmeSessionCredentials | undefined
          try { refreshed = await this.options.refreshSession?.(session) }
          catch { refreshed = undefined }
          if (refreshed !== undefined && refreshed.accessToken !== session.accessToken) {
            refreshedButUnacceptedToken = refreshed.accessToken
            this.forceReconnectRequested = false
            retryMs = this.retryBaseMs
            continue
          }
          blockedAccessToken = session.accessToken
          await this.wait(this.idlePollMs, signal)
          continue
        }
      } finally {
        if (this.connected && !signal.aborted) {
          this.options.diagnostic?.('sse_disconnected', {
            connectionGeneration: this.connectionGeneration,
          })
        }
        this.connected = false
      }
      if (this.forceReconnectRequested) {
        this.forceReconnectRequested = false
        retryMs = this.retryBaseMs
        continue
      }
      await this.wait(this.jitteredDelay(retryMs), signal)
      if (!stableConnection) {
        retryMs = Math.min(this.maxRetryMs, Math.max(this.retryBaseMs, retryMs * 2))
      }
    }
  }

  private async consume(session: ArkmeSessionCredentials, rootSignal: AbortSignal): Promise<void> {
    this.lastConnectionLifetimeMs = 0
    const controller = new AbortController()
    this.connectionController = controller
    const abortFromRoot = () => controller.abort(rootSignal.reason)
    rootSignal.addEventListener('abort', abortFromRoot, { once: true })
    const connectTimer = setTimeout(() => controller.abort(new Error('chat SSE connect timeout')), this.connectTimeoutMs)
    let leaseTimer: ReturnType<typeof setTimeout> | undefined
    let acceptedAtMillis: number | undefined
    try {
      const response = await this.fetchImpl(new URL(ARKME_CHAT_SSE_PATH, this.options.imBaseUrl), {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Accept-Language': 'zh-CN',
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
          Usersource: '3',
        },
        body: '{}',
        signal: controller.signal,
      })
      clearTimeout(connectTimer)
      if (response.status === 401 || response.status === 403) throw new ArkmeChatRealtimeAuthError()
      if (!response.ok || response.body === null) throw new Error(`chat SSE returned HTTP ${String(response.status)}`)
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.includes('text/event-stream')) {
        await response.body.cancel().catch(() => undefined)
        throw new Error('chat SSE returned a non-event-stream response')
      }
      acceptedAtMillis = this.now()
      this.connected = true
      this.lastAcceptedAccessToken = session.accessToken
      this.connectionGeneration += 1
      this.advanceRevision('reconcile')
      leaseTimer = setTimeout(() => controller.abort(new Error('chat SSE lease rotation')), this.leaseDurationMs)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!controller.signal.aborted) {
        const next = await readWithTimeout(reader, this.inactivityTimeoutMs, controller)
        if (next.done) break
        buffer += decoder.decode(next.value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) this.acceptLine(line)
      }
      buffer += decoder.decode()
      if (buffer !== '') this.acceptLine(buffer)
      await reader.cancel().catch(() => undefined)
    } finally {
      if (acceptedAtMillis !== undefined) {
        this.lastConnectionLifetimeMs = Math.max(0, this.now() - acceptedAtMillis)
      }
      clearTimeout(connectTimer)
      if (leaseTimer !== undefined) clearTimeout(leaseTimer)
      rootSignal.removeEventListener('abort', abortFromRoot)
      if (this.connectionController === controller) this.connectionController = undefined
    }
  }

  private jitteredDelay(milliseconds: number): number {
    const random = Math.min(1, Math.max(0, this.random()))
    return Math.max(0, Math.round(milliseconds * (0.8 + random * 0.4)))
  }

  private async wait(milliseconds: number, rootSignal: AbortSignal): Promise<void> {
    if (rootSignal.aborted) return
    const controller = new AbortController()
    const abortFromRoot = () => { controller.abort(rootSignal.reason) }
    rootSignal.addEventListener('abort', abortFromRoot, { once: true })
    this.waitController = controller
    try {
      await waitFor(milliseconds, controller.signal)
    } finally {
      rootSignal.removeEventListener('abort', abortFromRoot)
      if (this.waitController === controller) this.waitController = undefined
    }
  }

  private acceptLine(line: string): void {
    const projectionInvalidation = decodeArkmeProjectionInvalidatedDataLine(line)
    const hint = projectionInvalidation === undefined ? decodeArkmeChatReceiveDataLine(line) : undefined
    const eventUid = projectionInvalidation?.eventUid ?? hint?.eventUid
    if (eventUid === undefined || this.seenEventUids.has(eventUid)) return
    this.seenEventUids.add(eventUid)
    if (this.seenEventUids.size > MAX_SEEN_EVENTS) {
      const oldest = this.seenEventUids.values().next().value as string | undefined
      if (oldest !== undefined) this.seenEventUids.delete(oldest)
    }
    this.lastEventAtMillis = projectionInvalidation?.eventAtMillis ?? hint?.eventAtMillis
    this.advanceRevision('hint', hint, projectionInvalidation)
  }

  private advanceRevision(
    cause: ArkmeChatRealtimeNotice['cause'],
    hint?: ArkmeChatReceiveHint,
    projectionInvalidation?: ArkmeProjectionInvalidatedHint,
  ): void {
    this.revision += 1
    const state = this.state()
    const notice: ArkmeChatRealtimeNotice = {
      state,
      cause,
      ...(hint === undefined ? {} : { hint }),
      ...(projectionInvalidation === undefined ? {} : { projectionInvalidation }),
    }
    for (const listener of [...this.listeners]) listener(notice)
  }
}
