import type { ArkmeCallHistoryItem, ArkmeCallHistoryPage } from '../types.js'

export const callHistoryIdentity = (item: ArkmeCallHistoryItem): string => item.stableId || item.callRef

/** Catch up to the cached head, including bursts larger than one response page. */
export async function refreshCallHistory(
  previous: ArkmeCallHistoryPage | undefined,
  read: (cursor?: string) => Promise<ArkmeCallHistoryPage>,
  signal: AbortSignal,
): Promise<ArkmeCallHistoryPage> {
  const cached = new Set(previous?.items.map(callHistoryIdentity))
  const first = await read()
  let tail = first
  const items = new Map(first.items.map(item => [callHistoryIdentity(item), item]))
  const cursors = new Set<string>()
  while (cached.size > 0 && tail.hasMore && !tail.items.some(item => cached.has(callHistoryIdentity(item)))) {
    if (signal.aborted) throw new Error('aborted')
    const cursor = tail.nextCursor?.trim()
    if (!cursor || cursors.has(cursor)) throw new Error('通话记录分页游标无效，请重试')
    cursors.add(cursor)
    tail = await read(cursor)
    for (const item of tail.items) items.set(callHistoryIdentity(item), item)
  }
  // A complete server result is authoritative. Otherwise retain older loaded pages
  // and their continuation cursor, but let refreshed values replace matching rows.
  const retainOlder = tail.hasMore && previous !== undefined && cached.size > 0
  const merged = retainOlder ? new Map(previous.items.map(item => [callHistoryIdentity(item), item])) : new Map<string, ArkmeCallHistoryItem>()
  for (const [key, item] of items) merged.set(key, item)
  return {
    ...first,
    items: [...merged.values()].sort((a, b) => b.startedAtMillis - a.startedAtMillis),
    hasMore: retainOlder ? previous.hasMore : tail.hasMore,
    nextCursor: (retainOlder ? previous.nextCursor : tail.nextCursor) ?? '',
  }
}
