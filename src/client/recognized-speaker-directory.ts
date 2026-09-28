import type { ArkmeDirectoryPage, ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerPresence } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { loadSpeakerCandidateSnapshot, type SpeakerCandidateSnapshot } from './recognized-speaker-order.js'

export const readSpeakerOptions = (signal: AbortSignal) => callArkme<ArkmeRecordingSpeakerCandidate[]>('recordings.speaker.options', {}, signal)
export const readSpeakerPresence = (signal: AbortSignal) => callArkme<ArkmeRecordingSpeakerPresence>('recordings.speaker.presence', {}, signal)
export const readSpeakerPage = (cursor: string, signal: AbortSignal) => callArkme<ArkmeDirectoryPage>('directory.list', {
  section: 'unmarked-speakers', limit: 50, ...(cursor === '' ? {} : { cursor }),
}, signal)

export class SpeakerReadDeferred extends Error {
  constructor(readonly retryAt: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : '说话人列表暂时无法加载', { cause })
  }
}
export function speakerRetryDelay(error: unknown): number | undefined {
  return error instanceof SpeakerReadDeferred ? Math.max(1_000, error.retryAt - Date.now()) : undefined
}

/** Per-account shared read. A short release grace lets entry -> list hand off the same
 * request; leaving both cancels it. A late/aborted response can never update the cache.
 */
class SharedRead<T> {
  value: T | undefined
  freshUntil = 0
  private retryAt = 0
  private failures = 0
  private error: unknown
  private pending: { controller: AbortController; promise: Promise<T> } | undefined
  private listeners = new Set<(value: T) => void>()
  private releaseTimer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly ttl: number, private readonly load: (signal: AbortSignal, emit: (value: T) => void) => Promise<T>, private readonly now: () => number) {}

  read(signal: AbortSignal, progress: (value: T) => void = () => {}): Promise<T> {
    signal.throwIfAborted()
    if (this.value !== undefined) progress(this.value)
    if (this.now() < this.retryAt) return Promise.reject(new SpeakerReadDeferred(this.retryAt, this.error))
    if (this.value !== undefined && this.now() < this.freshUntil) return Promise.resolve(this.value)
    clearTimeout(this.releaseTimer)
    if (this.pending?.controller.signal.aborted) this.pending = undefined
    if (this.pending === undefined) {
      const controller = new AbortController()
      const emit = (value: T) => {
        controller.signal.throwIfAborted()
        this.value = value
        for (const listener of this.listeners) listener(value)
      }
      const promise = Promise.resolve().then(async () => {
        controller.signal.throwIfAborted()
        const value = await this.load(controller.signal, emit)
        controller.signal.throwIfAborted()
        emit(value)
        this.freshUntil = this.now() + this.ttl
        this.failures = 0; this.retryAt = 0; this.error = undefined
        return value
      }).catch(error => {
        if (controller.signal.aborted) throw error
        this.failures += 1
        const limited = /(?:\b429\b|rate.?limit|too many requests)/i.test(error instanceof Error ? error.message : String(error))
        this.retryAt = this.now() + Math.min(5 * 60_000, (limited ? 60_000 : 15_000) * 2 ** Math.min(4, this.failures - 1))
        this.error = error
        throw new SpeakerReadDeferred(this.retryAt, error)
      }).finally(() => { if (this.pending?.controller === controller) this.pending = undefined })
      this.pending = { controller, promise }
    }
    const pending = this.pending
    return new Promise<T>((resolve, reject) => {
      const listener = (value: T) => { if (!signal.aborted) progress(value) }
      this.listeners.add(listener)
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        this.listeners.delete(listener)
        if (this.listeners.size === 0 && this.pending === pending) {
          this.releaseTimer = setTimeout(() => { if (this.listeners.size === 0 && this.pending === pending) pending.controller.abort() }, 250)
        }
      }
      const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')) }
      signal.addEventListener('abort', abort, { once: true })
      pending.promise.then(value => { cleanup(); if (!signal.aborted) resolve(value) }, error => { cleanup(); if (!signal.aborted) reject(error) })
    })
  }

  invalidate(): void {
    // Manual refresh/mutations may refresh data, but never bypass server backoff.
    clearTimeout(this.releaseTimer)
    this.pending?.controller.abort()
    this.pending = undefined
    this.freshUntil = 0
  }
  dispose(): void { this.invalidate(); this.listeners.clear(); this.value = undefined }
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

