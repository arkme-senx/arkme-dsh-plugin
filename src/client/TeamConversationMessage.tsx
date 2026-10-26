import {Toast,IconCheckOutlineMedium} from '@deepseek-ai/dsh-client-ui-primitives'
import {ArkmeMessageReportDialog} from './ArkmeMessageReportDialog.js'
import {createArkmeSdk} from '../sdk/index.js'
import {ArkmeReactionPreview,ArkmeReactionSelections} from './ArkmeReactionPreview.js'
import type {ReactionPreviewTarget} from './reaction-preview-store.js'
import { ArkmeQuotePreview } from './ArkmeQuotePreview.js'
import { teamMessageActionUnavailable } from './team-message-action-availability.js'
import { conversationMessageMenu } from './conversation-message-actions.js'
import { ArkmeMessageSelectionControl, messageSelectionStyles } from './message-selection-presentation.js'
import { teamMessageSelectable } from './use-team-message-selection.js'
import { TeamReceiptBadge } from './TeamReadReceipts.js'
import { emptyTeamReceipt, type TeamReceiptStore } from './team-read-receipts.js'
import { ArkmeReadReceiptControl, readReceiptLineStyle } from './ArkmeReadReceiptControl.js'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import type { TeamMessage } from '../team-app-contract.js'
import { ArkmeMessageContextMenu } from './ArkmeMessageContextMenu.js'
import { ArkmeMessageTimestamp } from './ArkmeMessageTimestamp.js'
import { captureMessageContextMenu, captureMessageTextSelection } from './message-text-selection.js'
import { copyText } from './clipboard-text.js'
import { arkmeMessageCopyText } from './message-copy-text.js'
import { TeamMessageContent, teamMessagePresentation, teamReplyPresentation } from './TeamMessageContent.js'
import { arkmeConversationMessageLayout as layout } from './conversation-message-presentation.js'
import { teamText as tr } from './team-messaging-i18n.js'
import type { ReactNode } from 'react'

