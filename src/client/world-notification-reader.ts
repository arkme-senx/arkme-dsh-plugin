import type { ArkmeWorldInteractionItem, ArkmeWorldInteractionPage, ArkmeWorldNotificationSourcePage } from '../types.js'
import { callArkme } from './api.js'

export type WorldNotificationInteraction = ArkmeWorldInteractionItem & { replyToComment: boolean }

/** Compatibility reader over existing APIs. Never derive read sequences from comment timestamps. */
export async function readWorldNotifications(signal: AbortSignal, read: typeof callArkme = callArkme): Promise<WorldNotificationInteraction[]> {
  const notifications = new Map<string, WorldNotificationInteraction>()
  const sourceRefs = new Set<string>()
  let offset = 0
  for (let sourcePage = 0; sourcePage < 100; sourcePage++) {
    signal.throwIfAborted()
    const page = await read<ArkmeWorldNotificationSourcePage>('world.notification-sources', { offset }, signal, { priority: 'background' })
    if (!Array.isArray(page.items)) throw new Error('世界互动来源数据不完整，请重试')
    // Keep concurrency bounded: the legacy endpoint recursively returns a comment subtree.
    for (let index = 0; index < page.items.length; index += 2) {
      await Promise.all(page.items.slice(index, index + 2).map(async source => {
        if (sourceRefs.has(source.recordRef)) return
        sourceRefs.add(source.recordRef)
        let replyOffset = 0
        for (let replyPage = 0; replyPage < 100; replyPage++) {
          signal.throwIfAborted()
          const replies = await read<ArkmeWorldInteractionPage>('world.interactions.list', { recordRef: source.recordRef, limit: 50, offset: replyOffset }, signal, { priority: 'background' })
          for (const reply of replies.items) {
            if (reply.isSelf) continue
            // A root owner receives all replies. A commenter receives only direct replies to their own comment.
            if (source.isComment && reply.parentRef !== source.recordRef) continue
            const old = notifications.get(reply.interactionRef)
            notifications.set(reply.interactionRef, { ...reply, replyToComment: source.isComment || old?.replyToComment === true })
          }
          if (!replies.hasMore) return
          if (replies.nextOffset === undefined || replies.nextOffset <= replyOffset) throw new Error('世界回复分页未推进，请重试')
          replyOffset = replies.nextOffset
        }
        throw new Error('世界回复较多，暂未加载完整')
      }))
    }
    if (!page.hasMore) return [...notifications.values()].sort((a, b) => (b.publishedAtMillis || b.createdAtMillis) - (a.publishedAtMillis || a.createdAtMillis))
    if (page.nextOffset === undefined || page.nextOffset <= offset) throw new Error('世界互动来源分页未推进，请重试')
    offset = page.nextOffset
  }
  throw new Error('世界互动较多，暂未加载完整')
}
