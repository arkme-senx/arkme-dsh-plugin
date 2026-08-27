import type { ArkmeBotSummary } from '../types.js'

const STORAGE_KEY_PREFIX = 'dsh-arkme:bot-directory:v1:user:'

export interface ArkmeBotDirectoryPreferences {
  pinnedKeys: string[]
  hiddenKeys: string[]
}

const EMPTY_PREFERENCES: ArkmeBotDirectoryPreferences = { pinnedKeys: [], hiddenKeys: [] }

function storageOrUndefined(storage?: Storage): Storage | undefined {
  if (storage !== undefined) return storage
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

function storageKey(userId: number | undefined): string | undefined {
  return Number.isSafeInteger(userId) && (userId ?? 0) > 0
    ? `${STORAGE_KEY_PREFIX}${String(userId)}`
    : undefined
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(item => item !== ''))].slice(0, 2_000)
}

export function botDirectoryPreferenceKey(bot: Pick<ArkmeBotSummary, 'botRef' | 'directoryKey'>): string {
  return bot.directoryKey?.trim() || bot.botRef
}

export function readBotDirectoryPreferences(
  userId: number | undefined,
  storage?: Storage,
): ArkmeBotDirectoryPreferences {
  const key = storageKey(userId)
  const target = storageOrUndefined(storage)
  if (key === undefined || target === undefined) return EMPTY_PREFERENCES
  try {
    const parsed = JSON.parse(target.getItem(key) ?? '{}') as Record<string, unknown>
    return { pinnedKeys: uniqueStrings(parsed.pinnedKeys), hiddenKeys: uniqueStrings(parsed.hiddenKeys) }
  } catch {
    return EMPTY_PREFERENCES
  }
}

export function botDirectoryIsPinned(
  preferences: ArkmeBotDirectoryPreferences,
  bot: Pick<ArkmeBotSummary, 'botRef' | 'directoryKey'>,
): boolean {
  return preferences.pinnedKeys.includes(botDirectoryPreferenceKey(bot))
}

export function botDirectoryIsHidden(
  preferences: ArkmeBotDirectoryPreferences,
  bot: Pick<ArkmeBotSummary, 'botRef' | 'directoryKey'>,
): boolean {
  return preferences.hiddenKeys.includes(botDirectoryPreferenceKey(bot))
}

export function writeBotDirectoryPreferences(
  userId: number | undefined,
  preferences: ArkmeBotDirectoryPreferences,
  storage?: Storage,
): void {
  const key = storageKey(userId)
  const target = storageOrUndefined(storage)
  if (key === undefined || target === undefined) return
  try { target.setItem(key, JSON.stringify(preferences)) }
  catch { /* Browser preference storage is optional. */ }
}

export function updateBotDirectoryPreferences(
  preferences: ArkmeBotDirectoryPreferences,
  bot: Pick<ArkmeBotSummary, 'botRef' | 'directoryKey'>,
  update: { pinned?: boolean; hidden?: boolean },
): ArkmeBotDirectoryPreferences {
  const key = botDirectoryPreferenceKey(bot)
  const pinned = new Set(preferences.pinnedKeys)
  const hidden = new Set(preferences.hiddenKeys)
  if (update.pinned !== undefined) (update.pinned ? pinned.add(key) : pinned.delete(key))
  if (update.hidden !== undefined) (update.hidden ? hidden.add(key) : hidden.delete(key))
  return { pinnedKeys: [...pinned], hiddenKeys: [...hidden] }
}
