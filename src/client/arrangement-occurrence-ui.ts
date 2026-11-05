import type { ArkmeArrangementStatus } from '../types.js'
import { tr } from './locale.js'

export const OCCURRENCE_CHANGED = 'arkme-arrangement-occurrences-changed'
export const OCCURRENCE_INSPECT_TRACE = 'arkme-arrangement-inspect-trace'

export function occurrenceTime(value?: number) {
  return value && value > 0 ? new Date(value).toLocaleString() : tr('未记录')
}

export function occurrenceFailure(error: unknown) {
  return error instanceof Error ? error.message : tr('操作失败，请重试')
}

export function inspectArrangementTrace(
  accountScope: string,
  arrangementRef: string,
  traceId: string,
) {
  window.dispatchEvent(
    new CustomEvent(OCCURRENCE_INSPECT_TRACE, {
      detail: { accountScope, arrangementRef, traceId },
    }),
  )
}

export function occurrenceChanged() {
  window.dispatchEvent(new Event(OCCURRENCE_CHANGED))
}

export function occurrenceStatusLabel(status: ArkmeArrangementStatus) {
  return tr(
    status === 'completed'
      ? '已完成'
      : status === 'following'
        ? '跟进中'
        : status === 'identified'
          ? '已识别'
          : '不可归并',
  )
}

export function canMergeOccurrence(item: { status: ArkmeArrangementStatus }) {
  return ['identified', 'following', 'completed'].includes(item.status)
}
