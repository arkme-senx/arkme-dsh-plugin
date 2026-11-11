import type { CSSProperties, ReactNode } from 'react'
import { tr } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'

const styles = {
  forwardSuccessBannerWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 118, zIndex: 85, display: 'flex', justifyContent: 'center',
    padding: '0 16px', pointerEvents: 'none',
  },
  forwardSuccessBanner: {
    width: 'min(380px, 100%)', minHeight: 48, display: 'flex', alignItems: 'center', gap: 9,
    padding: '9px 12px', border: 0, borderRadius: 12, boxSizing: 'border-box',
    background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-3, #fff) 80%, transparent)',
    color: arkmeTheme.text, boxShadow: '0 5px 14px rgba(20,23,31,.16)', backdropFilter: 'blur(40px)',
    cursor: 'pointer', pointerEvents: 'auto', textAlign: 'left',
  },
  forwardSuccessAvatarStack: { width: 30, height: 30, flex: 'none', position: 'relative' },
  forwardSuccessText: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: '18px', fontWeight: 600 },
  forwardSuccessAction: { flex: 'none', fontSize: 13, lineHeight: '18px', fontWeight: 700 },
} satisfies Record<string, CSSProperties>

export function ArkmeForwardSuccessBanner({ message, avatars, onOpen }: {
  message: string; avatars: readonly ReactNode[]; onOpen(): void
}) {
  return <div style={styles.forwardSuccessBannerWrap}>
    <button type="button" style={styles.forwardSuccessBanner} aria-label={message} onClick={onOpen}>
      <span style={{ ...styles.forwardSuccessAvatarStack, width: Math.min(30 + Math.max(0, avatars.length - 1) * 15, 75) }}>
        {avatars.map((avatar, index) => <span key={index} style={{ position: 'absolute', left: index * 15, top: 0 }}>{avatar}</span>)}
      </span>
      <span style={styles.forwardSuccessText}>{message}</span>
      <span style={styles.forwardSuccessAction}>{tr('去看看')}</span>
    </button>
  </div>
}
