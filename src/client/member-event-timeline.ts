import type { ArkmeMemberEvent, ArkmeMemberEventPage, ArkmeMemberEventQuery } from '../types.js'

interface EventRange {
  id: string
  from: number
  to: number
  cursor?: string
  gapAt?: number
  failed?: boolean
  pending?: boolean
  fetchedAt?: number
  revision?: number
}

const CACHE_FRESH_MILLIS = 5 * 60_000
export interface MemberEventTimelineSnapshot {
  events: ArkmeMemberEvent[]
  gaps: Array<{ id: string; at: number }>
  loading: boolean
  unavailable: boolean
}

/** One account/group cache, with a selected display window. No expiry timer or polling. */
export class MemberEventTimeline {
  private events = new Map<string, ArkmeMemberEvent>()
  private ranges: EventRange[] = []
  private lower: number | undefined
  private upper = 0
  private sequence = 0
  private disposed = false
  private denied = false
  private active: AbortController | undefined
  private jobs: Array<{ range: EventRange; done: () => void }> = []
  private foreground = true
  private dirty = false
  private hintAt = 0
  private seen = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastRefresh = -Infinity
  private revision = 0
  private mode: 'latest' | 'around' = 'latest'
  private latestUpper: number | undefined
  private latestFetchedAt: number | undefined
  private latestRevision = -1
  private retryAt = 0

  constructor(
    private readonly read: (query: ArkmeMemberEventQuery, signal: AbortSignal) => Promise<ArkmeMemberEventPage>,
    private readonly changed: () => void = () => {},
    seed: readonly ArkmeMemberEvent[] = [],
  ) { for (const event of seed) this.events.set(event.eventId, event) }

  snapshot(lower = this.lower, upper = this.upper): MemberEventTimelineSnapshot {
    return {
      events: [...this.events.values()]
        .filter(event => lower !== undefined && event.occurredAtMillis >= lower && event.occurredAtMillis <= upper)
        .sort((a,b) => a.occurredAtMillis-b.occurredAtMillis || a.eventId.localeCompare(b.eventId)),
      gaps: this.ranges.filter(range => range.cursor !== undefined && range.gapAt !== undefined && !range.failed
        && lower !== undefined && range.gapAt >= lower && range.from <= upper)
        .map(range => ({ id: range.id, at: Math.min(range.gapAt!, upper) })),
      loading: this.active !== undefined,
      unavailable: this.denied,
    }
  }

  /** Pure render-time projection: never enters a window, expires data, or starts a read. */
  cachedSnapshot(mode: 'latest' | 'around', window?: { from: number; to?: number }): MemberEventTimelineSnapshot | undefined {
    if (this.disposed || this.denied) return undefined
    if ((window === undefined || (mode === 'around' && window.to === undefined)) && mode !== this.mode) return undefined
    const upper = window?.to ?? (mode === 'latest' ? this.latestUpper ?? this.upper : this.upper)
    return this.snapshot(window?.from ?? this.lower, upper)
  }

  windowUpper(): number { return this.upper }

  /** Re-entry is the only place that checks cache age. Pending reads remain shared. */
  async enterWindow(from: number, to: number, mode: 'latest' | 'around'): Promise<void> {
    if (this.disposed || this.denied || from < 0 || to < from) return
    this.mode = mode
    const coolingDown = Date.now() < this.retryAt
    if (mode === 'latest') {
      const fresh = this.latestFetchedAt !== undefined && Date.now() - this.latestFetchedAt < CACHE_FRESH_MILLIS
        && this.latestRevision === this.revision
      const pending = this.latestUpper !== undefined && this.ranges.some(range => range.pending
        && range.from <= this.latestUpper! && range.to >= this.latestUpper!)
      if (this.latestUpper === undefined || (!fresh && !pending && !coolingDown)) this.latestUpper = Math.max(to, this.hintAt)
      to = this.latestUpper
    }
    this.lower = from
    this.upper = to
    if (coolingDown) { this.changed(); return }
    this.ranges = this.ranges.filter(range => range.pending || range.to < from || range.from > to
      || (!range.failed && range.fetchedAt !== undefined && Date.now() - range.fetchedAt < CACHE_FRESH_MILLIS
        && range.revision === this.revision))
    if (this.active === undefined) this.dirty = false
    await this.setWindow(from, to)
  }

  async setWindow(from: number, to: number): Promise<void> {
    if (this.disposed || this.denied || from < 0 || to < from) return
    const missing: Array<[number,number]> = []
    let start = from
    for (const range of [...this.ranges].sort((a, b) => a.from - b.from)) {
      if (range.to < start || range.from > to) continue
      if (range.from > start) missing.push([start, range.from - 1])
      start = Math.max(start, range.to + 1)
    }
    if (start <= to) missing.push([start, to])
    this.lower = Math.min(this.lower ?? from,from)
    this.upper = Math.max(this.upper,to)
    const reads = missing.map(([start,end]) => this.enqueue(this.addRange(start,end)))
    this.changed()
    await Promise.all(reads)
    this.scheduleRefresh()
  }

