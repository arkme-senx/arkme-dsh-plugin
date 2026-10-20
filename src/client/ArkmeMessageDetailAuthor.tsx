import type { ReactNode } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeIntlLocale } from './locale.js'

/** One author and time layout for ordinary and Team message details. */
export function ArkmeMessageDetailAuthor({ avatar, name, at, bot = false }: { avatar: ReactNode; name: ReactNode; at: number; bot?: boolean }) {
  const time = Number.isFinite(at) && at > 0 && at < 8.64e15 ? at < 1e12 ? at * 1000 : at : 0
  const date = time ? new Date(time) : undefined
  const label = date ? `${date.toLocaleDateString(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' })} ${date.toLocaleTimeString(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''
  return <div data-arkme-detail-author style={{ display: 'flex', gap: bot ? 10 : 9, alignItems: 'center' }}>
    {avatar}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ minWidth: 0, overflowWrap: 'anywhere', color: arkmeTheme.secondary, fontSize: 12, fontWeight: 600 }}>{name}</div>
      <div style={{ color: arkmeTheme.tertiary, fontSize: bot ? 12 : 11, lineHeight: '18px', marginTop: bot ? 2 : 4 }}>{label}</div>
    </div>
  </div>
}
