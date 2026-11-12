import type { CSSProperties, ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { tr } from './locale.js'
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

export function ArkmeDetailConversationBadge({ name, avatar, onClick }: {
  name: string
  avatar: ReactNode
  onClick(): void
}) {
  return <button data-arkme-feedback="neutral" data-arkme-detail-conversation-source type="button"
    style={{ ...arkmeDetailSourceBadgeStyle, cursor: 'pointer' }}
    aria-label={tr('来源：{v0}', { v0: name })}
    onClick={event => { event.stopPropagation(); onClick() }}>
    {avatar}
    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    <CaretRight size={12} aria-hidden style={{ flex: 'none' }} />
  </button>
}
