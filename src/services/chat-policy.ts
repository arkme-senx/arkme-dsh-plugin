import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

type PolicyState = 1 | 2
export interface ChatPolicySnapshot {
  chat_session_uid: string
  user_id: number
  show_in_home_state: PolicyState
  privacy_state: PolicyState
  mute_state: PolicyState
  pin_state: PolicyState
  notify_state: PolicyState
  status: PolicyState | 3
  update_at: number
}
export type ChatPolicyPatch = Partial<Pick<ChatPolicySnapshot,
  'show_in_home_state' | 'privacy_state' | 'mute_state' | 'pin_state' | 'notify_state' | 'status'>>

// Chat owns atomic field updates. Callers supply intent, never a read-back snapshot.
export async function patchChatPolicy(
  runtime: ServiceRuntime,
  session: ArkmeSessionCredentials,
  chatSessionUid: string,
  patch: ChatPolicyPatch,
  signal?: AbortSignal,
): Promise<ChatPolicySnapshot> {
  signal?.throwIfAborted()
  const updated = await runtime.authenticatedChatPost<ChatPolicySnapshot>(
    '/api/v1/chats/policy/update', { chat_session_uid: chatSessionUid, patch }, session, signal,
  )
  signal?.throwIfAborted()
  if ((await runtime.requireSession()).userId !== session.userId) {
    throw new ArkmePluginError('login-context-changed', '登录账号已切换，请重试当前操作', false, 409)
  }
  if (updated === null || typeof updated !== 'object'
    || updated.chat_session_uid !== chatSessionUid || updated.user_id !== session.userId
    || !Number.isSafeInteger(updated.update_at) || updated.update_at <= 0
    || ![updated.show_in_home_state, updated.privacy_state, updated.mute_state, updated.pin_state, updated.notify_state].every(value => value === 1 || value === 2)
    || ![1, 2, 3].includes(updated.status)) {
    throw new ArkmePluginError('chat-policy-result-invalid', '会话设置读取不完整，请重试', true, 502)
  }
  if (Object.entries(patch).some(([field, value]) => updated[field as keyof ChatPolicySnapshot] !== value)) {
    throw new ArkmePluginError('chat-policy-conflict', '会话设置已变化，请刷新后重试', true, 409)
  }
  return updated
}
