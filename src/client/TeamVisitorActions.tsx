import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TeamConversation, TeamIdentity } from '../team-app-contract.js'
import type { ArkmeOpenPrivateChatResult } from '../types.js'
import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { callArkme } from './api.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { arkmeUi } from './ui-controller.js'
import { tr } from './locale.js'

/** All people use the same card/menu; identity is bound to the authorized conversation. */
export function useTeamVisitorActions({ conversation, accountKey, onRecords, onOpen, resolveIdentity, onMention }: {
  conversation: TeamConversation; accountKey: string; onRecords(person?: TeamIdentity, mode?: 'owner' | 'mentioned'): void; onMention?(person: TeamIdentity): void; onOpen(): void
  resolveIdentity?(identity: TeamIdentity): TeamIdentity
}) {
  const [selected, setSelected] = useState<{ identity: TeamIdentity; visitor: boolean }>()
  const [profile, setProfile] = useState(false), [menu, setMenu] = useState<{ x: number; y: number }>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController>()
  const close = () => { request.current?.abort(); request.current = undefined; setBusy(false); setProfile(false); setMenu(undefined) }
  useEffect(() => {
    close(); setError('')
    return () => { request.current?.abort() }
  }, [conversation.key, accountKey])
  const chosen = selected?.visitor ? conversation.visitor : selected?.identity ?? conversation.visitor
  const visitor = chosen && resolveIdentity ? resolveIdentity(chosen) : chosen, name = visitor?.nickname || tr('用户')
  const openPrivate = async () => {
    if (request.current) return
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const internal = selected?.visitor === false
      const result = await callArkme<ArkmeOpenPrivateChatResult>(internal ? 'team.app.person.private.open' : 'team.app.visitor.private.open', {
        conversationRef: conversation.ref, expectedAccountKey: accountKey,
        ...(internal ? { personRef: visitor?.personRef } : {}),
      }, controller.signal)
      if (!controller.signal.aborted) { setProfile(false); arkmeUi.activateNotificationSource(result.source) }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('打开私聊失败，请重试'))
    } finally {
      if (request.current === controller) { request.current = undefined; setBusy(false) }
    }
  }
  return {
    close,
    avatar: (image: ReactNode, identity?: TeamIdentity) => conversation.side !== 'team' || identity && !identity.personRef ? image : <button type="button"
      aria-label={tr('{v0} 的用户卡片', { v0: identity?.nickname ?? conversation.visitor?.nickname ?? tr('用户') })}
      style={{ display: 'inline-flex', flex: 'none', padding: 0, border: 0, background: 'transparent', borderRadius: '50%', cursor: 'pointer' }}
      onClick={event => { event.stopPropagation(); close(); onOpen(); setSelected({ identity: identity ?? conversation.visitor ?? { nickname: tr('用户') }, visitor: !identity }); setError(''); setProfile(true) }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); close(); onOpen(); setSelected({ identity: identity ?? conversation.visitor ?? { nickname: tr('用户') }, visitor: !identity }); setProfile(false); setMenu({ x: event.clientX, y: event.clientY }) }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
        event.preventDefault(); event.stopPropagation(); close(); onOpen(); setSelected({ identity: identity ?? conversation.visitor ?? { nickname: tr('用户') }, visitor: !identity }); setProfile(false)
        const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom })
      } }}>{image}</button>,
    layer: conversation.side !== 'team' ? null : <>
      {menu && <div style={{ position: 'fixed', width: 0, height: 0 }}><ArkmeActionMenu
        label={tr('{v0} 的成员操作', { v0: name })} point={menu} autoFocus onClose={() => setMenu(undefined)}
        actions={[...(visitor?.personRef && !visitor.isMe && onMention ? [{id:'mention',label:`@${name}`,onSelect:()=>{setMenu(undefined);onMention(visitor)}}] : []), ...(visitor?.personRef ? [{id:'mentioned-records',label:tr(visitor.isMe ? '@我的快记' : '@TA的快记'),onSelect:()=>{setMenu(undefined);onRecords(visitor,'mentioned')}}] : []), { id: 'owner-records', label: tr(visitor?.isMe ? '看我的快记' : '看TA的快记'), onSelect: () => { setMenu(undefined); onRecords(selected?.visitor === false ? visitor : undefined) } }]} /></div>}
      {profile && <ArkmeMemberProfileCard member={{ displayName: name, ...(visitor?.imageRef ? { avatarRef: visitor.imageRef } : {}) }}
        imagePort={teamAvatarImages} imageKey={visitor?.imageKey} hideSend={visitor?.isMe === true} busy={busy} error={error} onClose={close} onSend={() => { void openPrivate() }} />}
    </>,
  }
}
