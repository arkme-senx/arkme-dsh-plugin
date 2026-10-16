import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import { useSyncExternalStore, type CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeMessageSync } from './message-sync-store.js'

const slot: CSSProperties = { flex: 'none', minWidth: 0, height: 28, margin: '0 10px 8px' }
const banner: CSSProperties = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  boxSizing: 'border-box', padding: '0 8px', borderRadius: 5,
  background: arkmeTheme.subtle, color: arkmeTheme.secondary,
  fontSize: 12, lineHeight: '18px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  pointerEvents: 'none',
}

/** A presentation-only subscriber outside the directory's scroll viewport. */
export function ArkmeMessageSyncBanner() {
  const view = useSyncExternalStore(arkmeMessageSync.subscribe, arkmeMessageSync.snapshot, arkmeMessageSync.snapshot)
  if (!view.visible) return null
  const completed = view.progress?.completed ?? 0, total = view.progress?.total ?? 0
  return <div data-arkme-message-sync-slot style={slot}>
    <div data-arkme-message-sync role="progressbar" aria-label="消息同步"
      aria-valuemin={0} aria-valuemax={total || undefined} aria-valuenow={completed}
      style={banner}>
      <ArrowsClockwise size={14} style={{ flex: 'none' }} aria-hidden />
      <span>同步中 {completed}/{total}</span>
    </div>
  </div>
}
