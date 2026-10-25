import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ArkmeWorldFeedItem } from '../types.js'
import { ArkmeReactionPreview, ArkmeReactionSelections, ReactionAddIcon } from './ArkmeReactionPreview.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeTheme as c } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { worldLocalReactionLibrary, worldReactionPreview } from './world-reactions.js'

export function ArkmeWorldReactions({ item, children }: { item: ArkmeWorldFeedItem; children: ReactNode; onUnavailable(): void }) {
  useArkmeLocale()
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const [noticeOpen, setNoticeOpen] = useState(false), [openRequested, setOpenRequested] = useState(false)
  useEffect(() => { worldReactionPreview.setScope(scope) }, [scope])
  useEffect(() => { setNoticeOpen(false); setOpenRequested(false) }, [scope, item.recordRef])
  const target = item.localReactionTarget ? { ...item.localReactionTarget, source: '世界', text: item.textContent } : undefined
  return <div data-world-reactions data-storage="local" style={{ minWidth: 0, width: '100%' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 32 }}>
      {scope && target ? <ArkmeReactionPreview scope={scope} target={target} store={worldReactionPreview} library={worldLocalReactionLibrary} standalone panelNote={tr('仅本机保存 · 未云同步')}
        openRequested={openRequested} onOpenHandled={() => setOpenRequested(false)} />
        : <button type="button" aria-label={tr('表态')} title={tr('表态')} aria-expanded={noticeOpen} data-arkme-feedback="neutral" onClick={() => setNoticeOpen(value => !value)}
          style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, padding: 0, background: 'transparent', border: 0, color: c.secondary, cursor: 'pointer' }}><ReactionAddIcon /></button>}
      {children}
    </div>
    {scope && target && <ArkmeReactionSelections scope={scope} target={target} store={worldReactionPreview} onAdd={() => setOpenRequested(true)} />}
    {noticeOpen && !target && <div role="status" style={{ marginTop: 8, color: c.secondary, fontSize: 12 }}>
      {tr(!scope ? '请先登录后表态' : '请刷新世界后使用本机表态')}
    </div>}
  </div>
}
