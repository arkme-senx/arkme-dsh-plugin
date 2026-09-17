import type { ArkmeCalendarBucketPage } from '../types.js'
import { callArkme } from './api.js'
import { arkmeCalendarInvalidations, type CalendarInvalidation } from './calendar-invalidation-store.js'

export interface CalendarMonthQuery {
  scopeKey: string
  sourceRef?: string
  startDate: string
  endDate: string
  timezone: string
}
export interface CalendarMonthSnapshot { value?: ArkmeCalendarBucketPage; loading: boolean; error: string }
export const EMPTY_CALENDAR_MONTH: CalendarMonthSnapshot = { loading: false, error: '' }
const PREFIX = 'dsh-arkme:calendar-months:v1:'
const LIMIT = 48
const RETAIN_MS = 7 * 86_400_000
const FRESH_MS = 60_000
interface Entry {
  query: CalendarMonthQuery
  snapshot: CalendarMonthSnapshot
  refreshed: number
  listeners: Set<() => void>
  controller?: AbortController
  pending?: Promise<void>
}
const identity = (query: CalendarMonthQuery) => JSON.stringify([query.scopeKey, query.timezone, query.startDate, query.endDate])
const storage = (): Storage | undefined => { try { return globalThis.localStorage } catch { return undefined } }

/** Bounded per-account month summaries only. No record bodies, tokens or media are persisted. */
export class CalendarMonthCache {
  private account: string | undefined
  private entries = new Map<string, Entry>()
  private saved = new Map<string, { value: ArkmeCalendarBucketPage; refreshed: number }>()
  constructor(
    private readonly load: (query: CalendarMonthQuery, signal: AbortSignal, background: boolean) => Promise<ArkmeCalendarBucketPage>
      = (query, signal, background) => { const { scopeKey: _, ...params } = query; return callArkme('calendar.buckets', { ...params, background }, signal) },
    private readonly getStorage: () => Storage | undefined = storage,
    private readonly now = Date.now,
  ) {}

  activateAccount(account: string | undefined): void {
    if (this.account === account) return
    const previous = this.account
    this.account = account
    for (const entry of this.entries.values()) { entry.controller?.abort(); for (const notify of entry.listeners) notify() }
    this.entries.clear(); this.saved.clear()
    if (previous) { try { this.getStorage()?.removeItem(PREFIX + previous) } catch { /* optional storage */ } }
    if (!account) return
    try {
      const rows: unknown = JSON.parse(this.getStorage()?.getItem(PREFIX + account) ?? '[]')
      if (!Array.isArray(rows)) return
      for (const row of rows.slice(-LIMIT)) {
        if (typeof row?.key !== 'string' || row.key.length > 3000 || !Number.isFinite(row.refreshed)
          || row.refreshed > this.now() || this.now() - row.refreshed > RETAIN_MS) continue
        const value = cleanPage(row.value)
        if (value) this.saved.set(row.key, { value, refreshed: row.refreshed })
      }
    } catch { /* An unreadable/unsupported snapshot is a cache miss. */ }
  }

