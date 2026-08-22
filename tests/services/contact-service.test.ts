import { describe, expect, it, vi } from 'vitest'
import { ContactService } from '../../src/services/contact-service.js'

const session = { userId: 7, accessToken: 'access', refreshToken: 'refresh' }
const source = {
  sourceRef: 'safe-source-ref', sourceKey: 'safe-source-key', kind: 'private_chat' as const,
  displayName: '林林', activeAtMillis: 1, unreadCount: 0,
}

function fixture(authResult: Record<string, unknown>) {
  const runtime = {
    requireSession: vi.fn(async () => session),
    authenticatedAuthPost: vi.fn(async () => authResult),
    authenticatedChatPost: vi.fn(async () => ({ session: { chat_session_uid: 'chat-returned', session_kind: 1 } })),
  }
  const sourceOwner = {
    chatSourceFromBundle: vi.fn(async () => source),
    setChatSource: vi.fn(), invalidateSourceListCache: vi.fn(),
    chatDirectorySourceKey: vi.fn(async () => 'safe-source-key'),
  }
  const profile = { sealProfileImageRef: vi.fn(async () => 'safe-avatar-ref') }
  const realtime = { nextChatClientRevision: vi.fn(() => 1), emitChatClientEvent: vi.fn() }
  return {
    service: new ContactService(runtime as never, sourceOwner as never, profile as never, realtime as never),
    runtime, sourceOwner, profile, realtime,
  }
}

describe('ContactService', () => {
  it('keeps internal user IDs and avatar URLs behind an opaque search result, then uses the registered contact endpoint', async () => {
    const { service, runtime, sourceOwner, realtime } = fixture({
      exists: true, is_registered: true, can_add: true, is_self: false, invite_by_sms: false,
      user_id: 88, nick_name: '林林', jotmo_id: 'lin-lin', head_img: 'https://signed.example/secret',
    })
    const result = await service.search('lin-lin')

    expect(result).toMatchObject({
      contactRef: expect.stringMatching(/^arkme-contact-v1\.[0-9a-f-]{36}$/i),
      identifierKind: 'arkme_id', displayName: '林林', arkmeId: 'lin-lin', avatarRef: 'safe-avatar-ref',
      registered: true, canAdd: true, isSelf: false,
    })
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('targetUserId')
    expect(JSON.stringify(result)).not.toContain('signed.example')

    await expect(service.add(result.contactRef, {
      remark: '同事', requestUid: '9f445b4f-55aa-45c1-9250-25161832d432',
    })).resolves.toEqual({ state: 'ready', source: { ...source, avatarRef: 'safe-avatar-ref' } })
    expect(runtime.authenticatedAuthPost).toHaveBeenCalledTimes(2)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/contacts/add-and-open-private',
      expect.objectContaining({
        chat_session_uid: 'chat_session_9f445b4f-55aa-45c1-9250-25161832d432',
        target_user_id: 88, target_display_name_snapshot: '林林', remark: '同事',
      }),
      session, undefined, { key: 'contact:add:9f445b4f-55aa-45c1-9250-25161832d432' },
    )
    expect(sourceOwner.invalidateSourceListCache).toHaveBeenCalledWith(7, 'root')
    expect(realtime.emitChatClientEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'sessions-delta' }))
  })

  it('normalizes a phone and creates a pending contact without inventing a target user ID', async () => {
    const { service, runtime } = fixture({
      exists: false, is_registered: false, can_add: true, is_self: false, invite_by_sms: true,
      phone: '13800138000', nick_name: '', jotmo_id: '',
    })
    const result = await service.search('+86 138 0013 8000')
    expect(result).toMatchObject({ identifierKind: 'phone', registered: false, inviteBySms: true, canAdd: true })
    await expect(service.add(result.contactRef, {
      requestUid: '9f445b4f-55aa-45c1-9250-25161832d433',
    })).resolves.toMatchObject({ state: 'pending' })
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith(
      '/api/v1/chats/contacts/add-and-open-pending-phone',
      expect.objectContaining({ phone_pre: '86', phone: '13800138000' }),
      session, undefined, { key: 'contact:add:9f445b4f-55aa-45c1-9250-25161832d433' },
    )
  })

  it('never routes an unregistered Arkme ID through the pending-phone endpoint', async () => {
    const { service, runtime } = fixture({
      exists: false, is_registered: false, can_add: true, is_self: false, invite_by_sms: false,
      user_id: 0, nick_name: '', jotmo_id: '',
    })
    const result = await service.search('lin-lin')
    expect(result).toMatchObject({ identifierKind: 'arkme_id', registered: false, canAdd: false })

    await expect(service.add(result.contactRef, {
      requestUid: '9f445b4f-55aa-45c1-9250-25161832d435',
    })).rejects.toMatchObject({ code: 'contact-add-unavailable' })
    expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
  })

  it('rejects invalid identifiers and expired/forged references before any write', async () => {
    const { service, runtime } = fixture({})
    await expect(service.search('123')).rejects.toMatchObject({ code: 'contact-phone-invalid' })
    await expect(service.search('1abc')).rejects.toMatchObject({ code: 'contact-arkme-id-invalid' })
    await expect(service.search('-abc')).rejects.toMatchObject({ code: 'contact-arkme-id-invalid' })
    await expect(service.add('arkme-contact-v1.forged')).rejects.toMatchObject({ code: 'contact-ref-invalid' })
    expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
  })

  it('requires a fresh search when an identifier resolves to a different account before the write', async () => {
    const { service, runtime } = fixture({
      exists: true, is_registered: true, can_add: true, is_self: false, invite_by_sms: false,
      user_id: 88, nick_name: '原账号', jotmo_id: 'lin-lin',
    })
    const result = await service.search('lin-lin')
    runtime.authenticatedAuthPost.mockResolvedValueOnce({
      exists: true, is_registered: true, can_add: true, is_self: false, invite_by_sms: false,
      user_id: 99, nick_name: '新账号', jotmo_id: 'lin-lin',
    })

    await expect(service.add(result.contactRef, {
      requestUid: '9f445b4f-55aa-45c1-9250-25161832d434',
    })).rejects.toMatchObject({ code: 'contact-candidate-changed', httpStatus: 409 })
    expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
  })
})
