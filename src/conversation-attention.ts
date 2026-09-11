import type { ArkmeBotSummary, ArkmeConversationDirectoryVisibilityItem, ArkmeSourceItem } from './types.js'
import { projectBotChatDirectory } from './bot-chat-directory-projection.js'
import { arkmeBadgeUnreadCount } from './chat-attention.js'

/** One derivation supplies the row objects and their arithmetic total together. */
export function projectArkmeConversationAttention(
  sources: readonly ArkmeSourceItem[], bots: readonly ArkmeBotSummary[],
  visibility: readonly ArkmeConversationDirectoryVisibilityItem[],
) {
  const hidden = new Map(visibility.map(item => [`${item.entryKind}:${item.entryRef}`, item.hidden]))
  const directory = projectBotChatDirectory(sources, bots)
  const visibleSources = directory.sources.filter(source => (source.kind === 'private_chat' || source.kind === 'group_chat')
    && hidden.get(`source:${source.sourceRef}`) === false)
  const visibleBots = directory.bots.filter(bot => hidden.get(`bot:${bot.botRef}`) === false)
  let badgeCount = 0
  for (const row of visibleSources) badgeCount += arkmeBadgeUnreadCount(row)
  for (const row of visibleBots) badgeCount += arkmeBadgeUnreadCount(row)
  return { directory, sources: visibleSources, bots: visibleBots, badgeCount }
}

export function visibleArkmeConversations(
  sources: readonly ArkmeSourceItem[], bots: readonly ArkmeBotSummary[],
  visibility: readonly ArkmeConversationDirectoryVisibilityItem[],
) {
  const { sources: visibleSources, bots: visibleBots } = projectArkmeConversationAttention(sources, bots, visibility)
  return { sources: visibleSources, bots: visibleBots }
}

export function arkmeConversationBadgeTotal(
  sources: readonly ArkmeSourceItem[], bots: readonly ArkmeBotSummary[],
  visibility: readonly ArkmeConversationDirectoryVisibilityItem[],
): number {
  return projectArkmeConversationAttention(sources, bots, visibility).badgeCount
}

/** Cycle normal unread, muted unread, then the actual list head. */
export function nextArkmeUnreadConversation<T extends { key: string; unreadCount?: number; badgeUnreadCount?: number; isMuted?: boolean; notificationAllowed?: boolean }>(
  rows: readonly T[], previousKey?: string,
): T | { top: true } | undefined {
  const candidates = [
    ...rows.filter(row => arkmeBadgeUnreadCount(row) > 0),
    ...rows.filter(row => row.isMuted === true && (row.unreadCount ?? 0) > 0),
  ]
  if (candidates.length === 0) return undefined
  const index = candidates.findIndex(row => row.key === previousKey) + 1
  return index === candidates.length ? { top: true } : candidates[index]
}