  private addRange(from: number, to: number): EventRange {
    const range = { id: `range-${++this.sequence}`, from, to }
    this.ranges.push(range)
    return range
  }

  async loadGap(id: string): Promise<void> {
    if (this.disposed || this.denied || this.active !== undefined) return
    const range = this.ranges.find(value => value.id === id && value.cursor !== undefined && !value.failed)
    if (range !== undefined) await this.enqueue(range)
  }

  invalidate(eventId: string, occurredAt: number): void {
    if (this.disposed || this.denied || this.seen.has(eventId)) return
    this.seen.add(eventId)
    this.revision += 1
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!)
    this.hintAt = Math.max(this.hintAt,occurredAt)
    this.dirty = true
    this.scheduleRefresh()
  }

  setForeground(value: boolean): void {
    this.foreground = value
    if (!value && this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    this.scheduleRefresh()
  }

  revoke(): void {
    this.denied = true
    this.events.clear()
    this.ranges = []
    this.active?.abort()
    if (this.timer !== undefined) clearTimeout(this.timer)
    for (const job of this.jobs.splice(0)) job.done()
    this.changed()
  }

  private scheduleRefresh(): void {
    if (this.disposed || this.denied || !this.foreground || !this.dirty || this.lower === undefined || this.timer !== undefined || this.active !== undefined || this.jobs.length > 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.disposed || !this.foreground || !this.dirty || this.active !== undefined) return
      this.dirty = false
      this.lastRefresh = Date.now()
      if (this.mode === 'latest') {
        this.upper = Math.max(this.upper,this.hintAt)
        this.latestUpper = this.upper
      }
      this.ranges = this.ranges.filter(range => range.to < this.lower! || range.from > this.upper)
      void this.enqueue(this.addRange(this.lower!,this.upper))
    }, Math.max(300,this.lastRefresh+2_000-Date.now(),this.retryAt-Date.now()))
  }

  private enqueue(range: EventRange): Promise<void> {
    if (this.disposed || this.denied) return Promise.resolve()
    return new Promise(resolve => {
      range.pending = true
      this.jobs.push({range,done:resolve})
      this.pump()
    })
  }

  private pump(): void {
    if (this.disposed || this.denied || this.active !== undefined) return
    const job = this.jobs.shift()
    if (job === undefined) { this.scheduleRefresh(); return }
    const controller = new AbortController()
    this.active = controller
    this.changed()
    const { range } = job
    const revision = this.revision
    const firstPage = range.cursor === undefined
    void this.read({ fromAtMillis:range.from, toAtMillis:range.to, limit:50,
      ...(range.cursor === undefined ? {} : {cursor:range.cursor}),
    }, controller.signal).then(page => {
      if (this.disposed || controller.signal.aborted) return
      this.retryAt = 0
      if (firstPage) {
        range.fetchedAt = Date.now()
        range.revision = revision
      }
      delete range.failed
      if (firstPage && this.latestUpper !== undefined && range.from <= this.latestUpper && range.to >= this.latestUpper) {
        this.latestFetchedAt = range.fetchedAt
        this.latestRevision = revision
      }
      for (const event of page.items) this.events.set(event.eventId,event)
      if (page.hasMore && page.nextCursor !== undefined && page.nextCursor !== range.cursor && page.items.length > 0) {
        range.cursor = page.nextCursor
        range.gapAt = Math.min(...page.items.map(event => event.occurredAtMillis))
      } else {
        delete range.cursor
        delete range.gapAt
      }
    }).catch(error => {
      if (this.disposed || controller.signal.aborted) return
      range.failed = true
      this.retryAt = Date.now() + 2_000
      if (memberEventsUnavailable(error)) this.revoke()
      // No timer/retry on failure. A future actual hint or a new entry may try again.
    }).finally(() => {
      delete range.pending
      if (this.active === controller) this.active = undefined
      job.done()
      if (!this.disposed) { this.changed(); this.pump() }
    })
  }

  /** Bound inactive caches without claiming coverage for evicted rows or pages. */
  trim(): void {
    if (this.active !== undefined || this.jobs.length > 0) return
    const rows = [...this.events.values()].sort((a, b) => a.occurredAtMillis - b.occurredAtMillis || a.eventId.localeCompare(b.eventId))
    const removed = rows.slice(0, Math.max(0, rows.length - 1000))
    for (const row of removed) this.events.delete(row.eventId)
    this.ranges = this.ranges.filter(range => !removed.some(row => row.occurredAtMillis >= range.from && row.occurredAtMillis <= range.to)).slice(-200)
    if (!this.ranges.some(range => this.latestUpper !== undefined && range.from <= this.latestUpper && range.to >= this.latestUpper)) {
      this.latestFetchedAt = undefined
    }
  }

  dispose(): void {
    this.disposed = true
    this.active?.abort()
    if (this.timer !== undefined) clearTimeout(this.timer)
    for (const job of this.jobs.splice(0)) job.done()
  }
}

export function memberEventsUnavailable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const value = error as { code?: string; body?: { code?: string } }
  return (value.code ?? value.body?.code) === 'member-events-unavailable'
}
