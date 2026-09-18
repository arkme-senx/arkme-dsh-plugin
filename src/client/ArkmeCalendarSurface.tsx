import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type {
  ArkmeCalendarBucketDay,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordItem,
  ArkmeTimelineItem,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeTimelineDetailDrawer, ForwardRecordsDetail } from './ArkmeNoteDetails.js'
import { ArkmeDirectoryWindow } from './ArkmeDirectoryWindow.js'
import { ArkmeDirectorySourceAvatar, ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { ARKME_NAVIGATION_WIDTH } from './arkme-layout.js'
import {
  ARKME_DSH_AGENT_INPUT_LABEL,
  ArkmeDshAgentInputMarker,
  isDshAgentInputCreationSource,
} from './ArkmeDshAgentInputMarker.js'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'
import { useCalendarMonth } from './use-calendar-month.js'
import { arkmeUi } from './ui-controller.js'
import type { SelfCalendarDateSelection } from './use-self-calendar-navigation.js'
import type { CalendarMonthSnapshot } from './calendar-month-cache.js'
import { CALENDAR_MIN_HEIGHT, useCalendarPopoverLayout } from './use-calendar-popover-layout.js'

const colors = {
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary,
  caption: arkmeTheme.caption,
  border: arkmeTheme.border,
  borderSoft: arkmeTheme.borderSoft,
  panel: arkmeTheme.base,
  bubble: '#eef1f8',
  selected: arkmeTheme.primaryAction,
  selectedText: arkmeTheme.onPrimaryAction,
  danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'absolute', inset: 0, zIndex: 14, minWidth: 0, minHeight: 0,
    overflow: 'hidden', color: colors.text, pointerEvents: 'none',
  },
  productRailRoot: {
    position: 'fixed', top: 0, right: 0, bottom: 0, left: ARKME_NAVIGATION_WIDTH, zIndex: 60,
  },
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 1, width: '100%', height: '100%', padding: 0,
    border: 0, background: 'rgba(245, 245, 247, .08)', backdropFilter: 'blur(.6px)',
    WebkitBackdropFilter: 'blur(.6px)', cursor: 'default', pointerEvents: 'auto',
  },
  productRailBackdrop: {
    background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none',
  },
  layout: {
    position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
  },
  calendarCard: {
    position: 'absolute', top: 191, left: 105, width: 354, padding: '16px 17px 18px',
    boxSizing: 'border-box', pointerEvents: 'auto', border: '1px solid rgba(216,217,221,.9)',
    borderRadius: 18, background: 'rgba(255,255,255,.98)',
    boxShadow: '0 22px 52px rgba(27,29,37,.14), 0 2px 8px rgba(27,29,37,.055)',
  },
  productRailCalendarCard: { top: 88, left: 12 },
  calendarPointer: {
    position: 'absolute', top: 124, left: -7, width: 13, height: 13,
    transform: 'rotate(45deg)', background: '#fff',
    borderBottom: '1px solid #dfe0e3', borderLeft: '1px solid #dfe0e3',
  },
  header: { height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  navCluster: { display: 'flex', alignItems: 'center', gap: 3 },
  iconButton: {
    width: 27, height: 27, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: '#777b84',
    cursor: 'pointer', font: 'inherit', lineHeight: 1,
  },
  navDisabled: { opacity: .32, cursor: 'default' },
  caretLeft: { transform: 'rotate(180deg)' },
  monthTitle: { margin: '0 0 0 9px', fontSize: 13, lineHeight: '20px', fontWeight: 500 },
  todayButton: {
    width: 'auto', height: 27, flex: 'none', padding: '0 7px', border: 0,
    borderRadius: 8, background: 'transparent', color: '#747984', cursor: 'pointer',
    font: 'inherit', fontSize: 11, fontWeight: 400,
  },
  todayDisabled: { color: colors.caption, opacity: .45, cursor: 'default' },
  week: {
    height: 32, marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    alignItems: 'center',
  },
  weekDay: {
    textAlign: 'center', color: '#9a9da5', fontSize: 10, lineHeight: '16px', fontWeight: 400,
  },
  days: {
    display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4,
  },
  blank: { height: 45 },
  dayButton: {
    height: 45, minWidth: 0, display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 3,
    padding: 0, borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent', borderRadius: 11,
    background: 'transparent', color: '#50545d', cursor: 'pointer', font: 'inherit',
    boxSizing: 'border-box', transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
  },
  dayDisabled: { color: colors.caption, opacity: .4, cursor: 'default' },
  daySelected: {
    borderColor: colors.selected, background: colors.selected, color: colors.selectedText,
  },
  dayNumber: { fontSize: 12, lineHeight: '16px', fontWeight: 500 },
  dayCount: { height: 9, color: '#8b91a1', fontSize: 9, lineHeight: '9px', fontWeight: 400 },
  dayCountPopulated: {
    minWidth: 15, padding: '0 4px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #626878)',
    transition: 'background 120ms ease, color 120ms ease',
  },
  selectedDayCount: { background: 'transparent', color: colors.selectedText, opacity: 1 },
  status: { marginTop: 10, minHeight: 18, color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  retryButton: { marginLeft: 8, padding: '4px 8px', border: 0, borderRadius: 6,
    background: 'transparent', color: colors.text, font: 'inherit', cursor: 'pointer' },
  error: { color: colors.danger },
  loadingStatus: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.secondary, fontSize: 12, lineHeight: '18px', padding: '12px 0' },
  initialLoading: { minHeight: '100%', boxSizing: 'border-box' },
  topicBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', marginTop: 10, padding: '2px 6px', minHeight: 24, boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.tertiary, fontSize: 12, lineHeight: '18px' },
  recordsPanel: {
    position: 'absolute', top: 0, right: 0, bottom: 0, width: 394, minWidth: 0, minHeight: 0,
    display: 'flex', flexDirection: 'column', padding: '28px 22px', boxSizing: 'border-box',
    overflow: 'hidden', pointerEvents: 'auto', borderLeft: '1px solid rgba(225,225,228,.9)',
    background: 'rgba(255,255,255,.98)', boxShadow: '-18px 0 52px rgba(28,30,37,.09)',
  },
  recordsHeader: {
    flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  recordsTitle: { margin: 0, flex: 1, fontSize: 18, lineHeight: '28px', fontWeight: 600, letterSpacing: '-.025em', whiteSpace: 'nowrap' },
  list: { flex: 1, minHeight: 0, maxHeight: 'calc(100% - 72px)', margin: '28px -4px 0', padding: '2px 4px 18px', overflowY: 'auto' },
  recordRow: {
    width: '100%', minWidth: 0, marginBottom: 16, display: 'flex', alignItems: 'flex-start',
    justifyContent: 'flex-end', gap: 8, color: 'inherit', font: 'inherit', boxSizing: 'border-box',
  },
  recordStack: { width: 'auto', minWidth: 0, maxWidth: 282, flex: '0 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  recordHeader: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 7, marginBottom: 5 },
  recordTitle: {
    margin: 0, color: '#4f535c', fontSize: 12, lineHeight: '18px', fontWeight: 500,
  },
  recordTime: { flex: 'none', color: '#a0a3aa', fontSize: 11, lineHeight: '18px' },
  recordBubble: { maxWidth: '100%', padding: '11px 12px 9px', border: '1px solid rgba(83,97,145,.045)', borderRadius: '16px 5px 16px 16px', background: colors.bubble, color: '#292c34', boxShadow: '0 1px 1px rgba(20,22,28,.015)' },
  recordSource: {
    display: 'flex', maxWidth: '100%', marginTop: 8, alignItems: 'center',
    justifyContent: 'flex-end', gap: 4, color: '#858b99',
    fontSize: 9, lineHeight: '14px', textAlign: 'right',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  recordSourceIcon: { width: 10, height: 10, flex: 'none', opacity: .72 },
  emptyDay: { marginTop: 92, display: 'grid', justifyItems: 'center', textAlign: 'center', color: '#6d727b' },
  emptyIcon: { marginBottom: 14, color: '#747b8a' },

}

function errorMessage(error: unknown): string {
  return error instanceof ArkmeClientError ? error.body.message : error instanceof Error ? error.message : String(error)
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function monthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function dateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function monthLabel(date: Date): string {
  return `${String(date.getFullYear())}年${String(date.getMonth() + 1)}月`
}

function sameDay(left: Date, right: Date): boolean {
  return dateKey(left) === dateKey(right)
}

function selectedDayLabel(date: Date, today: Date): string {
  const suffix = sameDay(date, today) ? ' · 今天' : ''
  return `${monthLabel(date)}${String(date.getDate())}日${suffix}`
}

function timeLabel(value: number): string {
  return Number.isFinite(value) && value > 0
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
    : ''
}

function calendarCells(month: Date): Array<Date | undefined> {
  const first = monthStart(month)
  const blanks = (first.getDay() + 6) % 7
  const count = monthEnd(month).getDate()
  return [
    ...Array.from({ length: blanks }, () => undefined),
    ...Array.from({ length: count }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
  ]
}

function sameMonth(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

export function ArkmeCalendarMonthView({
  visibleMonth, selectedDate, today, days, loading, error, onVisibleMonthChange, onSelectDate,
}: {
  visibleMonth: Date
  selectedDate: Date
  today: Date
  days: readonly ArkmeCalendarBucketDay[]
  loading: boolean
  error: string
  onVisibleMonthChange(month: Date): void
  onSelectDate(date: Date): void
}) {
  const calendarByDay = useMemo(() => new Map(days.map(day => [day.bucketDate, day])), [days])
  const canGoNext = !sameMonth(visibleMonth, today) && visibleMonth < monthStart(today)
  const canJumpToday = !sameDay(selectedDate, today) || !sameMonth(visibleMonth, today)
  const chooseDate = (date: Date) => {
    const normalized = startOfLocalDay(date)
    onSelectDate(normalized)
    if (!sameMonth(normalized, visibleMonth)) onVisibleMonthChange(monthStart(normalized))
  }

  return <>
    <header style={styles.header}>
      <div style={styles.navCluster}>
        <button data-arkme-feedback="neutral" type="button" aria-label="上个月" title="上个月" style={styles.iconButton}
          onClick={() => onVisibleMonthChange(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>
          <CaretRight size={16} style={styles.caretLeft} aria-hidden />
        </button>
        <button data-arkme-feedback="neutral" type="button" aria-label="下个月" title="下个月" disabled={!canGoNext}
          style={{ ...styles.iconButton, ...(!canGoNext ? styles.navDisabled : {}) }}
          onClick={() => { if (canGoNext) onVisibleMonthChange(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)) }}>
          <CaretRight size={16} aria-hidden />
        </button>
      </div>
      <h2 style={styles.monthTitle}>{monthLabel(visibleMonth)}</h2>
      <button data-arkme-feedback="neutral" type="button" disabled={!canJumpToday}
        style={{ ...styles.todayButton, ...(!canJumpToday ? styles.todayDisabled : {}) }}
        onClick={() => { onVisibleMonthChange(monthStart(today)); chooseDate(today) }}>
        回到今日
      </button>
    </header>
    <div style={styles.week}>{['一', '二', '三', '四', '五', '六', '日'].map(label => <span key={label} style={styles.weekDay}>{label}</span>)}</div>
    <div style={{ ...styles.days, opacity: loading && days.length === 0 ? .55 : 1 }}>
      {calendarCells(visibleMonth).map((date, index) => {
        if (date === undefined) return <span key={`blank:${String(index)}`} style={styles.blank} />
        const key = dateKey(date)
        const disabled = date > today
        const meta = calendarByDay.get(key)
        return <ArkmeCalendarCell
          key={key}
          date={date}
          {...(meta === undefined ? {} : { meta })}
          selected={key === dateKey(selectedDate)}
          disabled={disabled}
          onClick={() => { if (!disabled) chooseDate(date) }}
        />
      })}
    </div>
    {(error !== '' || loading) && <div style={{ ...styles.status, ...(error !== '' ? styles.error : {}) }} role={error !== '' ? 'alert' : 'status'}>
      {error || (days.length === 0 ? '正在加载…' : '正在更新…')}
    </div>}
  </>
}

function useCalendarDateInvalidation(date: string): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => arkmeCalendarInvalidations.subscribeDate(date, () => {
    setRevision(value => value + 1)
  }), [date])
  return revision
}

interface ScopedResource<T> {
  scope: string
  value?: T
}

type CalendarIndex = CalendarMonthSnapshot & { retry(): void; notice?: string; incomplete?: boolean; retryNotice?: (() => void) | undefined }

/** A single month in the shared scrolling calendar; self/topic months load only near the viewport. */
function ScrollingCalendarMonth({ month, today, selectedDate, sourceRef, scopeKey, accountScope, timezone, index, initial, scrollRoot, onSelect, onNavigate, firstMonth }: {
  month: Date; today: Date; selectedDate: Date; sourceRef?: string | undefined; scopeKey?: string | undefined; accountScope?: string | undefined
  timezone: string; index?: CalendarIndex | undefined; initial: boolean; scrollRoot: RefObject<HTMLDivElement>
  onSelect(date: Date, day?: ArkmeCalendarBucketDay): void
  onNavigate(month: Date): void; firstMonth: string
}) {
  const element = useRef<HTMLElement>(null)
  const [editingMonth, setEditingMonth] = useState(false)
  const [visible, setVisible] = useState(initial)
  useEffect(() => { if (initial) setVisible(true) }, [initial])
  useEffect(() => {
    if (index || visible || !element.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { root: scrollRoot.current, rootMargin: '60px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [index, visible, scrollRoot])
  const loaded = useCalendarMonth({ scopeKey: scopeKey ?? sourceRef ?? 'global', ...(sourceRef ? { sourceRef } : {}),
    startDate: dateKey(monthStart(month)), endDate: dateKey(monthEnd(month)), timezone }, !index && visible, accountScope)
  const resource = index ?? loaded
  const byDay = new Map(resource.value?.days.map(day => [day.bucketDate, day]))
  const known = resource.value !== undefined
  return <section ref={element} aria-label={monthLabel(month)} data-calendar-month={dateKey(month).slice(0, 7)} style={{ paddingBottom: 12 }}>
    <h3 style={{ ...styles.monthTitle, margin: '8px 2px', height: 24, color: colors.secondary }}>
      {editingMonth ? <input autoFocus aria-label="跳转月份" type="month" min={firstMonth} max={dateKey(today).slice(0, 7)}
        defaultValue={dateKey(month).slice(0, 7)} style={{ height: 24, boxSizing: 'border-box', border: 0, padding: 0,
          background: 'transparent', color: 'inherit', font: 'inherit', maxWidth: '100%' }}
        onBlur={() => setEditingMonth(false)} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); setEditingMonth(false) }
        }} onChange={event => {
          if (/^\d{4}-\d{2}$/.test(event.target.value)) {
            onNavigate(new Date(`${event.target.value}-01T00:00:00`)); setEditingMonth(false)
          }
        }} /> : <button type="button" data-arkme-feedback="neutral" aria-label={`跳转月份：${monthLabel(month)}`}
        title="跳转年月" onClick={() => setEditingMonth(true)} style={{ height: 24, padding: '0 3px', marginLeft: -3,
          border: 0, borderRadius: 5, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
        {monthLabel(month)}
      </button>}
    </h3>
    <div style={styles.days}>{calendarCells(month).map((date, i) => {
      if (!date) return <span key={i} style={styles.blank} />
      const day = byDay.get(dateKey(date))
      return <ArkmeCalendarCell key={dateKey(date)} date={date} {...(day ? { meta: day } : {})}
        selected={sameDay(date, selectedDate)} disabled={date > today || !known || (index !== undefined && !day?.hasRecords)}
        today={sameDay(date, today)} showCountLabel unknown={!known} incomplete={index?.incomplete}
        onClick={() => onSelect(date, day)} />
    })}</div>
    {!index && (resource.loading || resource.error) && <div style={styles.status} role={resource.error ? 'alert' : 'status'}>
      {resource.error || (known ? '正在更新…' : '正在加载…')}
      {resource.error && <button type="button" style={styles.retryButton} data-arkme-feedback="neutral" onClick={resource.retry}>重试</button>}
    </div>}
  </section>
}

export function ArkmeCalendarMultiMonthView({ today, selectedDate, sourceRef, scopeKey, accountScope, timezone, index, onSelect }: {
  today: Date; selectedDate: Date; sourceRef?: string | undefined; scopeKey?: string | undefined; accountScope?: string | undefined
  timezone: string; index?: CalendarIndex | undefined; onSelect(date: Date, day?: ArkmeCalendarBucketDay): void
}) {
  const selectedKey = dateKey(selectedDate)
  const monthNumber = (date: Date) => date.getFullYear() * 12 + date.getMonth()
  const monthDate = (month: number) => new Date(Math.floor(month / 12), month % 12, 1)
  const firstDate = index?.value?.days[0]?.bucketDate
  const earliest = firstDate ? monthNumber(new Date(`${firstDate.slice(0, 7)}-01T00:00:00`)) : 1970 * 12
  const latest = monthNumber(today)
  const clampMonth = (month: number) => Math.max(earliest, Math.min(latest, month))
  const readingMonth = clampMonth(monthNumber(selectedDate))
  // Reading position, visible heading and mounted range are deliberately independent.
  // Keep a newer neighbour even when opening old history; both ends grow on demand.
  const [range, setRange] = useState(() => ({ start: readingMonth - 1, end: readingMonth + 1 }))
  const [visibleMonth, setVisibleMonth] = useState(readingMonth)
  const [positionTarget, setPositionTarget] = useState<{ month: number; day?: string }>({ month: readingMonth, day: selectedKey })
  const positionedTarget = useRef<typeof positionTarget>()
  const scrollRoot = useRef<HTMLDivElement>(null)
  const prependPosition = useRef<{ height: number; top: number }>()
  const programmedTop = useRef<number>()
  const extending = useRef(false)
  const initialized = useRef(false)
  const browsedMonths = useRef(false)
  useLayoutEffect(() => {
    // An asynchronously loaded index may supply a fallback date, but must not interrupt manual browsing.
    if (!browsedMonths.current) {
      setRange({ start: readingMonth - 1, end: readingMonth + 1 })
      setVisibleMonth(readingMonth)
      setPositionTarget({ month: readingMonth, day: selectedKey })
    }
  }, [selectedKey, readingMonth])
  const start = clampMonth(range.start), end = clampMonth(range.end)
  const months = Array.from({ length: end - start + 1 }, (_, i) => monthDate(start + i))
  useLayoutEffect(() => {
    const root = scrollRoot.current
    if (!root) return
    if (prependPosition.current !== undefined) {
      root.scrollTop = prependPosition.current.top + root.scrollHeight - prependPosition.current.height
      prependPosition.current = undefined
      programmedTop.current = root.scrollTop
    } else if (positionedTarget.current !== positionTarget) {
      const selected = positionTarget.day && root.querySelector<HTMLElement>(`[data-calendar-date="${positionTarget.day}"]`)
      const target = selected || root.querySelector<HTMLElement>(`[data-calendar-month="${dateKey(monthDate(positionTarget.month)).slice(0, 7)}"]`)
      if (target) {
        root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top
          - (selected ? (root.clientHeight - target.getBoundingClientRect().height) / 2 : 0)
        programmedTop.current = root.scrollTop
        positionedTarget.current = positionTarget
      }
    }
    extending.current = false
    initialized.current = true
  }, [start, end, positionTarget, firstDate])
  const older = () => {
    const root = scrollRoot.current
    if (!root || start <= earliest || extending.current) return
    extending.current = true
    prependPosition.current = { height: root.scrollHeight, top: root.scrollTop }
    setRange({ start: Math.max(earliest, start - 3), end })
  }
  const move = (value: Date) => {
    const month = clampMonth(monthNumber(value))
    browsedMonths.current = true
    prependPosition.current = undefined
    setVisibleMonth(month)
    setPositionTarget({ month })
    // Nearby navigation preserves mounted months; distant jumps use a small window and cached data.
    setRange(month >= start - 1 && month <= end + 1
      ? { start: Math.min(start, month - 1), end: Math.max(end, month + 1) }
      : { start: month - 1, end: month + 1 })
  }
  const scroll = (root: HTMLDivElement) => {
    if (!initialized.current || extending.current || root.clientHeight <= 0) return
    if (programmedTop.current === root.scrollTop) { programmedTop.current = undefined; return }
    programmedTop.current = undefined
    browsedMonths.current = true
    const viewport = root.getBoundingClientRect()
    let mostVisible = 0, month = visibleMonth
    for (const section of root.querySelectorAll<HTMLElement>('[data-calendar-month]')) {
      const rect = section.getBoundingClientRect()
      const visible = Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top))
      if (visible > mostVisible) {
        mostVisible = visible
        month = monthNumber(new Date(`${section.dataset.calendarMonth}-01T00:00:00`))
      }
    }
    if (mostVisible > 0) setVisibleMonth(month)
    if (root.scrollTop < 120 && start > earliest) older()
    else if (root.scrollHeight - root.scrollTop - root.clientHeight < 120 && end < latest) {
      extending.current = true
      setRange({ start, end: Math.min(latest, end + 3) })
    }
  }
  useEffect(() => {
    const root = scrollRoot.current
    if (!root) return
    // A taller viewport can expose more than the initial month window. Fill it without a full history scan.
    const fill = () => {
      if (root.clientHeight > 0 && root.scrollHeight <= root.clientHeight + 60 && start > earliest) older()
    }
    fill()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fill)
    observer.observe(root)
    return () => observer.disconnect()
  }, [start, end, earliest])
  return <>
    <div style={{ ...styles.week, marginTop: 0, flexShrink: 0 }}>{['一', '二', '三', '四', '五', '六', '日'].map(label => <span key={label} style={styles.weekDay}>{label}</span>)}</div>
    {index && (index.loading || index.error) && <div role={index.error ? 'alert' : 'status'} style={styles.status}>
      {index.error || (index.value ? '正在更新…' : '正在加载日历…')}
      {index.error && <button type="button" style={styles.retryButton} data-arkme-feedback="neutral" onClick={index.retry}>重试</button>}
    </div>}
    {index?.notice && <div role="status" style={styles.status}>{index.notice}
      {index.retryNotice && <button type="button" style={styles.retryButton} data-arkme-feedback="neutral" onClick={index.retryNotice}>重试互动</button>}
    </div>}
    {index?.value && !index.value.days.length && !index.incomplete ? <div style={styles.status}>暂无聊天记录</div> : <div ref={scrollRoot}
      data-arkme-calendar-months data-visible-month={dateKey(monthDate(clampMonth(visibleMonth))).slice(0, 7)}
      style={{ flex: 1, overflowY: 'auto', overflowAnchor: 'none', minHeight: 0, overscrollBehavior: 'contain' }}
      onWheel={() => { programmedTop.current = undefined; browsedMonths.current = true }}
      onPointerDown={() => { programmedTop.current = undefined; browsedMonths.current = true }}
      onKeyDown={() => { programmedTop.current = undefined; browsedMonths.current = true }}
      onScroll={event => scroll(event.currentTarget)}>
      {start > earliest && <button type="button" data-arkme-feedback="neutral" style={{ ...styles.todayButton, width: '100%' }} onClick={older}>更早月份</button>}
      {months.map(month => <ScrollingCalendarMonth key={dateKey(month)} month={month} today={today} selectedDate={selectedDate}
        sourceRef={sourceRef} scopeKey={scopeKey} accountScope={accountScope} timezone={timezone} index={index}
        initial={monthNumber(month) === visibleMonth} scrollRoot={scrollRoot} onSelect={onSelect}
        firstMonth={dateKey(monthDate(earliest)).slice(0, 7)} onNavigate={move} />)}
    </div>}
  </>
}

/** Mounted for each opening: the conversation's actual position, never an uncompleted date click, owns selection. */
function ConversationCalendarMonths({ getReadingDate, ...props }: Omit<Parameters<typeof ArkmeCalendarMultiMonthView>[0], 'selectedDate'> & {
  getReadingDate?: (() => string | undefined) | undefined
}) {
  const [readingDate] = useState(() => getReadingDate?.())
  const date = readingDate ?? props.index?.value?.days.at(-1)?.bucketDate ?? dateKey(props.today)
  return <ArkmeCalendarMultiMonthView {...props} selectedDate={new Date(`${date}T00:00:00`)} />
}

export function ArkmeSelfCalendarPopover({
  open, anchor, sourceRef, scopeKey, accountScope, onClose, onSelectRecord, onSelectDate, index, getReadingDate,
}: {
  open: boolean
  anchor: RefObject<HTMLButtonElement>
  sourceRef?: string
  scopeKey?: string
  accountScope?: string | undefined
  onClose(): void
  onSelectRecord(item: ArkmeCalendarRecordItem): void
  onSelectDate?(selection: SelfCalendarDateSelection): void
  index?: CalendarIndex
  getReadingDate?: (() => string | undefined) | undefined
}) {
  const today = useMemo(() => startOfLocalDay(new Date()), [])
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local', [])
  const panel = useRef<HTMLElement>(null)
  const { layout, resizing, resizeProps } = useCalendarPopoverLayout(open, anchor, panel, accountScope)
  const [selectionStatus, setSelectionStatus] = useState('')
  const selectionControllerRef = useRef<AbortController>()

  useEffect(() => {
    if (open) return
    selectionControllerRef.current?.abort()
    selectionControllerRef.current = undefined
    setSelectionStatus('')
  }, [open])
  useEffect(() => () => { selectionControllerRef.current?.abort() }, [sourceRef])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open, onClose])

  const selectDate = async (date: Date, day?: ArkmeCalendarBucketDay) => {
    const normalized = startOfLocalDay(date)
    const key = dateKey(normalized)
    selectionControllerRef.current?.abort()
    if ((day?.count ?? 0) <= 0) {
      setSelectionStatus('这一天没有发给自己的记录')
      return
    }
    if (index && !day?.anchor && !day?.momentAnchor) { setSelectionStatus('当天定位信息暂不可用，请刷新日历后重试'); return }
    if (onSelectDate !== undefined) {
      onSelectDate({ bucketDate: key, timezone, ...(day?.anchor ? { anchor: day.anchor } : {}),
        ...(day?.momentAnchor ? { momentAnchor: day.momentAnchor } : {}) })
      onClose()
      return
    }
    const controller = new AbortController()
    selectionControllerRef.current = controller
    setSelectionStatus('正在定位这一天的记录…')
    try {
      const page = await callArkme<ArkmeCalendarDayRecordPage>('calendar.records', {
        ...(sourceRef === undefined ? {} : { sourceRef }),
        ...(sourceRef === undefined ? {} : { oldestFirst: true }),
        bucketDate: key,
        timezone,
        limit: 1,
      }, controller.signal)
      if (controller.signal.aborted) return
      const item = page.items[0]
      if (item === undefined) {
        setSelectionStatus('这一天没有可查看的记录')
        return
      }
      setSelectionStatus('')
      onClose()
      onSelectRecord(item)
    } catch (caught) {
      if (!controller.signal.aborted) setSelectionStatus(errorMessage(caught) || '暂时无法定位这一天的记录')
    } finally {
      if (selectionControllerRef.current === controller) selectionControllerRef.current = undefined
    }
  }

  if (!open || typeof document === 'undefined') return null
  return createPortal(<>
    <button type="button" aria-label={index ? '关闭会话日历' : '关闭发给自己日历'} onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 299, width: '100%', height: '100%', padding: 0,
      border: 0, background: 'transparent', cursor: 'default',
    }} />
    <section ref={panel} role="dialog" aria-label={index ? '会话日历' : '发给自己日历'} style={{
      ...styles.calendarCard,
      position: 'fixed', top: layout.top, left: layout.left, height: layout.height, zIndex: 300,
      display: 'flex', flexDirection: 'column', paddingBottom: 20,
      maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100vh - 24px)', overflow: 'hidden',
    }}>
      <ConversationCalendarMonths
        key={`${accountScope ?? ''}:${scopeKey ?? sourceRef ?? ''}`}
        getReadingDate={getReadingDate}
        today={today}
        sourceRef={sourceRef} scopeKey={scopeKey} accountScope={accountScope} timezone={timezone} index={index}
        onSelect={(date, day) => { void selectDate(date, day) }}
      />
      {selectionStatus !== '' && <div role="status" style={{ ...styles.status, marginBottom: -6 }}>{selectionStatus}</div>}
      <div role="separator" aria-label="调整日历高度" aria-orientation="horizontal" tabIndex={0}
        aria-valuemin={Math.min(CALENDAR_MIN_HEIGHT, layout.maxHeight)} aria-valuemax={layout.maxHeight}
        aria-valuenow={layout.height} aria-valuetext={`${Math.round(layout.height)} 像素`}
        title="拖动调整高度，方向键也可调整" data-arkme-calendar-resize data-resizing={resizing || undefined}
        {...resizeProps} style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 18,
          display: 'grid', placeItems: 'center', borderRadius: 8, cursor: 'ns-resize', touchAction: 'none', userSelect: 'none' }}>
        <span aria-hidden style={{ width: 28, height: 3, borderRadius: 3, background: colors.tertiary, opacity: resizing ? .8 : .35 }} />
      </div>
    </section>
  </>, document.body)
}

