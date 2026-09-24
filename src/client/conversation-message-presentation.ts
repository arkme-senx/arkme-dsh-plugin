import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeIntlLocale } from './locale.js'

/** Shared conversation geometry; business state and permissions stay with each owner. */
export const arkmeConversationMessageLayout = {
  header: {
    flex: 'none', height: 68, display: 'flex', alignItems: 'center', padding: '12px 16px 12px 20px',
    boxSizing: 'border-box', borderBottom: `1px solid ${arkmeTheme.border}`, position: 'relative', gap: 4,
  },
  titleGroup: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' },
  titleBlock: { flex: '0 1 auto', minWidth: 0, maxWidth: '100%', padding: '2px 0', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  titleLine: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  title: { flex: '0 1 auto', minWidth: 0, margin: 0, fontSize: 15, lineHeight: '21px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  headerSubtitle: { color: arkmeTheme.secondary, fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  date: { alignSelf: 'center', marginBottom: 18, color: arkmeTheme.caption, fontSize: 10 },
  row: { width: '100%', minWidth: 0, display: 'flex', background: 'transparent', transition: 'background-color .3s ease' },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  messageLine: { maxWidth: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18 },
  messageLineMe: { flexDirection: 'row-reverse' },
  messageBody: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7 },
  messageBodyMe: { alignItems: 'flex-end' },
  messageAvatar: {
    width: 34, height: 34, flex: 'none', overflow: 'hidden', borderRadius: 999,
    display: 'grid', placeItems: 'center', background: 'transparent', color: arkmeTheme.secondary, fontSize: 11, fontWeight: 600,
  },
  messageAvatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  sender: { color: arkmeTheme.text, fontSize: 12, fontWeight: 600 },
  messageHeader: { display: 'flex', alignItems: 'center', gap: 7 },
  bubble: { maxWidth: 'min(600px, 100%)', minWidth: 0, padding: '10px 13px', overflow: 'hidden', overflowWrap: 'anywhere', wordBreak: 'break-word', borderRadius: '5px 16px 16px 16px', boxSizing: 'border-box', cursor: 'pointer', border: '1px solid rgba(29,32,40,.035)' },
  bubbleMe: { background: arkmeTheme.messageOwn, borderColor: 'rgba(83,97,145,.045)', borderRadius: '16px 5px 16px 16px', '--arkme-bubble-fade': arkmeTheme.messageOwn } as CSSProperties,
  bubbleOther: { background: arkmeTheme.messageOther, '--arkme-bubble-fade': arkmeTheme.messageOther } as CSSProperties,
  text: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: '20px' },
  meta: { color: arkmeTheme.tertiary, fontSize: 11 },
} satisfies Record<string, CSSProperties>

export function dayKey(value: number): string {
  const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function dayLabel(value: number): string {
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

export function timeLabel(value: number): string {
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

