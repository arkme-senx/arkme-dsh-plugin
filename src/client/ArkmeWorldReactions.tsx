import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeWorldFeedItem } from '../types.js'
import { ArkmeReactionPreview, ArkmeReactionSelections, ReactionAddIcon } from './ArkmeReactionPreview.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { worldCloudReactionPreview as worldReactionPreview, worldReactionContexts } from './world-reactions.js'
import { reactionLibrary } from './reaction-library.js'

export function ArkmeWorldReactions({ item, children, onUnavailable }: { item: ArkmeWorldFeedItem; children: ReactNode; onUnavailable(): void }) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const [noticeOpen, setNoticeOpen] = useState(false), [openRequested, setOpenRequested] = useState(false)
  useSyncExternalStore(worldReactionContexts.subscribe, worldReactionContexts.getSnapshot, worldReactionContexts.getSnapshot)
  useEffect(() => {
    worldReactionContexts.setScope(scope)
    worldReactionPreview.setScope(scope)
    if (scope) return worldReactionContexts.watch(scope, item.recordRef)
  }, [scope, item.recordRef])
  const context = scope ? worldReactionContexts.state(scope, item.recordRef) : undefined
  // Archive access never grants permission to keep a public card visible.
  useEffect(() => {
    // watch() above may have invalidated an old archive after republishing.
    const current = scope ? worldReactionContexts.state(scope, item.recordRef) : undefined
    if (current?.status === 'unavailable' || current?.status === 'ready' && current.context?.visibility === 'unpublished') onUnavailable()
  }, [scope, item.recordRef, context, onUnavailable])
  useEffect(() => { setNoticeOpen(false); setOpenRequested(false) }, [scope, item.recordRef])
  const target = context?.status === 'ready' && context.context?.visibility === 'published' ? { ...context.context.target, source: '世界', text: item.textContent } : undefined
  return <div data-world-reactions data-storage="cloud" style={{ minWidth: 0, width: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 32 }}>
      {scope && target ? <ArkmeReactionPreview scope={scope} target={target} store={worldReactionPreview} library={reactionLibrary} standalone
        openRequested={openRequested} onOpenHandled={() => setOpenRequested(false)} />
        : <button type="button" aria-label={tr('表态')} title={tr('表态')} aria-expanded={noticeOpen} data-arkme-feedback="neutral" onClick={() => { setNoticeOpen(value => !value); setOpenRequested(true); if (scope && context?.status === 'error') worldReactionContexts.retry(scope, item.recordRef) }}
          style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, padding: 0, background: 'transparent', border: 0, color: c.secondary, cursor: 'pointer' }}><ReactionAddIcon /></button>}
      {children}
    </div>
    {scope && target && <ArkmeReactionSelections scope={scope} target={target} store={worldReactionPreview} onAdd={() => setOpenRequested(true)} />}
    {noticeOpen && !target && <div role="status" style={{ marginTop: 8, color: c.secondary, fontSize: 12 }}>
      {tr(!scope ? '请先登录后表态' : context?.message ?? '正在读取世界表态…')}
    </div>}
  </div>
}
