import { invalidateMessageQuoteSources } from './message-quote-invalidations.js'
import { connectArkmeRealtime } from './realtime-connection.js'

/** The independent renderer owns one hint-only connection, with no directory/unread side effects. */
export function connectLongArticleRealtime(isCurrentAccount: () => boolean): () => void {
  let stopped = false, opened = false
  const current = () => !stopped && isCurrentAccount()
  const connection = connectArkmeRealtime({
    onOpen() {
      if (opened && current()) invalidateMessageQuoteSources()
      opened = true
    },
    onDisconnect() {},
    onMessage(event) {
      if (!current()) return
      let hint: { type?: string; projection?: string; sourceKey?: string }
      try { hint = JSON.parse(event.data) } catch { return }
      if (!hint || typeof hint !== 'object') return
      if (hint.type === 'timeline-changed' && typeof hint.sourceKey === 'string') invalidateMessageQuoteSources(hint.sourceKey)
      else if (hint.type === 'reconcile' || hint.type === 'chat-policy-invalidated'
        || (hint.type === 'projection-invalidated' && hint.projection === 'record')) invalidateMessageQuoteSources()
    },
  })
  return () => { stopped = true; connection.close() }
}
