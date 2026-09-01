import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type {
  ArkmeCalendarBucketDay,
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordItem,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import {
  ARKME_DSH_AGENT_INPUT_LABEL,
  ArkmeDshAgentInputMarker,
  isDshAgentInputCreationSource,
} from './ArkmeDshAgentInputMarker.js'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'
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
    minWidth: 15, padding: '0 4px', borderRadius: 8, background: '#f0f1f5', color: '#626878',
    transition: 'background 120ms ease, color 120ms ease',
  },
  selectedDayCount: { background: 'transparent', color: colors.selectedText, opacity: 1 },
  status: { marginTop: 10, minHeight: 18, color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  error: { color: colors.danger },
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
  recordText: {
    margin: 0, display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 5,
    WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere', color: '#292c34',
    fontSize: 12, lineHeight: '19.44px',
  },
  recordSource: {
    display: 'flex', maxWidth: '100%', marginTop: 8, alignItems: 'center',
    justifyContent: 'flex-end', gap: 4, color: '#858b99',
    fontSize: 9, lineHeight: '14px', textAlign: 'right',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  recordSourceIcon: { width: 10, height: 10, flex: 'none', opacity: .72 },
  emptyDay: { marginTop: 92, display: 'grid', justifyItems: 'center', textAlign: 'center', color: '#6d727b' },
  emptyIcon: { marginBottom: 14, color: '#747b8a' },
  loadMore: {
    alignSelf: 'center', marginTop: 4, minWidth: 92, height: 30, padding: '0 12px',
    border: `1px solid ${colors.border}`, borderRadius: 9, background: colors.panel,
    color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12,
  },
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

function useCalendarDateInvalidation(date: string): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => arkmeCalendarInvalidations.subscribeDate(date, () => {
    setRevision(value => value + 1)
  }), [date])
  return revision
}

function useCalendarMonthInvalidation(month: string): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => arkmeCalendarInvalidations.subscribeMonth(month, () => {
    setRevision(value => value + 1)
  }), [month])
  return revision
}

interface ScopedResource<T> {
  scope: string
  value?: T
}

export function arkmeCalendarRecordSourceLabel(item: ArkmeCalendarRecordItem): string {
  if (isDshAgentInputCreationSource(item)) return ARKME_DSH_AGENT_INPUT_LABEL
  return ''
}

export function arkmeCalendarRecordIsDSHAgentInput(item: ArkmeCalendarRecordItem): boolean {
  return isDshAgentInputCreationSource(item)
}

