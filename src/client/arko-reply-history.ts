import type { ArkoReplyHistoryPage, ConfigurableReplyScene } from '../arko-reply-contract.js'
import { callArkme } from './api.js'
export type { ArkoReplyHistoryEntry } from '../arko-reply-contract.js'
/** The backend keyset owns discovery, order and completeness across devices. */
export async function readArkoReplyHistory(scope: string, scene: ConfigurableReplyScene | 'all', cursor: string, signal: AbortSignal): Promise<ArkoReplyHistoryPage> {
  const page = await callArkme<ArkoReplyHistoryPage>('arko.replies.page', { expectedAccountScope: scope, query: { scene, cursor, limit: 50 } }, signal, { priority: 'background' })
  signal.throwIfAborted(); if (page.accountScope !== scope) throw new Error('账号已切换，请重新读取')
  return page
}
