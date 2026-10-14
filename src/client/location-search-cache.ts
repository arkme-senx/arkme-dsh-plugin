import type { LocationMarker, LocationQuery, LocationRecords, LocationSource, LocationViewport } from '../location-search.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'
import { arkmeUi } from './ui-controller.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { resetLocationMapSessions } from './location-map-session.js'
import { dayLocationCache } from './day-location-cache.js'

const FRESH_MS = 60_000
const RETAIN_MS = 300_000
const LIMIT = 24
export interface LocationSelection { marker: LocationMarker; query: LocationViewport }
export interface LocationNavigation {
  viewport: LocationViewport
  sources: LocationSource[]
  selected?: LocationSelection | undefined
  scrollTop: number
  recordLimit?: number
  page?: { key: string; data: LocationRecords } | undefined
}
interface Entry { mode: LocationQuery['mode']; value?: unknown; updated: number; stale?: boolean; pending?: Promise<unknown> | undefined; controller?: AbortController | undefined }
export const locationQueryKey = (query: LocationQuery): string => JSON.stringify([
  query.mode, query.bounds, query.zoom, query.clusterKeys, query.offset ?? 0, query.cursor, query.limit,
])

/** Short-lived memory only, owned by one login. In-flight reads survive closing search. */
export class LocationSearchCache {
  private account: string | undefined
  private entries = new Map<string, Entry>()
  private navigation = new Map<string, { value: LocationNavigation; at: number }>()
  private revision = 0
  private hardRevision = 0
  private listeners = new Set<() => void>()
  constructor(
    private readonly read: (query: LocationQuery, signal: AbortSignal) => Promise<unknown>
      = (query, signal) => withArkmeReadDeadline(inner => callArkme('search.locations', { ...query }, inner), signal),
    private readonly now = Date.now,
  ) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getRevision = () => this.revision
  getHardRevision = () => this.hardRevision
  activate(account: string | undefined): void {
    if (this.account === account) return
    this.account = account; this.navigation.clear()
    this.invalidate(true)
  }
  invalidate(hard: boolean): void {
    for (const entry of this.entries.values()) {
      entry.stale = true
      if (hard) { entry.controller?.abort(); entry.pending = undefined; entry.controller = undefined }
    }
    if (hard) { this.hardRevision++; this.entries.clear(); for (const navigation of this.navigation.values()) navigation.value = { ...navigation.value, selected: undefined, page: undefined, scrollTop: 0 } }
    this.revision++
    for (const listener of this.listeners) listener()
  }
  getNavigation(account: string, scope = 'all'): LocationNavigation | undefined {
    const navigation = this.navigation.get(scope)
    if (account !== this.account || !navigation) return
    const { value, at } = navigation
    return this.now() - at < RETAIN_MS ? value : { ...value, selected: undefined, page: undefined, scrollTop: 0 }
  }
  saveNavigation(account: string, value: LocationNavigation, scope = 'all'): void {
    if (account === this.account) {
      this.navigation.delete(scope); this.navigation.set(scope, { value, at: this.now() })
      while (this.navigation.size > 7) this.navigation.delete(this.navigation.keys().next().value!)
    }
  }
  peek<T>(account: string, query: LocationQuery): T | undefined {
    if (account !== this.account) return
    const entry = this.entries.get(locationQueryKey(query))
    return entry && this.now() - entry.updated < RETAIN_MS ? entry.value as T | undefined : undefined
  }
  load<T>(account: string, query: LocationQuery, force = false): Promise<T> {
    if (!account || this.account !== account) return Promise.reject(new Error('登录账号已变化，请重新打开位置'))
    const key = locationQueryKey(query)
    let entry = this.entries.get(key)
    if (entry?.pending) return entry.pending as Promise<T>
    if (!force && !entry?.stale && entry?.value !== undefined && this.now() - entry.updated < FRESH_MS) return Promise.resolve(entry.value as T)
    // A newer map view/selection supersedes the previous one; reopening the same query still joins it.
    for (const [otherKey, other] of this.entries) {
      if (otherKey !== key && other.mode === query.mode && other.pending) {
        other.controller?.abort(); other.controller = undefined; other.pending = undefined; other.stale = true
      }
    }
    if (!entry) { entry = { mode: query.mode, updated: 0 }; this.entries.set(key, entry) }
    // Touch in request order and bound retained pages/obsolete map views.
    this.entries.delete(key); this.entries.set(key, entry)
    while (this.entries.size > LIMIT) {
      const oldest = this.entries.keys().next().value!
      this.entries.get(oldest)?.controller?.abort(); this.entries.delete(oldest)
    }
    const current = entry, controller = new AbortController(), revision = this.revision
    current.controller = controller
    current.pending = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return this.read(query, controller.signal) }).then(value => {
      controller.signal.throwIfAborted()
      if (this.account !== account || this.entries.get(key) !== current) throw new Error('位置数据已更新，请重试')
      current.value = value; current.updated = this.now(); current.stale = revision !== this.revision
      return value
    }).finally(() => { if (current.controller === controller) { current.pending = undefined; current.controller = undefined } })
    return current.pending as Promise<T>
  }
}

export const locationSearchCache = new LocationSearchCache()
function syncAccount() {
  const auth = arkmeAuthStore.getSnapshot().auth
  const account = auth && ['authenticated', 'binding-required'].includes(auth.status) ? `${auth.environment}:${auth.userId}` : undefined
  locationSearchCache.activate(account)
  dayLocationCache.activate(account)
  resetLocationMapSessions(account)
}
let started = false
/** Attach once on first use; keep invalidations active while the location view is closed. */
export function startLocationSearchCache(): void {
  if (started) return
  started = true
  let hardRevision = locationSearchCache.getHardRevision()
  locationSearchCache.subscribe(() => {
    const next = locationSearchCache.getHardRevision()
    dayLocationCache.invalidate(next !== hardRevision); hardRevision = next
  })
  arkmeAuthStore.subscribe(syncAccount)
  syncAccount()
  arkmeCalendarInvalidations.subscribe(event => locationSearchCache.invalidate(event.hard))
  let recordRevision = arkmeUi.getRecordRevision()
  arkmeUi.subscribe(() => {
    const next = arkmeUi.getRecordRevision()
    if (next !== recordRevision) { recordRevision = next; locationSearchCache.invalidate(true) }
  })
}