export function arkmeCalendarRecordSourceLabel(item: ArkmeCalendarRecordItem): string {
  if (isDshAgentInputCreationSource(item)) return ARKME_DSH_AGENT_INPUT_LABEL
  return ''
}

export function arkmeCalendarRecordIsDSHAgentInput(item: ArkmeCalendarRecordItem): boolean {
  return isDshAgentInputCreationSource(item)
}

function calendarTimelineItem(item: ArkmeCalendarRecordItem, avatarRef?: string): ArkmeTimelineItem {
  return { ...(item.content ?? {
    itemUid: item.recordUid, senderName: '你', isMe: true, status: 1,
    sendAtMillis: item.sendAtMillis, title: item.title, textContent: item.textContent || item.preview,
    templateKind: item.templateKind, displayKind: item.displayKind,
    ...(item.textFormat === undefined ? {} : { textFormat: item.textFormat }),
  }), ...(avatarRef === undefined ? {} : { avatarRef }) }
}

function CalendarSourceBadge({ item, onSelect }: { item: ArkmeCalendarRecordItem; onSelect(source: NonNullable<ArkmeCalendarRecordItem['source']>): void }) {
  // DSH inputs use the shared origin marker, not a personal-topic navigation.
  if (isDshAgentInputCreationSource(item)) return null
  const title = item.topicTitle?.trim() || item.source?.displayName.trim() || (item.sourceKind === 'chat' ? '会话来源暂不可用' : '')
  if (title === '') return null
  return <button data-arkme-feedback="neutral" type="button" style={{ ...styles.topicBadge, background: 'transparent', cursor: item.source ? 'pointer' : 'default', textAlign: 'left' }}
    aria-label={`来源：${title}`} disabled={item.source === undefined}
    onClick={event => { event.stopPropagation(); if (item.source !== undefined) onSelect(item.source) }}>
    {item.source !== undefined && item.source.kind !== 'topic' ? <ArkmeDirectorySourceAvatar source={item.source} size={16} />
      : item.sourceKind === 'chat' && !item.topicTitle ? <ChatCircle size={14} aria-hidden /> : <NotePencil size={14} aria-hidden />}
    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
    {item.source !== undefined && <CaretRight size={12} aria-hidden style={{ flex: 'none' }} />}
  </button>
}

