import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TeamConversation, TeamMessage, TeamIdentity } from '../team-app-contract.js'
import { ArkmeExtensionParentPreview } from './ArkmeExtensionParentPreview.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeMessageDetailAuthor } from './ArkmeMessageDetailAuthor.js'
import { arkmeDetailSourceBadgeStyle } from './ArkmeDetailSourceBadgeVisuals.js'
import { TeamMessageContent, TeamMessageMediaScope, teamReplyPresentation } from './TeamMessageContent.js'
import { useTeamExtensions } from './use-team-extensions.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { timeLabel } from './conversation-message-presentation.js'
import { arkmeExtensionDetailListStyles as styles } from './extension-detail-list-styles.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Team keeps its own authorization; only the visual detail primitives are shared. */
export function TeamMessageDetail({ accountKey, message, conversation, avatar, footer, onClose, onLocate, onExtend, displayIdentity }: {
  accountKey: string
  message: TeamMessage
  conversation: TeamConversation
  avatar: ReactNode
  footer?: ReactNode | ((message?: TeamMessage) => ReactNode)
  displayIdentity?: ((identity: TeamIdentity) => TeamIdentity) | undefined
  onExtend?: ((message: TeamMessage) => void) | undefined
  onLocateReply?(message: TeamMessage): void
  onClose(): void
  onLocate(message: TeamMessage): void
}) {
  const [trail, setTrail] = useState<TeamMessage[]>([])
  useEffect(() => setTrail([]), [message.key])
  const body = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const focus = trail.at(-1) ?? message
  const extensions = useTeamExtensions(accountKey, conversation, focus)
  const raw = extensions.page?.message ?? focus
  const current = displayIdentity ? { ...raw, sender: displayIdentity(raw.sender) } : raw
  const saveScroll = () => { scrollPositions.current.set(focus.key, body.current?.scrollTop ?? 0) }
  useLayoutEffect(() => {
    if (extensions.page && body.current) body.current.scrollTop = scrollPositions.current.get(focus.key) ?? 0
  }, [focus.key, extensions.page?.message.key])
  const open = (target: TeamMessage) => { saveScroll(); setTrail(previous => [...previous, target]) }
  const openParent = () => {
    const parent = current.reply
    if (!parent || parent.state === 'unavailable') return
    open({key:parent.key,ref:parent.ref,seq:parent.seq,version:parent.version,revision:0,
      side:current.side,sender:parent.sender,own:false,state:'published',createdAt:0,
      canEdit:false,canDelete:false,contentStatus:'unavailable',media:[]})
  }
  const readable = !!extensions.page && !extensions.invalidated && current.contentStatus === 'available'
  const source = conversation.side === 'team'
    ? `${conversation.channel.name} · ${conversation.visitor?.nickname ?? tr('外部联系人')}`
    : conversation.channel.name
  return <ArkmeDetailShell title="" label={tr('消息详情')} style={{ top: 0 }} onClose={onClose} bodyRef={body}
    footer={typeof footer === 'function' ? footer(extensions.page && readable ? current : undefined) : footer}
    headerContent={<ArkmeMessageDetailAuthor avatar={trail.length
      ? <ArkmeUserAvatar avatarRef={current.sender.imageRef} imageKey={current.sender.imageKey} imagePort={teamAvatarImages} label={current.sender.nickname} size={40} />
      : avatar} name={current.sender.nickname} at={current.createdAt} />}
    {...(trail.length ? { onBack: () => { saveScroll(); setTrail(previous => previous.slice(0, -1)) }, backLabel: tr('返回延展列表') } : {})}
    onPointerDownOutside={event => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[role="toolbar"], [role="menu"], [data-arkme-member-profile], [aria-modal="true"], [data-arkme-image-preview-viewport]')) onClose()
    }}>
    {readable && current.reply && <TeamMessageMediaScope conversationRef={conversation.ref} conversationKey={conversation.key} message={{ ...current,ref:current.reply.ref,key:current.reply.key,version:current.reply.version,media: current.reply.media ?? [] }}>
      <ArkmeExtensionParentPreview inline parent={teamReplyPresentation(current)!} isMe={current.own} onSelect={openParent} />
    </TeamMessageMediaScope>}
    {readable ? <TeamMessageContent message={current} conversationRef={conversation.ref} conversationKey={conversation.key} presentation="detail" /> : <p>{tr(current.state==='recalled' ? current.own ? '你撤回了一条消息' : '对方撤回了一条消息' : '内容当前不可用')}</p>}
    <button type="button" style={{ ...arkmeDetailSourceBadgeStyle, cursor: 'pointer' }} aria-label={tr('所在对话：{v0}', { v0: source })} onClick={() => onLocate(current)}>
      <span aria-hidden>↗</span><span>{source}</span>
    </button>
    {readable && onExtend && <div style={{ marginTop: 24 }}><button type="button" onClick={() => onExtend(current)} style={styles.extensionContextRetry}>{tr('延展回复')}</button></div>}
    {extensions.loading && <div role="status" style={styles.extensionContextStatus}>{tr('正在加载延展…')}</div>}
    {extensions.error && <div role="alert" style={styles.extensionContextStatus}>{extensions.error}<button type="button" style={styles.extensionContextRetry} onClick={extensions.retry}>{tr('重试')}</button></div>}
    {extensions.page && !extensions.invalidated && <section style={styles.extensionContext} aria-label={tr('团队消息延展列表')}>
      <div data-arkme-note-extension-count="true" style={styles.extensionContextTitle}>{tr('共')}{extensions.page.totalCount}{tr('条延展')}</div>
      <div style={styles.extensionContextList}>{extensions.page.items.map(rawReply => {
        const reply = displayIdentity ? { ...rawReply, sender: displayIdentity(rawReply.sender) } : rawReply
        return <div key={reply.key} style={styles.extensionContextRow} role="button" tabIndex={0}
          aria-label={tr('查看延展')} data-team-extension-item={reply.key} onClick={() => open(reply)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(reply) } }}>
          <ArkmeUserAvatar avatarRef={reply.sender.imageRef} imageKey={reply.sender.imageKey} imagePort={teamAvatarImages} label={reply.sender.nickname} size={32} />
          <div style={styles.extensionContextBody}>
            <div style={styles.extensionContextHead}><span style={styles.extensionContextName}>{reply.sender.nickname}</span><span style={styles.extensionContextTime}>{timeLabel(reply.createdAt)}</span></div>
            {reply.contentStatus === 'available' ? <TeamMessageContent message={reply} conversationRef={conversation.ref} conversationKey={conversation.key} presentation="detail" /> : <p>{tr('内容当前不可用')}</p>}
          </div>
        </div>
      })}</div>
      {extensions.page.hasMore && <button type="button" disabled={extensions.loading} onClick={extensions.more} style={styles.extensionContextRetry}>{tr('加载更多')}</button>}
    </section>}
  </ArkmeDetailShell>
}
