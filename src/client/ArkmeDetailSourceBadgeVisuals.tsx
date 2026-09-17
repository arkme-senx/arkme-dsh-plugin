import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'

/** Shared by chat and personal-topic provenance in the note detail. */
export const arkmeDetailSourceBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: '100%',
  marginTop: 10,
  padding: '2px 6px',
  minHeight: 24,
  boxSizing: 'border-box',
  border: `1px solid ${arkmeTheme.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: arkmeTheme.tertiary,
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'left',
}

/** The same topic mark used beside messages in the self timeline. */
export function ArkmeTopicSourceIcon({ size = 14 }: { size?: number }) {
  return <svg aria-hidden viewBox="0 0 16 16" width={size} height={size} style={{ flex: 'none' }}>
    <path d="M3.25 2.75h9.5v10.5h-9.5zM5.25 5.25h5.5M5.25 7.9h3.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
}
