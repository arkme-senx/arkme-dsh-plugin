import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../../src/types.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ProfileService', () => {
  it('refreshes and persists the current account profile', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let cached: ArkmeUserProfileSnapshot = { profile: null, revision: 0, cachedAtMillis: 0 }
    const stateStore = {
      async cachedProfile() { return cached },
      async cacheProfile(_userId: number, profile: ArkmeUserProfile) {
        cached = { profile, revision: 1, cachedAtMillis: Date.now() }
        return cached
      },
    } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: {
      user_id: 42, nick_name: '小明', head_img: '', name_slug: 'xiaoming', type: 1,
      create_at: 123, phone: '13800138000', email: 'ming@example.com',
      has_bind_apple: false, has_bind_wechat: true, has_bind_google: false,
    } }), { status: 200 })) as typeof fetch
    const service = new ProfileService(new ServiceRuntime(config, sessions, stateStore, fetchImpl))

    await expect(service.refreshProfile()).resolves.toMatchObject({
      revision: 1,
      profile: {
        userId: 42,
        displayName: '小明',
        arkmeId: 'xiaoming',
        contact: { phoneMasked: '138****8000', emailMasked: 'm***@example.com' },
      },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('prefers the public-profile avatar for the signed-in user', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let cached: ArkmeUserProfileSnapshot = { profile: null, revision: 0, cachedAtMillis: 0 }
    const stateStore = {
      async uniqueCode() { return 'profile-test-secret' },
      async cachedProfile() { return cached },
      async cacheProfile(_userId: number, profile: ArkmeUserProfile) {
        cached = { profile, revision: 1, cachedAtMillis: Date.now() }
        return cached
      },
    } as StateStore
    const profileAvatarUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/profile.png?x-oss-signature=test'
    const publicAvatarUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/public.png?x-oss-signature=test'
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const data = url.endsWith('/api/v1/auth/get-user-info')
        ? { user_id: 42, nick_name: '小明', head_img: profileAvatarUrl, name_slug: 'xiaoming', type: 1,
          create_at: 123, phone: '', email: '', has_bind_apple: false, has_bind_wechat: true, has_bind_google: false }
        : { items: [{ user_id: 42, nick_name: '小明', head_img: publicAvatarUrl }] }
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
    }) as typeof fetch
    const service = new ProfileService(new ServiceRuntime(config, sessions, stateStore, fetchImpl))

    const snapshot = await service.refreshProfile()

    expect(snapshot.profile).toMatchObject({
      userId: 42,
      avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./),
      avatarUrl: publicAvatarUrl,
    })
  })

  it('projects public jotmo_id as accountName without changing legacy displayName semantics', async () => {
    const activeSession = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sessions: ArkmeSessionStore = {
      async read() { return activeSession }, async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { items: [{
      user_id: 88,
      nick_name: '',
      display_name: '',
      name_slug: '',
      arkme_id: '',
      jotmo_id: 'public-account-88',
      head_img: '',
    }] } }), { status: 200 })) as typeof fetch
    const service = new ProfileService(new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl))

    const profiles = await service.publicProfileSummariesByUserIds([88], activeSession)

    expect(profiles.get(88)).toEqual({
      userId: 88,
      displayName: '',
      nickname: '',
      accountName: 'public-account-88',
    })
  })
})
