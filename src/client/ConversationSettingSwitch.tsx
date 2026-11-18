import { arkmeTheme } from './arkme-theme.js'

export function ConversationSettingSwitch({ label, checked, busy, onChange }: { label: string; checked: boolean; busy: boolean; onChange(checked: boolean): void }) {
  return <span role="switch" aria-label={label} aria-checked={checked} aria-disabled={busy || undefined}
    style={{ marginLeft: 'auto', width: 40, height: 22, flexShrink: 0, border: 0, borderRadius: 999, padding: 2,
      display: 'flex', alignItems: 'center', cursor: busy ? 'default' : 'pointer', transition: 'background .15s ease', boxSizing: 'border-box',
      background: checked ? arkmeTheme.accent : arkmeTheme.active, opacity: busy ? .55 : 1 }}
    onClick={event => { event.stopPropagation(); if (!busy) onChange(!checked) }}>
    <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 999, background: arkmeTheme.foreground, boxShadow: '0 1px 2px rgba(0,0,0,.14)',
      transition: 'transform .15s ease', transform: checked ? 'translateX(18px)' : 'translateX(0)' }} />
  </span>
}
