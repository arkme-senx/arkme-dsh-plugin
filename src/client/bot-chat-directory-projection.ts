import type { ArkmeBotSummary, ArkmeSourceItem } from '../types.js'

export interface ArkmeBotChatDirectoryProjection {
  sources: ArkmeSourceItem[]
  bots: ArkmeBotSummary[]
}

export function projectBotChatDirectory(
  sources: readonly ArkmeSourceItem[],
  bots: readonly ArkmeBotSummary[],
): ArkmeBotChatDirectoryProjection {
  const sourcesByKey = new Map(sources.flatMap(source => (
    source.kind !== 'private_chat' || source.sourceKey === undefined || source.sourceKey === ''
      ? []
      : [[source.sourceKey, source] as const]
  )))
  const claimedSourceKeys = new Set<string>()
  const projectedBots = bots.map(bot => {
    if (bot.conversationProjection !== 'chat' || bot.chatSourceKey === undefined) return bot
    const source = sourcesByKey.get(bot.chatSourceKey)
    if (source === undefined) return bot
    claimedSourceKeys.add(bot.chatSourceKey)
    const projectedBot: ArkmeBotSummary = {
      ...bot,
      unreadCount: source.unreadCount,
      ...(source.badgeUnreadCount === undefined ? {} : { badgeUnreadCount: source.badgeUnreadCount }),
      ...(source.notificationAllowed === undefined ? {} : { notificationAllowed: source.notificationAllowed }),
      ...(source.isMuted === undefined ? {} : { isMuted: source.isMuted }),
    }
    const botActivityAtMillis = bot.latestMessageAtMillis ?? bot.createdAtMillis ?? 0
    if (source.activeAtMillis <= botActivityAtMillis) return projectedBot
    projectedBot.latestMessageAtMillis = source.activeAtMillis
    if (source.latestPreview === undefined || source.latestPreview === '') {
      delete projectedBot.latestMessagePreview
    } else {
      projectedBot.latestMessagePreview = source.latestPreview
    }
    return projectedBot
  })
  return {
    sources: sources.filter(source => source.kind !== 'private_chat'
      || source.sourceKey === undefined
      || !claimedSourceKeys.has(source.sourceKey)),
    bots: projectedBots,
  }
}
