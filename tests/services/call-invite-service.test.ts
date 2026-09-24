import { describe, expect, it, vi } from 'vitest'
import { OutgoingCallService } from '../../src/services/outgoing-call-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import type { ProfileService } from '../../src/services/profile-service.js'

function setup(data: Record<string, unknown> = {}) {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  const post = vi.fn(async () => ({ call_url: '/share-call?token=invite-token', expires_at: Date.now() + 1_800_000,
    call_media_type: 0, sharer_profile: { user_id: 42, display_name: '分享者' }, ...data }))
  const current = vi.fn(async () => session)
  const runtime = { config: { webrtcBaseUrl: 'https://webrtc.test' }, requireSession: async () => session,
    accountScopedSession: current, authenticatedWebrtcPost: post } as unknown as ServiceRuntime
  const profile = { refreshProfile: async () => ({ profile: { displayName: '我' } }) } as unknown as ProfileService
  return { service: new OutgoingCallService(runtime, {} as never, profile), session, post, current }
}

describe('desktop callback invitation service', () => {
  it.each(['audio', 'video'] as const)('uses the mobile endpoint and account for %s links', async mediaType => {
    const { service, session, post } = setup({ call_media_type: mediaType === 'video' ? 1 : 0 })
    await expect(service.createShareCallLink(mediaType)).resolves.toMatchObject({
      callUrl: 'https://webrtc.test/share-call?token=invite-token', mediaType, sharerDisplayName: '分享者',
    })
    expect(post).toHaveBeenCalledWith('/api/v1/trtc/share-call-link/create', { call_media_type: mediaType === 'video' ? 1 : 0 }, session)
  })

  it.each([
    { call_url: 'https://evil.test/share-call?token=t' }, { call_url: '/share-call' },
    { call_url: '/call/invite?from=someone' }, { call_url: 'javascript:alert(1)' },
    { call_url: 'https://user:secret@webrtc.test/share-call?token=t' },
    { expires_at: 1 }, { call_media_type: 1 }, { sharer_profile: { user_id: 99 } },
  ])('rejects invalid server contracts %j', async data => {
    await expect(setup(data).service.createShareCallLink('audio')).rejects.toMatchObject({ code: 'call-link-invalid' })
  })

  it('rejects an account switch while the invitation is being created', async () => {
    const { service, current } = setup()
    current.mockResolvedValue({ userId: 99, accessToken: 'other', refreshToken: 'other' })
    await expect(service.createShareCallLink('audio')).rejects.toMatchObject({ code: 'call-account-changed' })
  })

  it('prepares receiving without creating a call room', async () => {
    const { service, post } = setup({ sdk_app_id: 123, user_id: 'account-42', user_sig: 'private-sig' })
    await expect(service.prepareCallReceiver()).resolves.toMatchObject({ accountUserId: 42,
      bootstrap: { userId: 'account-42', userSig: 'private-sig', outgoingOnly: false } })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]?.[0]).toBe('/api/v1/trtc/credentials')
  })

  it('shares the existing active-call lease between incoming and outgoing calls', async () => {
    const { service } = setup()
    await service.claimIncomingCall('receiver-1')
    await expect(service.claimIncomingCall('receiver-2')).rejects.toMatchObject({ code: 'call-active' })
    await service.releaseOutgoingCall('receiver-1')
    await expect(service.claimIncomingCall('receiver-2')).resolves.toHaveProperty('expiresAtMillis')
    service.dispose()
  })
})
