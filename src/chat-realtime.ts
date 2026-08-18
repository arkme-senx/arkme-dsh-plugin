import type { ArkmeSessionCredentials } from './keychain-store.js'
import type { ArkmeChatRealtimeState } from './types.js'

export const ARKME_CHAT_SSE_PATH = '/api/v1/sse/chat/noty'
export const ARKME_CHAT_RECEIVE_BIZ_TYPE = 17

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_INACTIVITY_TIMEOUT_MS = 75_000
const DEFAULT_LEASE_DURATION_MS = 9 * 60_000 + 30_000
const DEFAULT_IDLE_POLL_MS = 2_000
const DEFAULT_RETRY_BASE_MS = 1_000
const MAX_RETRY_MS = 15_000
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

export interface ArkmeChatRealtimeNotice {
  state: ArkmeChatRealtimeState
  cause: 'reconcile' | 'hint' | 'local'
  hint?: ArkmeChatReceiveHint
}

export interface ArkmeChatRealtimeRuntimeOptions {
  imBaseUrl: string
  readSession(): Promise<ArkmeSessionCredentials | undefined>
  fetchImpl?: FetchLike
  connectTimeoutMs?: number
  inactivityTimeoutMs?: number
  leaseDurationMs?: number
  idlePollMs?: number
  retryBaseMs?: number
}

class ArkmeChatRealtimeAuthError extends Error {}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Decode one server data line. Heartbeats, malformed frames, and non-Chat hints are ignored. */
export function decodeArkmeChatReceiveDataLine(line: string): ArkmeChatReceiveHint | undefined {
  const normalized = line.trimStart()
  if (!normalized.startsWith('data:')) return undefined
  const payload = normalized.slice('data:'.length).trim()
  if (payload === '') return undefined
  let value: unknown
  try { value = JSON.parse(payload) }
  catch { return undefined }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
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
  private rootController: AbortController | undefined
  private connectionController: AbortController | undefined
  private loop: Promise<void> | undefined
  private revision = 0
  private connected = false
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
  }

  reconnect(): void {
    this.connectionController?.abort()
  }

  state(): ArkmeChatRealtimeState {
    return {
      revision: this.revision,
      connected: this.connected,
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
    while (!signal.aborted) {
      const session = await this.options.readSession()
      if (session === undefined) {
        this.connected = false
        await waitFor(this.idlePollMs, signal)
        continue
      }
      try {
        await this.consume(session, signal)
        retryMs = this.retryBaseMs
      } catch (error) {
        if (signal.aborted) break
        if (error instanceof ArkmeChatRealtimeAuthError) retryMs = this.retryBaseMs
      } finally {
        this.connected = false
      }
      await waitFor(retryMs, signal)
      retryMs = Math.min(MAX_RETRY_MS, Math.max(this.retryBaseMs, retryMs * 2))
    }
  }

  private async consume(session: ArkmeSessionCredentials, rootSignal: AbortSignal): Promise<void> {
    const controller = new AbortController()
    this.connectionController = controller
    const abortFromRoot = () => controller.abort(rootSignal.reason)
    rootSignal.addEventListener('abort', abortFromRoot, { once: true })
    const connectTimer = setTimeout(() => controller.abort(new Error('chat SSE connect timeout')), this.connectTimeoutMs)
    let leaseTimer: ReturnType<typeof setTimeout> | undefined
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
      this.connected = true
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
      clearTimeout(connectTimer)
      if (leaseTimer !== undefined) clearTimeout(leaseTimer)
      rootSignal.removeEventListener('abort', abortFromRoot)
      if (this.connectionController === controller) this.connectionController = undefined
    }
  }

  private acceptLine(line: string): void {
    const event = decodeArkmeChatReceiveDataLine(line)
    if (event === undefined || this.seenEventUids.has(event.eventUid)) return
    this.seenEventUids.add(event.eventUid)
    if (this.seenEventUids.size > MAX_SEEN_EVENTS) {
      const oldest = this.seenEventUids.values().next().value as string | undefined
      if (oldest !== undefined) this.seenEventUids.delete(oldest)
    }
    this.lastEventAtMillis = event.eventAtMillis
    this.advanceRevision('hint', event)
  }

  private advanceRevision(cause: ArkmeChatRealtimeNotice['cause'], hint?: ArkmeChatReceiveHint): void {
    this.revision += 1
    const state = this.state()
    const notice: ArkmeChatRealtimeNotice = { state, cause, ...(hint === undefined ? {} : { hint }) }
    for (const listener of [...this.listeners]) listener(notice)
  }
}
