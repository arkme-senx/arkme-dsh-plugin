import type { RecentEmojiStore } from '../emoji-recent.js'
import { callArkme } from './api.js'

const requestTimeoutMs = 2_000
const writesByAccount = new Map<string, Promise<void>>()

export const arkmeRecentEmojiStore: RecentEmojiStore = {
  async recentEmojiIds(accountKey) {
    await writesByAccount.get(accountKey)
    return await callArkme<string[]>('emoji.recent.list', { accountKey }, AbortSignal.timeout(requestTimeoutMs))
  },
  recordRecentEmoji(accountKey, emojiId) {
    const result = (writesByAccount.get(accountKey) ?? Promise.resolve()).then(async () =>
      await callArkme<string[]>('emoji.recent.record', { accountKey, emojiId }, AbortSignal.timeout(requestTimeoutMs)))
    const settled = result.then(() => undefined, () => undefined)
    writesByAccount.set(accountKey, settled)
    void settled.then(() => {
      if (writesByAccount.get(accountKey) === settled) writesByAccount.delete(accountKey)
    })
    return result
  },
}
