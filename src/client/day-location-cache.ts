import { readDayLocations, type DayLocationsSnapshot } from './day-location-reader.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { callArkme } from './api.js'

export interface LocationDateFilter { bucketDate: string; timezone: string }
export interface DayLocationState { data: DayLocationsSnapshot; loading: boolean; error: string }
const emptyData: DayLocationsSnapshot = { points: [], scanned: 0, failed: 0, complete: false }
const emptyState: DayLocationState = { data: emptyData, loading: false, error: '' }
interface Entry { state: DayLocationState; at: number; stale: boolean; controller?: AbortController; pending?: Promise<void> }
const keyOf = (date: LocationDateFilter) => JSON.stringify([date.bucketDate, date.timezone])
/** Bounded, account-owned snapshots; closing a view does not restart the same day's scan. */
export class DayLocationCache {
  private account: string | undefined
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  constructor(private read: typeof readDayLocations = (date, signal, progress) => readDayLocations(date, signal, progress,
    (operation, params, outerSignal) => withArkmeReadDeadline(inner => callArkme(operation, params, inner), outerSignal ?? signal)), private now = Date.now) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { for (const listener of this.listeners) listener() }
  activate(account: string | undefined) { if (this.account !== account) { this.account = account; this.invalidate(true) } }
  invalidate(hard: boolean) {
    for (const entry of this.entries.values()) { entry.stale = true; if (hard) entry.controller?.abort() }
    if (hard) this.entries.clear()
    this.emit()
  }
  get(account: string, date: LocationDateFilter): DayLocationState {
    const entry = account === this.account ? this.entries.get(keyOf(date)) : undefined
    return entry && (entry.pending || this.now() - entry.at < 300_000) ? entry.state : emptyState
  }
  load(account: string, date: LocationDateFilter, force = false): Promise<void> {
    if (!account || this.account !== account) return Promise.resolve()
    const key = keyOf(date)
    let entry = this.entries.get(key)
    if (entry?.pending) return entry.pending
    if (!force && entry && !entry.stale && entry.state.data.complete && this.now() - entry.at < 60_000) return Promise.resolve()
    for (const [otherKey, other] of this.entries) {
      if (otherKey === key || !other.pending) continue
      other.controller?.abort(); delete other.controller; delete other.pending
      other.stale = true; other.state = { ...other.state, loading: false }
    }
    if (!entry) { entry = { state: emptyState, at: 0, stale: true }; this.entries.set(key, entry) }
    const current = entry, controller = new AbortController()
    current.controller = controller; current.stale = false
    const previous = this.get(account, date).data
    current.state = { data: previous, loading: true, error: '' }
    this.entries.delete(key); this.entries.set(key, current)
    while (this.entries.size > 6) { const oldest = this.entries.keys().next().value!; this.entries.get(oldest)?.controller?.abort(); this.entries.delete(oldest) }
    const active = () => !controller.signal.aborted && this.account === account && this.entries.get(key) === current
    current.pending = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return this.read(date, controller.signal, data => {
        if (active()) { current.state = { data: previous.complete ? previous : data, loading: true, error: '' }; current.at = this.now(); this.emit() }
      })
    }).then(data => { if (active()) { current.state = { data, loading: false, error: '' }; current.at = this.now() } })
      .catch(reason => { if (active()) { current.state = { ...current.state, loading: false, error: reason instanceof Error ? reason.message : '当天位置加载失败' }; current.at = this.now() } })
      .finally(() => { if (active()) { delete current.pending; delete current.controller; this.emit() } })
    this.emit()
    return current.pending
  }
}
export const dayLocationCache = new DayLocationCache()
