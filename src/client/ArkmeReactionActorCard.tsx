import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeOpenPrivateChatResult } from '../types.js'
import type { ReactionActor } from '../reaction-contract.js'
import { callArkme } from './api.js'
import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { conversationWindowRequested, navigateConversationWindow } from './conversation-window.js'

export function ArkmeReactionActorCard({ scope, actor, onClose }: {
  scope: string; actor: ReactionActor; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController>()
  useEffect(() => {
    setBusy(false); setError('')
    return () => { request.current?.abort(); request.current = undefined }
  }, [scope, actor.userId])
  const send = async () => {
    if (request.current) return
    if (actor.userId === Number(scope.split(':').at(-1))) {
      arkmeUi.focusSendToSelf(); arkmeUi.chatChanged(); onClose(); return
    }
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const result = await callArkme<ArkmeOpenPrivateChatResult>('chat.private.open', { peerUserId: actor.userId, displayName: actor.displayName }, controller.signal)
      if (controller.signal.aborted) return
      if (conversationWindowRequested()) await navigateConversationWindow(result.source)
      else { arkmeChatDirectory.upsert(result.source); arkmeUi.selectSource(result.source) }
      onClose()
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '打开会话失败')
    } finally {
      if (!controller.signal.aborted) { request.current = undefined; setBusy(false) }
    }
  }
  const card = <div onClick={event => event.stopPropagation()}>
    <ArkmeMemberProfileCard copyLinkTarget={{ kind: 'person', userId: actor.userId }} error={error} member={{ displayName: actor.displayName,
      ...(actor.avatarRef ? { avatarRef: actor.avatarRef } : {}),
      ...(actor.groupNickname ? { memberName: actor.groupNickname } : {}),
    }} showTopicNickname busy={busy} onClose={onClose} onSend={() => { void send() }} />

  </div>
  return typeof document === 'undefined' ? card : createPortal(card, document.body)
}