export function TeamConversationMessage({ message, conversationRef, avatar, writable, showReceipts, receiptStore, busy, onEdit, onReceipts, onError, selecting = false, selected = false, onSelect, onToggle, onDetail, onReply, onOpenReply, accountKey, conversationKey, onAsk, askBusy, onCopyLink, onForward, located = false, onSnapshot }: {
  message: TeamMessage; avatar: ReactNode; writable: boolean; showReceipts: boolean; receiptStore: TeamReceiptStore; busy: boolean
  selecting?: boolean; selected?: boolean; onSelect?(): void; onToggle?(): void; onDetail?(): void
  accountKey?:string;conversationKey?:string
  located?: boolean; onSnapshot?(): void
  conversationRef?: string | undefined
  onAsk?: (()=>void) | undefined;askBusy?:boolean
 onCopyLink?():void
 onForward?():void
  onReply?(): void; onOpenReply?(): void
  onEdit(): void; onReceipts(anchor: HTMLElement | null): void; onError(error: string): void
}) {
  const [reporting,setReporting]=useState(false)
  const [reported,setReported]=useState(false)
  const [reactionOpen,setReactionOpen]=useState(false)
  const [menu, setMenu] = useState<ReturnType<typeof captureMessageContextMenu>>()
  const bubble = useRef<HTMLDivElement>(null)
  const receiptButton = useRef<HTMLButtonElement>(null)
  const select = (action: () => void) => { setMenu(undefined); action() }
  const receipt = useSyncExternalStore(receiptStore.subscribe, () => receiptStore.get(message.key), () => emptyTeamReceipt)
  const recipientRead = !showReceipts ? receipt.value?.teamRead ?? message.recipientRead : message.recipientRead
  useEffect(() => {
    if (showReceipts || !message.own || message.state !== 'published' || !receiptButton.current) return
    let stop: (() => void) | undefined
    const observer = new IntersectionObserver(entries => { if (entries.some(e=>e.isIntersecting)) stop ??= receiptStore.watch(message); else {stop?.();stop=undefined} })
    observer.observe(receiptButton.current)
    return () => {observer.disconnect();stop?.()}
  },[showReceipts,message.key,message.ref,message.own,message.state,recipientRead,receiptStore])
  const published = message.state === 'published', available = (published || message.state === 'sending') && message.contentStatus === 'available'
  useEffect(() => { setMenu(undefined) }, [message.key, message.version, message.state, message.contentStatus, selecting])
  const copy = (text: string) => select(() => { void copyText(text).catch(() => onError(tr('复制失败，请重试'))) })
  const reactionTarget:ReactionPreviewTarget|undefined=accountKey&&conversationRef&&conversationKey&&published&&available?{id:`team:${conversationKey}:${message.key}`,teamConversationRef:conversationRef,teamMessageRef:message.ref,source:'团队会话',text:message.content?.text_content ?? message.content?.title ?? ''}:undefined
  const copyMessage = () => copy(arkmeMessageCopyText(teamMessagePresentation(message)))
  const unavailable = (id: keyof typeof teamMessageActionUnavailable) => ({ id, disabled: true, disabledReason: tr(teamMessageActionUnavailable[id]), onSelect() {} })
  return <article data-arkme-message-item-uid={message.key} data-arkme-message-version={message.version} data-arkme-message-sequence={message.seq}
    data-team-selectable={teamMessageSelectable(message) ? message.key : undefined}
    onClickCapture={event => { if (selecting) { event.preventDefault(); event.stopPropagation(); if (!busy) onToggle?.() } }}
    data-arkme-conversation-row={`message:${message.key}`} data-team-message-key={message.key} style={{ ...layout.row, ...(message.own ? layout.rowMe : layout.rowOther), ...(selecting ? messageSelectionStyles.rowSelectAvatarMode : {}), ...(selected ? messageSelectionStyles.rowSelectedForAction : {}) }}>
    {selecting && <ArkmeMessageSelectionControl anchor="avatar" checked={selected} disabled={busy || !teamMessageSelectable(message)} onToggle={() => onToggle?.()} />}
    <div style={{ ...layout.messageLine, ...(message.own ? layout.messageLineMe : {}) }}>
      <div style={layout.messageAvatar}>{avatar}</div>
      <div style={{ ...layout.messageBody, ...(message.own ? layout.messageBodyMe : {}) }}>
        {!message.own && <div style={layout.messageHeader}><strong style={layout.sender}>{message.sender.nickname}</strong></div>}
        <ArkmeReactionPreview scope={accountKey??''} target={reactionTarget??{id:message.key,teamConversationRef:'',teamMessageRef:'',source:'团队会话',text:''}} isMe={message.own} enabled={!!reactionTarget&&!selecting} openRequested={reactionOpen} onOpenHandled={()=>setReactionOpen(false)}>
        <div style={{ ...readReceiptLineStyle, justifyContent: message.own ? 'flex-end' : 'flex-start' }}>
        {showReceipts && message.own && published && available && <TeamReceiptBadge message={message} store={receiptStore} onClick={onReceipts} />}
        {!showReceipts && message.own && published && recipientRead !== true && <ArkmeReadReceiptControl buttonRef={receiptButton}
          state={recipientRead === undefined ? 'error' : 'unread'}
          label={tr(recipientRead === undefined ? '已读状态同步中' : showReceipts ? '未读，查看阅读状态' : '团队尚未查阅')}
          {...(showReceipts ? { onClick: () => onReceipts(receiptButton.current) } : {})} />}
        <div ref={bubble} className="arkme-timed-bubble" data-team-message-located={located || undefined} style={{ ...layout.bubble, ...(message.own ? layout.bubbleMe : layout.bubbleOther), cursor: selecting ? 'pointer' : 'text', ...(selecting ? { userSelect: 'none' } : {}), ...(located ? { outline: '2px solid var(--dsw-alias-state-business-primary, #8295e8)', outlineOffset: 3 } : {}) }} tabIndex={0}
          aria-label={tr('消息操作')}
          onClick={event => {
            if (!published || !available || selecting || captureMessageTextSelection(bubble.current ?? undefined)
              || (event.target instanceof Element && event.target.closest('a,button,input,video,audio,[role="button"],[data-arkme-message-mark]'))) return
            onDetail?.()
          }}
          onContextMenu={event => { if (selecting || !published || !available) return; setMenu(captureMessageContextMenu(event, event.currentTarget)) }}
          onKeyDown={event => { if (!selecting && published && available && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu(captureMessageContextMenu({ clientX: rect.left, clientY: rect.bottom, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() }, event.currentTarget))
          } }}>
          {available && message.reply && <ArkmeQuotePreview parent={teamReplyPresentation(message)!} wholeMessageText={message.reply.text} onOpen={onOpenReply} />}
          {available ? <TeamMessageContent key={`${message.key}:${message.version}`} message={message} conversationRef={selecting ? undefined : conversationRef} /> : <p style={layout.text}>{tr(message.contentStatus === 'deleted' ? '消息已删除' : '内容当前不可用')}</p>}
          <ArkmeMessageTimestamp at={message.createdAt} />
        </div>
        {showReceipts && !message.own && published && available && <TeamReceiptBadge message={message} store={receiptStore} onClick={onReceipts} />}
        </div>
        </ArkmeReactionPreview>
        {reactionTarget&&!selecting&&<ArkmeReactionSelections scope={accountKey!} target={reactionTarget} onAdd={()=>setReactionOpen(true)} />}
        {/* A point menu must not create another flex gap and move the message. */}
        {menu && published && available && <div style={{ position: 'fixed', width: 0, height: 0 }}><ArkmeMessageContextMenu
          selectedText={menu.selectedText} copyIcon={<Copy />} onCopySelection={copy} onCopyMessage={copyMessage}
          point={{ x: menu.left, y: menu.top }} autoFocus onClose={() => setMenu(undefined)} actions={conversationMessageMenu([
          {id:'reaction',disabled:busy||!reactionTarget,onSelect:()=>select(()=>setReactionOpen(true))},
          { id: 'copy', onSelect: copyMessage }, {id:'link',disabled:busy||!onCopyLink,onSelect:()=>select(()=>onCopyLink?.())}, {id:'extend',disabled:busy || !writable || !onReply,onSelect:()=>select(()=>onReply?.())},
          message.canEdit && writable && { id: 'edit', disabled: busy, onSelect: () => select(onEdit) },
          { id: 'select', disabled: busy || !onSelect, onSelect: () => select(() => onSelect?.()) },
          {id:'forward',disabled:busy||!onForward,onSelect:()=>select(()=>onForward?.())}, {id:'ask-dsh',disabled:busy||askBusy||!onAsk,onSelect:()=>select(()=>onAsk?.())}, !message.own && {id:'report',disabled:busy||!conversationRef,onSelect:()=>select(()=>setReporting(true))},
          message.own && { id: 'detail', disabled: !onSnapshot, onSelect: () => select(() => onSnapshot?.()) },
          showReceipts && { id: 'receipts', onSelect: () => select(() => onReceipts(bubble.current)) },
          message.own && { type: 'separator', id: 'withdraw-divider' }, message.own && {...unavailable('withdraw'),disabledReason:tr('作者可通过删除移除同一快记，本次不支持仅撤回此会话中的发布')},
        ])} /></div>}
      </div>
    </div>
    {reporting && conversationRef && <ArkmeMessageReportDialog item={{...teamMessagePresentation(message),messageRef:message.ref}}
      submitReport={(input,signal)=>createArkmeSdk().reportTeamMessage(conversationRef,message.ref,message.version,({1:'spam',2:'illegal',3:'harassment',4:'other'} as const)[input.reportType],input.reason??'',signal)}
      onClose={()=>setReporting(false)} onSubmitted={()=>{setReporting(false);setReported(true)}} />}
    {reported && <Toast text={tr('举报已提交')} anchor={bubble.current} icon={<IconCheckOutlineMedium />} onDone={()=>setReported(false)} />}
  </article>
}
