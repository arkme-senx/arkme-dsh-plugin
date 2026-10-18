import type { CSSProperties, ReactNode } from 'react'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

const styles = {
  row: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 'none' },
  hint: {
    flex: '1 1 auto', minWidth: 0, overflow: 'hidden', paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 0,
    color: arkmeTheme.tertiary, fontSize: 11, lineHeight: 'normal', whiteSpace: 'pre',
    transition: 'opacity 150ms linear, height 150ms linear', pointerEvents: 'none',
  },
  icon: { flexShrink: 0, marginRight: 6, lineHeight: 'normal' },
  text: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  name: { color: arkmeTheme.secondary, fontWeight: 500 },
} satisfies Record<string, CSSProperties>

/** Reserve the hint row outside the input card so focusing never shifts the message viewport. */
export function ArkmeComposerInfoRow({ destination, focused, variant = 'direct', memberCount, children }: {
  destination?: string
  focused: boolean
  variant?: 'direct' | 'group' | 'self'
  memberCount?: number
  children?: ReactNode
}) {
  const height = variant === 'direct' ? 30 : 20
  return <div data-arkme-composer-info-row="true" style={{ ...styles.row, minHeight: height }}>
    {destination !== undefined && <div
      data-arkme-composer-destination-hint="true"
      aria-hidden={!focused}
      style={{ ...styles.hint, height, opacity: focused ? 1 : 0 }}
    >
      <span style={{ ...styles.icon, fontSize: variant === 'direct' ? 16 : 14 }} aria-hidden>💡</span>
      <span style={styles.text} title={tr('正在给 {v0} 发消息', { v0: destination })}><span>{tr('正在给')} </span>
        <span style={styles.name}>{variant === 'group' && destination.length > 10 ? `${destination.slice(0, 10)}...` : destination}</span>
        {memberCount !== undefined && memberCount > 1 && <span>{tr(' ({v0}人)', { v0: memberCount })}</span>}<span> {tr('发消息')}</span>
      </span>
    </div>}
    {children}
  </div>
}
