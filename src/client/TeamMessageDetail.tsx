import { TeamMessageReply } from './TeamMessageReply.js'
import type { ReactNode } from 'react'
import type { TeamConversation, TeamMessage } from '../team-app-contract.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeMessageDetailAuthor } from './ArkmeMessageDetailAuthor.js'
import { arkmeDetailSourceBadgeStyle } from './ArkmeDetailSourceBadgeVisuals.js'
import { TeamMessageContent } from './TeamMessageContent.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Team keeps its own authorization; only the visual detail primitives are shared. */
export function TeamMessageDetail({ message, conversation, avatar, onClose, onLocate, onExtend, replyParent, locatingReply, onLocateReply }: {
  onExtend?: (() => void) | undefined; replyParent?: TeamMessage | undefined; locatingReply?: boolean; onLocateReply?(): void
  message: TeamMessage; conversation: TeamConversation; avatar: ReactNode; onClose(): void; onLocate(): void
}) {
  const source = conversation.side === 'team' ? `${conversation.channel.name} · ${conversation.visitor?.nickname ?? tr('外部联系人')}` : conversation.channel.name
  return <ArkmeDetailShell title="" label={tr('消息详情')} style={{ top: 0 }} onClose={onClose}
    headerContent={<ArkmeMessageDetailAuthor avatar={avatar} name={message.sender.nickname} at={message.createdAt} />}
    onPointerDownOutside={event => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[role="toolbar"], [role="menu"], [data-arkme-member-profile], [aria-modal="true"], [data-arkme-image-preview-viewport]')) onClose()
    }}>
    {message.replyToKey && onLocateReply && <TeamMessageReply parent={replyParent} busy={locatingReply} onLocate={onLocateReply} />}
    <TeamMessageContent message={message} conversationRef={conversation.ref} presentation="detail" />
    <button type="button" style={{ ...arkmeDetailSourceBadgeStyle, cursor: 'pointer' }} aria-label={tr('所在对话：{v0}', { v0: source })} onClick={onLocate}>
      <span aria-hidden>↗</span><span>{source}</span>
    </button>
    <div style={{ marginTop: 24, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '20px' }}>
      {onExtend && <button type="button" onClick={onExtend} style={{ border: 0, padding: '4px 0', background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer' }}>{tr('延展回复')}</button>}
      <div>{tr('相关快记暂未接通')}</div>
    </div>
  </ArkmeDetailShell>
}
