import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { TeamConversation, TeamMessage, TeamIdentity } from '../team-app-contract.js'
import { ArkmeExtensionParentPreview } from './ArkmeExtensionParentPreview.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeTimelineDetailDrawer } from './ArkmeNoteDetails.js'
import { ArkmeDetailConversationBadge } from './ArkmeDetailSourceBadgeVisuals.js'
import { ArkmeTeamChannelAvatar } from './ArkmeTeamAvatar.js'
import { TeamMessageContent, TeamMessageMediaScope, teamMessagePresentation, teamReplyPresentation } from './TeamMessageContent.js'
import { useTeamExtensions } from './use-team-extensions.js'
import { teamAvatarImages } from './team-avatar-image-runtime.js'
import { timeLabel } from './conversation-message-presentation.js'
import { arkmeExtensionDetailListStyles as styles } from './extension-detail-list-styles.js'
import { tr } from './locale.js'

/** Adapts the Team extension reader and sender to the conversation detail drawer. */
export function TeamMessageDetail({ accountKey, message, conversation, avatar, footer, onClose, onLocate, displayIdentity }: {
  accountKey: string
  message: TeamMessage
  conversation: TeamConversation
  avatar: ReactNode
  footer?: ReactNode | ((message: TeamMessage, readable: boolean) => ReactNode)
  displayIdentity?: ((identity: TeamIdentity) => TeamIdentity) | undefined
  onClose(): void
  onLocate(message: TeamMessage): void
}) {
  const [trail, setTrail] = useState<TeamMessage[]>([])
  useEffect(() => setTrail([]), [message.key])
  const body = useRef<HTMLDivElement>(null)
  const scrollPositions = useRef(new Map<string, number>())
  const focus = trail.at(-1) ?? message
  const extensions = useTeamExtensions(accountKey, conversation, focus)
  const confirmed = extensions.page?.message.version === focus.version ? extensions.page.message : undefined
  const raw = confirmed ?? focus
  const current = displayIdentity ? { ...raw, sender: displayIdentity(raw.sender) } : raw
  const saveScroll = () => { scrollPositions.current.set(focus.key, body.current?.scrollTop ?? 0) }
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = scrollPositions.current.get(focus.key) ?? 0
  }, [focus.key])
  const open = (target: TeamMessage) => { saveScroll(); setTrail(previous => [...previous, target]) }
  const openParent = () => {
    const parent = current.reply
    if (!parent || parent.state === 'unavailable') return
    open({key:parent.key,ref:parent.ref,seq:parent.seq,version:parent.version,revision:0,
      side:current.side,sender:parent.sender,own:false,state:'published',createdAt:0,
      canEdit:false,canDelete:false,contentStatus:'unavailable',media:[]})
  }
  const readable = !extensions.invalidated && confirmed?.contentStatus === 'available'
    && (focus.key !== message.key || message.contentStatus === 'available')
  const source = conversation.side === 'team'
    ? `${conversation.channel.name} · ${conversation.visitor?.nickname ?? tr('外部联系人')}`
    : conversation.channel.name
  const parent = readable && current.reply && <TeamMessageMediaScope conversationRef={conversation.ref} conversationKey={conversation.key} message={{ ...current,ref:current.reply.ref,key:current.reply.key,revision:0,version:current.reply.version,media: current.reply.media ?? [] }}>
    <ArkmeExtensionParentPreview inline parent={teamReplyPresentation(current)!} isMe={current.own} onSelect={openParent} />
  </TeamMessageMediaScope>
  const extensionList = <>
    {extensions.error && <div role="alert" style={styles.extensionContextStatus}>{extensions.error}<button type="button" style={styles.extensionContextRetry} onClick={extensions.retry}>{tr('重试')}</button></div>}
    {extensions.page && !extensions.invalidated && extensions.page.totalCount > 0 && <section style={styles.extensionContext} aria-label={tr('快记延展列表')}>
      <div data-arkme-note-extension-count="true" style={styles.extensionContextTitle}>{tr('共')}{extensions.page.totalCount}{tr('条延展')}</div>
      <div style={styles.extensionContextList}>{extensions.page.items.map(rawReply => {
        const reply = displayIdentity ? { ...rawReply, sender: displayIdentity(rawReply.sender) } : rawReply
        return <div key={reply.key} style={styles.extensionContextRow} role="button" tabIndex={0}
          aria-label={tr('查看延展')} data-team-extension-item={reply.key} data-arkme-detail-scroll-anchor={`human:${reply.key}`} onClick={() => open(reply)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(reply) } }}>
          <ArkmeUserAvatar avatarRef={reply.sender.imageRef} imageKey={reply.sender.imageKey} imagePort={teamAvatarImages} label={reply.sender.nickname} size={32} />
          <div style={styles.extensionContextBody}>
            <div style={styles.extensionContextHead}><span style={styles.extensionContextName}>{reply.sender.nickname}</span><span style={styles.extensionContextTime}>{timeLabel(reply.createdAt)}</span></div>
            {reply.contentStatus === 'available' ? <TeamMessageContent message={reply} conversationRef={conversation.ref} conversationKey={conversation.key} presentation="detail" /> : <p>{tr(reply.contentStatus === 'revalidating' ? '正在确认…' : '内容当前不可用')}</p>}
          </div>
        </div>
      })}</div>
      {extensions.page.hasMore && <button type="button" disabled={extensions.loading} onClick={extensions.more} style={styles.extensionContextRetry}>{tr('加载更多')}</button>}
    </section>}
  </>
  return <ArkmeTimelineDetailDrawer item={teamMessagePresentation(current)} showOriginal canExtend={false}
    onToggleOriginal={() => {}} onClose={onClose}
    {...(trail.length ? { onBackToExtension: () => { saveScroll(); setTrail(previous => previous.slice(0, -1)) } } : {})}
    sourceBadge={<ArkmeDetailConversationBadge name={source} avatar={conversation.side === 'team' && conversation.visitor
      ? <ArkmeUserAvatar avatarRef={conversation.visitor.imageRef} imageKey={conversation.visitor.imageKey} imagePort={teamAvatarImages} label={conversation.visitor.nickname} size={16} />
      : <ArkmeTeamChannelAvatar channel={conversation.channel} size={16} />} onClick={() => onLocate(current)} />}
    conversationDetail={{
      bodyRef: body,
      avatar: trail.length ? <ArkmeUserAvatar avatarRef={current.sender.imageRef} imageKey={current.sender.imageKey} imagePort={teamAvatarImages} label={current.sender.nickname} size={40} /> : avatar,
      parent,
      content: readable ? <TeamMessageContent message={current} conversationRef={conversation.ref} conversationKey={conversation.key} presentation="detail" />
        : (!extensions.loading || current.state === 'recalled') && <p>{tr(current.state === 'recalled' ? current.own ? '你撤回了一条消息' : '{v0}撤回了一条消息' : current.contentStatus === 'revalidating' ? '正在确认…' : '内容当前不可用', { v0: current.sender.nickname })}</p>,
      extensions: extensionList,
      footer: typeof footer === 'function' ? footer(current, readable) : footer,
    }} />
}