function RecordRow({ item, avatarRef, onOpen, onSelectSource }: { item: ArkmeCalendarRecordItem; avatarRef?: string; onOpen(): void; onSelectSource(source: NonNullable<ArkmeCalendarRecordItem['source']>): void }) {
  const sourceLabel = arkmeCalendarRecordSourceLabel(item)
  return <article style={styles.recordRow}>
    <div style={styles.recordStack}>
      <div style={styles.recordHeader}>
        <h3 style={styles.recordTitle}>你</h3>
        <time style={styles.recordTime}>{timeLabel(item.sendAtMillis)}</time>
      </div>
      <div style={{ ...styles.recordBubble, cursor: 'pointer' }} tabIndex={0} role="button" aria-label="打开快记详情"
        onKeyDown={event => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault(); onOpen()
        }} onClick={event => {
        const control = (event.target as HTMLElement).closest('button, a, input, audio, video, [role="button"]')
        if (control !== null && control !== event.currentTarget) return
        if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
        onOpen()
      }}>
        <ArkmeMessageContent item={calendarTimelineItem(item, avatarRef)} onArticleOpen={onOpen} onCallDetailOpen={onOpen} />

        <CalendarSourceBadge item={item} onSelect={onSelectSource} />
        {sourceLabel === '' ? null : <ArkmeDshAgentInputMarker
          style={styles.recordSource}
          iconStyle={styles.recordSourceIcon}
        />}
      </div>
    </div>
    <ArkmeUserAvatar {...(avatarRef === undefined || avatarRef === '' ? {} : { avatarRef })} size={30} label="当前用户头像" />
  </article>
}

