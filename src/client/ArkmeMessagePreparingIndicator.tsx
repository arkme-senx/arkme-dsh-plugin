import { useSyncExternalStore } from 'react'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeMessagePreparing } from './message-preparing-store.js'

const motion = `
@keyframes arkme-preparing-dot { 0%,100% { opacity: .3; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-2px) } }
.arkme-preparing-dot { animation: arkme-preparing-dot 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .arkme-preparing-dot { animation: none; opacity: .6; } }
`

/** A transient accessory, never a timeline record or member-action surface. */
export function ArkmeMessagePreparingIndicator({ sourceKey, accountScope }: { sourceKey: string; accountScope: string }) {
  useSyncExternalStore(arkmeMessagePreparing.subscribe, arkmeMessagePreparing.getSnapshot, arkmeMessagePreparing.getSnapshot)
  const entries = arkmeMessagePreparing.get(sourceKey, accountScope).slice(0, 7)
  if (entries.length === 0) return null
  return <div role="status" aria-label="正在输入" aria-live="polite" data-arkme-message-preparing
    style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8, padding: '6px 4px', maxWidth: '100%', minWidth: 0, pointerEvents: 'none' }}>
    <style>{motion}</style>
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', minWidth: 0 }}>
      {entries.map(entry => <span key={entry.actorKey} style={{ flex: '0 0 32px' }}>
        <ArkmeUserAvatar {...(entry.avatarRef === undefined ? {} : { avatarRef: entry.avatarRef })} size={32} label="正在输入的成员" />
      </span>)}
    </div>
    <span aria-hidden style={{ display: 'flex', flex: 'none', alignItems: 'center', gap: 4, height: 28, padding: '0 14px',
      borderRadius: 14, background: arkmeTheme.messageOther, color: arkmeTheme.tertiary }}>
      {[0, 1, 2].map(index => <span key={index} className="arkme-preparing-dot" data-arkme-preparing-dot
        style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', animationDelay: `${index * 0.18}s` }} />)}
    </span>
  </div>
}
