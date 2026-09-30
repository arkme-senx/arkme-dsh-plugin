import type { CSSProperties } from 'react'
import { ARKME_CONVERSATION_ROW_HEIGHT } from './arkme-layout.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeIntlLocale, tr } from './locale.js'

// Shared by ordinary conversations, Team rows in the sidebar and Team directories.
export const conversationDirectoryStyles = {
  chatRow: {
    position: 'relative', width: '100%', height: ARKME_CONVERSATION_ROW_HEIGHT, minHeight: ARKME_CONVERSATION_ROW_HEIGHT, margin: '1px 0', display: 'flex', alignItems: 'center', gap: 10,
    // (58 - 33) / 2 joins the rounded edge to the centered selection marker.
    // Text clips in chatContent; the corner badge keeps its own small outline.
    padding: '10px 10px', boxSizing: 'border-box', overflow: 'visible', border: 0, borderRadius: 12.5,
    background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit', outline: 0,
  },
  chatContent: { flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 4 },
  chatTop: { minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 7 },
  entryName: {
    flex: '0 0 auto', minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 13, lineHeight: '18px', fontWeight: 600,
  },
  chatTime: { flex: 'none', color: arkmeTheme.caption, fontSize: 10, lineHeight: '15px' },
  chatBottom: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  preview: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: arkmeTheme.secondary, fontSize: 11, lineHeight: '16px',
  },
  sourceAvatarWrap: { width: 38, height: 38, flex: 'none', position: 'relative', display: 'grid', placeItems: 'center' },
  mentionUnread: {
    position: 'absolute', top: -2, right: -2, minWidth: 17, height: 17, padding: '0 5px',
    boxSizing: 'border-box', borderRadius: 999, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', background: '#20c66a', color: arkmeTheme.foreground,
    border: '2px solid #fff', fontSize: 10, lineHeight: '13px', fontWeight: 700,
  },
} satisfies Record<string, CSSProperties>

export function conversationTimeLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const time = new Intl.DateTimeFormat(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  if (day === start) return time
  if (day === start - 86_400_000) return tr("昨天 {v0}", { v0: time })
  if (day > start - 7 * 86_400_000) return new Intl.DateTimeFormat(arkmeIntlLocale(), { weekday: 'short' }).format(date)
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { month: '2-digit', day: '2-digit' }).format(date)
}
