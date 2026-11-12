import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ArkmePluginError, ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
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
  it('lets visible timeline avatars join one background lookup without mixing viewers', async () => {
    const service = new ProfileService({ config } as ServiceRuntime)
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    let finish!: (result: Map<number, never>) => void
    const pending = new Promise<Map<number, never>>(resolve => { finish = resolve })
    const read = vi.spyOn(service, 'publicProfilesByUserIds').mockReturnValue(pending)
    service.prefetchTimelineAvatars([7, 8, 7], session)
    service.prefetchTimelineAvatars([7], session)
    const first = service.pendingTimelineAvatar(42, 7)
    expect(first).toBeDefined()
    expect(service.pendingTimelineAvatar(42, 8)).toBe(first)
    expect(service.pendingTimelineAvatar(43, 7)).toBeUndefined()
    expect(read).toHaveBeenCalledExactlyOnceWith([7, 8], session, expect.any(AbortSignal))
    finish(new Map())
    await first
    expect(service.pendingTimelineAvatar(42, 7)).toBeUndefined()
  })
  it.each(['userIds', 'arkmeIds'] as const)('bounds cached public avatars read through %s without crossing viewer scope', async kind => {
    const avatarUrl='https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=test'
    const read=vi.fn(async(_path:string,body:Record<string,unknown>)=>({items:
      ((body.user_ids??body.jotmo_ids) as (number|string)[]).map(value=>{
        const userId=Number(String(value).replace('user',''))
        return {user_id:userId,jotmo_id:`user${userId}`,head_img:avatarUrl}
      })}))
    const service=new ProfileService({config,requireSession:async()=>({userId:42}),
      authenticatedAuthPost:read,accountScopedPublicAuthReadPost:read} as unknown as ServiceRuntime)
    vi.spyOn(service,'sealProfileImageRef').mockImplementation(async(viewer,user)=>`avatar:${viewer}:${user}`)
    const ids=Array.from({length:4097},(_,i)=>i+1)
    if(kind==='userIds') await service.publicAvatarPresentationsByUserIds(ids)
    else await service.publicAvatarPresentationsByArkmeIds(ids.map(id=>`user${id}`))
    expect(service.cachedPublicProfileAvatar(42,1)).toBeUndefined()
    expect(service.cachedPublicProfileAvatar(42,4097)).toBe(avatarUrl)
    expect(service.cachedPublicProfileAvatar(43,4097)).toBeUndefined()
    service.invalidate(42)
    expect(service.cachedPublicProfileAvatar(42,4097)).toBeUndefined()
  })
  it('projects public user avatars as viewer-scoped references and preserves default avatars',async()=>{
    const requireSession=vi.fn(async()=>({userId:42,accessToken:'a',refreshToken:'r'}))
    const target=new ProfileService({requireSession} as unknown as ServiceRuntime)
    const fallback={kind:'phone_default' as const,label:'访',colorIndex:2}
    vi.spyOn(target,'publicProfileSummariesByUserIds').mockResolvedValue(new Map([
      [7,{userId:7,displayName:'A',nickname:'A',avatarUrl:'https://private-signed-avatar.invalid/path?secret=not-for-ui'}],
      [8,{userId:8,displayName:'B',nickname:'B',avatarFallback:fallback}],
      [9,{userId:9,displayName:'C',nickname:'C'}],
    ]))
    const seal=vi.spyOn(target,'sealProfileImageRef').mockImplementation(async(viewer,user)=>`avatar:${viewer}:${user}`)
    const result=await target.publicAvatarPresentationsByUserIds([7,8,9])
    expect(result.get(7)).toEqual({avatarRef:'avatar:42:7'})
    expect(result.get(8)).toEqual({avatarFallback:fallback})
    expect(result.get(9)).toEqual({})
    expect(seal).toHaveBeenCalledExactlyOnceWith(42,7)
    expect(JSON.stringify([...result])).not.toMatch(/https:|secret/)
    requireSession.mockResolvedValue({userId:43,accessToken:'b',refreshToken:'s'})
    expect((await target.publicAvatarPresentationsByUserIds([7])).get(7)?.avatarRef).toBe('avatar:43:7')
  })
  it('rejects malformed public-profile collections without negative-caching them as absent users', async () => {
    const request = vi.fn().mockResolvedValueOnce({ items: 'invalid' }).mockResolvedValueOnce({ items: [{ user_id: 7, nick_name: '正常姓名' }] })
    const service = new ProfileService({ config, authenticatedAuthPost: request } as unknown as ServiceRuntime)
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    await expect(service.publicProfileSummariesByUserIds([7], session)).rejects.toMatchObject({ code: 'public-profile-contract-invalid', retryable: false })
    expect((await service.publicProfileSummariesByUserIds([7], session)).get(7)?.nickname).toBe('正常姓名')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('logs a failed public-profile batch with user IDs and preserves the original error', async () => {
    const error = new ArkmePluginError('arkme-timeout', 'SECRET_MESSAGE', true, 504)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const service = new ProfileService({
        config, authenticatedAuthPost: vi.fn().mockRejectedValue(error),
      } as unknown as ServiceRuntime)
      await expect(service.publicProfileSummariesByUserIds([88, 99], { userId: 42, accessToken: 'SECRET_TOKEN', refreshToken: 'SECRET_REFRESH' }))
        .rejects.toBe(error)
      const line = String(warn.mock.calls[0]![0])
      expect(JSON.parse(line.slice('[ArkmeAvatarDiag] '.length))).toMatchObject({
        event: 'profile_fetch_failed', viewerUserId: 42, targetUserIds: [88, 99], error: { code: 'arkme-timeout', httpStatus: 504 },
      })
      expect(line).not.toContain('SECRET')
    } finally { warn.mockRestore() }
  })

  it('logs rejected avatars and missing profiles but keeps ordinary default avatars quiet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const service = new ProfileService({
        config, authenticatedAuthPost: vi.fn().mockResolvedValue({ items: [
          { user_id: 88, head_img: 'https://untrusted.test/private?x-oss-signature=SECRET' },
          { user_id: 89, head_img: '' },
          { user_id: 90, head_img: 'phone_avatar://v1/1/AB' },
          { user_id: 91, head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=SECRET' },
        ] }),
      } as unknown as ServiceRuntime)
      const profiles = await service.publicProfileSummariesByUserIds([88, 89, 90, 91, 92], {
        userId: 42, accessToken: 'SECRET_TOKEN', refreshToken: 'SECRET_REFRESH',
      })
      expect(profiles.get(88)?.avatarUrl).toBeUndefined()
      expect(profiles.get(90)?.avatarFallback).toMatchObject({ kind: 'phone_default' })
      expect(profiles.get(91)?.avatarUrl).toBeDefined()
      expect(profiles.has(92)).toBe(false)
      expect(warn).toHaveBeenCalledTimes(2)
      const logs = warn.mock.calls.map(([line]) => JSON.parse(String(line).slice('[ArkmeAvatarDiag] '.length)))
      expect(logs).toEqual([
        expect.objectContaining({ event: 'profile_avatar_rejected', targetUserId: 88 }),
        expect.objectContaining({ event: 'profile_missing', targetUserIds: [92] }),
      ])
      expect(JSON.stringify(logs)).not.toMatch(/SECRET|https:/)
      await service.publicProfileSummariesByUserIds([88, 89, 90, 91, 92], { userId: 42, accessToken: 'a', refreshToken: 'r' })
      expect(warn).toHaveBeenCalledTimes(2)
    } finally { warn.mockRestore() }
  })

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

it('refreshes reaction names within the requested age without disabling batch caching', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  const request = vi.fn().mockResolvedValueOnce({ items: [{ user_id: 7, nick_name: '旧名字' }] }).mockResolvedValueOnce({ items: [{ user_id: 7, nick_name: '兔老大' }] })
  const service = new ProfileService({ config, authenticatedAuthPost: request } as unknown as ServiceRuntime)
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  try {
    await service.publicProfileSummariesByUserIds([7], session)
    clock.mockReturnValue(104000)
    expect((await service.publicProfileSummariesByUserIds([7, 7], session, undefined, 5000)).get(7)?.displayName).toBe('旧名字')
    expect(request).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(106000)
    expect((await service.publicProfileSummariesByUserIds([7], session, undefined, 5000)).get(7)?.displayName).toBe('兔老大')
    expect(request).toHaveBeenCalledTimes(2)
  } finally { clock.mockRestore() }
})
