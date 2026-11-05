import { useState, type ReactNode } from 'react'
import type { ArkmeGroupAvatarFallback } from '../types.js'
import type { MemberActionTarget } from './member-interaction.js'
import type { ArkmeBotAvatarIdentity } from './ArkmeBotAvatarActions.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeMemberProfileCard } from './ArkmeMemberProfileCard.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { arkmeConversationMessageLayout } from './conversation-message-presentation.js'
import { tr } from './locale.js'

const styles = { messageAvatar: arkmeConversationMessageLayout.messageAvatar }
const ARKME_MESSAGE_AVATAR_SIZE = 34

function UnresolvedMessageAvatar({ label, avatar }: { label: string; avatar: ReactNode }) {
  const [opened, setOpened] = useState(false), [anchor, setAnchor] = useState<HTMLElement>()
  const unavailable = tr('该消息缺少成员身份，请刷新会话后重试')
  return <>
    <button type="button" data-arkme-message-avatar="true" style={{ ...styles.messageAvatar, padding: 0, border: 0, cursor: 'pointer' }}
      aria-label={tr('查看 {v0}', { v0: label })} onClick={event => { event.stopPropagation(); setAnchor(undefined); setOpened(true) }}
      onPointerEnter={event => { if (event.pointerType === 'mouse' && event.buttons === 0 && !document.querySelector('[aria-modal="true"]')) setAnchor(event.currentTarget) }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setAnchor(event.currentTarget) }}>
      {avatar}
    </button>
    {anchor && !opened && <ArkmeActionMenu label={tr('{v0} 的成员操作', { v0: label })} hoverAnchor={anchor} autoFocus={false}
      getAnchorRect={() => anchor.getBoundingClientRect()} onClose={() => setAnchor(undefined)} actions={[
        { id: 'profile', label: tr('查看资料'), onSelect: () => { setAnchor(undefined); setOpened(true) } },
        { id: 'identity-unavailable', label: unavailable, disabled: true, onSelect: () => {} },
      ]}/>}
    {opened && <ArkmeMemberProfileCard member={{ displayName: label }} hideSend busy={false} error={unavailable}
      onClose={() => setOpened(false)} onSend={() => {}}/>}
  </>
}

export function MessageAvatar(props: {
  senderKind?: 'human' | 'bot' | undefined
  avatarRef?: string
  fallback?: ArkmeGroupAvatarFallback
  label?: string
  member?: MemberActionTarget
  profileEnabled: boolean
  hoverEnabled?: boolean | undefined
  onOpen: (member: MemberActionTarget) => void
  onContextMenu: (member: MemberActionTarget, anchorRect: DOMRect) => void
  onHover?: ((member: MemberActionTarget, anchor: HTMLElement) => void) | undefined
  bot?: ArkmeBotAvatarIdentity | undefined
  onBotHover?: ((bot: ArkmeBotAvatarIdentity, anchor: HTMLElement) => void) | undefined
  onBotMenu?: ((bot: ArkmeBotAvatarIdentity, anchorRect: DOMRect) => void) | undefined
  onBotOpen?: ((bot: ArkmeBotAvatarIdentity) => void) | undefined
}) {
  const member = props.member
  const avatar = <ArkmeUserAvatar senderKind={props.senderKind} {...(props.avatarRef === undefined ? {} : { avatarRef: props.avatarRef })}
    {...(props.fallback === undefined ? {} : { fallback: props.fallback })}
    size={ARKME_MESSAGE_AVATAR_SIZE} label={props.label ?? tr("消息头像")} />
  if (member === undefined) {
    const bot = props.bot
    if (bot === undefined) return props.profileEnabled || props.hoverEnabled
      ? <UnresolvedMessageAvatar label={props.label ?? tr('群成员')} avatar={avatar}/>
      : <span data-arkme-message-avatar="true" style={styles.messageAvatar} aria-hidden>{avatar}</span>

    return <button
    type="button" data-arkme-message-avatar="true" data-arkme-bot-avatar={bot.itemUid}
    style={{ ...styles.messageAvatar, padding: 0, border: 0, cursor: 'pointer' }}
    aria-label={tr('查看 {v0} 的 Bot 资料', { v0: bot.name })}
    onClick={event => {
      event.stopPropagation()
      props.onBotOpen?.(bot)
    }}
    onPointerEnter={event => {
      if (event.pointerType === 'mouse' && event.buttons === 0) props.onBotHover?.(bot, event.currentTarget)
    }}
    onKeyDown={event => {
      if (event.key !== 'ArrowDown') return
      event.preventDefault()
      props.onBotMenu?.(bot, event.currentTarget.getBoundingClientRect())
    }}
    onContextMenu={event => {
      event.preventDefault()
      event.stopPropagation()
      props.onBotMenu?.(bot, event.currentTarget.getBoundingClientRect())
    }}
  >{avatar}</button>
  }
  return <button
    type="button"
    data-arkme-message-avatar="true"
    style={{ ...styles.messageAvatar, padding: 0, border: 0, cursor: props.profileEnabled ? 'pointer' : 'default' }}
    aria-label={props.profileEnabled
      ? member.isSelf ? '查看我的用户卡片' : tr("查看 {v0}", { v0: member.displayName })
      : `${member.displayName} 的消息头像`}
    onClick={event => {
      event.stopPropagation()
      if (props.profileEnabled) props.onOpen(member)
    }}
    onPointerEnter={event => {
      if ((props.hoverEnabled ?? props.profileEnabled) && event.pointerType === 'mouse' && event.buttons === 0) props.onHover?.(member, event.currentTarget)
    }}
    onKeyDown={event => {
      if (event.key !== 'ArrowDown') return
      event.preventDefault()
      props.onContextMenu(member, event.currentTarget.getBoundingClientRect())
    }}
    onContextMenu={event => {
      event.preventDefault()
      event.stopPropagation()
      props.onContextMenu(member, event.currentTarget.getBoundingClientRect())
    }}
  >{avatar}</button>
}


