import { expect, it, vi } from 'vitest'
import { ChatService } from '../../src/services/chat-service.js'
import { dispatchArkmeHostOperation } from '../../src/host-api.js'
const session = { userId: 11, accessToken: 'access', refreshToken: 'refresh' }
const snapshot = { chat_session_uid: 'private-chat', user_id: 11, show_in_home_state: 1, privacy_state: 1, mute_state: 2, pin_state: 2, notify_state: 2, status: 1, update_at: 20 }
function fixture(kind = 'private_chat') {
  const post = vi.fn().mockResolvedValue(snapshot), requireSession = vi.fn().mockResolvedValue(session)
  const source = { openSourceRef: vi.fn().mockResolvedValue({ kind, ownerRef: 'private-chat' }), applyConfirmedChatPolicy: vi.fn() }
  const refreshAttentionSummary = vi.fn().mockResolvedValue(undefined)
  const service = new ChatService({ requireSession, authenticatedChatPost: post } as never, source as never, undefined as never,
    undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, { refreshAttentionSummary } as never)
  return { post, requireSession, source, service, refreshAttentionSummary }
}
it('reads the account-bound private policy and patches only notification intent', async () => {
  const f = fixture()
  await expect(f.service.conversationNotification('sealed')).resolves.toEqual({ messageDnd: true, chatNotificationPolicyUpdatedAtMillis: 20 })
  expect(f.source.openSourceRef).toHaveBeenCalledWith('sealed', 11)
  expect(f.post).toHaveBeenLastCalledWith('/api/v1/chats/policy/get', { chat_session_uid: 'private-chat' }, session, undefined)
  await f.service.conversationNotification('sealed', true)
  expect(f.post).toHaveBeenLastCalledWith('/api/v1/chats/policy/update', { chat_session_uid: 'private-chat', patch: { mute_state: 2, notify_state: 2 } }, session, undefined)
  expect(f.source.applyConfirmedChatPolicy).toHaveBeenCalledWith(snapshot)
  expect(f.refreshAttentionSummary).toHaveBeenCalledOnce()
})
it('rejects unsupported sources and incomplete policy responses without projecting false facts', async () => {
  const unsupported = fixture('record')
  await expect(unsupported.service.conversationNotification('sealed', true)).rejects.toMatchObject({ code: 'chat-policy-source-invalid' })
  expect(unsupported.post).not.toHaveBeenCalled()
  const f = fixture(); f.post.mockResolvedValue({ mute_state: 2 })
  await expect(f.service.conversationNotification('sealed')).rejects.toMatchObject({ code: 'chat-policy-result-invalid' })
  expect(f.source.applyConfirmedChatPolicy).not.toHaveBeenCalled()
})
it('does not apply policy after account switch', async () => {
  const f = fixture(); f.requireSession.mockResolvedValueOnce(session).mockResolvedValue({ ...session, userId: 22 })
  await expect(f.service.conversationNotification('sealed')).rejects.toMatchObject({ code: 'login-context-changed' })
  expect(f.source.applyConfirmedChatPolicy).not.toHaveBeenCalled()
})
it('Host validates explicit boolean and passes cancellation; caller identity is ignored', async () => {
  const service = { conversationNotification: vi.fn() }, signal = new AbortController().signal
  await dispatchArkmeHostOperation(service as never, 'chat.notification.get', { sourceRef: 'sealed', userId: 99 }, undefined, undefined, undefined, undefined, signal)
  expect(service.conversationNotification).toHaveBeenLastCalledWith('sealed', undefined, signal)
  await dispatchArkmeHostOperation(service as never, 'chat.notification.set', { sourceRef: 'sealed', enabled: false }, undefined, undefined, undefined, undefined, signal)
  expect(service.conversationNotification).toHaveBeenLastCalledWith('sealed', false, signal)
  await expect(dispatchArkmeHostOperation(service as never, 'chat.notification.set', { sourceRef: 'sealed', enabled: 'false' })).rejects.toThrow()
})
