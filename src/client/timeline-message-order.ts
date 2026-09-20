import type { ArkmeTimelineItem } from '../types.js'

/** Match Flutter: same-time chat messages follow the owner sequence, not record IDs. */
export function compareTimelineMessages(left: ArkmeTimelineItem, right: ArkmeTimelineItem): number {
  return left.sendAtMillis - right.sendAtMillis
    || (left.sequence ?? 0) - (right.sequence ?? 0)
    || left.itemUid.localeCompare(right.itemUid)
}
