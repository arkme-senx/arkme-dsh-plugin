import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeSourceItem } from '../types.js'
import type { ReactionExpression, ReactionOriginalMessage, ReactionNotification } from '../reaction-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import { reactionNotifications } from './reaction-notifications.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { expressionIdentity, expressionLabel } from './reaction-expression.js'
import { ReactionLabel, reactionLabelText } from './ReactionLabel.js'
import { tr } from './locale.js'
import { conversationTimeLabel } from './conversation-directory-presentation.js'
import { formatConversationDate } from './conversation-date-format.js'

function useNotifications(source?: ArkmeSourceItem) {
 const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
 const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
 const version = useSyncExternalStore(reactionNotifications.subscribe, reactionNotifications.getSnapshot, reactionNotifications.getSnapshot)
 return { scope, version, items: reactionNotifications.forSource(scope, source?.sourceKey) }
}
export function openReactionNotification(source: ArkmeSourceItem, item: ReactionNotification) {
 reactionNotifications.beginViewing(item.sourceKey, item.itemUid)
 arkmeUi.showConversationTarget(source, item.itemUid, item.sendAtMillis, item.recordOwnerUserId, undefined, true)
}
export function openReactionHistory(message: ReactionOriginalMessage, expression?: ReactionExpression) {
 const auth = arkmeAuthStore.getSnapshot().auth
 if (auth?.status === 'authenticated' && expression) reactionNotifications.beginHistoryViewing(`${auth.environment}:${auth.userId}`, message.source.sourceKey, message.itemUid, expressionIdentity(expression))
 arkmeUi.showConversationTarget(message.source, message.itemUid, message.sendAtMillis, message.recordOwnerUserId, undefined, true)
}
function reactionAt(item: ReactionNotification) {
 return Math.max(0, ...item.selections.map(selection => selection.at))
}

/** Reading ordinary messages must never reveal an older reaction as their preview. */
export function ArkmeReactionNotificationPreview({ source, disabled = false }: { source: ArkmeSourceItem; disabled?: boolean }) {
 const { items, scope } = useNotifications(source)
 const notices = items.filter(item => item.unread !== false && item.selections.length > 0)
 if (!notices.length) return null
 return <ConversationReactionNotice key={`${scope}:${source.sourceKey ?? source.sourceRef}`} source={source} items={notices} disabled={disabled} />
}

