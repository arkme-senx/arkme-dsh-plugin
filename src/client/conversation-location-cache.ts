import type { ConversationLocationPage, ConversationLocationRecord } from '../conversation-location.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export interface ConversationLocationState { items: ConversationLocationRecord[]; scanned: number; complete: boolean; loading: boolean; error: string }
const empty: ConversationLocationState = { items: [], scanned: 0, complete: false, loading: false, error: '' }
interface Progress { items: Map<string, ConversationLocationRecord>; scanned: number; cursor?: string; cursors: Set<string> }
interface Entry { state: ConversationLocationState; at: number; stale: boolean; paused?: boolean; progress?: Progress; pending?: Promise<void>; controller?: AbortController }
/** Compact coordinates and snippets, memory only. One ongoing read per account/scope. */
export class ConversationLocationCache {
  private account: string | undefined
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  constructor(private read = (sourceRef: string, cursor: string | undefined, signal: AbortSignal): Promise<ConversationLocationPage> =>
    withArkmeReadDeadline(inner => callArkme('search.conversation-locations', { sourceRef, ...(cursor ? { cursor } : {}) }, inner), signal), private now = Date.now) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { for (const listener of this.listeners) listener() }
  activate(account: string | undefined) { if (this.account !== account) { this.account = account; this.invalidate(true) } }
  invalidate(hard: boolean) {
    for (const entry of this.entries.values()) { entry.stale = true; if (hard) entry.controller?.abort() }
    if (hard) this.entries.clear()
    this.emit()
  }
  get(account: string, sourceRef: string): ConversationLocationState {
    const entry = account === this.account ? this.entries.get(sourceRef) : undefined
    return entry && (entry.pending || this.now() - entry.at < 300_000) ? entry.state : empty
  }
  pause(account: string, sourceRef: string): void {
    const entry = account === this.account ? this.entries.get(sourceRef) : undefined
    if (entry) entry.paused = true
  }
  load(account: string, sourceRef: string, force = false): Promise<void> {
    if (account !== this.account) return Promise.resolve()
    let entry = this.entries.get(sourceRef)
    if (entry) entry.paused = false
    if (entry?.pending) return entry.pending
    if (!force && entry && !entry.stale && entry.state.complete && this.now() - entry.at < 60_000) return Promise.resolve()
    for (const [key, other] of this.entries) if (key !== sourceRef && other.pending) {
      other.controller?.abort(); delete other.controller; delete other.pending
      other.state = { ...other.state, loading: false }
    }
    if (!entry) { entry = { state: empty, at: 0, stale: true }; this.entries.set(sourceRef, entry) }
    const current = entry, controller = new AbortController(), previous = this.get(account, sourceRef)
    const progress = !force && !current.stale && !current.state.complete && this.now() - current.at < 300_000 && current.progress
      || { items: new Map<string, ConversationLocationRecord>(), scanned: 0, cursors: new Set<string>() } as Progress
    current.progress = progress
    current.controller = controller; current.stale = false
    current.state = { ...previous, loading: true, error: '' }
    this.entries.delete(sourceRef); this.entries.set(sourceRef, current)
    while (this.entries.size > 6) { const key = this.entries.keys().next().value!; this.entries.get(key)?.controller?.abort(); this.entries.delete(key) }
    const active = () => !controller.signal.aborted && this.account === account && this.entries.get(sourceRef) === current
    current.pending = Promise.resolve().then(async () => {
      const { items, cursors } = progress
      let cursor = progress.cursor, scanned = progress.scanned
      for (let index = 0; index < 10_000; index++) {
        controller.signal.throwIfAborted()
        const page = await this.read(sourceRef, cursor, controller.signal)
        if (!active()) return
        if (!Array.isArray(page.items) || !Number.isSafeInteger(page.scanned) || page.scanned < 0) throw new Error('位置返回不完整，请重试')
        for (const item of page.items) items.set(item.key, item)
        scanned += page.scanned
        const data = { items: [...items.values()], scanned, complete: !page.hasMore, loading: page.hasMore, error: '' }
        // Keep a complete previous snapshot until its replacement is complete.
        current.state = previous.complete && page.hasMore ? { ...previous, loading: true, error: '' } : data
        current.at = this.now(); this.emit()
        if (!page.hasMore) { delete current.progress; return }
        if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('位置分页未推进，请重试')
        cursors.add(page.nextCursor); cursor = page.nextCursor
        progress.cursor = cursor; progress.scanned = scanned
        if (current.paused) { current.state = { ...current.state, loading: false }; return }
      }
      throw new Error('历史数据较多，位置尚未读取完整，请重试')
    }).catch(error => {
      if (active()) { current.state = { ...current.state, loading: false, error: error instanceof Error ? error.message : '位置读取失败' }; current.at = this.now() }
    }).finally(() => { if (active()) { delete current.pending; delete current.controller; this.emit() } })
    this.emit()
    return current.pending
  }
}
export const conversationLocationCache = new ConversationLocationCache()
