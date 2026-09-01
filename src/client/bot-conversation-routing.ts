import type { ArkmeBotSummary } from '../types.js'

export function botUsesStandardChatSource(bot: ArkmeBotSummary): boolean {
  return bot.directChatAvailable
    && bot.conversationProjection === 'chat'
    && bot.chatSourceKey !== undefined
    && bot.chatSourceKey.trim() !== ''
}

export function botUsesPrivateConversationSurface(bot: ArkmeBotSummary): boolean {
  return bot.directChatAvailable && bot.conversationProjection === 'record'
}
