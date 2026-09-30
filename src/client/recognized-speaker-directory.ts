import type { SpeakerDirectoryDetail, SpeakerDirectoryListInput, SpeakerDirectoryPage, SpeakerDirectoryQuery, SpeakerDirectorySeen, SpeakerDirectorySummary } from '../speaker-directory-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'

export interface DirectoryLoaders {
  summary(input: { snapshotVersion?: string; seenVersion?: number }, signal: AbortSignal): Promise<SpeakerDirectorySummary>
  list(input: SpeakerDirectoryListInput, signal: AbortSignal): Promise<SpeakerDirectoryPage>
  seen(throughCursor: string, signal: AbortSignal): Promise<SpeakerDirectorySeen>
  open(detailRef: string, signal: AbortSignal): Promise<SpeakerDirectoryDetail>
}
const loaders: DirectoryLoaders = {
  summary: (input, signal) => callArkme('speaker-directory.summary', input, signal),
  list: (input, signal) => callArkme('speaker-directory.list', { ...input }, signal),
  seen: (throughCursor, signal) => callArkme('speaker-directory.seen', { throughCursor }, signal),
  open: (detailRef, signal) => callArkme('speaker-directory.open', { detailRef }, signal),
}
export class SpeakerReadDeferred extends Error {
  constructor(readonly retryAt: number, cause: unknown) { super(cause instanceof Error ? cause.message : '说话人目录暂不可用', { cause }) }
}
export function directoryErrorCode(error: unknown): string {
  const value = error as { code?: string; body?: { code?: string } } | undefined
  return value?.body?.code ?? value?.code ?? ''
}
export function speakerRetryDelay(error: unknown): number | undefined {
  if (error instanceof SpeakerReadDeferred) return Math.max(1_000, error.retryAt - Date.now())
  const value = error as { body?: { retryable?: boolean; retryAfterMillis?: number }; retryable?: boolean; retryAfterMillis?: number } | undefined
  if (directoryErrorCode(error) === 'arkme-code-1001' || value?.body?.retryable === false || value?.retryable === false) return undefined
  return Math.max(1_000, value?.body?.retryAfterMillis ?? value?.retryAfterMillis ?? 15_000)
}
export const directoryVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
export const normalizeDirectoryQuery = (query: string) => query.trim().toLowerCase()
export function directoryQueryValid(query: string) { return new TextEncoder().encode(normalizeDirectoryQuery(query)).length <= 256 }
const queryKey = (query: SpeakerDirectoryQuery) => JSON.stringify([query.filter, query.sort, normalizeDirectoryQuery(query.query)])
const empty = Object.freeze({})
export interface DirectorySnapshot { summary?: SpeakerDirectorySummary; error?: string }
export interface DirectoryList extends SpeakerDirectoryPage { query: SpeakerDirectoryQuery; requestedCursors: string[] }
interface Account {
  controller: AbortController
  snapshot: DirectorySnapshot
  summaryAt: number
  retryAt: number
  failures: number
  flights: Map<string, Promise<unknown>>
  lists: Map<string, DirectoryList>
  pendingSeen: Set<string>
  confirmedSeen: Set<string>
  expiredSeen: Set<string>
  revision: number
}

