import { arkmeChatDirectory } from './chat-directory-store.js'

/** One native presentation consumer of the same snapshot used by the rail and rows. */
export function startArkmeDirectoryBadge(
  apply: (count: number) => Promise<boolean>,
  accountScope: string | undefined,
): () => void {
  let stopped = false
  let running = false
  let lastApplied: number | undefined
  let desired = 0
  const flush = async () => {
    if (running || stopped) return
    running = true
    try {
      while (!stopped && desired !== lastApplied) {
        const count = desired
        if (!await apply(count)) break
        lastApplied = count
      }
    } catch { /* Retry on the next directory change or window focus. */ }
    finally { running = false }
  }
  const update = () => {
    const snapshot = arkmeChatDirectory.getConversationSnapshot()
    desired = accountScope !== undefined && snapshot.accountScope === accountScope ? snapshot.badgeCount : 0
    void flush()
  }
  const unsubscribe = arkmeChatDirectory.subscribe(update)
  const browserWindow = typeof window === 'undefined' ? undefined : window
  browserWindow?.addEventListener('focus', update)
  update()
  return () => {
    stopped = true
    unsubscribe()
    browserWindow?.removeEventListener('focus', update)
  }
}
