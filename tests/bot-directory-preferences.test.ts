import { describe, expect, it } from 'vitest'
import {
  botDirectoryIsHidden,
  botDirectoryIsPinned,
  botDirectoryPreferenceKey,
  readBotDirectoryPreferences,
  updateBotDirectoryPreferences,
  writeBotDirectoryPreferences,
} from '../src/client/bot-directory-preferences.js'

const bot = { botRef: 'temporary-bot-ref', directoryKey: 'arkme-bot-directory-v1.stable-opaque-key' }

describe('Bot directory preferences', () => {
  it('uses the stable opaque key instead of the renewable Bot reference', () => {
    expect(botDirectoryPreferenceKey(bot)).toBe('arkme-bot-directory-v1.stable-opaque-key')
  })

  it('updates pin and removal state independently', () => {
    const pinned = updateBotDirectoryPreferences({ pinnedKeys: [], hiddenKeys: [] }, bot, { pinned: true })
    expect(botDirectoryIsPinned(pinned, bot)).toBe(true)
    expect(botDirectoryIsHidden(pinned, bot)).toBe(false)

    const removed = updateBotDirectoryPreferences(pinned, bot, { hidden: true, pinned: false })
    expect(botDirectoryIsPinned(removed, bot)).toBe(false)
    expect(botDirectoryIsHidden(removed, bot)).toBe(true)
  })

  it('persists preferences separately for each signed-in account', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    } as Storage
    const preferences = updateBotDirectoryPreferences({ pinnedKeys: [], hiddenKeys: [] }, bot, { pinned: true })

    writeBotDirectoryPreferences(10001, preferences, storage)
    expect(readBotDirectoryPreferences(10001, storage)).toEqual(preferences)
    expect(readBotDirectoryPreferences(10002, storage)).toEqual({ pinnedKeys: [], hiddenKeys: [] })
  })
})
