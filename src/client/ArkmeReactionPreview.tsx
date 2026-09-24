import { reactionNotifications } from './reaction-notifications.js'
import { useVisibleReactionNotification } from './ArkmeReactionNotification.js'
import { Toast, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArkmeReactionActorCard } from './ArkmeReactionActorCard.js'
import { ArkmeReactionPhrases } from './ArkmeReactionPhrases.js'
import { arkmeDefaultEmojis } from './arkme-emoji.js'
import { ReactionLabel, reactionLabelText, reactionPhraseStyle } from './ReactionLabel.js'
import { useState, useCallback, useSyncExternalStore, useRef, useLayoutEffect, useEffect, type CSSProperties, type ReactNode } from 'react'
import { expressionIdentity, expressionLabel } from './reaction-expression.js'
import type { ReactionActor, ReactionActorPage, ReactionGroupPage, ReactionExpression } from '../reaction-contract.js'
import { createPortal } from 'react-dom'
import { reactionPreview, type ReactionPreviewTarget } from './reaction-preview-store.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { arkmeAvatarImages } from './avatar-image-runtime.js'
import { watchVisibleReactionTarget } from './reaction-visible-target.js'

const button: CSSProperties = { border: `1px solid ${c.border}`, borderRadius: 9, padding: '5px 10px', background: c.base, color: c.text, font: 'inherit', cursor: 'pointer' }
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }

export function reactionToolbarPosition(isMe: boolean, box: { left: number; right: number; bottom: number }, parent: { left: number; top: number }, edges: { left: number; right: number }, receipt?: { left: number; right: number; top: number }): CSSProperties {
  const receiptCenter = receipt ? (receipt.left + receipt.right) / 2 : 0
  const aboveLeft = Math.min(receiptCenter - 13, box.left - 32)
  if (isMe && receipt && aboveLeft >= edges.left) {
    return { left: aboveLeft - parent.left, top: receipt.top - parent.top - 32, paddingBottom: 6 }
  }
  const beside = isMe ? box.left - 32 >= edges.left : box.right + 32 <= edges.right
  const left = beside ? (isMe ? box.left - parent.left - 32 : box.right - parent.left)
    : Math.max(0, (isMe ? box.left : box.right - 26) - parent.left)
  const top = box.bottom - parent.top - (beside ? 26 : 0)
  return { left, top,
    paddingLeft: beside && !isMe ? 6 : 0, paddingRight: beside && isMe ? 6 : 0,
    paddingTop: beside ? 0 : 4 }
}

export function reactionPanelPosition(box: { left: number; top: number; bottom: number }, width: number, viewport: { width: number; height: number }): CSSProperties {
  const above = Math.max(0, box.top - 16), below = Math.max(0, viewport.height - box.bottom - 16)
  const left = Math.max(8, Math.min(box.left, viewport.width - width - 8))
  return above >= 180 || above >= below
    ? { left, bottom: Math.max(8, viewport.height - box.top + 8), maxHeight: above }
    : { left, top: Math.max(8, box.bottom + 8), maxHeight: below }
}

export function ReactionAddIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.4 11.2a8.7 8.7 0 1 0-8.9 9.2" />
    <circle cx="8.2" cy="9.3" r=".75" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="9.3" r=".75" fill="currentColor" stroke="none" />
    <path d="M7.8 13.2c.7 1.5 1.9 2.3 3.6 2.3 1.2 0 2.2-.4 2.9-1.2M18.5 14v8M14.5 18h8" />
  </svg>
}