function RecordRow({ item, avatarRef }: { item: ArkmeCalendarRecordItem; avatarRef?: string }) {
  const sourceLabel = arkmeCalendarRecordSourceLabel(item)
  return <article style={styles.recordRow}>
    <div style={styles.recordStack}>
      <div style={styles.recordHeader}>
        <h3 style={styles.recordTitle}>你</h3>
        <time style={styles.recordTime}>{timeLabel(item.sendAtMillis)}</time>
      </div>
      <div style={styles.recordBubble}>
        <p style={styles.recordText}>{item.textContent || item.preview || '无文字内容'}</p>
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
  onClose, anchor = 'directory',
}: { onClose?: () => void; anchor?: 'directory' | 'product-rail' } = {}) {
  const today = useMemo(() => startOfLocalDay(new Date()), [])
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local', [])
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const visibleMonthStartKey = dateKey(monthStart(visibleMonth))
  const visibleMonthEndKey = dateKey(monthEnd(visibleMonth))
  const visibleMonthKey = visibleMonthStartKey.slice(0, 7)
  const selectedDateKey = dateKey(selectedDate)
  const calendarScope = `${timezone}:${visibleMonthKey}`
  const recordsScope = `${timezone}:${selectedDateKey}`
  const monthInvalidationRevision = useCalendarMonthInvalidation(visibleMonthKey)
  const dateInvalidationRevision = useCalendarDateInvalidation(selectedDateKey)
  const [calendarResource, setCalendarResource] = useState<ScopedResource<ArkmeCalendarBucketPage>>(() => ({ scope: calendarScope }))
  const [recordsResource, setRecordsResource] = useState<ScopedResource<ArkmeCalendarDayRecordPage>>(() => ({ scope: recordsScope }))
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [recordsError, setRecordsError] = useState('')
  const [userProfile, setUserProfile] = useState<ArkmeUserProfile | null>(null)
  const loadMoreController = useRef<AbortController>()
  const calendar = calendarResource.scope === calendarScope ? calendarResource.value : undefined
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
    setCalendarResource(current => current.scope === calendarScope ? current : { scope: calendarScope })
    setCalendarLoading(true); setCalendarError('')
    void callArkme<ArkmeCalendarBucketPage>('calendar.buckets', {
      startDate: visibleMonthStartKey,
      endDate: visibleMonthEndKey,
      timezone,
    }, controller.signal)
      .then(value => { if (active) setCalendarResource({ scope: calendarScope, value }) })
      .catch(caught => { if (active && !controller.signal.aborted) setCalendarError(errorMessage(caught)) })
      .finally(() => { if (active) setCalendarLoading(false) })
    return () => { active = false; controller.abort() }
  }, [calendarScope, monthInvalidationRevision, timezone, visibleMonthEndKey, visibleMonthStartKey])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadMoreController.current?.abort()
    loadMoreController.current = undefined
    setLoadingMore(false)
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

  const calendarByDay = useMemo(() => new Map((calendar?.days ?? []).map(day => [day.bucketDate, day])), [calendar])
  const canGoNext = !sameMonth(visibleMonth, today) && visibleMonth < monthStart(today)
  const canJumpToday = !sameDay(selectedDate, today) || !sameMonth(visibleMonth, today)
  const recordItems = records?.items ?? []

  const chooseDate = (date: Date) => {
    const normalized = startOfLocalDay(date)
    setSelectedDate(normalized)
    setDetailsOpen(true)
    if (!sameMonth(normalized, visibleMonth)) setVisibleMonth(monthStart(normalized))
  }

  const loadMore = async () => {
    if (records?.nextCursor === undefined || loadingMore || loadMoreController.current !== undefined) return
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
  }

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
        <header style={styles.header}>
          <div style={styles.navCluster}>
            <button type="button" aria-label="上个月" title="上个月" style={styles.iconButton} onClick={() => setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><CaretRight size={16} style={styles.caretLeft} aria-hidden /></button>
            <button type="button" aria-label="下个月" title="下个月" disabled={!canGoNext} style={{ ...styles.iconButton, ...(!canGoNext ? styles.navDisabled : {}) }} onClick={() => { if (canGoNext) setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1)) }}><CaretRight size={16} aria-hidden /></button>
          </div>
          <h2 style={styles.monthTitle}>{monthLabel(visibleMonth)}</h2>
          <button type="button" disabled={!canJumpToday} style={{ ...styles.todayButton, ...(!canJumpToday ? styles.todayDisabled : {}) }} onClick={() => { setVisibleMonth(monthStart(today)); setSelectedDate(today); setDetailsOpen(true) }}>回到今日</button>
        </header>
        <div style={styles.week}>{['一', '二', '三', '四', '五', '六', '日'].map(label => <span key={label} style={styles.weekDay}>{label}</span>)}</div>
        <div style={{ ...styles.days, opacity: calendarLoading ? .55 : 1 }}>
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
        {(calendarError !== '' || calendarLoading) && <div style={{ ...styles.status, ...(calendarError !== '' ? styles.error : {}) }} role={calendarError !== '' ? 'alert' : 'status'}>
          {calendarError || (calendar === undefined ? '正在加载…' : '正在更新…')}
        </div>}
      </section>
      {detailsOpen && <section style={styles.recordsPanel} aria-label="当天内容">
        <header style={styles.recordsHeader}>
          <h2 style={styles.recordsTitle}>{selectedDayLabel(selectedDate, today)}</h2>
          <button type="button" aria-label="关闭当天内容" title="关闭" style={styles.iconButton} onClick={() => setDetailsOpen(false)}><X size={20} aria-hidden /></button>
        </header>
        {recordsError !== '' && <div style={{ ...styles.status, ...styles.error }} role="alert">{recordsError}</div>}
        {recordsError === '' && recordsLoading && records !== undefined && <div style={styles.status} role="status">正在更新…</div>}
        <div style={styles.list}>
          {recordsLoading && records === undefined ? <div style={styles.status} role="status">正在加载…</div>
            : recordItems.length === 0 ? <div style={styles.emptyDay}>
              <NotePencil size={23} style={styles.emptyIcon} aria-hidden />
              <strong>这一天还没有快记</strong>
            </div>
              : recordItems.map(item => <RecordRow key={item.recordUid} item={item} {...(userProfile?.avatarRef === undefined ? {} : { avatarRef: userProfile.avatarRef })} />)}
          {records?.hasMore === true && records.nextCursor !== undefined && <button type="button" style={styles.loadMore} disabled={loadingMore} onClick={() => { void loadMore() }}>{loadingMore ? '加载中…' : '加载更多'}</button>}
        </div>
      </section>}
    </div>
  </div>
}
