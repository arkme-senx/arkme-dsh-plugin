import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('production plugin configuration', () => {
  it('routes each owner API to its production service', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(patch).toContain('environment: prod')
    expect(patch).toContain('authBaseUrl: https://api.jotmo.cc')
    expect(patch).toContain('subjectBaseUrl: https://subject.jotmo.cc')
    expect(patch).toContain('recordBaseUrl: https://record.jotmo.cc')
    expect(patch).toContain('chatBaseUrl: https://chat.jotmo.cc')
    expect(patch).toContain('imBaseUrl: https://im.jotmo.cc')
    expect(patch).toContain('webrtcBaseUrl: https://webrtc.jiwo.cc')
    expect(patch).toContain('worldBaseUrl: https://world.jotmo.cc')
    expect(patch).toContain('relationBaseUrl: https://relation.jotmo.cc')
    expect(patch).toContain('intelligentBaseUrl: https://intelligent.jotmo.cc')
    expect(patch).toContain('audioBaseUrl: https://audio.jotmo.cc')
    expect(patch).toContain('toolProfile: business')
    expect(patch).toContain('relatedRecordingsEnabled: true')
    expect(patch).not.toContain('relatedRecordingSharingEnabled:')
    expect(patch).toContain('interwovenMomentsEnabled: true')
    expect(patch).toContain('richMediaRenderEnabled: true')
    expect(patch).toContain('richMediaSendEnabled: true')
    expect(patch).toContain('maxUploadBytes: 104857600')
    expect(patch).toContain('allowProduction: true')
    expect(patch).toContain('updateCheckEnabled: true')
    expect(patch).toContain('updateChannel: stable')
    expect(patch).toContain('updateRegistryUrl: https://registry.npmjs.org')
    expect(patch).toContain('updateCheckIntervalHours: 12')
    expect(patch).toContain('updateAllowLocalInstall: false')
    expect(patch).not.toContain('chatBaseUrl: https://im.jotmo.cc')
  })
})
