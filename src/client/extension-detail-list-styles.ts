import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'

/** Shared group and Team extension detail geometry. */
export const arkmeExtensionDetailListStyles = {
  extensionContext: { marginTop: 28 },
  extensionContextTitle: { marginBottom: 18, color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px', fontWeight: 500 },
  extensionContextList: { display: 'flex', flexDirection: 'column', gap: 10 },
  extensionContextRow: { display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, padding: '6px 8px', boxSizing: 'border-box',
    borderRadius: 12, background: 'transparent', cursor: 'pointer', outline: 0 },
  extensionContextRowSelected: { background: arkmeTheme.subtle },
  extensionContextBody: { flex: 1, minWidth: 0 },
  extensionContextHead: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  extensionContextName: { flex: 1, minWidth: 0, color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px', fontWeight: 500, overflowWrap: 'anywhere' },
  extensionContextTime: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  extensionContextStatus: { display: 'flex', alignItems: 'center', gap: 8, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '20px' },
  extensionContextRetry: { padding: 0, border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', font: 'inherit' },
  extensionContextAvatarImage: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  extensionContextAvatarFallback: { width: 36, height: 36, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 999, overflow: 'hidden', background: arkmeTheme.layer2, color: arkmeTheme.secondary, fontSize: 13, fontWeight: 600 },
} satisfies Record<string, CSSProperties>
