import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ARKME_PRODUCTION_TRUSTED_SIGNING_KEYS,
  resolveArkmeAppVersion,
} from '../src/index.js'

describe('production plugin configuration', () => {
  it('routes every external API and update endpoint to production infrastructure', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(patch).toContain('environment: prod')
    expect(patch).toContain('authBaseUrl: https://api.jotmo.cc')
    expect(patch).toContain('subjectBaseUrl: https://subject.jotmo.cc')
    expect(patch).toContain('botBaseUrl: https://bot.jotmo.cc')
    expect(patch).toContain('recordBaseUrl: https://record.jotmo.cc')
    expect(patch).toContain('dataBaseUrl: https://data.jotmo.cc')
    expect(patch).toContain('chatBaseUrl: https://chat.jotmo.cc')
    expect(patch).toContain('imBaseUrl: https://im.jotmo.cc')
    expect(patch).toContain('webrtcBaseUrl: https://webrtc.jiwo.cc')
    expect(patch).toContain('worldBaseUrl: https://world.jotmo.cc')
    expect(patch).toContain('relationBaseUrl: https://relation.jotmo.cc')
    expect(patch).toContain('intelligentBaseUrl: https://intelligent.jotmo.cc')
    expect(patch).toContain('audioBaseUrl: https://audio.jotmo.cc')
    expect(patch).toContain('extensionPublishBaseUrl: https://extension-publish.jotmo.cc')
    expect(patch).toContain('shareWebsite: https://jiwo.cc')
    expect(patch).toContain('prod-ed25519-20260819-1')
    expect(JSON.parse(ARKME_PRODUCTION_TRUSTED_SIGNING_KEYS)).toEqual({
      'prod-ed25519-20260819-1': 'm1MKKU16hyu1b1KKIXMG+zKEr/GmhmvyUEreJzthTxs=',
    })
  })

  it('falls back to the desktop-injected APP version for private plugin updates', () => {
    expect(resolveArkmeAppVersion('', { ARKME_APP_VERSION: '1.2.3' })).toBe('1.2.3')
    expect(resolveArkmeAppVersion('2.0.0', { ARKME_APP_VERSION: '1.2.3' })).toBe('2.0.0')
    expect(resolveArkmeAppVersion('', {})).toBeUndefined()
  })
})
