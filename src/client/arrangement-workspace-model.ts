import type { ArkmeArrangementItem, ArkmeDeletedArrangementItem } from '../types.js'

export const arrangementViews = ['today', 'week', 'all', 'completed', 'deleted'] as const
export type ArrangementView = typeof arrangementViews[number]
export type ArrangementWorkspaceItem = ArkmeArrangementItem | ArkmeDeletedArrangementItem
export const arrangementViewLabels: Record<ArrangementView, string> = {
  today: '今天', week: '最近7天', all: '全部安排', completed: '已完成', deleted: '已删除',
}
export function arrangementViewRange(view: ArrangementView, now: number): { dueStartAtMillis: number; dueEndAtMillis: number } | undefined {
  if (view !== 'today' && view !== 'week') return
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  // Calendar days, rather than 24-hour durations, remain correct across DST.
  end.setDate(end.getDate() + (view === 'week' ? 7 : 1))
  return { dueStartAtMillis: start.getTime(), dueEndAtMillis: end.getTime() - 1 }
}
export function arrangementViewStatuses(view: ArrangementView) {
  return view === 'deleted' ? ['deleted'] as const : view === 'completed' ? ['completed'] as const : ['identified', 'following'] as const
}
export function arrangementMatchesView(item: ArrangementWorkspaceItem, view: ArrangementView, now: number): boolean {
  if (view === 'deleted') return item.status === 'deleted'
  if (view === 'completed') return item.status === 'completed'
  if (item.status !== 'identified' && item.status !== 'following') return false
  const range = arrangementViewRange(view, now)
  return !range || item.dueAtMillis !== undefined && item.dueAtMillis >= range.dueStartAtMillis && item.dueAtMillis <= range.dueEndAtMillis
}
export function sortArrangementRows(items: ArrangementWorkspaceItem[], view: ArrangementView): ArrangementWorkspaceItem[] {
  const rows = [...new Map(items.map(item => [item.arrangementRef, item])).values()]
  // Dated queries are ordered by due time by the owner. Other views retain its
  // latest-update order, including across the two unfinished-status branches.
  return rows.sort((a, b) => (view === 'today' || view === 'week' ? (a.dueAtMillis ?? Infinity) - (b.dueAtMillis ?? Infinity) : 0)
    || b.updatedAtMillis - a.updatedAtMillis || a.arrangementRef.localeCompare(b.arrangementRef))
}
export function nextArrangementMidnight(now = Date.now()): number {
  const next = new Date(now); next.setHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - now)
}
