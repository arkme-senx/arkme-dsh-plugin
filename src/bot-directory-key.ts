import { createHmac } from 'node:crypto'

/** Opaque, account-scoped identity shared by Bot directory entries and chat senders. */
export function arkmeBotDirectoryKey(userId: number, botId: string, signingKey: string): string {
  const digest = createHmac('sha256', signingKey)
    .update(`arkme-bot-directory-v1:${String(userId)}:${botId.trim()}`)
    .digest('base64url')
  return `arkme-bot-directory-v1.${digest}`
}
