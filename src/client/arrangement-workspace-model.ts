import { offsetRecordingDate, recordingZonedWindow } from '../recording-time.js'
import { arkmeDayKey, getArkmeEffectiveTimeZone } from './display-time-zone.js'
import type { ArkmeArrangementItem, ArkmeDeletedArrangementItem } from '../types.js'

export const arrangementViews = ['today', 'week', 'all', 'completed', 'deleted'] as const
export type ArrangementView = typeof arrangementViews[number]
export type ArrangementWorkspaceItem = ArkmeArrangementItem | ArkmeDeletedArrangementItem
export const arrangementViewLabels: Record<ArrangementView, string> = {
  today: '今天', week: '最近7天', all: '全部安排', completed: '已完成', deleted: '已删除',
}
export function arrangementViewRange(view: ArrangementView, now: number, timeZone = getArkmeEffectiveTimeZone()): { dueStartAtMillis: number; dueEndAtMillis: number } | undefined {
  if (view !== 'today' && view !== 'week') return
  const date = arkmeDayKey(now, timeZone)
  const start = recordingZonedWindow(date, timeZone)
  const end = view === 'today' ? start : recordingZonedWindow(offsetRecordingDate(date, 6), timeZone)
  return { dueStartAtMillis: start.dateStamp, dueEndAtMillis: end.endStamp - 1 }
}
export function arrangementViewStatuses(view: ArrangementView) {
  return view === 'deleted' ? ['deleted'] as const : view === 'completed' ? ['completed'] as const : ['identified', 'following'] as const
}
export function arrangementMatchesView(item: ArrangementWorkspaceItem, view: ArrangementView, now: number, timeZone?: string): boolean {
  if (view === 'deleted') return item.status === 'deleted'
  if (view === 'completed') return item.status === 'completed'
  if (item.status !== 'identified' && item.status !== 'following') return false
  const range = arrangementViewRange(view, now, timeZone)
  return !range || item.dueAtMillis !== undefined && item.dueAtMillis >= range.dueStartAtMillis && item.dueAtMillis <= range.dueEndAtMillis
}
export function sortArrangementRows(items: ArrangementWorkspaceItem[], view: ArrangementView): ArrangementWorkspaceItem[] {
  const rows = [...new Map(items.map(item => [item.arrangementRef, item])).values()]
  // Dated queries are ordered by due time by the owner. Other views retain its
  // latest-update order, including across the two unfinished-status branches.
  return rows.sort((a, b) => (view === 'today' || view === 'week' ? (a.dueAtMillis ?? Infinity) - (b.dueAtMillis ?? Infinity) : 0)
    || b.updatedAtMillis - a.updatedAtMillis || a.arrangementRef.localeCompare(b.arrangementRef))
}
export function nextArrangementMidnight(now = Date.now(), timeZone = getArkmeEffectiveTimeZone()): number {
  return Math.max(1, recordingZonedWindow(arkmeDayKey(now, timeZone), timeZone).endStamp - now)
}
