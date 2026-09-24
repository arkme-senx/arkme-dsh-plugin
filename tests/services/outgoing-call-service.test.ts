import { describe, expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { OutgoingCallService } from '../../src/services/outgoing-call-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('OutgoingCallService', () => {
  it('creates an account-bound outgoing call intent', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const runtime = new ServiceRuntime(config, sessions, stateStore)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined },
    })
    const sourceRef = await source.sealSourceRef(42, 'private_chat', 'chat-1', '同事')
    const service = new OutgoingCallService(runtime, source, profile)

    const pending = service.requestOutgoingCall(sourceRef, 'audio')
    await new Promise(resolve => setTimeout(resolve, 0))
    const claim = await service.claimOutgoingCallIntent()
    expect(claim).not.toBeNull()
    await service.resolveOutgoingCallIntent({
      intentId: claim!.intentId,
      claimToken: claim!.claimToken,
      outcome: { status: 'calling' },
    })
    await expect(pending).resolves.toMatchObject({
      status: 'calling', mediaType: 'audio', displayName: '同事',
    })
    service.dispose()
  })
})
