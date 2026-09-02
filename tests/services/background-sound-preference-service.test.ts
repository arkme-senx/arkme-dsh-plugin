import { describe, expect, it, vi } from 'vitest'
import { BackgroundSoundPreferenceService } from '../../src/services/background-sound-preference-service.js'

function fixture() {
  const authenticatedPost = vi.fn()
  const membershipCurrent = vi.fn(async () => ({ userId: 42, memberType: 1, eligible: true }))
  const runtime = {
    requireSession: vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' })),
    authenticatedPost,
  }
  return {
    service: new BackgroundSoundPreferenceService(runtime as never, { current: membershipCurrent } as never),
    authenticatedPost,
    membershipCurrent,
  }
}

describe('BackgroundSoundPreferenceService', () => {
  it('reads and updates only the authenticated account owner document', async () => {
    const { service, authenticatedPost, membershipCurrent } = fixture()
    authenticatedPost
      .mockResolvedValueOnce({ user_id: 42, found: false, enabled: false, source_version: 11, update_at: 100 })
      .mockResolvedValueOnce({ user_id: 42, enabled: true, source_version: 12, update_at: 101 })

    await expect(service.preference()).resolves.toEqual({
      userId: 42, found: false, enabled: false, eligible: true, memberType: 1,
      eligibilityReason: 'eligible', sourceVersion: 11, updatedAtMillis: 100,
    })
    await expect(service.update(true)).resolves.toEqual({
      userId: 42, found: true, enabled: true, eligible: true, memberType: 1,
      eligibilityReason: 'eligible', sourceVersion: 12, updatedAtMillis: 101,
    })
    expect(authenticatedPost).toHaveBeenNthCalledWith(
      1, '/api/v1/settings/background-voice/query', {}, expect.objectContaining({ userId: 42 }), undefined,
    )
    expect(authenticatedPost).toHaveBeenNthCalledWith(
      2, '/api/v1/settings/background-voice/update', { enabled: true }, expect.objectContaining({ userId: 42 }), undefined,
    )
    expect(membershipCurrent).toHaveBeenCalledTimes(2)
    expect(membershipCurrent).toHaveBeenNthCalledWith(1, { expectedUserId: 42 })
  })

  it('rejects an owner mismatch and preserves transport failures for UI rollback', async () => {
    const { service, authenticatedPost } = fixture()
    authenticatedPost.mockResolvedValueOnce({ user_id: 99, enabled: true })
    await expect(service.update(true)).rejects.toMatchObject({ code: 'background-sound-owner-mismatch' })

    authenticatedPost.mockRejectedValueOnce(new Error('offline'))
    await expect(service.update(false)).rejects.toThrow('offline')
    expect(authenticatedPost).toHaveBeenCalledTimes(2)
  })

  it('fences an expected account switch before issuing the remote write', async () => {
    const { service, authenticatedPost } = fixture()

    await expect(service.update(true, undefined, 99))
      .rejects.toMatchObject({ code: 'background-sound-account-changed' })
    expect(authenticatedPost).not.toHaveBeenCalled()
  })

  it('carries the verified owner identity from read to a later fenced write', async () => {
    let userId = 42
    const authenticatedPost = vi.fn(async (path: string) => path.endsWith('/query')
      ? { user_id: 42, found: true, enabled: true }
      : { user_id: userId, found: true, enabled: false })
    const service = new BackgroundSoundPreferenceService({
      requireSession: async () => ({ userId, accessToken: 'access', refreshToken: 'refresh' }),
      authenticatedPost,
    } as never, { current: async () => ({ userId, memberType: 2, eligible: true }) } as never)
    const prepared = await service.preference()
    userId = 43

    await expect(service.update(false, undefined, prepared.userId))
      .rejects.toMatchObject({ code: 'background-sound-account-changed' })
    expect(authenticatedPost).toHaveBeenCalledTimes(1)
  })

  it('forces a known free account off and rejects enable before the settings write', async () => {
    const { service, authenticatedPost, membershipCurrent } = fixture()
    membershipCurrent.mockResolvedValue({ userId: 42, memberType: 0, eligible: false })
    authenticatedPost
      .mockResolvedValueOnce({ user_id: 42, found: true, enabled: true })
      .mockResolvedValueOnce({ user_id: 42, found: true, enabled: false })

    await expect(service.preference()).resolves.toMatchObject({
      enabled: false, eligible: false, memberType: 0, eligibilityReason: 'membership-required',
    })
    await expect(service.update(true)).rejects.toMatchObject({
      code: 'background-sound-membership-required', retryable: false,
    })
    await expect(service.update(false)).resolves.toMatchObject({
      enabled: false, eligible: false, memberType: 0, eligibilityReason: 'membership-required',
    })
    expect(authenticatedPost.mock.calls.map(call => call[0])).toEqual([
      '/api/v1/settings/background-voice/query',
      '/api/v1/settings/background-voice/update',
    ])
  })

  it('represents membership failure as unknown, blocks enable, and still permits disable', async () => {
    const { service, authenticatedPost, membershipCurrent } = fixture()
    membershipCurrent.mockRejectedValue(new Error('membership offline'))
    authenticatedPost
      .mockResolvedValueOnce({ user_id: 42, found: true, enabled: true })
      .mockResolvedValueOnce({ user_id: 42, found: true, enabled: false })

    await expect(service.preference()).resolves.toMatchObject({
      enabled: false, eligible: false, eligibilityReason: 'membership-unavailable',
    })
    await expect(service.update(true)).rejects.toMatchObject({
      code: 'background-sound-membership-unavailable', retryable: true,
    })
    await expect(service.update(false)).resolves.toMatchObject({
      enabled: false, eligible: false, eligibilityReason: 'membership-unavailable',
    })
    expect(authenticatedPost.mock.calls.map(call => call[0])).toEqual([
      '/api/v1/settings/background-voice/query',
      '/api/v1/settings/background-voice/update',
    ])
  })
})