export function ArkmeCalendarCell({
  date, meta, selected, disabled, onClick, today, showCountLabel, unknown, incomplete,
}: {
  date: Date
  meta?: ArkmeCalendarBucketDay
  selected: boolean
  disabled: boolean
  onClick(): void
  today?: boolean
  showCountLabel?: boolean
  unknown?: boolean
  incomplete?: boolean | undefined
}) {
  const count = meta?.count ?? 0
  const breakdown = meta?.conversationCounts
  const tooltip = breakdown ? [breakdown.messages > 0 ? `私聊 ${breakdown.messages} 条` : '',
    breakdown.interactions > 0 ? `群聊互动 ${breakdown.interactions} 条` : ''].filter(Boolean).join(' · ') : ''
  return <button data-arkme-feedback={selected ? 'primary' : 'neutral'}
    type="button"
    aria-label={`${dateKey(date)} ${unknown ? '待加载' : count > 0 ? `${incomplete ? '已知 ' : ''}${String(count)} 条记录` : incomplete ? '暂无已加载记录' : '暂无记录'}`}
    title={tooltip || undefined}
    data-selected={selected ? 'true' : 'false'}
    data-calendar-date={dateKey(date)}
    aria-current={today ? 'date' : undefined}
    disabled={disabled}
    style={{
      ...styles.dayButton,
      ...(showCountLabel && count > 0 ? { background: colors.bubble } : {}),
      ...(today ? { borderColor: colors.selected } : {}),
      ...(disabled ? styles.dayDisabled : {}),
      ...(selected ? styles.daySelected : {}),
    }}
    onClick={onClick}
  >
    <span style={styles.dayNumber}>{date.getDate()}</span>
    <span style={{ ...styles.dayCount, ...(count > 0 ? styles.dayCountPopulated : {}), ...(selected ? styles.selectedDayCount : {}) }}>{count > 0 ? `${count}${showCountLabel ? '条' : ''}` : ''}</span>
  </button>
}

