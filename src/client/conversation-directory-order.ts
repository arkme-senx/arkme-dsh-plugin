/** Source activity only: receipt times, polling clocks and presence are not conversations. */
export function conversationActivityAtMillis(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8_640_000_000_000_000 ? value : 0
}

/** Stable ties preserve existing directory order; pinning remains the first grouping. */
export function orderConversationDirectoryRows<T extends { pinned: boolean; activeAtMillis: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || conversationActivityAtMillis(b.activeAtMillis) - conversationActivityAtMillis(a.activeAtMillis))
}
