import type { ArkmeConversationMemberRecordPage, ArkmeTimelineItem } from '../types.js'

export function mergeRecordItems(current: readonly ArkmeTimelineItem[], incoming: readonly ArkmeTimelineItem[]): ArkmeTimelineItem[] {
  const merged = new Map(current.map(item => [item.itemUid, item]))
  for (const item of incoming) merged.set(item.itemUid, item)
  return [...merged.values()].sort((left, right) => right.sendAtMillis - left.sendAtMillis)
}


/** Read an owner-provided page range; never publish a partially refreshed window. */
export async function readMemberRecordWindow(
  readPage: (beforeSequence?: number) => Promise<ArkmeConversationMemberRecordPage>,
  options: { beforeSequence?: number; refresh: boolean; loadedCursor?: number; signal: AbortSignal },
): Promise<ArkmeConversationMemberRecordPage> {
  let page = await readPage(options.beforeSequence)
  let items = page.items
  let previousCursor: number | undefined
  while (options.refresh && page.hasMore) {
    options.signal.throwIfAborted()
    const next = page.nextCursor?.beforeSequence
    if (next === undefined || next <= 0 || (previousCursor !== undefined && next >= previousCursor)) {
      throw new Error('快记分页游标无效，请重试')
    }
    if (options.loadedCursor !== undefined && next <= options.loadedCursor) break
    previousCursor = next
    page = await readPage(next)
    items = mergeRecordItems(items, page.items)
  }
  options.signal.throwIfAborted()
  return { ...page, items }
}
