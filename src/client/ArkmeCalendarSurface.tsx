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
import {
  ARKME_DSH_AGENT_INPUT_LABEL,
  ArkmeDshAgentInputMarker,
  isDshAgentInputCreationSource,
} from './ArkmeDshAgentInputMarker.js'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'
import { useCalendarMonth } from './use-calendar-month.js'
import { arkmeUi } from './ui-controller.js'

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
    position: 'fixed', top: 0, right: 0, bottom: 0, left: 72, zIndex: 60,
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
        <button type="button" aria-label="上个月" title="上个月" style={styles.iconButton}
          onClick={() => onVisibleMonthChange(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>
          <CaretRight size={16} style={styles.caretLeft} aria-hidden />
        </button>
        <button type="button" aria-label="下个月" title="下个月" disabled={!canGoNext}
          style={{ ...styles.iconButton, ...(!canGoNext ? styles.navDisabled : {}) }}
          onClick={() => { if (canGoNext) onVisibleMonthChange(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)) }}>
          <CaretRight size={16} aria-hidden />
        </button>
      </div>
      <h2 style={styles.monthTitle}>{monthLabel(visibleMonth)}</h2>
      <button type="button" disabled={!canJumpToday}
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

export function ArkmeSelfCalendarPopover({
  open, anchor, sourceRef, scopeKey, accountScope, onClose, onSelectRecord,
}: {
  open: boolean
  anchor: RefObject<HTMLButtonElement>
  sourceRef?: string
  scopeKey?: string
  accountScope?: string | undefined
  onClose(): void
  onSelectRecord(item: ArkmeCalendarRecordItem): void
}) {
  const today = useMemo(() => startOfLocalDay(new Date()), [])
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local', [])
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [position, setPosition] = useState({ top: 52, left: 12 })
  const [selectionStatus, setSelectionStatus] = useState('')
  const visibleMonthStartKey = dateKey(monthStart(visibleMonth))
  const visibleMonthEndKey = dateKey(monthEnd(visibleMonth))
  const month = useCalendarMonth({ scopeKey: scopeKey ?? sourceRef ?? 'global',
    ...(sourceRef ? { sourceRef } : {}), timezone, startDate: visibleMonthStartKey, endDate: visibleMonthEndKey }, open, accountScope)
  const calendar = month.value
  const calendarLoading = month.loading
  const calendarError = month.error
  const selectionControllerRef = useRef<AbortController>()

  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') return
    const updatePosition = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (rect === undefined) return
      const width = 354
      const estimatedHeight = 392
      const viewportPadding = 12
      const left = Math.max(viewportPadding, Math.min(window.innerWidth - width - viewportPadding, rect.right - width))
      const below = rect.bottom + 8
      const top = below + estimatedHeight <= window.innerHeight - viewportPadding
        ? below
        : Math.max(viewportPadding, rect.top - estimatedHeight - 8)
      setPosition({ top, left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchor, open])


  useEffect(() => {
    if (open) return
    selectionControllerRef.current?.abort()
    selectionControllerRef.current = undefined
    setSelectionStatus('')
  }, [open])
  useEffect(() => () => { selectionControllerRef.current?.abort() }, [sourceRef])

  const selectDate = async (date: Date) => {
    const normalized = startOfLocalDay(date)
    const key = dateKey(normalized)
    setSelectedDate(normalized)
    selectionControllerRef.current?.abort()
    if ((calendar?.days.find(day => day.bucketDate === key)?.count ?? 0) <= 0) {
      setSelectionStatus('这一天没有发给自己的记录')
      return
    }
    const controller = new AbortController()
    selectionControllerRef.current = controller
    setSelectionStatus('正在定位这一天的记录…')
    try {
      const page = await callArkme<ArkmeCalendarDayRecordPage>('calendar.records', {
        ...(sourceRef === undefined ? {} : { sourceRef }),
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
    <button data-arkme-hover="none" type="button" aria-label="关闭发给自己日历" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 299, width: '100%', height: '100%', padding: 0,
      border: 0, background: 'transparent', cursor: 'default',
    }} />
    <section aria-label="发给自己日历" style={{
      ...styles.calendarCard,
      position: 'fixed', top: position.top, left: position.left, zIndex: 300,
    }}>
      <ArkmeCalendarMonthView
        visibleMonth={visibleMonth}
        selectedDate={selectedDate}
        today={today}
        days={calendar?.days ?? []}
        loading={calendarLoading}
        error={calendarError}
        onVisibleMonthChange={month => { setVisibleMonth(month); setSelectionStatus('') }}
        onSelectDate={date => { void selectDate(date) }}
      />
      {selectionStatus !== '' && <div role="status" style={{ ...styles.status, marginBottom: -6 }}>{selectionStatus}</div>}
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
  return <button type="button" style={{ ...styles.topicBadge, background: 'transparent', cursor: item.source ? 'pointer' : 'default', textAlign: 'left' }}
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
  date, meta, selected, disabled, onClick,
}: {
  date: Date
  meta?: ArkmeCalendarBucketDay
  selected: boolean
  disabled: boolean
  onClick(): void
}) {
  const count = meta?.count ?? 0
  return <button
    type="button"
    aria-label={`${dateKey(date)} ${count > 0 ? `${String(count)} 条记录` : '暂无记录'}`}
    data-selected={selected ? 'true' : 'false'}
    data-arkme-hover="button"
    disabled={disabled}
    style={{
      ...styles.dayButton,
      ...(disabled ? styles.dayDisabled : {}),
      ...(selected ? styles.daySelected : {}),
    }}
    onClick={onClick}
  >
    <span style={styles.dayNumber}>{date.getDate()}</span>
    <span style={{ ...styles.dayCount, ...(count > 0 ? styles.dayCountPopulated : {}), ...(selected ? styles.selectedDayCount : {}) }}>{count > 0 ? count : ''}</span>
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
    }} aria-label="关闭日历" data-arkme-hover="none" onClick={() => {
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
          <button type="button" aria-label="刷新当天快记" disabled={recordsLoading} style={{ ...styles.iconButton, width: 'auto', fontSize: 12 }}
            onClick={() => arkmeCalendarInvalidations.publish({ dateKey: selectedDateKey })}>刷新</button>
          <button type="button" aria-label="关闭当天内容" title="关闭" style={styles.iconButton} onClick={() => { setDetailsOpen(false); setSelectedRecord(undefined) }}><X size={20} aria-hidden /></button>
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
