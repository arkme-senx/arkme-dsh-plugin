import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeOwnedExtensionStore } from '../../src/extensions/owned-store.js'

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

    expect(statSync(join(directory, 'owned-extensions.sqlite3')).mode & 0o777).toBe(0o600)
  })

  it('keeps profile ownership stable while a local dependency spec changes', () => {
    const store = new ArkmeOwnedExtensionStore(temporaryDirectory())
    store.claim('profile', 'web\0local-weather', 7, 'a'.repeat(64))
    store.claim('profile', 'web\0local-weather', 7, 'b'.repeat(64))

    expect(store.owner('profile', 'web\0local-weather')).toBe(7)
    expect(store.specDigest('profile', 'web\0local-weather')).toBe('b'.repeat(64))
    store.close()
  })
})
