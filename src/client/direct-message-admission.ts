import { useEffect, useMemo, useRef } from 'react'
import { directMessageAdmissionMessage } from '../direct-message-admission.js'
import { isSocialSource } from './social-access-store.js'
import { requirePhoneForSocialAction } from './social-action-guard.js'
import type { ArkmeSourceItem } from '../types.js'
import { chatActionKey, privateChatActions } from './private-chat-actions-store.js'
import { useResource } from './use-resource.js'

export async function requireDirectMessageSendAllowed(source: ArkmeSourceItem, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (isSocialSource(source)) await requirePhoneForSocialAction('发送消息', signal)
  // Forward writes already check live refusal before Record creation and again at Chat relation commit.
  // A separate UI query adds a round trip without making that write authorization more current.
  signal?.throwIfAborted()
}

export function invalidateDirectMessageAdmission(): void { privateChatActions.admission.invalidate() }

export function useDirectMessageAdmission(account: string | undefined, source: ArkmeSourceItem | undefined, applicable: boolean) {
  useEffect(() => { privateChatActions.activateAccount(account) }, [account])
  const binding = useMemo(() => ({ account: account ?? '', source: source ?? {
    sourceRef: '', kind: 'private_chat' as const, displayName: '',
  } }), [account, source?.sourceRef, source?.sourceKey, source?.kind, source?.peerUserId, source?.displayName])
  const key = account !== undefined && source !== undefined && applicable ? chatActionKey(binding) : undefined
  const { snapshot, refresh } = useResource(privateChatActions.admission, key, binding)
  const current = privateChatActions.account === account ? snapshot : privateChatActions.admission.empty
  const activeRef = useRef(key)
  activeRef.current = key
  useEffect(() => () => { activeRef.current = undefined }, [])
  // Capture the displayed intention now, not the inverse of a later read-back.
  const toggle = async (confirmRefusal: () => boolean = () => true): Promise<void> => {
    if (key === undefined) return
    try { await privateChatActions.setRefused(binding, !(current.value?.ownRefused ?? false), confirmRefusal, () => activeRef.current === key) }
    catch { /* The shared operation error remains visible until the next explicit attempt. */ }
  }
  const admission = current.value
  const blocked = key !== undefined && admission?.canSend === false
  return { applicable: key !== undefined, admission, blocked,
    error: current.operationError instanceof Error ? current.operationError.message : current.error !== undefined ? '暂时无法读取拒收设置' : '',
    busy: current.mutating,
    message: blocked && admission !== undefined ? directMessageAdmissionMessage(admission) : '',
    refresh, toggle }
}