  private entry(query: CalendarMonthQuery): Entry {
    const key = identity(query)
    let entry = this.entries.get(key)
    if (!entry) {
      const saved = this.saved.get(key)
      entry = { query, snapshot: { ...(saved ? { value: saved.value } : {}), loading: false, error: '' },
        // Disk is immediately usable, but always revalidated after a page reload.
        refreshed: 0, listeners: new Set() }
      this.entries.set(key, entry)
    } else { entry.query = query; this.entries.delete(key); this.entries.set(key, entry) }
    this.prune()
    return entry
  }
  get(account: string, query: CalendarMonthQuery): CalendarMonthSnapshot {
    return this.account === account ? this.entry(query).snapshot : EMPTY_CALENDAR_MONTH
  }
  subscribe(account: string, query: CalendarMonthQuery, notify: () => void): () => void {
    this.activateAccount(account)
    const entry = this.entry(query)
    entry.listeners.add(notify)
    return () => {
      entry.listeners.delete(notify)
      if (!entry.listeners.size && entry.controller) {
        this.cancel(entry)
        entry.snapshot = { ...entry.snapshot, loading: false }
      }
    }
  }
  async ensure(account: string, query: CalendarMonthQuery, background = false): Promise<void> {
    if (account !== this.account) return
    const entry = this.entry(query)
    if (entry.pending) return entry.pending
    if (entry.snapshot.value && entry.refreshed > 0 && this.now() - entry.refreshed < FRESH_MS) return
    const controller = new AbortController()
    entry.controller = controller
    this.publish(entry, { ...entry.snapshot, loading: true, error: '' })
    const current = () => this.account === account && entry.controller === controller && !controller.signal.aborted
    entry.pending = Promise.resolve().then(() => this.load(query, controller.signal, background)).then(value => {
      if (!current()) return
      entry.refreshed = this.now()
      this.publish(entry, { value, loading: false, error: '' })
      const clean = cleanPage(value)
      if (clean) { this.saved.delete(identity(query)); this.saved.set(identity(query), { value: clean, refreshed: entry.refreshed }); this.persist() }
    }).catch(error => {
      if (!current()) return
      const code = (error as { body?: { code?: string } } | undefined)?.body?.code
      const accessDenied = code && /privacy|login-required|account-changed|source-invalid|ref-invalid|not-found/.test(code)
      if (accessDenied) {
        this.saved.delete(identity(query)); this.persist(); entry.refreshed = 0
      }
      this.publish(entry, { ...(accessDenied ? {} : entry.snapshot), loading: false, error: error instanceof Error ? error.message : String(error) })
    }).finally(() => { if (entry.controller === controller) { delete entry.pending; delete entry.controller } })
    return entry.pending
  }
  invalidate(event: CalendarInvalidation): void {
    const affected = (start: string, end: string) => !event.dates || event.dates.some(day => day >= start && day <= end)
    for (const [key, saved] of this.saved) {
      if (!affected(saved.value.startDate, saved.value.endDate)) continue
      if (event.hard) this.saved.delete(key)
    }
    if (event.hard) this.persist()
    for (const entry of [...this.entries.values()]) {
      if (!affected(entry.query.startDate, entry.query.endDate)) continue
      this.cancel(entry); entry.refreshed = 0
      this.publish(entry, { ...(event.hard ? {} : entry.snapshot.value ? { value: entry.snapshot.value } : {}), loading: false, error: '' })
      if (entry.listeners.size && this.account) void this.ensure(this.account, entry.query)
    }
  }
  private cancel(entry: Entry): void { entry.controller?.abort(); delete entry.controller; delete entry.pending }
  private publish(entry: Entry, snapshot: CalendarMonthSnapshot): void { entry.snapshot = snapshot; for (const notify of entry.listeners) notify() }
  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= LIMIT) break
      if (!entry.listeners.size && !entry.pending) this.entries.delete(key)
    }
  }
  private persist(): void {
    while (this.saved.size > LIMIT) this.saved.delete(this.saved.keys().next().value!)
    if (!this.account) return
    try { this.getStorage()?.setItem(PREFIX + this.account, JSON.stringify([...this.saved].map(([key, value]) => ({ key, ...value })))) } catch { /* Memory caching still works. */ }
  }
}

function cleanPage(value: unknown): ArkmeCalendarBucketPage | undefined {
  const page = value as ArkmeCalendarBucketPage | undefined
  if (!page || !['self', 'send_to_self', 'topic', 'uncategorized'].includes(page.scope)
    || !/^\d{4}-\d{2}-\d{2}$/.test(page.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(page.endDate)
    || typeof page.timezone !== 'string' || page.timezone.length > 80 || !Array.isArray(page.days) || page.days.length > 62) return
  const days = page.days.filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day.bucketDate)
    && day.bucketDate >= page.startDate && day.bucketDate <= page.endDate
    && Number.isSafeInteger(day.count) && day.count >= 0).map(day => ({ bucketDate: day.bucketDate, count: day.count,
      hasRecords: day.count > 0, protectedCount: 0,
      ...(Number.isFinite(day.firstSendAtMillis) ? { firstSendAtMillis: day.firstSendAtMillis } : {}) }))
  return { scope: page.scope, startDate: page.startDate, endDate: page.endDate, timezone: page.timezone,
    refreshedAtMillis: Number.isFinite(page.refreshedAtMillis) ? page.refreshedAtMillis : 0, days }
}

export const arkmeCalendarMonths = new CalendarMonthCache()
arkmeCalendarInvalidations.subscribe(event => { arkmeCalendarMonths.invalidate(event) })
