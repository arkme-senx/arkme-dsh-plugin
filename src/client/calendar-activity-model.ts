import { arkmeIntlLocale, tr } from './locale.js'
import type { ArkmeRecordingCoverage, ArkmeRecordingDay, ArkmeTimelineItem, ArkmeRecordLocationObservation, ArkmeCallDetail, ArkmeCallHistoryItem, ArkmeSourceItem } from '../types.js'

/** Frontend read model, NOT a deployed HTTP contract. See docs/my-day-calendar.md. */
export type DayActivityKind = 'note' | 'private_chat' | 'group_chat' | 'call' | 'recording' | 'arko' | 'bot' | 'dsh'
/** A display filter may combine sources without changing their underlying identity. */
export type DayActivityFilter = DayActivityKind | 'all' | 'conversation'
export type DayActivityMode = 'activities' | 'records'

export interface DayActivityQuery {
  accountScope: string
  bucketDate: string
  timezone: string
  mode: DayActivityMode
  kind: DayActivityFilter
  includeBackground: boolean
}

export interface DayActivityEntry {
  /** Presentation only; image references retain the existing authorized image reader. */
  avatar?: { [Key in 'avatarRef' | 'avatarRefs' | 'groupAvatar']?: ArkmeSourceItem[Key] | undefined }
  previewAuthor?: { name: string; remark?: string }
  /** Selected verbatim excerpts from the bounded loaded segment, never an AI summary. */
  excerpts?: DayActivityExcerpt[]
  location?: ArkmeRecordLocationObservation
  /** Label-only location hint returned by the calendar index; coordinates stay protected. */
  locationSummary?: { label?: string; capturedAtMillis?: number }
  canLoadLocation?: boolean
  /** Explicit source identity, never a display name or a guessed participant. */
  sourceIdentity?: string
  statusLabel?: string
  relatedCallId?: string
  /** Source record ID or deterministic physical recording interval ID. */
  id: string
  kind: DayActivityKind
  startAtMillis: number
  endAtMillis: number
  access: 'available' | 'restricted'
  title: string
  preview: string
  sourceName: string
  participant?: { name: string; remark?: string }
  recordCount: number
  participation: 'self' | 'participated' | 'mentioned' | 'received' | 'background'
}

export interface DayActivityExcerpt {
  id: string
  text: string
  author?: { name: string; remark?: string }
  self: boolean
}

export interface DayActivityPage {
  /** Adapter must echo every query dimension; mismatched responses fail closed. */
  query: DayActivityQuery
  snapshotId: string
  /** Existing domain readers use a local read-session ID, not an atomic backend snapshot. */
  order?: 'ascending' | 'descending'
  notice?: string
  warnings?: string[]
  /** Already generated recording-only material; never attached to one arbitrary activity. */
  recordingReview?: Pick<ArkmeRecordingDay, 'summary' | 'timeline'>
  /** Composite readers regroup their bounded loaded window when another page arrives. */
  replaceItems?: boolean
  items: DayActivityEntry[]
  completeness: 'complete' | 'partial'
  missingKinds: DayActivityKind[]
  hasMore: boolean
  nextCursor?: string
  /** Day bounds supplied by the adapter, in the requested timezone (not always 24h). */
  dayStartMillis: number
  dayEndMillis: number
  coverage?: ArkmeRecordingCoverage
  speechIntervals?: Array<{ startAtMillis: number; endAtMillis: number }>
}

export interface DayActivityDetailPage {
  call?: { item: ArkmeCallHistoryItem; detail: ArkmeCallDetail }
  query: DayActivityQuery
  activityId: string
  snapshotId: string
  access: 'available' | 'restricted'
  items: Array<{
    id: string
    occurredAtMillis: number
    author: { name: string; remark?: string }
    text: string
    textFormat?: 'plain' | 'markdown'
    content?: ArkmeTimelineItem
  }>
  hasMore: boolean
  nextCursor?: string
  /** Opaque authorized navigation target. Never an arbitrary URL. */
  sourceRef?: string
}

/** A read-only adapter. No send, read-receipt, recording, or mutation methods. */
export interface DayActivityReader {
  capabilities?: { kinds: readonly DayActivityKind[]; modes: readonly DayActivityMode[]; notice: string; autoLocationLimit?: number; background?: boolean }
  loadDay(query: DayActivityQuery, options: { signal: AbortSignal; cursor?: string; snapshotId?: string }): Promise<DayActivityPage>
  loadDetail(query: DayActivityQuery, activityId: string,
    options: { signal: AbortSignal; snapshotId: string; cursor?: string }): Promise<DayActivityDetailPage>
  loadLocation?(query: DayActivityQuery, activityId: string,
    options: { signal: AbortSignal; snapshotId: string }): Promise<DayActivityLocationDetail>
}

