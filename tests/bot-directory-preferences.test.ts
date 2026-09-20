import { describe, expect, it } from 'vitest'
import {
  botDirectoryIsPinned,
  botDirectoryPreferenceKey,
  readBotDirectoryPreferences, migrateBotDirectoryPreferences,
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


it('migrates old Browser pins only after durable confirmation and retains failed entries for retry', async () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } as Storage
  const items = ['one', 'two'].map(key => ({ botRef: `ref-${key}`, directoryKey: key, name: key, provider: 'openclaw' as const, description: '', status: 'offline' as const, directChatAvailable: true }))
  writeBotDirectoryPreferences(1, { pinnedKeys: ['one', 'two'] }, storage)
  const pinned: string[] = []
  await expect(migrateBotDirectoryPreferences(1, items, async ref => { if (ref === 'ref-two') throw new Error('disk full'); pinned.push(ref) }, undefined, storage)).rejects.toThrow('disk full')
  expect(readBotDirectoryPreferences(1, storage).pinnedKeys).toEqual(['two'])
  await migrateBotDirectoryPreferences(1, items, async ref => { pinned.push(ref) }, undefined, storage)
  expect(pinned).toEqual(['ref-one', 'ref-two'])
  expect(readBotDirectoryPreferences(1, storage).pinnedKeys).toEqual([])
  expect(readBotDirectoryPreferences(2, storage).pinnedKeys).toEqual([])
})
