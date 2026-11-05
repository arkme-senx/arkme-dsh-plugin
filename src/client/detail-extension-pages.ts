import type { ArkmeSourceMessageExtensionContext } from '../types.js'

function mergePages(current: ArkmeSourceMessageExtensionContext, page: ArkmeSourceMessageExtensionContext): ArkmeSourceMessageExtensionContext {
  const items = new Map(current.extensions.map(item => [JSON.stringify([item.recordOwnerUserId ?? '', item.recordUid, item.sequence ?? '']), item]))
  for (const item of page.extensions) items.set(JSON.stringify([item.recordOwnerUserId ?? '', item.recordUid, item.sequence ?? '']), item)
  const extensions = [...items.values()].sort((a, b) => b.sendAtMillis - a.sendAtMillis)
  const { nextCursor: _previousCursor, ...previous } = current
  return { ...previous, ...page, extensions, extensionCount: Math.max(current.extensionCount, page.extensionCount, extensions.length) }
}

/** First loads publish progressively; background revalidation publishes one complete snapshot.
 * The caller owns cancellation and retains its prior authorized snapshot on a transient failure.
 */
export async function readDetailExtensionPages({ parentRecordUid, loadPage, onPage, signal, initial, atomic = false }: {
  parentRecordUid: string
  loadPage(cursor?: string): Promise<ArkmeSourceMessageExtensionContext>
  onPage(context: ArkmeSourceMessageExtensionContext): void
  signal: AbortSignal
  initial?: ArkmeSourceMessageExtensionContext | undefined
  atomic?: boolean
}) {
  let context = initial
  const seen = new Set<string>()
  do {
    signal.throwIfAborted()
    const cursor = context?.nextCursor
    if (context && !cursor) return
    if (cursor && seen.has(cursor)) throw new Error('延展分页未前进，请重试')
    if (cursor) seen.add(cursor)
    const page = await loadPage(cursor)
    signal.throwIfAborted()
    if (page.parentRecordUid !== parentRecordUid) throw new Error('延展来源已变化，请重新打开详情')
    context = context ? mergePages(context, page) : page
    if (!atomic) onPage(context)
  } while (context.nextCursor)
  if (atomic) onPage(context)
}
