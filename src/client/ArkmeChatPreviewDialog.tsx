import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { Fragment, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeSourceItem } from '../types.js'
import { ArkmeDirectorySourceAvatar, ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeMessageReadReceiptLine } from './ArkmeMessageReadReceipt.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeChatTimelineDelta } from './chat-directory-store.js'
import { arkmeSourceIdentityKey } from './source-identity.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import { useChatPreviewTimeline } from './use-chat-preview-timeline.js'
import { arkmeConversationAnchorOffset, arkmeConversationViewport } from './conversation-viewport.js'
import { arkmeConversationRestoredScrollTop, type ArkmeConversationViewportSnapshot } from './conversation-memory-cache.js'

export type ArkmeChatPreviewSource = ArkmeSourceItem & { kind: 'private_chat' | 'group_chat' }
export function arkmeCanPreviewChat(source: ArkmeSourceItem): source is ArkmeChatPreviewSource {
  return (source.kind === 'private_chat' || source.kind === 'group_chat') && source.sourceRef.trim() !== ''
}

const button: CSSProperties = { border: 0, padding: '6px 8px', borderRadius: 6, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer', font: 'inherit', fontSize: 12 }
const status: CSSProperties = { padding: 16, textAlign: 'center', color: arkmeTheme.secondary, fontSize: 13 }

/** Only mounted for the current account. It never activates the previewed conversation. */
export function ArkmeChatPreviewDialog({ source, onClose }: { source: ArkmeChatPreviewSource; onClose(): void }) {
  useArkmeLocale()
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  const sourceKey = arkmeSourceIdentityKey(source)
  const delta = useSyncExternalStore(arkmeChatTimelineDelta.subscribe,
    () => arkmeChatTimelineDelta.getSnapshotForSource(sourceKey),
    () => arkmeChatTimelineDelta.getSnapshotForSource(sourceKey))
  const timeline = useChatPreviewTimeline(source.sourceRef, delta.revision)
  const dialog = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const viewport = useRef<ArkmeConversationViewportSnapshot>()
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useLayoutEffect(() => {
    const element = body.current
    if (element === null || timeline.page === undefined) return
    const offset = arkmeConversationAnchorOffset(element, viewport.current?.anchorId)
    element.scrollTop = arkmeConversationRestoredScrollTop(viewport.current, {
      currentScrollTop: element.scrollTop, scrollHeight: element.scrollHeight,
      ...(offset === undefined ? {} : { anchorOffset: offset }),
    })
    viewport.current = arkmeConversationViewport(element)
  }, [timeline.page])

  if (typeof document === 'undefined') return null
  return createPortal(<div data-arkme-chat-preview-backdrop style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,.3)' }}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr("{v0}的聊天预览", { v0: source.displayName })}
      style={{ width: 460, maxWidth: '100%', height: 520, maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 16, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}
      onKeyDown={event => {
        // Nested media portals own their keyboard lifecycle.
        if (event.target instanceof Element && event.target.closest('[aria-modal="true"]') !== dialog.current) return
        event.stopPropagation()
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); event.preventDefault(); onClose() }
        if (event.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],audio[controls],video[controls],[tabindex="0"]')
          const first = controls?.[0], last = controls?.[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}>
        <ArkmeDirectorySourceAvatar source={source} size={28} />
        <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 16 }}>{source.displayName}</strong>
        <span style={{ flex: 'none', padding: '3px 8px', borderRadius: 99, background: arkmeTheme.subtle, color: arkmeTheme.secondary, fontSize: 11 }}>{tr("预览中")}</span>
        <button type="button" style={{ ...button, marginLeft: 'auto' }} aria-label={tr("关闭聊天预览")} onClick={onClose}><X size={20} /></button>
      </header>
      {timeline.error !== '' && <div role="alert" style={status}>{timeline.error}<button type="button" style={button} disabled={timeline.loading} onClick={() => { void timeline.retry() }}>{tr("重试")}</button></div>}
      <div ref={body} aria-label={tr("预览消息列表")} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 16px 16px' }}
        onScroll={() => { if (body.current !== null) viewport.current = arkmeConversationViewport(body.current) }}>
        {timeline.page?.hasMore && <div style={status}><button type="button" style={button} disabled={timeline.loading} onClick={() => { void timeline.loadMore() }}>{tr("加载更早消息")}</button></div>}
        {timeline.loading && timeline.page === undefined && <div role="status" style={status}>{tr("正在加载消息…")}</div>}
        {!timeline.loading && timeline.error === '' && timeline.page?.items.length === 0 && <div style={status}>{tr("暂无消息")}</div>}
        {timeline.page?.items.map((item, index, items) => <Fragment key={item.itemUid}>
          {source.kind === 'group_chat' && (index === 0 || Math.abs(item.sendAtMillis - items[index - 1]!.sendAtMillis) > 30 * 60 * 1000) && <div data-arkme-preview-time-marker style={status}>
            {new Date(item.sendAtMillis).toLocaleString(arkmeIntlLocale(), { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>}
          <article data-arkme-conversation-row={`message:${item.itemUid}`}
          style={{ display: 'flex', flexDirection: item.isMe ? 'row-reverse' : 'row', alignItems: 'flex-start', gap: 8, marginTop: 14 }}>
          <ArkmeUserAvatar {...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef })} size={30} label={source.kind === 'group_chat' || item.isMe ? item.senderName : tr("消息头像")} />
          <div style={{ minWidth: 0, maxWidth: 'calc(100% - 38px)' }}>
            {(source.kind === 'group_chat' || item.isMe) && <div style={{ marginBottom: 4, color: arkmeTheme.secondary, fontSize: 11, textAlign: item.isMe ? 'right' : 'left' }}>{item.senderName}</div>}
            <ArkmeMessageReadReceiptLine source={source} item={item}>
              <div style={{ minWidth: 0, padding: '8px 10px', borderRadius: 10, background: item.isMe ? arkmeTheme.messageOwn : arkmeTheme.messageOther }}>
                <ArkmeMessageContent item={item} presentation="detail" />
              </div>
            </ArkmeMessageReadReceiptLine>
          </div>
        </article></Fragment>)}
      </div>
    </div>
  </div>, document.body)
}
