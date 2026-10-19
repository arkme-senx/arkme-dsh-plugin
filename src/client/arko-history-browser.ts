import type { ArkmeArkoMessagePage } from '../arko-history-contract.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
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

// Latest-view restoration needs a visible page, not a physical candidate page.
// Continue only empty pages; history browsing keeps its own cursor/window and
// must never restore a historical session as the current task.
export async function readLatestArkoMessages(signal: AbortSignal): Promise<ArkmeArkoMessagePage> {
  let cursor: string | undefined
  const visited = new Set<string>()
  for (let attempt = 0; attempt < 1000; attempt++) {
    signal.throwIfAborted()
    const page = await callArkme<ArkmeArkoMessagePage>('arko.messages', { limit: 50, ...(cursor ? { cursor } : {}) }, signal)
    signal.throwIfAborted()
    if (page.items.length > 0 || !page.hasMore) return page
    if (!page.nextCursor || visited.has(page.nextCursor)) throw new Error(tr('历史分页未能继续，请重试'))
    visited.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new Error(tr('历史候选消息较多，超过本次读取预算，请重试'))
}
