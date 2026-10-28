import type { ArkmeArrangementItem } from '../types.js'
import type { ArrangementColumn } from './arrangement-board-model.js'
export type BoardItems = Record<ArrangementColumn, ArkmeArrangementItem[]>
export type Placement = { status: ArrangementColumn; beforeRef?: string | undefined; afterRef?: string | undefined }
/** Neighbour references refer to the loaded slice, never an assumed global tail. */
export function placementOf(items: BoardItems, ref: string): Placement | undefined {
  for (const status of ['identified', 'following', 'completed'] as const) {
    const index = items[status].findIndex(item => item.arrangementRef === ref)
    if (index >= 0) return { status, beforeRef: items[status][index + 1]?.arrangementRef, afterRef: items[status][index - 1]?.arrangementRef }
  }
}
export function projectPlacement(items: BoardItems, item: ArkmeArrangementItem, status: ArrangementColumn, index: number): BoardItems {
  const next = Object.fromEntries(Object.entries(items).map(([key, rows]) => [key, rows.filter(row => row.arrangementRef !== item.arrangementRef)])) as BoardItems
  next[status].splice(Math.max(0, Math.min(index, next[status].length)), 0, item)
  return next
}
export function samePlacement(a?: Placement, b?: Placement) { return !!a && !!b && a.status === b.status && a.beforeRef === b.beforeRef && a.afterRef === b.afterRef }
