import { TeamReceiptBadge } from './TeamReadReceipts.js'
import type { TeamReceiptStore } from './team-read-receipts.js'
import { ArkmeReadReceiptControl, readReceiptLineStyle } from './ArkmeReadReceiptControl.js'
import { useEffect, useRef, useState } from 'react'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { Checks } from '@phosphor-icons/react/dist/icons/Checks'
import type { TeamMessage } from '../team-app-contract.js'
import { ArkmeMessageContextMenu } from './ArkmeMessageContextMenu.js'
import { captureMessageContextMenu } from './message-text-selection.js'
import { copyText } from './clipboard-text.js'
import { arkmeMessageCopyText } from './message-copy-text.js'
import { TeamMessageContent, teamMessagePresentation } from './TeamMessageContent.js'
import { arkmeConversationMessageLayout as layout, timeLabel } from './conversation-message-presentation.js'
import { teamText as tr } from './team-messaging-i18n.js'
import type { ReactNode } from 'react'

export function TeamConversationMessage({ message, conversationRef, avatar, writable, showReceipts, receiptStore, busy, onEdit, onDelete, onReceipts, onError }: {
  message: TeamMessage; avatar: ReactNode; writable: boolean; showReceipts: boolean; receiptStore: TeamReceiptStore; busy: boolean
  conversationRef?: string | undefined
  onEdit(): void; onDelete(): void; onReceipts(anchor: HTMLElement | null): void; onError(error: string): void
}) {
  const [menu, setMenu] = useState<ReturnType<typeof captureMessageContextMenu>>()
  const bubble = useRef<HTMLDivElement>(null)
  const receiptButton = useRef<HTMLButtonElement>(null)
  const select = (action: () => void) => { setMenu(undefined); action() }
  const published = message.state === 'published', available = (published || message.state === 'sending') && message.contentStatus === 'available'
  useEffect(() => { setMenu(undefined) }, [message.key, message.version, message.state, message.contentStatus, conversationRef])
  const copy = (text: string) => select(() => { void copyText(text).catch(() => onError(tr('复制失败，请重试'))) })
  const copyMessage = () => copy(arkmeMessageCopyText(teamMessagePresentation(message)))
  return <article data-arkme-conversation-row={`message:${message.key}`} data-team-message-key={message.key} style={{ ...layout.row, ...(message.own ? layout.rowMe : layout.rowOther) }}>
    <div style={{ ...layout.messageLine, ...(message.own ? layout.messageLineMe : {}) }}>
      <div style={layout.messageAvatar}>{avatar}</div>
      <div style={{ ...layout.messageBody, ...(message.own ? layout.messageBodyMe : {}) }}>
        <div style={layout.messageHeader}>{!message.own && <strong style={layout.sender}>{message.sender.nickname}</strong>}<time style={layout.meta}>{timeLabel(message.createdAt)}</time></div>
        <div style={{ ...readReceiptLineStyle, justifyContent: message.own ? 'flex-end' : 'flex-start' }}>
        {!showReceipts && message.own && published && message.recipientRead !== true && <ArkmeReadReceiptControl buttonRef={receiptButton}
          state={message.recipientRead === undefined ? 'error' : 'unread'}
          label={tr(message.recipientRead === undefined ? '已读状态同步中' : showReceipts ? '未读，查看阅读状态' : '团队尚未查阅')}
          {...(showReceipts ? { onClick: () => onReceipts(receiptButton.current) } : {})} />}
        <div ref={bubble} style={{ ...layout.bubble, ...(message.own ? layout.bubbleMe : layout.bubbleOther) }} tabIndex={0}
          aria-label={tr('消息操作')}
          onContextMenu={event => { if (!published || !available) return; setMenu(captureMessageContextMenu(event, event.currentTarget)) }}
          onKeyDown={event => { if (published && available && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu(captureMessageContextMenu({ clientX: rect.left, clientY: rect.bottom, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() }, event.currentTarget))
          } }}>
          {available ? <TeamMessageContent key={`${message.key}:${message.version}`} message={message} conversationRef={conversationRef} /> : <p style={layout.text}>{tr(message.contentStatus === 'deleted' ? '消息已删除' : '内容当前不可用')}</p>}
        </div>
        </div>
        {showReceipts && published && available && <TeamReceiptBadge message={message} store={receiptStore} onClick={onReceipts} />}
        {/* A point menu must not create another flex gap and move the message. */}
        {menu && published && available && <div style={{ position: 'fixed', width: 0, height: 0 }}><ArkmeMessageContextMenu
          selectedText={menu.selectedText} copyIcon={<Copy />} onCopySelection={copy} onCopyMessage={copyMessage}
          point={{ x: menu.left, y: menu.top }} autoFocus onClose={() => setMenu(undefined)} actions={[
          !!arkmeMessageCopyText(teamMessagePresentation(message)) && { id: 'copy', label: tr('复制'), icon: <Copy />, onSelect: copyMessage },
          message.canEdit && writable && { id: 'edit', label: tr('编辑'), icon: <PencilSimple />, disabled: busy, onSelect: () => select(onEdit) },
          message.canDelete && { id: 'delete', label: tr('删除'), icon: <Trash />, disabled: busy, danger: true, onSelect: () => select(onDelete) },
          showReceipts && { id: 'receipts', label: tr('查看阅读状态'), icon: <Checks />, onSelect: () => select(() => onReceipts(bubble.current)) },
        ]} /></div>}
      </div>
    </div>
  </article>
}
