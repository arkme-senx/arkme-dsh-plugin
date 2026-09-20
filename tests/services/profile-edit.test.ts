import { describe, expect, it, vi } from 'vitest'
import { ProfileService } from '../../src/services/profile-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'

function fixture() {
  let userId = 42
  let raw: Record<string, unknown> = { user_id: 42, nick_name: '原昵称', real_name: '真实名', head_img: '', phone: '13800138000', email: 'test@example.com', has_bind_wechat: true, wechat_nick_name: '微信昵称', has_bind_huawei: true }
  const get = vi.fn(async () => ({ ...raw }))
  const post = vi.fn(async (url: string, body: Record<string, unknown>) => {
    if (url.endsWith('update-user-info')) { raw = { ...raw, ...body }; return {} }
    return { items: [] }
  })
  const read = vi.fn(async () => ({ self_code: 'TEST12', self_invited_count: 3, had_fill: false, over_7_days: true }))
  const runtime = { config: { environment: 'test' }, requireSession: vi.fn(async () => ({ userId, accessToken: 'test', refreshToken: 'test' })),
    authenticatedAuthGet: get, authenticatedAuthPost: post, authenticatedAuthReadPost: read,
    requestScope: () => 'test:42', requestCoordinator: { invalidateKey: vi.fn() },
    stateStore: { uniqueCode: async () => 'test-signing-key', cacheProfile: vi.fn(async (_id: number, profile: unknown) => ({ profile, revision: 1, cachedAtMillis: 1 })) },
  } as unknown as ServiceRuntime
  return { service: new ProfileService(runtime), get, post, read, runtime, setUser: (id: number) => { userId = id }, setRaw: (patch: Record<string, unknown>) => { raw = { ...raw, ...patch } } }
}

describe('profile editing preserves mobile contract', () => {
  it('changes nickname only, preserving unmasked private fields and provider identity', async () => {
    const f = fixture()
    const result = await f.service.updateProfile({ field: 'nickname', value: ' 新昵称 ', expectedAccountScope: 'test:42' })
    expect(f.post.mock.calls.find(c => c[0].endsWith('update-user-info'))?.[1]).toEqual({ nick_name: '新昵称', real_name: '真实名', head_img: '', phone: '13800138000', email: 'test@example.com' })
    expect(result.profile).toMatchObject({ nickname: '新昵称', bindingNames: { wechat: '微信昵称' }, bindings: { huawei: true }, contact: { phoneMasked: '138****8000' } })
    expect(f.runtime.requestCoordinator.invalidateKey).toHaveBeenCalled()
  })
  it('refuses incomplete profile responses instead of clearing fields', async () => {
    const f = fixture(); f.setRaw({ email: undefined })
    await expect(f.service.updateProfile({ field: 'nickname', value: '新昵称', expectedAccountScope: 'test:42' })).rejects.toMatchObject({ code: 'profile-contract-invalid' })
    expect(f.post).not.toHaveBeenCalled()
  })
  it.each(['', 'x'.repeat(65), 'bad\nname'])('rejects invalid nickname before transport', async value => {
    const f = fixture()
    await expect(f.service.updateProfile({ field: 'nickname', value, expectedAccountScope: 'test:42' })).rejects.toMatchObject({ code: 'profile-nickname-invalid' })
    expect(f.get).not.toHaveBeenCalled(); expect(f.post).not.toHaveBeenCalled()
  })
  it('only accepts uploaded asset references for avatar edits', async () => {
    const f = fixture()
    await expect(f.service.updateProfile({ field: 'avatar', value: 'https://untrusted.test/photo.jpg', expectedAccountScope: 'test:42' })).rejects.toMatchObject({ code: 'profile-avatar-invalid' })
    expect(f.get).not.toHaveBeenCalled()
  })
  it('saves the avatar asset and changes its signed reference to invalidate browser caches', async () => {
    const f = fixture()
    const before = await f.service.sealProfileImageRef(42, 42)
    const result = await f.service.updateProfile({ field: 'avatar', value: 'file_asset://validasset012345', expectedAccountScope: 'test:42' })
    expect(result.profile?.avatarAssetRef).toBe('file_asset://validasset012345')
    expect(result.profile?.avatarRef).not.toBe(before)
    expect(result.profile?.nickname).toBe('原昵称')
    expect(f.post.mock.calls.find(c => c[0].endsWith('update-user-info'))?.[1]).toMatchObject({ head_img: 'file_asset://validasset012345', phone: '13800138000', email: 'test@example.com' })
  })
  it('stops before writing if the account changes during the read', async () => {
    const f = fixture(); f.get.mockImplementationOnce(async () => { f.setUser(43); return { user_id: 42, nick_name: '', real_name: '', head_img: '', phone: '', email: '' } })
    await expect(f.service.updateProfile({ field: 'nickname', value: 'New', expectedAccountScope: 'test:42' })).rejects.toMatchObject({ code: 'profile-account-changed' })
    expect(f.post).not.toHaveBeenCalled()
  })
  it('rejects stale scopes and aborted edits without network activity', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort()
    await expect(f.service.updateProfile({ field: 'nickname', value: 'New', expectedAccountScope: 'prod:42' })).rejects.toMatchObject({ code: 'profile-account-changed' })
    await expect(f.service.updateProfile({ field: 'nickname', value: 'New', expectedAccountScope: 'test:42' }, controller.signal)).rejects.toMatchObject({ code: 'profile-update-cancelled' })
    expect(f.get).not.toHaveBeenCalled()
  })
  it('reads invitation rewards without claiming or redeeming rewards', async () => {
    const f = fixture()
    expect(await f.service.invitationRewards('test:42')).toMatchObject({ accountScope: 'test:42', code: 'TEST12', invitedCount: 3 })
    expect(f.post).not.toHaveBeenCalled()
    await expect(f.service.invitationRewards('test:43')).rejects.toMatchObject({ code: 'profile-account-changed' })
    expect(f.read).toHaveBeenCalledTimes(1)
  })
})