export function ArkmeReactionPreview({ scope, target, children, isMe = false, openRequested = false, toggleRequested = false, onOpenHandled, standalone = false }: { scope: string; target: ReactionPreviewTarget; children?: ReactNode; isMe?: boolean; openRequested?: boolean; toggleRequested?: boolean; onOpenHandled?: () => void; standalone?: boolean }) {
  useSyncExternalStore(reactionPreview.subscribe, reactionPreview.getSnapshot, reactionPreview.getSnapshot)
  const activeScope = reactionPreview.isScope(scope)
  const latestTarget = useRef(target)
  latestTarget.current = target
  // A conversation reference also carries its latest message sequence. Updating it
  // must not dispose the subscription (and erase reactions) for this message.
  useEffect(() => watchVisibleReactionTarget(message.current, () => reactionPreview.watch(scope, latestTarget.current)), [activeScope, scope, target.id])
  useEffect(() => { reactionPreview.updateTarget(scope, target) }, [activeScope, scope, target])
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [notice, setNotice] = useState<{ text: string; sequence: number }>()
  useEffect(() => { setNotice(undefined) }, [scope, target.id])
  const anchor = useRef<HTMLButtonElement>(null)
  const message = useVisibleReactionNotification(scope, target.sourceKey, target.itemUid, reactionPreview.snapshot(target.id)?.groups.map(group => group.key) ?? [])
  const [toolbar, setToolbar] = useState<CSSProperties>({ ...(isMe ? { right: '100%' } : { left: '100%' }), bottom: 0 })
  const positionToolbar = useCallback(() => {
    const root = message.current
    if (!root) return
    const bubble = root.querySelector<HTMLElement>('[data-arkme-message-direction]') ?? root
    const box = bubble.getBoundingClientRect(), parent = root.getBoundingClientRect()
    const viewport = root.closest<HTMLElement>('[data-arkme-width-viewport]')?.getBoundingClientRect()
    const next = reactionToolbarPosition(isMe, box, parent, {
      left: Math.max(viewport?.left ?? 0, 0) + 8,
      right: Math.min(viewport?.right ?? window.innerWidth, window.innerWidth) - 8,
    }, root.querySelector<HTMLElement>('[data-arkme-read-receipt-indicator]')?.getBoundingClientRect())
    setToolbar(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
  }, [isMe])
  useLayoutEffect(() => { positionToolbar() })
  useLayoutEffect(() => {
    const root = message.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(positionToolbar)
    observer.observe(root)
    const bubble = root.querySelector('[data-arkme-message-direction]')
    if (bubble) observer.observe(bubble)
    return () => observer.disconnect()
  }, [positionToolbar])
  useLayoutEffect(() => {
    if (!openRequested) return
    positionToolbar()
    setOpen(current => toggleRequested ? !current : true)
    onOpenHandled?.()
  }, [openRequested])
  const panel = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<CSSProperties>({ left: 8, top: 8 })
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    // Keep this opening anchored to its initial position while reaction rows grow.
    const box = anchor.current.getBoundingClientRect()
    const reposition = () => {
      if (!panel.current) return
      const size = panel.current.getBoundingClientRect()
      const next = reactionPanelPosition(box, size.width, { width: window.innerWidth, height: window.innerHeight })
      setPosition(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }
    reposition()
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && (panel.current?.contains(event.target) || anchor.current?.contains(event.target))) return
      if (event.target instanceof Element && message.current?.contains(event.target) && event.target.closest('[data-arkme-reaction-toggle]')) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', reposition)
    }
  }, [open])
  const selected = reactionPreview.isScope(scope) ? reactionPreview.snapshot(target.id)?.mine.selections.filter(item => !item.expression.color).map(item => expressionLabel(item.expression)) ?? [] : []
  const toggle = async (label: string, expression?: ReactionExpression) => {
    setStatus('')
    const accepted = await reactionPreview.toggle(scope, target, label, expression)
    setStatus(accepted
      ? ''
      : reactionPreview.error(target.id) ?? '暂时无法添加表态。')
    if (accepted) { setOpen(false) }
    return accepted
  }
  const readOnly = reactionPreview.snapshot(target.id)?.private === true
  const overlay = open && !readOnly && <section ref={panel} aria-label="表态面板" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); anchor.current?.focus() } }} style={{ position: 'fixed', zIndex: 120, background: c.menu, color: c.text, fontSize: 12, border: `1px solid ${c.border}`, boxShadow: c.shadow, borderRadius: 12, padding: 14, width: 'min(340px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 16px)', ...position, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
      <div role="group" aria-label="全部表情" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, height: 206, minHeight: 38, flexShrink: 1, alignContent: 'start', scrollSnapType: 'y mandatory', overflowY: 'auto' }}>
        {arkmeDefaultEmojis.map(emoji => <button type="button" key={emoji.id} aria-label={emoji.label} title={emoji.label}
          disabled={reactionPreview.busy(target.id)} aria-pressed={selected.includes(emoji.token)} onClick={() => toggle(emoji.token)}
          style={{ ...button, padding: 5, height: 38, scrollSnapAlign: 'start', borderColor: 'transparent', background: selected.includes(emoji.token) ? `color-mix(in srgb, ${c.secondary} 12%, ${c.base})` : c.base }}>
          <img src={emoji.assetUrl} alt="" width={28} height={28} draggable={false} style={{ maxWidth: '100%', objectFit: 'contain' }} />
        </button>)}
      </div>
      <div role="group" aria-label="短语" style={{ minHeight: 0, flexShrink: 1, maxHeight: '55%', overflowY: 'auto', marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}` }}>
      <ArkmeReactionPhrases key={scope} scope={scope} selected={reactionPreview.isScope(scope) ? reactionPreview.snapshot(target.id)?.mine.selections.map(item => item.expression) ?? [] : []} onUse={toggle} onNotice={text => setNotice(current => ({ text, sequence: (current?.sequence ?? 0) + 1 }))} />
      </div>
      {(status || reactionPreview.error(target.id)) && <div role="status" style={{ marginTop: 6, color: c.secondary }}>{status || reactionPreview.error(target.id)}</div>}
    </section>
  return <div ref={message} data-arkme-reaction-preview data-arkme-reaction-ready={reactionPreview.snapshot(target.id) !== undefined || reactionPreview.error(target.id) !== undefined ? 'true' : 'false'} data-open={open} onMouseEnter={positionToolbar} onFocus={positionToolbar} style={{ position: 'relative', maxWidth: '100%', fontSize: 12 }}>
    {children}
    <div className={standalone ? undefined : 'arkme-reaction-hover-toolbar'} style={standalone ? {} : { position: 'absolute', ...toolbar, zIndex: 5 }}>
      <button ref={anchor} className={standalone ? undefined : 'arkme-reaction-hover-trigger'} type="button" aria-label={readOnly ? "已设为私密" : "表态"} disabled={readOnly} aria-expanded={open && !readOnly} onClick={() => { setStatus(''); setOpen(!open) }} style={{ ...button, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, padding: 3, borderRadius: 6, color: c.secondary }}><ReactionAddIcon /></button>
    </div>
    {notice && (typeof document === 'undefined' ? <div role="status">{notice.text}</div> : <Toast key={notice.sequence} text={notice.text} anchor={message.current} icon={<IconCheckOutline16 />} onDone={() => setNotice(undefined)} />)}
    {overlay && (typeof document === 'undefined' ? overlay : createPortal(overlay, document.body))}
  </div>
}

function warmActorAvatar(actor: ReactionActor) {
  if (actor.avatarRef) void arkmeAvatarImages.load(actor.avatarRef).catch(() => undefined)
}

export function ArkmeReactionSelections({ scope, target, onAdd, actorName = '我', actorGroupNickname, actorAvatarRef }: { scope: string; target: ReactionPreviewTarget; onAdd?: () => void; actorName?: string; actorGroupNickname?: string | undefined; actorAvatarRef?: string | undefined }) {
  useSyncExternalStore(reactionPreview.subscribe, reactionPreview.getSnapshot, reactionPreview.getSnapshot)
  useSyncExternalStore(reactionNotifications.subscribe, reactionNotifications.getSnapshot, reactionNotifications.getSnapshot)
  const highlight = reactionNotifications.highlights(scope, target.sourceKey, target.itemUid)
  const snapshot = reactionPreview.isScope(scope) ? reactionPreview.snapshot(target.id) : undefined
  const [groupPage, setGroupPage] = useState<ReactionGroupPage>()
  const groupScope = useRef('')
  const viewScope = JSON.stringify([scope, target.id])
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupError, setGroupError] = useState('')
  const groupAbort = useRef<AbortController>()
  useEffect(() => { setGroupPage(undefined); return () => groupAbort.current?.abort() }, [scope, target.id])
  const currentGroupPage = groupScope.current === viewScope ? groupPage : undefined
  const groups = snapshot ? currentGroupPage?.items ?? snapshot.groups : []
  const loadGroups = async () => {
    if (groupBusy) return
    const controller = new AbortController(); groupAbort.current = controller
    setGroupBusy(true); setGroupError('')
    try { const page = await reactionPreview.groups(scope, target, groups.at(-1)?.key ?? '', controller.signal); if (!controller.signal.aborted) { groupScope.current = viewScope; setGroupPage(page) } }
    catch (error) { if (!controller.signal.aborted) setGroupError(error instanceof Error ? error.message : '加载失败') }
    finally { if (!controller.signal.aborted) setGroupBusy(false) }
  }
  const [profileActor, setProfileActor] = useState<ReactionActor>()
  useEffect(() => { setProfileActor(undefined) }, [scope, target.id, snapshot?.actors_visible])
  const [actorKey, setActorKey] = useState<string>()
  const [actors, setActors] = useState<ReactionActorPage>()
  const [actorError, setActorError] = useState('')
  const [actorBusy, setActorBusy] = useState(false)
  const actorAbort = useRef<AbortController>()
  const actorScope = useRef('')
  useEffect(() => { setActorKey(undefined); setActors(undefined); setActorBusy(false); return () => actorAbort.current?.abort() }, [scope, target.id])
  const loadActors = async (key: string, more = false) => {
    if (actorBusy) return
    actorAbort.current?.abort(); const controller = new AbortController(); actorAbort.current = controller
    setActorKey(key); setActorBusy(true); setActorError('')
    actorScope.current = viewScope
    if (!more) setActors(undefined)
    try {
      const result = await reactionPreview.actors(scope, target, key, more ? actors?.items.at(-1)?.userId : 0, controller.signal)
      if (!controller.signal.aborted) setActors({ ...result, items: more ? [...(actors?.items ?? []), ...result.items] : result.items })
    } catch (error) { if (!controller.signal.aborted) setActorError(error instanceof Error ? error.message : '加载失败') }
    finally { if (!controller.signal.aborted) setActorBusy(false) }
  }
  const selectionsRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = selectionsRef.current
    if (!element) return
    const fitRows = () => {
      element.style.width = 'max-content'
      const box = element.getBoundingClientRect()
      const right = Math.max(box.left, ...Array.from(element.children, child => child.getBoundingClientRect().right))
      if (right > box.left) element.style.width = `${Math.ceil(right - box.left)}px`
    }
    fitRows()
    const viewport = element.closest('[data-arkme-width-viewport]')
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fitRows)
    if (viewport) observer?.observe(viewport)
    window.addEventListener('resize', fitRows)
    return () => { observer?.disconnect(); window.removeEventListener('resize', fitRows) }
  }, [snapshot, target.text, currentGroupPage])
  if (!groups.length) return null
  return <div ref={selectionsRef} data-arkme-message-reactions style={{ ...row, width: 'max-content', maxWidth: '100%', gap: 4, marginTop: 8, fontSize: 12 }}>
    {groups.map(group => { const label = expressionLabel(group.expression), mine = snapshot?.mine.selections.some(item => item.key === group.key); const newActors = new Set(highlight?.rows.filter(notice => notice.selections.some(selection => selection.key === group.key)).map(notice => notice.actorUserId)); const newGroup = highlight?.expressionIdentity === expressionIdentity(group.expression) || newActors.size > 0 && newActors.size >= group.count; return <span key={`${group.key}:${highlight?.revision ?? 0}`} data-arkme-new-reaction={newGroup ? 'group' : undefined} className={newGroup ? 'arkme-new-reaction' : undefined} style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 5px', borderRadius: 6, minHeight: 28, boxSizing: 'border-box', maxWidth: '100%', flexShrink: 0, background: `color-mix(in srgb, ${c.secondary} 10%, transparent)` }}>
      <button type="button" data-arkme-hover="none" disabled={snapshot?.private || reactionPreview.busy(target.id)} aria-busy={reactionPreview.busy(target.id)} aria-pressed={mine} aria-label={`${mine ? '取消我的' : '添加'}${reactionLabelText(label)}`}
        onClick={event => { event.stopPropagation(); void reactionPreview.toggle(scope, target, label, group.expression) }}
        style={{ ...button, border: 0, background: 'transparent', ...reactionPhraseStyle(label, false, group.expression.color), borderRadius: 3, padding: '1px 4px', overflowWrap: 'anywhere' }}>
        <ReactionLabel label={label} />
      </button>
      <span style={{ color: c.secondary, borderLeft: `1px solid ${c.border}`, marginLeft: 6, padding: '0 2px 0 7px', lineHeight: '16px' }}>
        {snapshot?.actors_visible ? <>
          {(group.actors?.length ? group.actors : mine ? [{ userId: Number(scope.split(':').at(-1)), displayName: '我' }] : []).map((actor, index) => {
            const identity: ReactionActor = actor.userId === Number(scope.split(':').at(-1)) && actor.displayName === '我' ? { ...actor, displayName: actorGroupNickname?.trim() || actorName,
              ...(actorGroupNickname ? { groupNickname: actorGroupNickname } : {}),
              ...(actorAvatarRef ? { avatarRef: actorAvatarRef } : {}),
            } : actor
            const name = identity.displayName
            return <span key={actor.userId}>{index > 0 && '、'}<button type="button" aria-label={`查看${name}的资料`} data-arkme-new-reaction={!newGroup && newActors.has(actor.userId) ? 'actor' : undefined} className={!newGroup && newActors.has(actor.userId) ? 'arkme-new-reaction' : undefined}
              onClick={event => { event.stopPropagation(); setProfileActor(identity) }}
              onPointerEnter={() => warmActorAvatar(identity)} onFocus={() => warmActorAvatar(identity)}
              style={{ ...button, background: 'transparent', border: 0, borderRadius: 0, padding: 0, color: 'inherit' }}>{name}</button></span>
          })}
          {group.count > (group.actors?.length ?? (mine ? 1 : 0)) && <button type="button" aria-label={`查看 ${group.count} 位表态者`} className={!newGroup && [...newActors].some(id => !group.actors?.some(actor => actor.userId === id)) ? 'arkme-new-reaction' : undefined}
            onClick={event => { event.stopPropagation(); void loadActors(group.key) }}
            style={{ ...button, background: 'transparent', border: 0, padding: 0, color: 'inherit' }}> 等{group.count}人</button>}
        </> : `${group.count}人`}
      </span>
    </span>})}
    {currentGroupPage && <button type="button" style={button} onClick={() => setGroupPage(undefined)}>返回</button>}
    {(currentGroupPage?.has_more ?? snapshot?.has_more) && <button type="button" disabled={groupBusy} style={button} onClick={() => void loadGroups()}>更多表态</button>}
    {groupError && <div role="alert">{groupError}</div>}
    {actorKey && snapshot?.actors_visible && actorScope.current === viewScope && <div role="region" aria-label="表态者" style={{ flexBasis: '100%', padding: 6, border: `1px solid ${c.border}`, borderRadius: 6 }}>
      <button type="button" aria-label="关闭表态者" style={button} onClick={() => { actorAbort.current?.abort(); setActorKey(undefined); setActorBusy(false) }}>×</button>
      {actors?.items.map(actor => <button type="button" key={actor.userId} aria-label={`查看${actor.displayName}的资料`} className={highlight?.rows.some(notice => notice.actorUserId === actor.userId && notice.selections.some(selection => selection.key === actorKey)) ? 'arkme-new-reaction' : undefined} style={{ ...button, margin: 6 }} onPointerEnter={() => warmActorAvatar(actor)} onFocus={() => warmActorAvatar(actor)} onClick={event => { event.stopPropagation(); setProfileActor(actor) }}>{actor.displayName}</button>)}
      {actorBusy && <span role="status">加载中…</span>}
      {actorError && <button type="button" style={button} onClick={() => void loadActors(actorKey)}>{actorError} · 重试</button>}
      {actors?.has_more && <button type="button" disabled={actorBusy} style={button} onClick={() => void loadActors(actorKey, true)}>更多</button>}
    </div>}
    {profileActor && snapshot?.actors_visible && <ArkmeReactionActorCard key={`${scope}:${profileActor.userId}`} scope={scope} actor={profileActor} onClose={() => setProfileActor(undefined)} />}
    {reactionPreview.error(target.id) && <div role="alert">{reactionPreview.error(target.id)}</div>}
    {onAdd && !snapshot?.private && <button type="button" data-arkme-reaction-toggle aria-label="继续表态" onClick={event => { event.stopPropagation(); onAdd() }}
      style={{ ...button, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 3, border: 0, borderRadius: 6, color: c.secondary, background: `color-mix(in srgb, ${c.secondary} 10%, transparent)` }}><ReactionAddIcon /></button>}
  </div>
}
