import { invalidateTeamMessages } from './team-messaging-events.js'
import type { TeamMessageChangeHint } from '../team-app-contract.js'
import { invalidateMessageQuoteSources } from './message-quote-invalidations.js'
import { connectArkmeRealtime } from './realtime-connection.js'

/** The independent renderer owns one hint-only connection, with no directory/unread side effects. */
export function connectLongArticleRealtime(isCurrentAccount: () => boolean, teamAccount?: string): () => void {
  let stopped = false, opened = false
  const current = () => !stopped && isCurrentAccount()
  const connection = connectArkmeRealtime({
    onOpen() {
      if (opened && current()) {
        invalidateMessageQuoteSources()
        if (teamAccount) invalidateTeamMessages(teamAccount)
      }
      opened = true
    },
    onDisconnect() {},
    onMessage(event) {
      if (!current()) return
      let hint: { type?: string; projection?: string; sourceKey?: string; receiptOnly?: boolean; change?: TeamMessageChangeHint }
      try { hint = JSON.parse(event.data) } catch { return }
      if (!hint || typeof hint !== 'object') return
      if (teamAccount && (hint.type === 'team-invalidated' || hint.type === 'reconcile')) {
        invalidateTeamMessages(teamAccount, hint.type === 'team-invalidated' && hint.receiptOnly === true, hint.change)
      }
      if (hint.type === 'timeline-changed' && typeof hint.sourceKey === 'string') invalidateMessageQuoteSources(hint.sourceKey)
      else if (hint.type === 'reconcile' || hint.type === 'chat-policy-invalidated'
        || (hint.type === 'projection-invalidated' && hint.projection === 'record')) invalidateMessageQuoteSources()
    },
  })
  return () => { stopped = true; connection.close() }
}
