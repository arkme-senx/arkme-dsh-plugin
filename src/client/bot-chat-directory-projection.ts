import type { ArkmeBotSummary, ArkmeSourceItem } from '../types.js'

export interface ArkmeBotChatDirectoryProjection {
  sources: ArkmeSourceItem[]
  bots: ArkmeBotSummary[]
}

/** Merge owner activity only; hydrated previews, unread and current opaque handles stay intact. */
export function mergeBotDirectoryActivity(
  current: ArkmeBotSummary[],
  refreshed: readonly ArkmeBotSummary[],
): ArkmeBotSummary[] {
  const refreshedByKey = new Map(refreshed.map(bot => [bot.directoryKey?.trim() || bot.botRef, bot]))
  let changed = false
  const next = current.map(bot => {
    const latest = refreshedByKey.get(bot.directoryKey?.trim() || bot.botRef)
      ?.conversationListActivityAtMillis ?? 0
    if (latest <= (bot.conversationListActivityAtMillis ?? 0)) return bot
    changed = true
    return { ...bot, conversationListActivityAtMillis: latest }
  })
  return changed ? next : current
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
    const botActivityAtMillis = Math.max(
      bot.createdAtMillis ?? 0,
      bot.latestMessageAtMillis ?? 0,
      bot.conversationListActivityAtMillis ?? 0,
    )
    if (source.activeAtMillis <= botActivityAtMillis) return projectedBot
    projectedBot.conversationListActivityAtMillis = source.activeAtMillis
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