export function ArkmeCalendarSurface({
  onClose, anchor = 'directory', accountScope,
}: { onClose?: () => void; anchor?: 'directory' | 'product-rail'; accountScope?: string | undefined } = {}) {
  const today = useMemo(() => startOfLocalDay(new Date()), [])
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local', [])
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [selectedRecord, setSelectedRecord] = useState<{ scope: string; uid: string }>()
  const [showOriginal, setShowOriginal] = useState(false)
  const visibleMonthStartKey = dateKey(monthStart(visibleMonth))
  const visibleMonthEndKey = dateKey(monthEnd(visibleMonth))
  const selectedDateKey = dateKey(selectedDate)
  const recordsScope = `${timezone}:${selectedDateKey}`
  const dateInvalidationRevision = useCalendarDateInvalidation(selectedDateKey)
  const month = useCalendarMonth({ scopeKey: 'global', timezone,
    startDate: visibleMonthStartKey, endDate: visibleMonthEndKey }, true, accountScope)
  const [recordsResource, setRecordsResource] = useState<ScopedResource<ArkmeCalendarDayRecordPage>>(() => ({ scope: recordsScope }))
  const calendarLoading = month.loading
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const calendarError = month.error
  const [recordsError, setRecordsError] = useState('')
  const [userProfile, setUserProfile] = useState<ArkmeUserProfile | null>(null)
  const loadMoreController = useRef<AbortController>()
  const listRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinel = useRef<HTMLDivElement>(null)
  const loadMoreArmed = useRef(true)
  const calendar = month.value
  const records = recordsResource.scope === recordsScope ? recordsResource.value : undefined

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, controller.signal)
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, controller.signal)
        : snapshot)
      .then(snapshot => { if (active) setUserProfile(snapshot.profile) })
      .catch(() => undefined)
    return () => { active = false; controller.abort() }
  }, [])


  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadMoreController.current?.abort()
    loadMoreController.current = undefined
    setLoadingMore(false)
    loadMoreArmed.current = true
    setRecordsResource(current => current.scope === recordsScope ? current : { scope: recordsScope })
    setRecordsLoading(true); setRecordsError('')
    void callArkme<ArkmeCalendarDayRecordPage>('calendar.records', {
      bucketDate: selectedDateKey,
      timezone,
      limit: 20,
    }, controller.signal)
      .then(value => { if (active) setRecordsResource({ scope: recordsScope, value }) })
      .catch(caught => { if (active && !controller.signal.aborted) setRecordsError(errorMessage(caught)) })
      .finally(() => { if (active) setRecordsLoading(false) })
    return () => { active = false; controller.abort() }
  }, [dateInvalidationRevision, recordsScope, selectedDateKey, timezone])

  useEffect(() => () => {
    const controller = loadMoreController.current
    loadMoreController.current = undefined
    controller?.abort()
  }, [])

  const recordItems = records?.items ?? []
  const selectedItem = selectedRecord?.scope === recordsScope && detailsOpen
    ? recordItems.find(item => item.recordUid === selectedRecord.uid) : undefined
  const detailItem = selectedItem === undefined ? undefined : calendarTimelineItem(selectedItem, userProfile?.avatarRef)

  const chooseDate = (date: Date) => {
    const normalized = startOfLocalDay(date)
    setSelectedRecord(undefined)
    setSelectedDate(normalized)
    setDetailsOpen(true)
    if (!sameMonth(normalized, visibleMonth)) setVisibleMonth(monthStart(normalized))
  }

  const loadMore = useCallback(async () => {
    if (records?.hasMore !== true || records.nextCursor === undefined || recordsLoading || recordsError !== '' || loadingMore || loadMoreController.current !== undefined) return
    const controller = new AbortController()
    const requestScope = recordsScope
    loadMoreController.current = controller
    setLoadingMore(true); setRecordsError('')
    try {
      const next = await callArkme<ArkmeCalendarDayRecordPage>('calendar.records', {
        bucketDate: selectedDateKey,
        timezone,
        limit: 20,
        cursor: records.nextCursor,
      }, controller.signal)
      if (controller.signal.aborted) return
      setRecordsResource(current => {
        if (current.scope !== requestScope) return current
        return {
          scope: requestScope,
          value: current.value === undefined ? next : {
            ...next,
            items: [...current.value.items, ...next.items],
          },
        }
      })
    } catch (caught) {
      if (!controller.signal.aborted) setRecordsError(errorMessage(caught))
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = undefined
        setLoadingMore(false)
      }
    }
  }, [records, recordsLoading, recordsError, loadingMore, recordsScope, selectedDateKey, timezone])

  useEffect(() => {
    const root = listRef.current
    const target = loadMoreSentinel.current
    if (!detailsOpen || selectedItem !== undefined || root === null || target === null || recordsLoading || loadingMore
      || recordsError !== '' || records?.hasMore !== true || records.nextCursor === undefined
      || typeof IntersectionObserver === 'undefined') return
    let active = true
    const observer = new IntersectionObserver(entries => {
      if (!active) return
      if (!entries.some(entry => entry.isIntersecting)) { loadMoreArmed.current = true; return }
      if (!loadMoreArmed.current) return
      loadMoreArmed.current = false
      void loadMore()
    }, { root, rootMargin: '0px 0px 120px' })
    observer.observe(target)
    return () => { active = false; observer.disconnect() }
  }, [detailsOpen, selectedItem, records, recordsLoading, loadingMore, recordsError, loadMore])

  const selectSource = (source: NonNullable<ArkmeCalendarRecordItem['source']>) => {
    setSelectedRecord(undefined)
    onClose?.()
    arkmeUi.selectSource(source)
  }
  const sourceBadge = selectedItem === undefined ? undefined : <CalendarSourceBadge item={selectedItem} onSelect={selectSource} />

  return <div style={{
    ...styles.root,
    ...(anchor === 'product-rail' ? styles.productRailRoot : {}),
  }} aria-label="客户端日历">
    <button type="button" style={{
      ...styles.backdrop,
      ...(anchor === 'product-rail' ? styles.productRailBackdrop : {}),
    }} aria-label="关闭日历" onClick={() => {
      if (onClose === undefined) arkmeUi.showConversations()
      else onClose()
    }} />
    <div style={styles.layout}>
      <section style={{
        ...styles.calendarCard,
        ...(anchor === 'product-rail' ? styles.productRailCalendarCard : {}),
      }} aria-label="客户端日历">
        <span style={styles.calendarPointer} aria-hidden />
        <ArkmeCalendarMonthView
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          today={today}
          days={calendar?.days ?? []}
          loading={calendarLoading}
          error={calendarError}
          onVisibleMonthChange={setVisibleMonth}
          onSelectDate={chooseDate}
        />
      </section>
      {detailsOpen && <section style={styles.recordsPanel} aria-label="当天内容">
        <header style={styles.recordsHeader}>
          <h2 style={styles.recordsTitle}>{selectedDayLabel(selectedDate, today)}</h2>
          <button data-arkme-feedback="neutral" type="button" aria-label="刷新当天快记" disabled={recordsLoading} style={{ ...styles.iconButton, width: 'auto', fontSize: 12 }}
            onClick={() => arkmeCalendarInvalidations.publish({ dateKey: selectedDateKey })}>刷新</button>
          <button data-arkme-feedback="neutral" type="button" aria-label="关闭当天内容" title="关闭" style={styles.iconButton} onClick={() => { setDetailsOpen(false); setSelectedRecord(undefined) }}><X size={20} aria-hidden /></button>
        </header>
        {recordsError !== '' && <div style={{ ...styles.status, ...styles.error }} role="alert">{recordsError}</div>}
        {recordsError === '' && recordsLoading && records !== undefined && <div style={styles.loadingStatus} role="status">正在更新…</div>}
        <div key={recordsScope} ref={listRef} style={styles.list} aria-label="当天快记列表">
          {recordsLoading && records === undefined ? <div style={{ ...styles.loadingStatus, ...styles.initialLoading }} role="status">正在加载…</div>
            : recordsError !== '' && records === undefined ? null
            : recordItems.length === 0 ? <div style={styles.emptyDay}>
              <NotePencil size={23} style={styles.emptyIcon} aria-hidden />
              <strong>这一天还没有快记</strong>
            </div>
              : <ArkmeDirectoryWindow activeKey={selectedItem?.recordUid}>{recordItems.map(item => <RecordRow key={item.recordUid} item={item}
                onOpen={() => { setSelectedRecord({ scope: recordsScope, uid: item.recordUid }); setShowOriginal(false) }} onSelectSource={selectSource}
                {...(userProfile?.avatarRef === undefined ? {} : { avatarRef: userProfile.avatarRef })} />)}</ArkmeDirectoryWindow>}
          {records?.hasMore === true && records.nextCursor !== undefined && <div ref={loadMoreSentinel} style={{ minHeight: 1 }}>
            {loadingMore && <div style={styles.loadingStatus} role="status">加载中…</div>}
          </div>}
        </div>
      </section>}
      {detailItem !== undefined && <div style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(394px, 100%)', pointerEvents: 'auto' }}>
          {detailItem.forwardRecords !== undefined
            ? <ForwardRecordsDetail sourceBadge={sourceBadge} item={detailItem} onClose={() => setSelectedRecord(undefined)} />
            : <ArkmeTimelineDetailDrawer sourceBadge={sourceBadge} key={detailItem.itemUid} item={detailItem} canExtend={false}
              showOriginal={showOriginal} onToggleOriginal={() => setShowOriginal(value => !value)}
              onClose={() => setSelectedRecord(undefined)} />}
        </div>
      </div>}
    </div>
  </div>
}
