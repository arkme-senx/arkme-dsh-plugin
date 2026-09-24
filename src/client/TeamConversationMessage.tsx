import { ArkmeReadReceiptControl, readReceiptLineStyle } from './ArkmeReadReceiptControl.js'
import { useRef, useState } from 'react'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { Checks } from '@phosphor-icons/react/dist/icons/Checks'
import type { TeamMessage } from '../team-app-contract.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { TeamMessageContent } from './TeamMessageContent.js'
import { arkmeConversationMessageLayout as layout, timeLabel } from './conversation-message-presentation.js'
import { teamText as tr } from './team-messaging-i18n.js'
import type { ReactNode } from 'react'

export function TeamConversationMessage({ message, avatar, writable, showReceipts, busy, onEdit, onDelete, onReceipts, onError }: {
  message: TeamMessage; avatar: ReactNode; writable: boolean; showReceipts: boolean; busy: boolean
  onEdit(): void; onDelete(): void; onReceipts(anchor: HTMLElement | null): void; onError(error: string): void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const bubble = useRef<HTMLDivElement>(null)
  const receiptButton = useRef<HTMLButtonElement>(null)
  const select = (action: () => void) => { setMenu(undefined); action() }
  const published = message.state === 'published', available = published && message.contentStatus === 'available'
  return <article data-arkme-conversation-row={`message:${message.key}`} data-team-message-key={message.key} style={{ ...layout.row, ...(message.own ? layout.rowMe : layout.rowOther) }}>
    <div style={{ ...layout.messageLine, ...(message.own ? layout.messageLineMe : {}) }}>
      <div style={layout.messageAvatar}>{avatar}</div>
      <div style={{ ...layout.messageBody, ...(message.own ? layout.messageBodyMe : {}) }}>
        <div style={layout.messageHeader}>{!message.own && <strong style={layout.sender}>{message.sender.nickname}</strong>}<time style={layout.meta}>{timeLabel(message.createdAt)}</time></div>
        <div style={{ ...readReceiptLineStyle, justifyContent: message.own ? 'flex-end' : 'flex-start' }}>
        {message.own && published && message.recipientRead !== true && <ArkmeReadReceiptControl buttonRef={receiptButton}
          state={message.recipientRead === undefined ? 'error' : 'unread'}
          label={tr(message.recipientRead === undefined ? '已读状态同步中' : showReceipts ? '未读，查看阅读状态' : '团队尚未查阅')}
          {...(showReceipts ? { onClick: () => onReceipts(receiptButton.current) } : {})} />}
        <div ref={bubble} style={{ ...layout.bubble, ...(message.own ? layout.bubbleMe : layout.bubbleOther) }} tabIndex={0}
          aria-label={tr('消息操作')}
          onContextMenu={event => { if (!published) return; event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }) }}
          onKeyDown={event => { if (published && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom }) } }}>
          {available ? <TeamMessageContent key={`${message.key}:${message.version}`} message={message} /> : <p style={layout.text}>{tr(message.contentStatus === 'deleted' ? '消息已删除' : '内容当前不可用')}</p>}
        </div>
        </div>
        {/* A point menu must not create another flex gap and move the message. */}
        {menu && published && <div style={{ position: 'fixed', width: 0, height: 0 }}><ArkmeActionMenu label={tr('消息操作')} point={menu} autoFocus onClose={() => setMenu(undefined)} actions={[
          available && !!message.content?.text_content && { id: 'copy', label: tr('复制'), icon: <Copy />, onSelect: () => select(() => { void navigator.clipboard.writeText(message.content!.text_content ?? '').catch(() => onError(tr('复制失败，请重试'))) }) },
          message.canEdit && writable && { id: 'edit', label: tr('编辑'), icon: <PencilSimple />, disabled: busy, onSelect: () => select(onEdit) },
          message.canDelete && { id: 'delete', label: tr('删除'), icon: <Trash />, disabled: busy, danger: true, onSelect: () => select(onDelete) },
          showReceipts && { id: 'receipts', label: tr('查看阅读状态'), icon: <Checks />, onSelect: () => select(() => onReceipts(bubble.current)) },
        ]} /></div>}
      </div>
    </div>
  </article>
}
