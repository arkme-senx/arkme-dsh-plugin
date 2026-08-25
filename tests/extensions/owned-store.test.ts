import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeOwnedExtensionStore } from '../../src/extensions/owned-store.js'
import { expectPrivatePath } from '../helpers/private-path.js'

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'arkme-owned-extension-store-'))
}

describe('owned extension provenance store', () => {
  it('persists one source owner and cloud lineage without allowing account takeover', () => {
    const directory = temporaryDirectory()
    const store = new ArkmeOwnedExtensionStore(directory)

    store.claim('cordis', 'instance-1\0session-1\0weather-1', 7)
    store.linkCloud('cordis', 'instance-1\0session-1\0weather-1', 7, 'ext-weather')
    expect(store.owner('cordis', 'instance-1\0session-1\0weather-1')).toBe(7)
    expect(store.cloudLink('cordis', 'instance-1\0session-1\0weather-1', 7)).toBe('ext-weather')
    expect(() => store.claim('cordis', 'instance-1\0session-1\0weather-1', 8))
      .toThrow('已属于其他 Arkme 账号')
    store.close()

    const reopened = new ArkmeOwnedExtensionStore(directory)
    expect(reopened.owner('cordis', 'instance-1\0session-1\0weather-1')).toBe(7)
    expect(reopened.cloudLink('cordis', 'instance-1\0session-1\0weather-1', 7)).toBe('ext-weather')
    reopened.close()

    expectPrivatePath(join(directory, 'owned-extensions.sqlite3'), 0o600)
  })

  it('keeps profile ownership stable while a local dependency spec changes', () => {
    const store = new ArkmeOwnedExtensionStore(temporaryDirectory())
    store.claim('profile', 'web\0local-weather', 7, 'a'.repeat(64))
    store.claim('profile', 'web\0local-weather', 7, 'b'.repeat(64))

    expect(store.owner('profile', 'web\0local-weather')).toBe(7)
    expect(store.specDigest('profile', 'web\0local-weather')).toBe('b'.repeat(64))
    store.close()
  })

  it('persists Cordis-to-Profile lineage and never exposes another account link', () => {
    const directory = temporaryDirectory()
    const cordisKey = 'instance-1\0session-1\0weather-1'
    const profileKey = 'web\0@arkme-generated/weather'
    const store = new ArkmeOwnedExtensionStore(directory)
    store.claim('cordis', cordisKey, 7)
    store.claim('profile', profileKey, 7, 'a'.repeat(64))
    store.linkProfile(cordisKey, profileKey, 7)

    expect(store.profileLink(cordisKey, 7)).toBe(profileKey)
    expect(store.profileLink(cordisKey, 8)).toBeUndefined()
    expect(() => store.linkProfile(cordisKey, profileKey, 8)).toThrow('已属于其他 Arkme 账号')
    store.close()

    const reopened = new ArkmeOwnedExtensionStore(directory)
    expect(reopened.profileLink(cordisKey, 7)).toBe(profileKey)
    reopened.close()
  })

  it('removes every current-account source reference to one deleted cloud extension only', () => {
    const store = new ArkmeOwnedExtensionStore(temporaryDirectory())
    store.claim('cordis', 'instance-1\0session-1\0weather-1', 7)
    store.linkCloud('cordis', 'instance-1\0session-1\0weather-1', 7, 'ext-weather')
    store.claim('profile', 'web\0@example/weather', 7, 'a'.repeat(64))
    store.linkCloud('profile', 'web\0@example/weather', 7, 'ext-weather')
    store.claim('profile', 'web\0@example/calendar', 7, 'b'.repeat(64))
    store.linkCloud('profile', 'web\0@example/calendar', 7, 'ext-calendar')
    store.claim('profile', 'web\0@example/other-owner', 8, 'c'.repeat(64))
    store.linkCloud('profile', 'web\0@example/other-owner', 8, 'ext-weather')

    expect(store.removeCloudReferences(7, 'ext-weather')).toEqual([
      { kind: 'cordis', key: 'instance-1\0session-1\0weather-1' },
      { kind: 'profile', key: 'web\0@example/weather' },
    ])
    expect(store.owner('cordis', 'instance-1\0session-1\0weather-1')).toBeUndefined()
    expect(store.owner('profile', 'web\0@example/weather')).toBeUndefined()
    expect(store.cloudLink('profile', 'web\0@example/calendar', 7)).toBe('ext-calendar')
    expect(store.cloudLink('profile', 'web\0@example/other-owner', 8)).toBe('ext-weather')
    store.close()
  })
})
