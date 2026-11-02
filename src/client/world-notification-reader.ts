import type { ArkmeWorldCommentNotificationPage } from '../types.js'
import { callArkme } from './api.js'

export type WorldNotificationInteraction = ArkmeWorldCommentNotificationPage['items'][number]

/** Read one owner-ledger page; never reconstruct notifications by scanning public comment trees. */
export async function readWorldNotifications(signal: AbortSignal, read: typeof callArkme = callArkme, cursor?: string): Promise<ArkmeWorldCommentNotificationPage> {
  signal.throwIfAborted()
  const page = await read<ArkmeWorldCommentNotificationPage>('world.comment-notifications', { limit: 20, ...(cursor ? { cursor } : {}) }, signal, { priority: 'background' })
  signal.throwIfAborted()
  if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean' || page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw new Error('世界通知分页返回异常，请重试')
  return page
}