export interface DayActivityLocationDetail {
  query: DayActivityQuery
  activityId: string
  snapshotId: string
  access: 'available' | 'restricted'
  location?: ArkmeRecordLocationObservation
}

export const dayActivityLabels: Record<DayActivityKind | 'all', string> = {
  all: '全部', note: '个人记录', private_chat: '私聊', group_chat: '群聊', call: '通话', arko: 'Arko', bot: 'Bot', dsh: 'DSH', recording: '录音',
}

export const dayActivityFilters = [
  { kind: 'all', get label() { return tr("全部") } }, { kind: 'note', label: '个人记录' },
  { kind: 'conversation', get label() { return tr("对话") } }, { kind: 'call', get label() { return tr("通话") } }, { kind: 'recording', get label() { return tr("录音") } },
] as const

export function dayActivityMatchesFilter(filter: DayActivityFilter, kind: DayActivityKind): boolean {
  return filter === 'all' || (filter === 'conversation'
    ? ['private_chat', 'group_chat', 'arko', 'bot', 'dsh'].includes(kind) : filter === kind)
}

export function dayActivityQueryKey(query: DayActivityQuery): string {
  return JSON.stringify([query.accountScope, query.bucketDate, query.timezone, query.mode, query.kind, query.includeBackground])
}

export function dayActivityDisplayName(person: { name: string; remark?: string }): string {
  return person.remark?.trim() || person.name.trim() || '未命名用户'
}

/** Do not rewrite free-text summaries or guess identities from a nickname. */
export function dayActivityTitle(entry: DayActivityEntry): string {
  if (entry.access !== 'available') return '内容已不可访问'
  if (entry.participant && entry.kind === 'private_chat') {
    return dayActivityDisplayName(entry.participant)
  }
  return entry.title.trim() || `${dayActivityLabels[entry.kind]}活动`
}

export function mergeDayActivityItems(previous: readonly DayActivityEntry[], incoming: readonly DayActivityEntry[], order: 'ascending' | 'descending' = 'ascending'): DayActivityEntry[] {
  // Only an explicit stable ID deduplicates. Never merge by time, preview or name.
  const items = new Map(previous.map(item => [item.id, item]))
  for (const item of incoming) items.set(item.id, item)
  return [...items.values()].sort((a, b) => (order === 'descending' ? -1 : 1) * (a.startAtMillis - b.startAtMillis || a.id.localeCompare(b.id)))
}

export function dayActivityTime(value: number, timezone: string): string {
  if (!Number.isFinite(value)) return '时间未知'
  try {
    return new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value)
  } catch { return '时间未知' }
}

export function dayActivityPeriod(value: number, timezone: string): string {
  const hour = Number(dayActivityTime(value, timezone).slice(0, 2))
  return hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour < 18 ? '下午' : hour < 24 ? '晚上' : '时间未知'
}

export function dayActivityOverview(items: readonly DayActivityEntry[], mode: DayActivityMode): string {
  const available = items.filter(item => item.access === 'available')
  const parts = dayActivityFilters.filter(filter => filter.kind !== 'all').flatMap(filter => {
    const matches = available.filter(item => dayActivityMatchesFilter(filter.kind, item.kind))
    if (!matches.length) return []
    const count = filter.kind === 'note' ? matches.reduce((total, item) => total + item.recordCount, 0) : matches.length
    const label = filter.kind === 'conversation' ? `${count} ${mode === 'activities' ? '段对话' : '条对话记录'}`
      : filter.kind === 'call' ? `${count} 次通话` : filter.kind === 'recording' ? `${count} 个录音时段` : `${count} 条个人记录`
    return [label]
  })
  return `已加载：${parts.join(' · ') || '暂无可显示的活动'}`
}

/** Clip each physical interval independently. A gap never becomes recorded time. */
export function dayActivityInterval(interval: { startAtMillis: number; endAtMillis: number }, start: number, end: number) {
  if (![start, end, interval.startAtMillis, interval.endAtMillis].every(Number.isFinite) || end <= start) return undefined
  const left = Math.max(start, interval.startAtMillis)
  const right = Math.min(end, interval.endAtMillis)
  if (right <= left) return undefined
  return { left: `${(left - start) / (end - start) * 100}%`, width: `${(right - left) / (end - start) * 100}%` }
}
