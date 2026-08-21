import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type {
  ArkmeCalendarBucketDay,
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordItem,
} from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

const colors = {
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary,
  caption: arkmeTheme.caption,
  border: arkmeTheme.border,
  borderSoft: arkmeTheme.borderSoft,
  panel: arkmeTheme.base,
  layer: arkmeTheme.layer1,
  accent: arkmeTheme.accent,
  accentSoft: arkmeTheme.accentSoft,
  danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%', height: '100%', minHeight: 0, overflow: 'auto',
    padding: 24, boxSizing: 'border-box', background: colors.panel, color: colors.text,
  },
  layout: {
    width: 'min(940px, 100%)', minHeight: '100%', margin: '0 auto',
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
    gap: 22, alignItems: 'start',
  },
  calendarCard: {
    position: 'relative', width: '100%', padding: '18px 28px 30px', boxSizing: 'border-box',
    border: `1px solid ${colors.borderSoft}`, borderRadius: 22, background: colors.panel,
    boxShadow: arkmeTheme.shadow,
  },
  header: { height: 40, display: 'flex', alignItems: 'center', gap: 12 },
  navButton: {
    width: 36, height: 36, flex: 'none', display: 'grid', placeItems: 'center',
    padding: 0, border: 0, borderRadius: 10, background: colors.layer, color: colors.secondary,
    cursor: 'pointer', font: 'inherit', fontSize: 28, lineHeight: 1,
  },
  navDisabled: { opacity: 0.38, cursor: 'default' },
  monthTitle: { margin: '0 0 0 8px', flex: 1, fontSize: 20, lineHeight: '30px', fontWeight: 600 },
  todayButton: {
    height: 30, flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '0 6px', border: 0, borderRadius: 8, background: 'transparent',
    color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500,
  },
  todayDisabled: { color: colors.caption, opacity: 0.48, cursor: 'default' },
  week: {
    marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    columnGap: 12,
  },
  weekDay: { height: 24, textAlign: 'center', color: colors.tertiary, fontSize: 14, lineHeight: '24px', fontWeight: 500 },
  days: {
    marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: '14px 12px',
  },
  blank: { height: 58 },
  dayButton: {
    height: 58, minWidth: 0, display: 'grid', gridTemplateRows: '28px 20px', placeItems: 'center',
    padding: 0, border: '1px solid transparent', borderRadius: 13, background: 'transparent',
    color: colors.secondary, cursor: 'pointer', font: 'inherit', boxSizing: 'border-box',
  },
  dayDisabled: { color: colors.caption, cursor: 'default' },
  daySelected: { borderColor: colors.accent, background: colors.accentSoft, color: colors.accent },
  dayNumber: { gridRow: 1, fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  dayCount: { gridRow: 2, minHeight: 20, color: colors.accent, fontSize: 14, lineHeight: '20px', fontWeight: 500 },
  status: { marginTop: 14, minHeight: 20, color: colors.secondary, fontSize: 13, lineHeight: '20px' },
  error: { color: colors.danger },
  recordsPanel: {
    minWidth: 0, minHeight: 420, display: 'flex', flexDirection: 'column',
    borderLeft: `1px solid ${colors.border}`, paddingLeft: 22, boxSizing: 'border-box',
  },
  recordsHeader: { flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 40 },
  recordsTitle: { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600 },
  recordsMeta: { color: colors.tertiary, fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
  list: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginTop: 10 },
  recordRow: {
    width: '100%', minWidth: 0, padding: '12px 0', border: 0, borderBottom: `1px solid ${colors.borderSoft}`,
    background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit',
  },
  recordTitle: { margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '21px', fontWeight: 600 },
  recordText: {
    margin: '5px 0 0', display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere', color: colors.secondary,
    fontSize: 13, lineHeight: '20px',
  },
  recordMeta: { display: 'block', marginTop: 6, color: colors.caption, fontSize: 11, lineHeight: '16px' },
  loadMore: {
    alignSelf: 'center', marginTop: 14, minWidth: 96, height: 32, padding: '0 14px',
    border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.panel,
    color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 13,
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
  return `${String(date.getFullYear())}年${String(date.getMonth() + 1).padStart(2, '0')}月`
}

function dayLabel(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`
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

function RecordRow({ item }: { item: ArkmeCalendarRecordItem }) {
  return <article style={styles.recordRow}>
    <h3 style={styles.recordTitle}>{item.title || item.preview}</h3>
    <p style={styles.recordText}>{item.textContent || item.preview}</p>
    <span style={styles.recordMeta}>{[timeLabel(item.sendAtMillis), item.topicTitle].filter(Boolean).join(' · ')}</span>
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
    disabled={disabled}
    style={{
      ...styles.dayButton,
      ...(disabled ? styles.dayDisabled : {}),
      ...(selected ? styles.daySelected : {}),
    }}
    onClick={onClick}
  >
    <span style={styles.dayNumber}>{date.getDate()}</span>
    <span style={styles.dayCount}>{count > 0 ? count : ''}</span>
  </button>
}

export function ArkmeCalendarSurface() {
  const today = useMemo(() => startOfLocalDay(new Date()), [])
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local', [])
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendar, setCalendar] = useState<ArkmeCalendarBucketPage>()
  const [records, setRecords] = useState<ArkmeCalendarDayRecordPage>()
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [recordsError, setRecordsError] = useState('')

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setCalendar(undefined); setCalendarLoading(true); setCalendarError('')
    void callArkme<ArkmeCalendarBucketPage>('calendar.buckets', {
      startDate: dateKey(monthStart(visibleMonth)),
      endDate: dateKey(monthEnd(visibleMonth)),
      timezone,
    }, controller.signal)
      .then(value => { if (active) setCalendar(value) })
      .catch(caught => { if (active && !controller.signal.aborted) setCalendarError(errorMessage(caught)) })
      .finally(() => { if (active) setCalendarLoading(false) })
    return () => { active = false; controller.abort() }
  }, [timezone, visibleMonth])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setRecords(undefined); setRecordsLoading(true); setRecordsError('')
    void callArkme<ArkmeCalendarDayRecordPage>('calendar.records', {
      bucketDate: dateKey(selectedDate),
      timezone,
      limit: 20,
    }, controller.signal)
      .then(value => { if (active) setRecords(value) })
      .catch(caught => { if (active && !controller.signal.aborted) setRecordsError(errorMessage(caught)) })
      .finally(() => { if (active) setRecordsLoading(false) })
    return () => { active = false; controller.abort() }
  }, [selectedDate, timezone])

  const calendarByDay = useMemo(() => new Map((calendar?.days ?? []).map(day => [day.bucketDate, day])), [calendar])
  const canGoNext = !sameMonth(visibleMonth, today) && visibleMonth < monthStart(today)
  const canJumpToday = dateKey(selectedDate) !== dateKey(today) || !sameMonth(visibleMonth, today)
  const selectedMeta = calendarByDay.get(dateKey(selectedDate))
  const recordItems = records?.items ?? []

  const chooseDate = (date: Date) => {
    const normalized = startOfLocalDay(date)
    setSelectedDate(normalized)
    if (!sameMonth(normalized, visibleMonth)) setVisibleMonth(monthStart(normalized))
  }

  const loadMore = async () => {
    if (records?.nextCursor === undefined || loadingMore) return
    setLoadingMore(true); setRecordsError('')
    try {
      const next = await callArkme<ArkmeCalendarDayRecordPage>('calendar.records', {
        bucketDate: dateKey(selectedDate),
        timezone,
        limit: 20,
        cursor: records.nextCursor,
      })
      setRecords(current => current === undefined ? next : {
        ...next,
        items: [...current.items, ...next.items],
      })
    } catch (caught) {
      setRecordsError(errorMessage(caught))
    } finally {
      setLoadingMore(false)
    }
  }

  return <div style={styles.root}>
    <div style={styles.layout}>
      <section style={styles.calendarCard} aria-label="日历">
        <header style={styles.header}>
          <button type="button" aria-label="上个月" title="上个月" style={styles.navButton} onClick={() => setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}>‹</button>
          <button type="button" aria-label="下个月" title="下个月" disabled={!canGoNext} style={{ ...styles.navButton, ...(!canGoNext ? styles.navDisabled : {}) }} onClick={() => { if (canGoNext) setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1)) }}>›</button>
          <h2 style={styles.monthTitle}>{monthLabel(visibleMonth)}</h2>
          <button type="button" disabled={!canJumpToday} style={{ ...styles.todayButton, ...(!canJumpToday ? styles.todayDisabled : {}) }} onClick={() => { setVisibleMonth(monthStart(today)); setSelectedDate(today) }}>↶ 回到今日</button>
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
        <div style={{ ...styles.status, ...(calendarError !== '' ? styles.error : {}) }} role={calendarError !== '' ? 'alert' : 'status'}>
          {calendarError || (calendarLoading ? '正在加载…' : '')}
        </div>
      </section>
      <section style={styles.recordsPanel} aria-label="当天记录">
        <header style={styles.recordsHeader}>
          <h2 style={styles.recordsTitle}>{dayLabel(selectedDate)}</h2>
          <span style={styles.recordsMeta}>{selectedMeta?.count ?? recordItems.length} 条</span>
        </header>
        {recordsError !== '' && <div style={{ ...styles.status, ...styles.error }} role="alert">{recordsError}</div>}
        <div style={styles.list}>
          {recordsLoading ? <div style={styles.status} role="status">正在加载…</div>
            : recordItems.length === 0 ? <div style={styles.status}>当天暂无记录</div>
              : recordItems.map(item => <RecordRow key={item.recordUid} item={item} />)}
          {records?.hasMore === true && records.nextCursor !== undefined && <button type="button" style={styles.loadMore} disabled={loadingMore} onClick={() => { void loadMore() }}>{loadingMore ? '加载中…' : '加载更多'}</button>}
        </div>
      </section>
    </div>
  </div>
}
