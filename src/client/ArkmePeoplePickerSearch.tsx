import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Shared search field for group membership and Team contact pickers. */
export function ArkmePeoplePickerSearch({ value, onChange, onSubmit, disabled = false, label = '搜索成员候选人', placeholder = '搜索' }: {
  value: string; onChange(value: string): void; onSubmit?(): void; disabled?: boolean; label?: string; placeholder?: string;
}) {
  return <form onSubmit={event => { event.preventDefault(); onSubmit?.() }} style={{ position: 'relative', margin: '16px 12px 8px', flex: 'none' }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 12, top: 11, color: arkmeTheme.secondary }} aria-hidden><circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2"/><path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
    <input className="arkme-group-member-search" style={{ width: '100%', boxSizing: 'border-box', height: 40, border: 0, borderRadius: 11, padding: '0 30px 0 36px', background: arkmeTheme.base, color: arkmeTheme.text, font: 'inherit', outline: 'none' }}
      value={value} placeholder={tr(placeholder)} aria-label={tr(label)} disabled={disabled} onChange={event => onChange(event.currentTarget.value)}/>
    {value && <button type="button" aria-label={tr('清除搜索')} disabled={disabled} onClick={() => onChange('')} style={{ position: 'absolute', right: 8, top: 8, width: 24, height: 24, border: 0, background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' }}>×</button>}
  </form>
}
