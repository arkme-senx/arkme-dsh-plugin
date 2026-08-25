import { describe, expect, it } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArkoService } from '../../src/services/arko-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ArkoService', () => {
  it('rejects an invalid model route before owner access', async () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const service = new ArkoService(runtime, new ProfileService(runtime))
    await expect(service.arkoActivateModel('../invalid')).rejects.toMatchObject({ code: 'arko-model-route-invalid' })
  })

  it('uses the client-compatible send time before the creation time for history activity', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    runtime.authenticatedIntelligentPost = async () => ({
      message_ls: [{
        id: 101,
        session_id: 88,
        role: 3,
        content: '最新回复',
        send_at: 1_786_000_100,
        created_at: 1_786_000_000,
        status: 1,
      }],
    })
    const service = new ArkoService(runtime, new ProfileService(runtime))

    await expect(service.arkoHistoryPage(10, 0)).resolves.toMatchObject({
      items: [{ text: '最新回复', createdAtMillis: 1_786_000_100_000 }],
    })
  })
})
