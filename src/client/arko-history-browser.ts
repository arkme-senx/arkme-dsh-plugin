import type { ArkmeArkoHistoryItem } from '../types.js'

export const arkoHistoryKey = (item: ArkmeArkoHistoryItem) => `${item.sessionId}:${item.messageId}`
export function arkoHistoryDate(at: number): string {
  const date = new Date(at)
  if (!Number.isFinite(at) || at <= 0 || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function sortArkoHistory(items: Iterable<ArkmeArkoHistoryItem>): ArkmeArkoHistoryItem[] {
  return [...items].sort((a, b) => (a.orderAtMillis ?? a.createdAtMillis) - (b.orderAtMillis ?? b.createdAtMillis) || a.messageId - b.messageId)
}
