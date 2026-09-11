import { arkmeDefaultEmojiSeeds } from './arkme-emoji-text.js'

export interface RecentEmojiStore {
  recentEmojiIds(accountKey: string): Promise<string[]>
  recordRecentEmoji(accountKey: string, emojiId: string): Promise<string[]>
}

export const recentEmojiLimit = 8
const knownIds = new Set(arkmeDefaultEmojiSeeds.map(emoji => emoji.id))
export function isRecentEmojiId(id: string): boolean { return knownIds.has(id) }
export function normalizeRecentEmojiIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && isRecentEmojiId(id)))].slice(0, recentEmojiLimit)
}
