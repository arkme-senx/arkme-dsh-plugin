import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeWorldFeedItem } from '../types.js'
import { ArkmeReactionPreview, ArkmeReactionSelections, ReactionAddIcon } from './ArkmeReactionPreview.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { watchVisibleReactionTarget } from './reaction-visible-target.js'
import { worldReactionContexts, worldReactionPreview } from './world-reactions.js'

export function ArkmeWorldReactions({ item, children, onUnavailable }: { item: ArkmeWorldFeedItem; children: ReactNode; onUnavailable(): void }) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  useSyncExternalStore(worldReactionContexts.subscribe, worldReactionContexts.getSnapshot, worldReactionContexts.getSnapshot)
  const state = scope ? worldReactionContexts.state(scope, item.recordRef) : undefined
  const [noticeOpen, setNoticeOpen] = useState(false), [openRequested, setOpenRequested] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    worldReactionContexts.setScope(scope); worldReactionPreview.setScope(scope)
    if (!scope) return
    return watchVisibleReactionTarget(root.current, () => worldReactionContexts.watch(scope, item.recordRef))
  }, [scope, item.recordRef])
  useEffect(() => { setNoticeOpen(false); setOpenRequested(false) }, [scope, item.recordRef])
  useEffect(() => { if (state?.status === 'unavailable') onUnavailable() }, [state?.status, onUnavailable])
  const target = state?.context ? { ...state.context.target, source: '世界', text: item.textContent } : undefined
  const readOnly = state?.context?.visibility === 'unpublished'
  return <div ref={root} data-world-reactions style={{ minWidth: 0, width: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, minHeight: 30 }}>
      {scope && state?.status === 'ready' && target ? <ArkmeReactionPreview scope={scope} target={target} store={worldReactionPreview} standalone triggerText={tr('表态')} readOnly={readOnly}
        openRequested={openRequested} onOpenHandled={() => setOpenRequested(false)} />
        : <button type="button" aria-label={tr('表态')} aria-expanded={noticeOpen} data-arkme-feedback="neutral"
          onClick={() => setNoticeOpen(value => !value)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 28, padding: 3, background: 'transparent', border: 0, color: c.secondary, font: 'inherit', fontSize: 12, cursor: 'pointer' }}><ReactionAddIcon />{tr('表态')}</button>}
      {children}
    </div>
    {scope && state?.status === 'ready' && target && <ArkmeReactionSelections scope={scope} target={target} store={worldReactionPreview} readOnly={readOnly} {...(!readOnly ? { onAdd: () => setOpenRequested(true) } : {})} />}
    {readOnly && <p style={{ margin: '6px 0 0', color: c.secondary, fontSize: 12 }}>{tr('世界表态 · 已取消公开，仅你可查看')}</p>}
    {noticeOpen && !target && <div role="status" style={{ marginTop: 8, padding: '10px 12px', border: `1px solid ${c.border}`, borderRadius: 8, background: c.layer2, color: c.secondary, fontSize: 12, lineHeight: 1.6 }}>
      <span>{tr(!scope ? '请先登录后表态' : state?.message ?? '正在读取世界表态…')}</span>
      {scope && ['error', 'unsupported'].includes(state?.status ?? '') && <button type="button" onClick={() => worldReactionContexts.retry(scope, item.recordRef)} style={{ marginLeft: 10, color: c.accent, font: 'inherit', background: 'transparent', border: 0, cursor: 'pointer' }}>{tr('重试')}</button>}
    </div>}
  </div>
}
