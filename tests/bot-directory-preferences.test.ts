import { describe, expect, it } from 'vitest'
import {
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

  it('keeps only the presentation pin in local preferences', () => {
    const pinned = updateBotDirectoryPreferences({ pinnedKeys: [] }, bot, { pinned: true })
    expect(botDirectoryIsPinned(pinned, bot)).toBe(true)
  })

  it('persists preferences separately for each signed-in account', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    } as Storage
    const preferences = updateBotDirectoryPreferences({ pinnedKeys: [] }, bot, { pinned: true })

    writeBotDirectoryPreferences(10001, preferences, storage)
    expect(readBotDirectoryPreferences(10001, storage)).toEqual(preferences)
    expect(readBotDirectoryPreferences(10002, storage)).toEqual({ pinnedKeys: [] })
  })

})
