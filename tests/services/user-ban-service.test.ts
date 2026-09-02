import { describe, expect, it, vi } from 'vitest'
import { UserBanService } from '../../src/services/user-ban-service.js'

function fixture() {
  const authenticatedAuthReadPost = vi.fn()
  const authenticatedAuthPost = vi.fn()
  const resolvePrivateChatPeer = vi.fn(async () => ({ userId: 42, displayName: '何' }))
  return {
    service: new UserBanService(
      { authenticatedAuthReadPost, authenticatedAuthPost } as never,
      { resolvePrivateChatPeer },
    ),
    authenticatedAuthReadPost,
    authenticatedAuthPost,
    resolvePrivateChatPeer,
  }
}

function record(status: 1 | 2) {
  return {
    user_id: 42,
    status,
    operator_id: 7,
    remark: '复核记录',
    banned_at: 1_788_246_000_000,
    unbanned_at: status === 2 ? 1_788_249_600_000 : 0,
    updated_at: status === 2 ? 1_788_249_600_000 : 1_788_246_000_000,
  }
}

describe('UserBanService', () => {
  it('treats an absent independent ban record as an ordinary unbanned user', async () => {
    const { service, authenticatedAuthReadPost, resolvePrivateChatPeer } = fixture()
    authenticatedAuthReadPost.mockResolvedValue({ exists: false, banned: false })

    await expect(service.status('source-ref')).resolves.toEqual({
      sourceRef: 'source-ref', targetUserId: 42, displayName: '何', exists: false, banned: false,
    })
    expect(resolvePrivateChatPeer).toHaveBeenCalledWith('source-ref', undefined)
    expect(authenticatedAuthReadPost).toHaveBeenCalledWith(
      '/api/v1/user-ban/status', { user_id: 42 }, undefined, undefined, { bypassCache: true },
    )
  })

  it('projects the backend current fact without reusing account or cancellation state', async () => {
    const { service, authenticatedAuthReadPost } = fixture()
    authenticatedAuthReadPost.mockResolvedValue({ exists: true, banned: true, item: record(1) })

    await expect(service.status('source-ref')).resolves.toMatchObject({
      exists: true,
      banned: true,
      record: {
        sourceRef: 'source-ref', targetUserId: 42, displayName: '何', status: 'banned',
        operatorUserId: 7, remark: '复核记录', updatedAtMillis: 1_788_246_000_000,
      },
    })
  })

  it('uses explicit idempotent target-state endpoints and keeps transport ownership Host-side', async () => {
    const { service, authenticatedAuthPost } = fixture()
    authenticatedAuthPost.mockResolvedValueOnce(record(1)).mockResolvedValueOnce(record(2))

    await expect(service.ban('source-ref', ' 私聊复核 ')).resolves.toMatchObject({ status: 'banned' })
    await expect(service.unban('source-ref', ' 复核通过 ')).resolves.toMatchObject({ status: 'unbanned' })

    expect(authenticatedAuthPost).toHaveBeenNthCalledWith(
      1, '/api/v1/user-ban/ban', { user_id: 42, remark: '私聊复核' }, undefined, undefined,
      { bypassCache: true, trackWriteOutcome: true },
    )
    expect(authenticatedAuthPost).toHaveBeenNthCalledWith(
      2, '/api/v1/user-ban/unban', { user_id: 42, remark: '复核通过' }, undefined, undefined,
      { bypassCache: true, trackWriteOutcome: true },
    )
  })

  it('rejects mismatched target facts and oversized remarks', async () => {
    const { service, authenticatedAuthPost } = fixture()
    authenticatedAuthPost.mockResolvedValue({ ...record(1), user_id: 99 })

    await expect(service.ban('source-ref')).rejects.toMatchObject({ code: 'user-ban-contract-invalid' })
    await expect(service.ban('source-ref', '字'.repeat(256)))
      .rejects.toMatchObject({ code: 'user-ban-remark-invalid' })
    expect(authenticatedAuthPost).toHaveBeenCalledTimes(1)
  })

  it('rejects a current state that omits its own state timestamp', async () => {
    const { service, authenticatedAuthReadPost } = fixture()
    authenticatedAuthReadPost.mockResolvedValue({
      exists: true, banned: true, item: { ...record(1), banned_at: 0 },
    })

    await expect(service.status('source-ref')).rejects.toMatchObject({ code: 'user-ban-contract-invalid' })
  })
})
