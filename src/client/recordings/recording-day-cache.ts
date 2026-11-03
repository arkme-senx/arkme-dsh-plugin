import type { ArkmeRecordingDay } from '../../types.js'
import type { RecordingDayOverview } from './recording-day-overview.js'
import type { RecordingScrollAnchor } from './recording-scroll-anchor.js'

export type RecordingCachedTab = 'transcript' | 'summary' | 'timeline' | 'files'
export interface RecordingDayView {
  tab: RecordingCachedTab
  summaryVersionId: string
  timelineVersionId: string
}
export interface RecordingDayPosition {
  top: number
  left: number
  anchor?: Pick<RecordingScrollAnchor, 'item' | 'time' | 'offset'>
}
interface Entry {
  account: string
  day: ArkmeRecordingDay
  view?: RecordingDayView
  positions: Partial<Record<RecordingCachedTab, RecordingDayPosition>>
  overview?: { key: string; value: RecordingDayOverview }
  bytes: number
}
interface Limits { daysPerAccount: number; bytesPerAccount: number; totalBytes: number }

/** Session-only display snapshots. No audio bytes, DOM nodes or login tokens. */
export class RecordingDayCache {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly limits: Limits = { daysPerAccount: 8, bytesPerAccount: 32 * 1024 ** 2, totalBytes: 96 * 1024 ** 2 }) {}

  get(scope: string, account: string): Entry | undefined {
    const entry = this.entries.get(scope)
    if (!entry || entry.account !== account) return undefined
    this.entries.delete(scope); this.entries.set(scope, entry)
    return entry
  }

  setDay(scope: string, account: string, day: ArkmeRecordingDay): void {
    const previous = this.get(scope, account)
    if (previous?.day === day) return
    const entry: Entry = { account, day, positions: previous?.positions ?? {}, bytes: 0,
      ...(previous?.view ? { view: previous.view } : {}),
      ...(previous?.overview && previous.day.transcript.viewRef === day.transcript.viewRef ? { overview: previous.overview } : {}),
    }
    this.store(scope, entry)
  }

  setView(scope: string, account: string, view: RecordingDayView): void {
    const entry = this.get(scope, account)
    if (entry) entry.view = view
  }

  setPosition(scope: string, account: string, tab: RecordingCachedTab, position: RecordingDayPosition): void {
    const entry = this.get(scope, account)
    if (entry) entry.positions[tab] = position
  }

  getOverview(scope: string, account: string, key: string): RecordingDayOverview | undefined {
    const entry = this.get(scope, account)
    return entry?.overview?.key === key ? entry.overview.value : undefined
  }

  setOverview(scope: string, account: string, key: string, viewRef: string, value: RecordingDayOverview): void {
    const entry = this.get(scope, account)
    if (!entry || entry.day.transcript.viewRef !== viewRef) return
    this.store(scope, { ...entry, overview: { key, value } })
  }

  /** Keep readable days, but rebuild affected metadata after a confirmed write. */
  invalidateAccount(account: string): void {
    for (const [scope, entry] of [...this.entries]) if (entry.account === account && entry.overview) {
      const { overview: _overview, ...rest } = entry
      this.store(scope, rest)
    }
  }

  clear(): void { this.entries.clear() }

  private store(scope: string, entry: Entry): void {
    // Include serialized cursor/reference metadata as well as full text. The
    // extra allowance bounds per-entry UI state without serializing on scroll.
    entry.bytes = JSON.stringify([entry.day, entry.overview]).length * 2 + scope.length * 2 + 4096
    if (entry.bytes > this.limits.bytesPerAccount || entry.bytes > this.limits.totalBytes || this.limits.daysPerAccount < 1) {
      this.entries.delete(scope); return
    }
    this.entries.delete(scope); this.entries.set(scope, entry)
    const totals = () => {
      let count = 0, accountBytes = 0, totalBytes = 0
      for (const item of this.entries.values()) {
        totalBytes += item.bytes
        if (item.account === entry.account) { count++; accountBytes += item.bytes }
      }
      return { count, accountBytes, totalBytes }
    }
    let size = totals()
    for (const [key, item] of this.entries) {
      if (size.count <= this.limits.daysPerAccount && size.accountBytes <= this.limits.bytesPerAccount) break
      if (item.account === entry.account) { this.entries.delete(key); size = totals() }
    }
    for (const key of this.entries.keys()) {
      if (size.totalBytes <= this.limits.totalBytes) break
      this.entries.delete(key); size = totals()
    }
  }
}

export const recordingDayCache = new RecordingDayCache()
