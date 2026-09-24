import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import type { ReactionExpression, ReactionOriginalMessage, ReactionNotification } from '../reaction-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import { reactionNotifications } from './reaction-notifications.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { expressionIdentity, expressionLabel } from './reaction-expression.js'
import { ReactionLabel, reactionLabelText } from './ReactionLabel.js'

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
export function ArkmeReactionNotificationPreview({ source, disabled = false }: { source: ArkmeSourceItem; disabled?: boolean }) {
 const { items } = useNotifications(source)
 const item = items.reduce<ReactionNotification | undefined>((latest, row) => !latest || row.selections.at(-1)!.at > latest.selections.at(-1)!.at ? row : latest, undefined)
 if (!item) return null
 const value = item.selections.at(-1)!.expression
 const expression = expressionLabel(value)
 const imageLabel = value.emoji ? expressionLabel({ ...value, text: '' }) : ''
 const label = reactionLabelText(expression)
 return <button type="button" disabled={disabled} data-arkme-reaction-notice onDoubleClick={event => event.stopPropagation()} title="查看收到表态的消息" aria-label={`新表态：${label}，${item.text || '查看原消息'}`} onClick={event => { event.stopPropagation(); if (!disabled) openReactionNotification(source, item) }}
 style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, padding: 0, color: c.text, font: 'inherit', fontSize: 12, width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textAlign: 'left', cursor: 'pointer' }}>
 <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, minWidth: 0, maxWidth: '55%', color: '#ff8700' }}>
 <span style={{ flexShrink: 0 }}>[</span>
 {imageLabel && <span style={{ display: 'inline-flex', flexShrink: 0 }}><ReactionLabel label={imageLabel} size={18} /></span>}
 <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.text || '表态'}</span>
 <span style={{ flexShrink: 0 }}>]</span>
 </span>
 <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', color: c.secondary }}>{item.text || '查看原消息'}</span>
 </button>
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
