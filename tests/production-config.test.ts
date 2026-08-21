import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  resolveArkmeAppVersion,
} from '../src/index.js'

describe('test plugin configuration', () => {
  it('routes each owner API and the update service to test infrastructure', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(patch).toContain('environment: test')
    expect(patch).toContain('authBaseUrl: https://jotmo.senguo.me')
    expect(patch).toContain('subjectBaseUrl: https://jotmo-subject.senguo.me')
    expect(patch).toContain('botBaseUrl: https://jotmo-bot.senguo.me')
    expect(patch).toContain('recordBaseUrl: https://jotmo-record.senguo.me')
    expect(patch).toContain('chatBaseUrl: https://jotmo-chat.senguo.me')
    expect(patch).toContain('imBaseUrl: https://jotmo-im.senguo.me')
    expect(patch).toContain('webrtcBaseUrl: https://jotmo-webrtc.senguo.me')
    expect(patch).toContain('worldBaseUrl: https://jotmo-world.senguo.me')
    expect(patch).toContain('relationBaseUrl: https://jotmo-relation.senguo.me')
    expect(patch).toContain('intelligentBaseUrl: https://jotmo-intelligent.senguo.me')
    expect(patch).toContain('audioBaseUrl: https://jotmo-audio.senguo.me')
    expect(patch).toContain('extensionPublishBaseUrl: https://jotmo-extension-publish.senguo.me')
    expect(patch).toContain('test-ed25519-20260819-1')
    expect(patch).toContain('toolProfile: business')
    expect(patch).toContain('relatedRecordingsEnabled: true')
    expect(patch).not.toContain('relatedRecordingSharingEnabled:')
    expect(patch).toContain('interwovenMomentsEnabled: true')
    expect(patch).toContain('richMediaRenderEnabled: true')
    expect(patch).toContain('richMediaSendEnabled: true')
    expect(patch).toContain('maxUploadBytes: 104857600')
    expect(patch).toContain('allowProduction: false')
    expect(patch).toContain('updateCheckEnabled: true')
    expect(patch).toContain('updateChannel: stable')
    expect(patch).toContain('updateServiceBaseUrl: https://jotmo.senguo.me')
    expect(patch).not.toContain('updateArtifactBaseUrl:')
    expect(patch).not.toContain('updateTrustedPublicKey:')
    expect(patch).not.toContain('updateRegistryUrl:')
    expect(patch).not.toContain('registry.npmjs.org')
    expect(patch).toContain('updateCheckIntervalHours: 12')
    expect(patch).toContain('updateAllowLocalInstall: true')
    expect(patch).not.toContain('environment: prod')
    expect(patch).not.toContain('https://api.jotmo.cc')
  })

  it('falls back to the desktop-injected APP version for private plugin updates', () => {
    expect(resolveArkmeAppVersion('', { ARKME_APP_VERSION: '1.2.3' })).toBe('1.2.3')
    expect(resolveArkmeAppVersion('2.0.0', { ARKME_APP_VERSION: '1.2.3' })).toBe('2.0.0')
    expect(resolveArkmeAppVersion('', {})).toBeUndefined()
  })
})
