const MAX_PENDING_DATE_KEYS = 128

export type ArkmeCalendarInvalidationHint =
  | { dateKey: string; dateStamp?: never }
  | { dateStamp: number; dateKey?: never }

type Listener = () => void

function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function normalizedDateKey(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return undefined
  }
  return `${match[1]}-${match[2]}-${match[3]}`
}

function normalizedMonthKey(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : undefined
}

function dateKeyFromHint(hint: ArkmeCalendarInvalidationHint): string | undefined {
  if (hint.dateKey !== undefined) return normalizedDateKey(hint.dateKey)
  if (!Number.isFinite(hint.dateStamp)) return undefined
  const date = new Date(hint.dateStamp)
  return Number.isFinite(date.getTime()) ? localDateKey(date) : undefined
}

function addListener(
  listenersByScope: Map<string, Set<Listener>>,
  scope: string,
  listener: Listener,
): () => void {
  const listeners = listenersByScope.get(scope) ?? new Set<Listener>()
  listeners.add(listener)
  listenersByScope.set(scope, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByScope.delete(scope)
  }
}

/** Browser-local owner for coalesced, date-scoped Calendar invalidation hints. */
export class ArkmeCalendarInvalidationStore {
  private readonly dateListeners = new Map<string, Set<Listener>>()
  private readonly monthListeners = new Map<string, Set<Listener>>()
  private readonly pendingDateKeys = new Set<string>()
  private pendingAllDates = false
  private flushScheduled = false

  subscribeDate(dateKey: string, listener: Listener): () => void {
    const normalized = normalizedDateKey(dateKey)
    if (normalized === undefined) throw new RangeError(`Invalid Calendar date key: ${dateKey}`)
    return addListener(this.dateListeners, normalized, listener)
  }

  subscribeMonth(monthKey: string, listener: Listener): () => void {
    const normalized = normalizedMonthKey(monthKey)
    if (normalized === undefined) throw new RangeError(`Invalid Calendar month key: ${monthKey}`)
    return addListener(this.monthListeners, normalized, listener)
  }

  publish(hint: ArkmeCalendarInvalidationHint): void {
    const dateKey = dateKeyFromHint(hint)
    if (dateKey === undefined) return
    if (!this.pendingAllDates) {
      if (this.pendingDateKeys.size >= MAX_PENDING_DATE_KEYS && !this.pendingDateKeys.has(dateKey)) {
        this.pendingDateKeys.clear()
        this.pendingAllDates = true
      } else {
        this.pendingDateKeys.add(dateKey)
      }
    }
    this.scheduleFlush()
  }

  publishAll(): void {
    this.pendingDateKeys.clear()
    this.pendingAllDates = true
    this.scheduleFlush()
  }

  listenerCount(): number {
    let count = 0
    for (const listeners of this.dateListeners.values()) count += listeners.size
    for (const listeners of this.monthListeners.values()) count += listeners.size
    return count
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => { this.flush() })
  }

  private flush(): void {
    this.flushScheduled = false
    const pendingAllDates = this.pendingAllDates
    const dateKeys = [...this.pendingDateKeys]
    this.pendingAllDates = false
    this.pendingDateKeys.clear()
    const listeners = new Set<Listener>()
    if (pendingAllDates) {
      for (const scoped of this.dateListeners.values()) for (const listener of scoped) listeners.add(listener)
      for (const scoped of this.monthListeners.values()) for (const listener of scoped) listeners.add(listener)
    } else {
      for (const dateKey of dateKeys) {
        for (const listener of this.dateListeners.get(dateKey) ?? []) listeners.add(listener)
        for (const listener of this.monthListeners.get(dateKey.slice(0, 7)) ?? []) listeners.add(listener)
      }
    }
    for (const listener of listeners) listener()
  }
}

export const arkmeCalendarInvalidations = new ArkmeCalendarInvalidationStore()