export interface SharedSpeakerSnapshot extends SpeakerCandidateSnapshot { total?: number | undefined }
interface AccountDirectory {
  marked: SharedRead<ArkmeRecordingSpeakerCandidate[]>
  presence: SharedRead<ArkmeRecordingSpeakerPresence>
  candidates: SharedRead<SharedSpeakerSnapshot>
  pages: Map<string, ArkmeDirectoryPage>
}

export class RecognizedSpeakerDirectory {
  private readonly accounts = new Map<string, AccountDirectory>()
  constructor(
    private readonly loaders = { marked: readSpeakerOptions, page: readSpeakerPage, presence: readSpeakerPresence },
    private readonly pageGapMs = 750,
    private readonly now = Date.now,
  ) {}

  private account(account: string): AccountDirectory {
    const found = this.accounts.get(account)
    if (found !== undefined) return found
    const pages = new Map<string, ArkmeDirectoryPage>()
    let startedAt = 0, lastRequestAt = 0, completed = false
    let state!: AccountDirectory
    state = {
      pages,
      marked: new SharedRead(60_000, signal => this.loaders.marked(signal), this.now),
      presence: new SharedRead(60_000, signal => this.loaders.presence(signal), this.now),
      candidates: new SharedRead(5 * 60_000, async (signal, emit) => {
        // A failed/interrupted traversal reuses its successful pages for up to five
        // minutes. A finished traversal is replaced as one snapshot, never mixed.
        if (completed || this.now() - startedAt >= 5 * 60_000) pages.clear()
        if (pages.size === 0) startedAt = this.now()
        completed = false
        let total: number | undefined
        const result = await loadSpeakerCandidateSnapshot(async cursor => {
          const cached = pages.get(cursor)
          if (cached !== undefined) return cached
          await pause(Math.max(0, lastRequestAt + this.pageGapMs - this.now()), signal)
          signal.throwIfAborted()
          lastRequestAt = this.now()
          const page = await this.loaders.page(cursor, signal)
          signal.throwIfAborted()
          if (page.cursorStale) { pages.clear(); startedAt = this.now() }
          else if (page.projectionState === undefined || page.projectionState === 'fresh') pages.set(cursor, page)
          return page
        }, signal, snapshot => {
          const first = pages.get('')
          total = first?.coverage !== 'partial' ? first?.total : undefined
          // Keep a previously complete list visible while a new snapshot builds.
          if (!state.candidates.value?.complete || snapshot.complete) emit({ ...snapshot, total })
        })
        completed = result.complete
        if (!result.complete) {
          // Incomplete/stale results must not be cached as fresh for five minutes.
          if (!state.candidates.value?.complete) emit({ ...result, total })
          throw new Error('说话人列表尚未完整，请稍后重试')
        }
        return { ...result, total }
      }, this.now),
    }
    this.accounts.set(account, state)
    return state
  }

  peekMarked(account: string) { return this.accounts.get(account)?.marked.value }
  peekPresence(account: string) { return this.accounts.get(account)?.presence.value }
  peekCandidates(account: string) { return this.accounts.get(account)?.candidates.value }
  readMarked(account: string, signal: AbortSignal) { return this.account(account).marked.read(signal) }
  readPresence(account: string, signal: AbortSignal) { return this.account(account).presence.read(signal) }
  refreshPresence(account: string, signal: AbortSignal) {
    this.account(account).presence.invalidate()
    return this.readPresence(account, signal)
  }
  readCandidates(account: string, signal: AbortSignal, progress: (value: SharedSpeakerSnapshot) => void) { return this.account(account).candidates.read(signal, progress) }
  invalidate(account: string): void {
    const state = this.accounts.get(account)
    if (state === undefined) return
    state.pages.clear(); state.marked.invalidate(); state.presence.invalidate(); state.candidates.invalidate()
  }
  clear(): void {
    for (const state of this.accounts.values()) { state.marked.dispose(); state.presence.dispose(); state.candidates.dispose() }
    this.accounts.clear()
  }
}

export const recognizedSpeakerDirectory = new RecognizedSpeakerDirectory()
const accountKey = () => {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
}
let activeAccount = accountKey()
arkmeAuthStore.subscribe(() => {
  const next = accountKey()
  if (next !== activeAccount) { activeAccount = next; recognizedSpeakerDirectory.clear() }
})
