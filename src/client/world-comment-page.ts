import type { ArkmeWorldInteractionItem, ArkmeWorldRepliesPage } from '../types.js'

export interface WorldCommentContinuation {
  parentRef: string
  path: readonly string[]
  cursor?: string
}

/** One shared comments pager, including replies, using the current authorized reads.
 * Work is bounded per user page; there is no eager scan of the entire comment tree.
 * Continuations contain references only, never cached publication/media snapshots.
 */
export async function loadWorldCommentPage(
  pending: readonly WorldCommentContinuation[],
  read: (ref: string, limit: number, cursor?: string) => Promise<ArkmeWorldRepliesPage>,
  signal: AbortSignal,
): Promise<{ items: ArkmeWorldInteractionItem[]; pending: WorldCommentContinuation[] }> {
  const queue = [...pending]
  const continuations: WorldCommentContinuation[] = []
  const items = new Map<string, ArkmeWorldInteractionItem>()
  let requests = 0
  while (queue.length && requests < 32 && items.size < 100) {
    signal.throwIfAborted()
    const batch = queue.splice(0, Math.min(4, 32 - requests, 100 - items.size))
    const limit = Math.min(20, Math.floor((100 - items.size) / batch.length))
    requests += batch.length
    const pages = await Promise.all(batch.map(async task => ({ task, page: await read(task.parentRef, limit, task.cursor) })))
    signal.throwIfAborted()
    const next: WorldCommentContinuation[] = []
    for (const { task, page } of pages) {
      if (page.items.length > limit || page.items.some(item => item.parentRef !== task.parentRef || task.path.includes(item.interactionRef))) {
        throw new Error('评论层级返回异常，请重试')
      }
      for (const item of page.items) {
        items.set(item.interactionRef, item)
        // The publication owner permits at most 32 ancestors.
        if (task.path.length < 32) next.push({ parentRef: item.interactionRef, path: [...task.path, item.interactionRef] })
      }
      if (page.hasMore) {
        if (!page.nextCursor || page.nextCursor === task.cursor) throw new Error('评论分页未推进，请重试')
        continuations.push({ ...task, cursor: page.nextCursor })
      }
    }
    queue.unshift(...next)
  }
  return { items: [...items.values()], pending: [...queue, ...continuations] }
}
