import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeIntlLocale, getArkmeLocale, tr, useArkmeLocale } from './locale.js'

const button: CSSProperties = {
  height: 32, padding: '0 8px', flex: 'none', border: 0, borderRadius: 6,
  background: 'transparent', color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 13,
}
const disabledStyle: CSSProperties = { opacity: .35, cursor: 'default' }
const monthNumber = (date: Date) => date.getFullYear() * 12 + date.getMonth()

/** Shared month navigation for recording and personal calendars. Browsing never selects a day. */
export function ArkmeCalendarMonthHeader({ visibleMonth, selectedDate, today, allowFuture = false, onVisibleMonthChange, onToday }: {
  visibleMonth: Date
  selectedDate: Date
  today: Date
  allowFuture?: boolean
  onVisibleMonthChange(month: Date): void
  onToday(): void
}) {
  useArkmeLocale()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const selectedYear = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number }>()
  const [draftYear, setDraftYear] = useState(visibleMonth.getFullYear())
  const open = anchor !== undefined
  const currentMonth = monthNumber(visibleMonth)
  const canPrevious = currentMonth > 1970 * 12
  const canNext = currentMonth < (allowFuture ? 9999 * 12 + 11 : monthNumber(today))
  const canToday = currentMonth !== monthNumber(today) || selectedDate.toDateString() !== today.toDateString()
  const close = (restoreFocus = false) => { setAnchor(undefined); if (restoreFocus) trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (!open) return
    const selected = selectedYear.current
    if (selected?.parentElement) selected.parentElement.scrollTop = selected.offsetTop - selected.parentElement.clientHeight / 2 + selected.offsetHeight / 2
    selected?.focus({ preventScroll: true })
  }, [open, draftYear])
  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (rect) setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom })
    }
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [open])
  useEffect(() => { setAnchor(undefined) }, [currentMonth])
  const viewport = typeof window === 'undefined' ? { width: 1024, height: 768 } : { width: window.innerWidth, height: window.innerHeight }
  const width = Math.min(280, viewport.width - 16)
  const height = Math.min(250, viewport.height - 16)
  const left = Math.max(8, Math.min(anchor?.left ?? 0, viewport.width - width - 8))
  const top = anchor === undefined ? 0 : anchor.bottom + 4 + height <= viewport.height - 8 ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4)
  const latestYear = allowFuture ? Math.min(9999, Math.max(today.getFullYear(), visibleMonth.getFullYear(), draftYear) + 10) : today.getFullYear()
  const years = Array.from({ length: latestYear - 1970 + 1 }, (_, index) => latestYear - index)
  const title = getArkmeLocale() === 'en'
    ? new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: 'long' }).format(visibleMonth)
    : `${visibleMonth.getFullYear()}年 ${visibleMonth.getMonth() + 1}月`
  const menu = !open ? null : <>
    <button type="button" tabIndex={-1} aria-label={tr('关闭年月选择')} onClick={event => { event.stopPropagation(); close(true) }}
      style={{ position: 'fixed', zIndex: 1009, inset: 0, border: 0, padding: 0, background: 'transparent', cursor: 'default' }} />
    <div ref={panel} id={id} role="dialog" aria-label={tr('年月选择')} style={{ position: 'fixed', zIndex: 1010,
      left, top, width, height, padding: 12, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: '68px minmax(0,1fr)', gap: 12,
      border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow }}>
      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: arkmeTheme.tertiary, fontSize: 11, paddingLeft: 8 }}>{tr('年份')}</span>
        <div role="group" aria-label={tr('年份')} style={{ position: 'relative', minHeight: 0, overflowY: 'auto' }}
          onKeyDown={event => {
            const year = event.key === 'ArrowUp' ? draftYear + 1 : event.key === 'ArrowDown' ? draftYear - 1
              : event.key === 'Home' ? latestYear : event.key === 'End' ? 1970 : undefined
            if (year === undefined) return
            event.preventDefault(); event.stopPropagation(); setDraftYear(Math.max(1970, Math.min(latestYear, year)))
          }}>
          {years.map(year => <button key={year} ref={year === draftYear ? selectedYear : undefined} type="button"
            className="arkme-month-header-button" aria-pressed={year === draftYear} tabIndex={year === draftYear ? 0 : -1}
            style={{ ...button, width: '100%', ...(year === draftYear ? { background: arkmeTheme.subtle, fontWeight: 600 } : {}) }}
            onClick={() => setDraftYear(year)}>{year}</button>)}
        </div>
      </div>
      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ color: arkmeTheme.tertiary, fontSize: 11, paddingLeft: 8 }}>{tr('月份')}</span>
        <div role="group" aria-label={tr('月份')} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, overflowY: 'auto' }}>
          {Array.from({ length: 12 }, (_, month) => {
            const disabled = !allowFuture && draftYear * 12 + month > monthNumber(today)
            const selected = draftYear === visibleMonth.getFullYear() && month === visibleMonth.getMonth()
            return <button key={month} type="button" className="arkme-month-header-button" aria-pressed={selected} disabled={disabled}
              style={{ ...button, padding: '0 4px', ...(selected ? { background: arkmeTheme.subtle, fontWeight: 600 } : {}), ...(disabled ? disabledStyle : {}) }}
              onClick={() => { if (!disabled) { onVisibleMonthChange(new Date(draftYear, month, 1)); close(true) } }}>
              {new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'short' }).format(new Date(draftYear, month, 1))}
            </button>
          })}
        </div>
      </div>
    </div>
  </>
  return <header data-arkme-calendar-month-header style={{ minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
    onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) } }}
    onBlurCapture={event => {
      const next = event.relatedTarget as Node | null
      // A null target can be the browser window losing focus, not navigation out of the picker.
      if (open && next !== null && !event.currentTarget.contains(next) && !panel.current?.contains(next)) close()
    }}>
    <style>{`.arkme-month-header-button:not(:disabled):hover { background: ${arkmeTheme.hover} !important; }
      .arkme-month-header-button:focus-visible { outline: 2px solid ${arkmeTheme.accent}; outline-offset: -2px; }`}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <button type="button" className="arkme-month-header-button" aria-label={tr('上个月')} disabled={!canPrevious}
        style={{ ...button, width: 28, padding: 0, display: 'grid', placeItems: 'center', ...(!canPrevious ? disabledStyle : {}) }}
        onClick={() => { if (canPrevious) onVisibleMonthChange(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1)) }}>
        <CaretRight size={14} style={{ transform: 'rotate(180deg)' }} aria-hidden />
      </button>
      <button ref={trigger} type="button" className="arkme-month-header-button" aria-label={tr('选择年月')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        style={{ ...button, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }} onClick={event => {
          if (open) { close(); return }
          setDraftYear(visibleMonth.getFullYear())
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom })
        }}>{title}</button>
      <button type="button" className="arkme-month-header-button" aria-label={tr('下个月')} disabled={!canNext}
        style={{ ...button, width: 28, padding: 0, display: 'grid', placeItems: 'center', ...(!canNext ? disabledStyle : {}) }}
        onClick={() => { if (canNext) onVisibleMonthChange(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)) }}>
        <CaretRight size={14} aria-hidden />
      </button>
    </div>
    <button type="button" className="arkme-month-header-button" disabled={!canToday}
      style={{ ...button, color: arkmeTheme.secondary, fontSize: 12, whiteSpace: 'nowrap', ...(!canToday ? disabledStyle : {}) }}
      onClick={() => { if (canToday) onToday() }}>{tr('回到今日')}</button>
    {menu !== null && (typeof document === 'undefined' || !document.body ? menu : createPortal(menu, document.body))}
  </header>
}