function ConversationReactionNotice({ source, items, disabled }: { source: ArkmeSourceItem; items: ReactionNotification[]; disabled: boolean }) {
 const anchor = useRef<HTMLButtonElement>(null)
 const panel = useRef<HTMLDivElement>(null)
 const closeTimer = useRef<ReturnType<typeof setTimeout>>()
 const id = useId()
 const [open, setOpen] = useState(false)
 const [position, setPosition] = useState({ left: 0, top: 0 })
 const focusFirst = useRef(false)
 const sorted = [...items].sort((a, b) => reactionAt(b) - reactionAt(a) || a.id.localeCompare(b.id))
 const messageCount = new Set(items.map(item => `${item.recordOwnerUserId}:${item.itemUid}`)).size
 const summary = tr('{count} 条消息收到新表态', { count: messageCount })
 const cancelClose = () => clearTimeout(closeTimer.current)
 const show = () => { cancelClose(); if (!disabled) setOpen(true) }
 const close = () => { cancelClose(); setOpen(false) }
 const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 180) }
 const inside = (target: EventTarget | null) => target instanceof Node && (anchor.current?.contains(target) || panel.current?.contains(target))
 useEffect(() => () => clearTimeout(closeTimer.current), [])
 useEffect(() => { if (disabled) setOpen(false) }, [disabled])
 useLayoutEffect(() => {
  if (!open || !anchor.current || !panel.current) return
  const bounds = anchor.current.getBoundingClientRect()
  const size = panel.current.getBoundingClientRect()
  setPosition({
   left: Math.max(8, Math.min(bounds.right - size.width, window.innerWidth - size.width - 8)),
   top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - size.height - 8)),
  })
  if (focusFirst.current) { focusFirst.current = false; panel.current.querySelector('button')?.focus() }
 }, [open, items])
 useEffect(() => {
  if (!open || typeof document === 'undefined') return
  const outside = (event: PointerEvent) => { if (!inside(event.target)) close() }
  const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close() }
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
  document.addEventListener('pointerdown', outside)
  document.addEventListener('scroll', scroll, true)
  document.addEventListener('keydown', escape)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
  return () => {
   document.removeEventListener('pointerdown', outside)
   document.removeEventListener('scroll', scroll, true)
   document.removeEventListener('keydown', escape)
   window.removeEventListener('resize', close)
   window.removeEventListener('blur', close)
  }
 }, [open])
 const overlay = open && !disabled ? <div ref={panel} id={id} role="dialog" aria-label={tr('收到的表态')} data-arkme-reaction-notice-popover
  onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
  onFocus={cancelClose} onBlur={event => { if (!inside(event.relatedTarget)) close() }}
  onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
  onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
  onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { anchor.current?.focus(); close() } }}
  style={{ position: 'fixed', ...position, width: 320, maxWidth: 'calc(100vw - 16px)', maxHeight: 'min(360px, calc(100vh - 16px))', overflowY: 'auto', zIndex: 10000,
   boxSizing: 'border-box', padding: 6, border: `1px solid ${c.border}`, borderRadius: 10, background: c.menu, color: c.text, boxShadow: c.shadow, fontSize: 12, lineHeight: '18px', cursor: 'default' }}>
  <div style={{ padding: '4px 6px 6px', color: c.secondary, fontSize: 11 }}>{summary}</div>
  {sorted.map(item => {
   const at = reactionAt(item)
   const actor = source.kind === 'private_chat' && source.peerUserId === item.actorUserId ? source.displayName : item.actorName || tr('对方')
   const expressions = item.selections.map(selection => reactionLabelText(expressionLabel(selection.expression))).join(' · ')
   return <button key={item.id} type="button" className="arkme-conversation-reaction-item" aria-label={tr('查看{actor}的表态：{expression}，{text}', { actor, expression: expressions, text: item.text || tr('查看原消息') })}
    onClick={() => { close(); openReactionNotification(source, item) }}
    style={{ display: 'block', width: '100%', padding: '7px 6px', border: 0, borderRadius: 6, background: 'transparent', color: c.text, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
     <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{actor}</span>
     <time dateTime={at > 0 ? new Date(at).toISOString() : undefined} title={at > 0 ? formatConversationDate(new Date(at), 'full') : undefined} style={{ flex: 'none', color: c.caption, fontSize: 10 }}>{conversationTimeLabel(at)}</time>
    </span>
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, color: c.warning, margin: '2px 0' }}>{item.selections.map(selection => <ReactionLabel key={selection.key} label={expressionLabel(selection.expression)} size={16} />)}</span>
    <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', color: c.secondary }}>{item.text || tr('查看原消息')}</span>
   </button>
  })}
 </div> : null
 return <>
  <button ref={anchor} type="button" disabled={disabled} data-arkme-reaction-notice aria-label={summary} aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls={open ? id : undefined}
   onMouseEnter={show} onMouseLeave={scheduleClose} onFocus={show} onBlur={event => { if (!inside(event.relatedTarget)) close() }}
   onClick={event => { event.stopPropagation(); show() }} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
   onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') close(); else if (event.key === 'ArrowDown') { event.preventDefault(); if (open) panel.current?.querySelector('button')?.focus(); else { focusFirst.current = true; show() } } }}
   style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 2, padding: '0 4px', border: 0, borderRadius: 4, background: c.warningSoft, color: c.warning, font: 'inherit', fontSize: 10, lineHeight: '16px', whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer' }}>
   {tr('表态')}{messageCount > 1 && <span>{messageCount}</span>}
  </button>
  {overlay && (typeof document === 'undefined' ? overlay : createPortal(overlay, document.body))}
 </>
}
/** Only explicitly opened, rendered reactions acknowledge their exact clicked revision. */
export function useVisibleReactionNotification(scope: string, sourceKey: string | undefined, itemUid: string | undefined, renderedKeys: readonly string[]) {
 const ref = useRef<HTMLDivElement>(null)
 const version = useSyncExternalStore(reactionNotifications.subscribe, reactionNotifications.getSnapshot, reactionNotifications.getSnapshot)
 const keySignature = renderedKeys.join(',')
 useEffect(() => {
  const node = ref.current
  if (!node || !itemUid || typeof IntersectionObserver === 'undefined') return
  const items = reactionNotifications.forSource(scope, sourceKey).filter(item => item.itemUid === itemUid && reactionNotifications.canAcknowledge(scope, item) && item.selections.every(selection => renderedKeys.includes(selection.key)))
  if (!items.length && !reactionNotifications.hasHistoryHighlight(scope, sourceKey, itemUid)) return
  let timer: ReturnType<typeof setTimeout> | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let visible = false
  const viewport = node.closest('.arkme-conversation-body')
  const update = () => {
   clearTimeout(timer); clearTimeout(settleTimer)
   if (!visible || document.hidden || !document.hasFocus()) return
   // Scroll events reset this brief quiet period; travel time never uses up the accent.
   settleTimer = setTimeout(() => {
    if (!visible || document.hidden || !document.hasFocus()) return
    reactionNotifications.startHighlights(scope, sourceKey, itemUid)
    if (items.length) timer = setTimeout(() => { void reactionNotifications.seen(scope, items) }, 700)
   }, 180)
  }
  const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .99); update() }, { root: viewport, threshold: [.99] })
  // Observe the reactions themselves, not a tall image or the whole message bubble.
  observer.observe(node.querySelector?.('[data-arkme-message-reactions]') ?? node)
  viewport?.addEventListener('scroll', update, { passive: true })
  document.addEventListener('visibilitychange', update); window.addEventListener('focus', update); window.addEventListener('blur', update)
  return () => { clearTimeout(timer); clearTimeout(settleTimer); observer.disconnect(); viewport?.removeEventListener('scroll', update); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('blur', update) }
 }, [scope, sourceKey, itemUid, version, keySignature])
 return ref
}