/** Shared summary and immutable same-version pages. No traversal or local new-person inference. */
export class RecognizedSpeakerDirectory {
  private accounts = new Map<string, Account>()
  private listeners = new Set<() => void>()
  constructor(private readonly api: DirectoryLoaders = loaders, private readonly now = Date.now) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get = (account?: string): DirectorySnapshot => account === undefined ? empty : this.accounts.get(account)?.snapshot ?? empty
  private emit() { this.listeners.forEach(listener => listener()) }
  private account(key: string) {
    let found = this.accounts.get(key)
    if (!found) {
      found = { controller: new AbortController(), snapshot: empty, summaryAt: 0, retryAt: 0, failures: 0,
        flights: new Map(), lists: new Map(), pendingSeen: new Set(), confirmedSeen: new Set(), expiredSeen: new Set(), revision: 0 }
      this.accounts.set(key, found)
    }
    return found
  }
  private current(account: string, value: Account) {
    value.controller.signal.throwIfAborted()
    if (this.accounts.get(account) !== value) throw new DOMException('账号已切换', 'AbortError')
  }
  private async request<T>(account: string, key: string, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const value = this.account(account)
    this.current(account, value)
    key = `${value.revision}:${key}`
    const pending = value.flights.get(key)
    if (pending) return pending as Promise<T>
    if (this.now() < value.retryAt) throw new SpeakerReadDeferred(value.retryAt, new Error('请求较频繁或网络暂不可用，请稍后重试'))
    const promise = Promise.resolve().then(() => load(value.controller.signal)).then(result => {
      this.current(account, value); value.failures = 0; return result
    }).catch(error => {
      this.current(account, value)
      const delay = speakerRetryDelay(error)
      if (delay !== undefined) {
        value.failures += 1
        value.retryAt = this.now() + Math.max(delay, Math.min(300_000, 1_000 * 2 ** Math.min(8, value.failures)))
        throw new SpeakerReadDeferred(value.retryAt, error)
      }
      throw error
    }).finally(() => { if (value.flights.get(key) === promise) value.flights.delete(key) })
    value.flights.set(key, promise)
    return promise
  }
  async summary(account: string, force = false): Promise<SpeakerDirectorySummary> {
    const state = this.account(account), cached = state.snapshot.summary, revision = state.revision
    if (!force && cached && (cached.state === 'disabled' || this.now() < state.summaryAt)) return cached
    try {
      const result = await this.request(account, 'summary', signal => this.api.summary(cached && cached.snapshotVersion
        ? { snapshotVersion: cached.snapshotVersion, seenVersion: cached.seenVersion } : {}, signal))
      this.current(account, state)
      if (revision !== state.revision) return this.summary(account, force)
      state.snapshot = { summary: result }
      state.summaryAt = this.now() + (result.retryAfterMs > 0 ? result.retryAfterMs : 30_000)
      this.emit()
      return result
    } catch (error) {
      this.current(account, state)
      state.snapshot = { ...state.snapshot, error: error instanceof Error ? error.message : '目录暂不可用' }
      this.emit(); throw error
    }
  }
  peek(account: string, query: SpeakerDirectoryQuery): DirectoryList | undefined {
    return this.accounts.get(account)?.lists.get(queryKey(query))
  }
  async first(account: string, query: SpeakerDirectoryQuery, signal: AbortSignal, force = false): Promise<DirectoryList> {
    if (!directoryQueryValid(query.query)) throw new Error('搜索内容过长，请缩短至 256 字节以内')
    signal.throwIfAborted()
    const state = this.account(account), revision = state.revision
    const summary = await this.summary(account, force)
    signal.throwIfAborted()
    const key = queryKey(query), cached = state.lists.get(key)
    if (!force && cached && cached.snapshotVersion === summary.snapshotVersion && !state.expiredSeen.has(cached.throughCursor)) return cached
    const input = { ...query, query: normalizeDirectoryQuery(query.query), cursor: '', snapshotVersion: summary.snapshotVersion, limit: 50 }
    const page = summary.state === 'disabled' || summary.coverage !== 'complete'
      ? { ...summary, items: [], hasMore: false, nextCursor: '', throughCursor: '' } as SpeakerDirectoryPage
      : await this.request(account, `list:${JSON.stringify(input)}`, inner => this.api.list(input, inner))
    signal.throwIfAborted(); this.current(account, state)
    if (revision !== state.revision) throw new DOMException('目录已更新', 'AbortError')
    if (page.state === 'snapshot_expired') {
      state.summaryAt = 0; state.lists.delete(key)
      if (page.retryAfterMs > 0) { state.retryAt = Math.max(state.retryAt, this.now() + page.retryAfterMs); throw new SpeakerReadDeferred(state.retryAt, new Error('目录正在更新，请稍后重试')) }
      if (force) throw new Error('目录正在更新，请稍后刷新')
      return this.first(account, query, signal, true)
    }
    if (page.state === 'disabled') { state.snapshot = { summary: { ...summary, state: 'disabled' } }; this.emit() }
    const result: DirectoryList = { ...page, query: { ...query, query: input.query }, requestedCursors: [''] }
    if (page.coverage === 'complete' && page.state !== 'disabled') {
      state.lists.delete(key); state.lists.set(key, result)
      // Cache a bounded number of queries, with no cap on an individual directory's pagination.
      while (state.lists.size > 12) state.lists.delete(state.lists.keys().next().value!)
    }
    return result
  }
  async more(account: string, previous: DirectoryList, signal: AbortSignal): Promise<DirectoryList> {
    signal.throwIfAborted()
    if (!previous.hasMore) return previous
    const state = this.account(account), revision = state.revision
    if (!state.lists.has(queryKey(previous.query))) return this.first(account, previous.query, signal, true)
    const input = { ...previous.query, limit: 50, cursor: previous.nextCursor, snapshotVersion: previous.snapshotVersion }
    const page = await this.request(account, `list:${JSON.stringify(input)}`, inner => this.api.list(input, inner))
    signal.throwIfAborted(); this.current(account, state)
    if (revision !== state.revision) throw new DOMException('目录已更新', 'AbortError')
    if (page.state === 'snapshot_expired') {
      state.lists.delete(queryKey(previous.query)); state.summaryAt = 0
      if (page.retryAfterMs > 0) { state.retryAt = Math.max(state.retryAt, this.now() + page.retryAfterMs); throw new SpeakerReadDeferred(state.retryAt, new Error('目录正在更新，请稍后刷新')) }
      return this.first(account, previous.query, signal, true)
    }
    if (page.state === 'disabled') {
      const summary = state.snapshot.summary
      if (summary) { state.snapshot = { summary: { ...summary, state: 'disabled' } }; this.emit() }
      return { ...previous, state: 'disabled', hasMore: false }
    }
    if (page.snapshotVersion !== previous.snapshotVersion || page.coverage !== 'complete'
      || (page.hasMore && (page.nextCursor === previous.nextCursor || previous.requestedCursors.includes(page.nextCursor)))) throw new Error('目录版本已变化，请刷新列表')
    const keys = new Set(previous.items.map(item => item.personKey))
    const result = { ...page, query: previous.query, requestedCursors: [...previous.requestedCursors, previous.nextCursor], items: [...previous.items, ...page.items.filter(item => { if (keys.has(item.personKey)) return false; keys.add(item.personKey); return true })] }
    state.lists.set(queryKey(previous.query), result)
    return result
  }
  async confirmDisplayed(account: string, list: DirectoryList): Promise<void> {
    if (!directoryVisible() || list.query.filter !== 'all' || list.query.query !== '' || list.coverage !== 'complete'
      || !['fresh', 'stale', 'failed'].includes(list.state) || !list.throughCursor) return
    const state = this.account(account)
    if (state.confirmedSeen.has(list.throughCursor) || state.expiredSeen.has(list.throughCursor) || state.snapshot.summary?.state === 'disabled') return
    state.pendingSeen.add(list.throughCursor)
    await this.flushSeen(account)
  }
  private async flushSeen(account: string): Promise<void> {
    const state = this.account(account)
    if (!directoryVisible() || state.snapshot.summary?.state === 'disabled') return
    for (const cursor of state.pendingSeen) {
      let result: SpeakerDirectorySeen
      try { result = await this.request(account, `seen:${cursor}`, signal => this.api.seen(cursor, signal)) }
      catch (error) {
        if (directoryErrorCode(error) === 'arkme-code-1001') {
          state.pendingSeen.delete(cursor); state.expiredSeen.add(cursor); state.lists.clear(); state.summaryAt = 0; this.emit(); continue
        }
        throw error
      }
      this.current(account, state)
      if (result.success) { state.pendingSeen.delete(cursor); state.confirmedSeen.add(cursor); await Promise.allSettled([...state.flights.entries()].filter(([key]) => key.endsWith(':summary')).map(([, promise]) => promise)); await this.summary(account, true) }
      else if (result.state === 'snapshot_expired') {
        state.pendingSeen.delete(cursor); state.expiredSeen.add(cursor); state.lists.clear(); state.summaryAt = 0
        if (result.retryAfterMs > 0) state.retryAt = Math.max(state.retryAt, this.now() + result.retryAfterMs)
        this.emit()
      } else {
        state.pendingSeen.clear()
        if (state.snapshot.summary) state.snapshot = { summary: { ...state.snapshot.summary, state: 'disabled' } }
        this.emit(); return
      }
    }
  }
  hasPendingSeen(account: string) { return (this.accounts.get(account)?.pendingSeen.size ?? 0) > 0 }
  needsReload(account: string, list: DirectoryList) { return this.accounts.get(account)?.expiredSeen.has(list.throughCursor) === true }
  open(account: string, ref: string, signal: AbortSignal) {
    signal.throwIfAborted()
    return this.request(account, `open:${ref}`, inner => this.api.open(ref, inner)).then(value => { signal.throwIfAborted(); return value })
  }
  /** Visible consumers share one lightweight summary request, including online/focus recovery. */
  watch(account: string, changed: () => void = () => {}): () => void {
    let disposed = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      if (disposed || busy || !directoryVisible()) return
      busy = true
      let delay = 30_000
      try {
        const summary = await this.summary(account)
        if (summary.state === 'disabled') { changed(); return }
        await this.flushSeen(account)
        changed(); delay = summary.retryAfterMs > 0 ? summary.retryAfterMs : 30_000
      } catch (error) { delay = speakerRetryDelay(error) ?? 0; changed() }
      finally {
        busy = false
        if (!disposed && delay > 0 && this.get(account).summary?.state !== 'disabled') {
          clearTimeout(timer); timer = setTimeout(() => { void run() }, Math.max(1_000, delay))
        }
      }
    }
    const wake = () => { if (directoryVisible()) { const value = this.account(account); value.summaryAt = 0; void run() } }
    void run()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
    if (typeof window !== 'undefined') { window.addEventListener('online', wake); window.addEventListener('focus', wake) }
    return () => { disposed = true; clearTimeout(timer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake)
      if (typeof window !== 'undefined') { window.removeEventListener('online', wake); window.removeEventListener('focus', wake) } }
  }
  invalidate(account: string) {
    const state = this.accounts.get(account)
    if (!state) return
    state.revision += 1; state.summaryAt = 0; state.lists.clear()
    // Keep server cooldown and pending confirmations for versions actually displayed.
    this.emit()
  }
  clear() { this.accounts.forEach(state => state.controller.abort()); this.accounts.clear(); this.emit() }
}
export const recognizedSpeakerDirectory = new RecognizedSpeakerDirectory()
const currentAccount = () => { const auth = arkmeAuthStore.getSnapshot().auth; return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : '' }
let account = currentAccount()
arkmeAuthStore.subscribe(() => { const next = currentAccount(); if (next !== account) { account = next; recognizedSpeakerDirectory.clear() } })
