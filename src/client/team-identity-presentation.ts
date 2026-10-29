import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'

// Shared geometry from the existing identity-menu badge and public-team link.
export const teamIdentityBadgeStyle: CSSProperties = {
  position: 'absolute', right: -2, bottom: -2, display: 'grid', placeItems: 'center',
  width: 14, height: 14, borderRadius: '50%', border: `2px solid ${arkmeTheme.base}`,
  background: arkmeTheme.accentSoft, color: arkmeTheme.accent,
}
export const teamIdentityLinkStyle: CSSProperties = {
  border: 0, background: 'transparent', color: arkmeTheme.accent, padding: 6, cursor: 'pointer',
}
