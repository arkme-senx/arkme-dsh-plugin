import { describe, expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

function fakeVoiceprintService() {
  return {
    myVoiceprint: vi.fn(async () => ({ status: 'active' })),
    outboundVoiceprintGrants: vi.fn(async (input: unknown) => input),
    recognizedVoiceprintPeople: vi.fn(async (input: unknown) => input),
    recognizedVoiceprintPerson: vi.fn(async (personRef: string) => ({ personRef })),
    recognizedPersonVoiceprints: vi.fn(async (personRef: string) => ({ personRef })),
    createVoiceprintInvitation: vi.fn(async () => ({ inviteUrl: 'https://example.test/v' })),
    createRecognizedPersonVoiceprintInvitation: vi.fn(async (personRef: string, targetContactRef: string | undefined) => ({ personRef, targetContactRef })),
    revokeVoiceprintPlaybackGrant: vi.fn(async (grantRef: string) => ({ grantRef })),
    restoreVoiceprintPlayback: vi.fn(async () => ({ restored: true })),
  }
}

describe('Voiceprint built-in Host API dispatch', () => {
  it('advertises voiceprint management as an additive Provider capability', () => {
    const config = {
      environment: 'test', authBaseUrl: 'https://auth.test', recordBaseUrl: 'https://record.test',
      chatBaseUrl: 'https://chat.test', imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test',
      worldBaseUrl: 'https://world.test', relationBaseUrl: 'https://relation.test',
      intelligentBaseUrl: 'https://intelligent.test', audioBaseUrl: 'https://audio.test',
      routePath: '/arkme-self/api', requestTimeoutMs: 5000, maxTextLength: 20_000,
      geetestCaptchaId: 'captcha-test-id-1234567890',
    } satisfies ArkmeServiceConfig
    const service = new ArkmeService(config, { read: async () => undefined, write: async () => {}, delete: async () => {} }, {
      uniqueCode: async () => 'device', revision: async () => 0,
    } as never)

    expect(service.providerCapabilities().features.voiceprintManagement).toBe(true)
  })

  it('keeps status, outbound grants and recognized people as separate read operations', async () => {
    const service = fakeVoiceprintService()

    await dispatchArkmeHostOperation(service as never, 'voiceprint.status' as never, {})
    await dispatchArkmeHostOperation(service as never, 'voiceprint.grants' as never, {
      cursor: ' next ', limit: 999, userId: 91,
    })
    await dispatchArkmeHostOperation(service as never, 'voiceprint.people' as never, {
      cursor: ' people-next ', limit: -5, speakerId: 'must-not-forward',
    })

    expect(service.myVoiceprint).toHaveBeenCalledWith()
    expect(service.outboundVoiceprintGrants).toHaveBeenCalledWith({ cursor: 'next', limit: 100 })
    expect(service.recognizedVoiceprintPeople).toHaveBeenCalledWith({ cursor: 'people-next', limit: 1 })
  })

  it('forwards only the opaque recognized-person reference to detail and library operations', async () => {
    const service = fakeVoiceprintService()

    await dispatchArkmeHostOperation(service as never, 'voiceprint.person' as never, {
      personRef: ' person-ref ', speakerId: 'must-not-forward', targetUserId: 99,
    })
    await dispatchArkmeHostOperation(service as never, 'voiceprint.person.voiceprints' as never, {
      personRef: ' person-ref ', grantRef: 'must-not-forward',
    })

    expect(service.recognizedVoiceprintPerson).toHaveBeenCalledWith('person-ref')
    expect(service.recognizedPersonVoiceprints).toHaveBeenCalledWith('person-ref')
  })

  it('keeps invitation, grant revocation and playback restoration as separate writes', async () => {
    const service = fakeVoiceprintService()

    await dispatchArkmeHostOperation(service as never, 'voiceprint.invite' as never, { scope: 'voiceprint_play' })
    await dispatchArkmeHostOperation(service as never, 'voiceprint.person.invite' as never, {
      personRef: ' person-ref ', targetContactRef: ' contact-ref ', targetUserId: 99,
    })
    await dispatchArkmeHostOperation(service as never, 'voiceprint.revoke' as never, {
      grantRef: ' grant-ref ', personRef: 'must-not-forward',
    })
    await dispatchArkmeHostOperation(service as never, 'voiceprint.restore' as never, {
      consentVersion: 'browser-owned',
    })

    expect(service.createVoiceprintInvitation).toHaveBeenCalledWith()
    expect(service.createRecognizedPersonVoiceprintInvitation).toHaveBeenCalledWith('person-ref', 'contact-ref')
    expect(service.revokeVoiceprintPlaybackGrant).toHaveBeenCalledWith('grant-ref')
    expect(service.restoreVoiceprintPlayback).toHaveBeenCalledWith()
  })

  it('keeps the contact target absent for a bound-person invitation', async () => {
    const service = fakeVoiceprintService()

    await dispatchArkmeHostOperation(service as never, 'voiceprint.person.invite' as never, {
      personRef: ' person-ref ',
    })

    expect(service.createRecognizedPersonVoiceprintInvitation).toHaveBeenCalledWith('person-ref', undefined)
  })
})
