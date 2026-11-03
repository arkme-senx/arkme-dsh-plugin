import type { ArkmeWorldCommentNotificationPage } from '../types.js'
import { callArkme } from './api.js'

export type WorldNotificationInteraction = ArkmeWorldCommentNotificationPage['items'][number]

/** Preserve the existing history-list contract, using the owner ledger instead of scanning comment trees. */
export async function readWorldNotifications(signal: AbortSignal, read: typeof callArkme = callArkme): Promise<WorldNotificationInteraction[]> {
  const items = new Map<string, WorldNotificationInteraction>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  // shortcut: existing UI consumes one array; above 5000 notifications requires a paged UI in MR2.
  for (let index = 0; index < 100; index++) {
    signal.throwIfAborted()
    const page = await read<ArkmeWorldCommentNotificationPage>('world.comment-notifications', { limit: 50, ...(cursor ? { cursor } : {}) }, signal, { priority: 'background' })
    signal.throwIfAborted()
    if (!Array.isArray(page.items) || page.items.length > 50 || typeof page.hasMore !== 'boolean') throw new Error('世界通知返回异常，请重试')
    for (const item of page.items) items.set(item.interactionRef, item)
    if (!page.hasMore) return [...items.values()]
    if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('世界通知分页未推进，请重试')
    cursors.add(page.nextCursor); cursor = page.nextCursor
  }
  throw new Error('世界通知较多，暂未加载完整')
}

export async function readWorldReactionNotifications(accountKey: string, signal: AbortSignal, read: typeof callArkme = callArkme) {
  type Page = import('../world-reaction-contract.js').WorldReactionNotificationPage
  const items = new Map<string, Page['items'][number]>()
  const cursors = new Set<string>()
  let after_id = ''
  // shortcut: the existing notification list consumes one array; a paged UI is needed above 5000 rows.
  for (let index = 0; index < 100; index++) {
    signal.throwIfAborted()
    const page = await read<Page>('world.reactions', { action: 'notifications', accountKey, include_read: true, limit: 50, after_id }, signal, { priority: 'background' })
    signal.throwIfAborted()
    if (!Array.isArray(page.items) || page.items.length > 50 || typeof page.has_more !== 'boolean') throw Error('世界表态通知返回异常，请重试')
    for (const item of page.items) if (!items.has(item.id) || items.get(item.id)!.revision < item.revision) items.set(item.id, item)
    if (!page.has_more) return [...items.values()]
    if (!page.after_id || cursors.has(page.after_id)) throw Error('世界表态通知分页未推进，请重试')
    cursors.add(page.after_id); after_id = page.after_id
  }
  throw Error('世界表态通知较多，暂未加载完整')
}
