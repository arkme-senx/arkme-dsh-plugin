import { describe, expect, it, vi } from 'vitest'
import { BackgroundSoundMembershipService } from '../../src/services/background-sound-membership-service.js'

function fixture(initialUserId = 42) {
  let userId = initialUserId
  const requireSession = vi.fn(async () => ({ userId, accessToken: 'access', refreshToken: 'refresh' }))
  const authenticatedAuthReadPost = vi.fn()
  return {
    service: new BackgroundSoundMembershipService({ requireSession, authenticatedAuthReadPost } as never),
    requireSession,
    authenticatedAuthReadPost,
    setUserId(nextUserId: number) { userId = nextUserId },
  }
}

describe('BackgroundSoundMembershipService', () => {
  it('projects free and eligible member types from the current record owner', async () => {
    const { service, authenticatedAuthReadPost, requireSession } = fixture()
    const controller = new AbortController()
    authenticatedAuthReadPost
      .mockResolvedValueOnce({ member_type: 0 })
      .mockResolvedValueOnce({ member_type: 2 })

    await expect(service.current({ signal: controller.signal, expectedUserId: 42 })).resolves.toEqual({
      userId: 42,
      memberType: 0,
      eligible: false,
    })
    await expect(service.current()).resolves.toEqual({
      userId: 42,
      memberType: 2,
      eligible: true,
    })

    expect(authenticatedAuthReadPost).toHaveBeenNthCalledWith(
      1,
      '/api/v1/premium/get/member',
      {},
      expect.objectContaining({ userId: 42 }),
      controller.signal,
    )
    expect(authenticatedAuthReadPost).toHaveBeenNthCalledWith(
      2,
      '/api/v1/premium/get/member',
      {},
      expect.objectContaining({ userId: 42 }),
      undefined,
    )
    expect(requireSession).toHaveBeenCalledTimes(4)
  })

  it.each([
    {},
    { member_type: '0' },
    { member_type: -1 },
    { member_type: 1.5 },
    { member_type: Number.NaN },
  ])('rejects malformed member_type instead of projecting it as free: %j', async response => {
    const { service, authenticatedAuthReadPost } = fixture()
    authenticatedAuthReadPost.mockResolvedValueOnce(response)

    await expect(service.current()).rejects.toMatchObject({
      code: 'background-sound-membership-contract-invalid',
      retryable: true,
      httpStatus: 502,
    })
  })

  it('rejects an invalid or changed expected account before the remote request', async () => {
    const { service, authenticatedAuthReadPost } = fixture()

    await expect(service.current({ expectedUserId: 0 }))
      .rejects.toMatchObject({ code: 'background-sound-membership-expected-user-invalid' })
    await expect(service.current({ expectedUserId: 99 }))
      .rejects.toMatchObject({ code: 'background-sound-membership-account-changed' })
    expect(authenticatedAuthReadPost).not.toHaveBeenCalled()
  })

  it('drops a response when the authenticated account changes in flight', async () => {
    const { service, authenticatedAuthReadPost, setUserId } = fixture()
    authenticatedAuthReadPost.mockImplementationOnce(async () => {
      setUserId(43)
      return { member_type: 2 }
    })

    await expect(service.current({ expectedUserId: 42 }))
      .rejects.toMatchObject({ code: 'background-sound-membership-account-changed' })
  })

  it('preserves transport failures so callers can represent membership as unknown', async () => {
    const { service, authenticatedAuthReadPost } = fixture()
    authenticatedAuthReadPost.mockRejectedValueOnce(new Error('offline'))

    await expect(service.current()).rejects.toThrow('offline')
  })
})
