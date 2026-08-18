import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  ArkmeRecordingCalendarDay,
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingDay,
  ArkmeRecordingSection,
  ArkmeRecordingVersion,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'

type RecordingTab = 'transcript' | 'summary' | 'timeline'

const colors = {
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  subtle: 'var(--dsw-alias-bg-subtle, #f5f6f8)',
  accent: '#3964fe',
  danger: '#c2413b',
  warning: '#a16207',
}
const speakerPalette = [
  '#ec7fa9', '#799eff', '#80a1ba', '#b4debd', '#f5d2d2',
  '#ffde63', '#e69db8', '#b7b1f2', '#91c4c3', '#4cc9fe',
  '#ffbd73', '#e178c5', '#beadfa', '#ffa1cf', '#e6ba95',
]

function speakerColorAt(index: number): string {
  if (index < 0) return '#a4a4a4'
  if (index < speakerPalette.length) return speakerPalette[index] ?? '#a4a4a4'
  const cycleStart = Math.max(0, speakerPalette.length - 7)
  const cycleLength = speakerPalette.length - cycleStart
  return cycleLength > 0
    ? speakerPalette[cycleStart + ((index - cycleStart + 1) % cycleLength)] ?? '#a4a4a4'
    : '#a4a4a4'
}

const styles: Record<string, CSSProperties> = {
  root: { flex: 1, width: '100%', height: 'auto', minWidth: 0, minHeight: 0, overflow: 'hidden', color: colors.text },
  layout: { height: '100%', minHeight: 0, display: 'grid', alignItems: 'stretch', gap: 20, padding: 20, boxSizing: 'border-box', overflow: 'hidden' },
  calendar: { minWidth: 0, padding: 14, border: `1px solid ${colors.border}`, borderRadius: 14, background: '#fff' },
  monthHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  monthTitle: { margin: 0, fontSize: 15, fontWeight: 650 },
  iconButton: { width: 30, height: 30, border: `1px solid ${colors.border}`, borderRadius: 8, background: '#fff', color: 'inherit', cursor: 'pointer' },
  week: { display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4, marginBottom: 4 },
  weekDay: { color: colors.secondary, textAlign: 'center', fontSize: 11, lineHeight: '24px' },
  days: { display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4 },
  day: { position: 'relative', display: 'grid', gridTemplateRows: '24px 12px', alignContent: 'center', justifyItems: 'center', minWidth: 0, height: 54, padding: '7px 2px', boxSizing: 'border-box', border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' },
  dayDate: { gridRow: 1, lineHeight: '24px' },
  daySelected: { background: colors.accent, color: '#fff' },
  dayToday: { boxShadow: `inset 0 0 0 1px ${colors.accent}` },
  duration: { gridRow: 2, display: 'block', whiteSpace: 'nowrap', color: 'inherit', opacity: .68, fontSize: 9, lineHeight: '12px' },
  content: { minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', border: `1px solid ${colors.border}`, borderRadius: 14, overflow: 'hidden', background: '#fff' },
  contentHeader: { flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${colors.border}` },
  dateControls: { display: 'flex', alignItems: 'center', gap: 8 },
  dateTitle: { margin: 0, fontSize: 17, fontWeight: 680 },
  total: { color: colors.secondary, fontSize: 12 },
  todayButton: { border: `1px solid ${colors.border}`, borderRadius: 8, padding: '6px 10px', background: '#fff', color: 'inherit', cursor: 'pointer' },
  tabs: { flex: 'none', display: 'flex', gap: 4, padding: '10px 14px 0', borderBottom: `1px solid ${colors.border}` },
  tab: { border: 0, borderBottom: '2px solid transparent', padding: '8px 12px', background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit' },
  tabActive: { borderBottomColor: colors.accent, color: colors.text, fontWeight: 650 },
  pane: { flex: 1, minHeight: 0, padding: 18, boxSizing: 'border-box', overflowY: 'auto', overscrollBehavior: 'contain' },
  status: { padding: '42px 16px', textAlign: 'center', color: colors.secondary, fontSize: 13 },
  error: { padding: '12px 14px', borderRadius: 10, background: 'rgba(194,65,59,.08)', color: colors.danger, fontSize: 13 },
  transcriptList: { display: 'flex', flexDirection: 'column', gap: 16, margin: 0, padding: 0, listStyle: 'none' },
  transcript: { display: 'grid', gridTemplateColumns: '64px minmax(110px,160px) minmax(0,1fr)', gap: 12, alignItems: 'start' },
  time: { color: colors.secondary, fontVariantNumeric: 'tabular-nums', fontSize: 12, lineHeight: '22px' },
  speaker: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 650, lineHeight: '22px' },
  speakerDot: { flex: 'none', width: 16, height: 16, borderRadius: 999 },
  transcriptText: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '22px' },
  background: { display: 'inline-block', marginLeft: 6, padding: '0 5px', borderRadius: 999, background: '#eef0f3', color: colors.secondary, fontSize: 9, lineHeight: '17px', verticalAlign: 1 },
  versionBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 },
  select: { maxWidth: '100%', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '7px 9px', background: '#fff', color: 'inherit' },
  banner: { marginBottom: 14, padding: '9px 11px', borderRadius: 8, background: '#fff8e6', color: colors.warning, fontSize: 12 },
  markdown: { fontSize: 14, lineHeight: 1.75, wordBreak: 'break-word' },
  markdownHeading: { margin: '18px 0 8px', fontWeight: 700 },
  markdownLine: { margin: '4px 0', whiteSpace: 'pre-wrap' },
  eventList: { display: 'flex', flexDirection: 'column', gap: 12 },
  event: { padding: 14, border: `1px solid ${colors.border}`, borderRadius: 12, background: '#fff' },
  eventHeader: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 },
  eventTime: { flex: 'none', color: colors.accent, fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 650 },
  eventTitle: { margin: 0, fontSize: 15 },
  eventText: { margin: '5px 0', whiteSpace: 'pre-wrap', color: colors.text, fontSize: 13, lineHeight: 1.65 },
  metaRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { padding: '2px 7px', borderRadius: 999, background: colors.subtle, color: colors.secondary, fontSize: 11 },
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function monthStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function dateKey(value: number | Date): string {
  const date = typeof value === 'number' ? new Date(value) : value
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function calendarCells(month: Date): Array<Date | undefined> {
  const first = monthStart(month)
  const leading = (first.getDay() + 6) % 7
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return [
    ...Array.from<undefined>({ length: leading }),
    ...Array.from({ length: count }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1)),
  ]
}

function shiftDay(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount)
}

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

function shortDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000)
  if (minutes <= 0) return ''
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}小时` : `${hours}小时${rest}分`
}

function calendarDuration(milliseconds: number): string {
  if (milliseconds <= 0) return ''
  const roundedHours = Math.max(0.1, Math.round(milliseconds / 360_000) / 10)
  return `${roundedHours.toFixed(1)}h`
}

export function RecordingCalendarCell({ date, meta, selected, isToday, onClick }: {
  date: Date
  meta: ArkmeRecordingCalendarDay | undefined
  selected: boolean
  isToday: boolean
  onClick(): void
}) {
  return <button type="button" style={{ ...styles.day, ...(isToday ? styles.dayToday : {}), ...(selected ? styles.daySelected : {}) }} aria-pressed={selected} onClick={onClick}>
    <span style={styles.dayDate}>{date.getDate()}</span>
    {meta !== undefined && meta.durationMillis > 0 && <span style={styles.duration}>{calendarDuration(meta.durationMillis)}</span>}
  </button>
}

export function RecordingSpeakerLabel({ label, colorIndex, isBackground }: {
  label: string
  colorIndex: number
  isBackground: boolean
}) {
  return <span style={styles.speaker}>
    <span aria-hidden="true" style={{ ...styles.speakerDot, background: speakerColorAt(colorIndex) }} />
    <span>{label}</span>
    {isBackground && <span style={styles.background}>背景音</span>}
  </span>
}

function fullDuration(milliseconds: number): string {
  return milliseconds > 0 ? `当天录音 ${shortDuration(milliseconds) || '不足1分钟'}` : '当天无录音'
}

function dateTitle(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(value)
}

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
}

function versionLabel(version: ArkmeRecordingVersion): string {
  const time = version.generatedAtMillis > 0
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(version.generatedAtMillis))
    : '时间未知'
  return `${time}${version.modelDisplayName === '' ? '' : ` · ${version.modelDisplayName}`}`
}

function SectionState({ section, loading }: { section: ArkmeRecordingSection<unknown> | undefined; loading: boolean }) {
  if (loading) return <div style={styles.status}>正在读取…</div>
  if (section === undefined) return <div style={styles.status}>暂无数据</div>
  const message = section.message || (section.state === 'empty' ? '暂无已生成内容' : '读取失败')
  return section.state === 'error'
    ? <div style={styles.error} role="alert">{message}</div>
    : <div style={styles.status}>{message}</div>
}

function StatusBanner({ section }: { section: ArkmeRecordingSection<ArkmeRecordingVersion> }) {
  if (section.state !== 'processing' && section.state !== 'failed') return null
  return <div style={styles.banner}>{section.message}</div>
}

function SafeMarkdown({ content }: { content: string }) {
  const nodes: ReactNode[] = []
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trimEnd()
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    const bullet = /^[-*+]\s+(.+)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (line.trim() === '') nodes.push(<div key={index} style={{ height: 8 }} />)
    else if (heading !== null) nodes.push(<div key={index} style={{ ...styles.markdownHeading, fontSize: Math.max(14, 20 - (heading[1]?.length ?? 1)) }}>{heading[2]}</div>)
    else if (bullet !== null) nodes.push(<div key={index} style={styles.markdownLine}>• {bullet[1]}</div>)
    else if (numbered !== null) nodes.push(<div key={index} style={styles.markdownLine}>{line}</div>)
    else if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) nodes.push(<hr key={index} style={{ border: 0, borderTop: `1px solid ${colors.border}` }} />)
    else nodes.push(<div key={index} style={styles.markdownLine}>{line}</div>)
  }
  return <div style={styles.markdown}>{nodes}</div>
}

function VersionPicker({ versions, selectedId, onChange }: {
  versions: ArkmeRecordingVersion[]
  selectedId: string
  onChange(id: string): void
}) {
  const selectable = versions.filter(version => version.selectable)
  if (selectable.length <= 1) return null
  return <div style={styles.versionBar}>
    <span style={{ color: colors.secondary, fontSize: 12 }}>历史成功版本</span>
    <select style={styles.select} value={selectedId} onChange={event => { onChange(event.target.value) }}>
      {selectable.map(version => <option key={version.id} value={version.id}>{versionLabel(version)}</option>)}
    </select>
  </div>
}

export function ArkmeRecordingSurface() {
  const today = useMemo(() => startOfLocalDay(new Date()), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const [selectedDate, setSelectedDate] = useState(today)
  const [visibleMonth, setVisibleMonth] = useState(monthStart(today))
  const [activeTab, setActiveTab] = useState<RecordingTab>('transcript')
  const [calendar, setCalendar] = useState<ArkmeRecordingCalendarMonth>()
  const [day, setDay] = useState<ArkmeRecordingDay>()
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [dayLoading, setDayLoading] = useState(true)
  const [calendarError, setCalendarError] = useState('')
  const [dayError, setDayError] = useState('')
  const [summaryVersionId, setSummaryVersionId] = useState('')
  const [timelineVersionId, setTimelineVersionId] = useState('')

  useEffect(() => {
    const root = rootRef.current
    if (root === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => { setCompact((entries[0]?.contentRect.width ?? 900) < 820) })
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    let cancelled = false
    const from = monthStart(visibleMonth)
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
    setCalendar(undefined); setCalendarLoading(true); setCalendarError('')
    void callArkme<ArkmeRecordingCalendarMonth>('recordings.calendar', { fromStamp: from.getTime(), toStamp: to.getTime() })
      .then(value => { if (!cancelled) setCalendar(value) })
      .catch(error => { if (!cancelled) { setCalendar(undefined); setCalendarError(errorMessage(error)) } })
      .finally(() => { if (!cancelled) setCalendarLoading(false) })
    return () => { cancelled = true }
  }, [visibleMonth])

  useEffect(() => {
    let cancelled = false
    setDay(undefined); setDayLoading(true); setDayError('')
    setSummaryVersionId(''); setTimelineVersionId('')
    void callArkme<ArkmeRecordingDay>('recordings.day', { dateStamp: selectedDate.getTime() })
      .then(value => {
        if (cancelled) return
        setDay(value)
        setSummaryVersionId(value.summary.items.find(version => version.selectable)?.id ?? '')
        setTimelineVersionId(value.timeline.items.find(version => version.selectable)?.id ?? '')
      })
      .catch(error => { if (!cancelled) setDayError(errorMessage(error)) })
      .finally(() => { if (!cancelled) setDayLoading(false) })
    return () => { cancelled = true }
  }, [selectedDate])

  const calendarByDay = useMemo(() => new Map((calendar?.days ?? []).map(item => [dateKey(item.dateStamp), item])), [calendar])
  const selectedCalendarDay = calendarByDay.get(dateKey(selectedDate))
  const totalDuration = selectedCalendarDay?.durationMillis ?? day?.totalDurationMillis ?? 0
  const selectedSummary = day?.summary.items.find(version => version.id === summaryVersionId && version.selectable)
  const selectedTimeline = day?.timeline.items.find(version => version.id === timelineVersionId && version.selectable)

  const chooseDate = (value: Date) => {
    const normalized = startOfLocalDay(value)
    setSelectedDate(normalized)
    if (normalized.getFullYear() !== visibleMonth.getFullYear() || normalized.getMonth() !== visibleMonth.getMonth()) {
      setVisibleMonth(monthStart(normalized))
    }
  }

  const renderTranscript = () => {
    const section = day?.transcript
    if (dayLoading || section === undefined || section.state !== 'ready') return <SectionState section={section} loading={dayLoading} />
    return <ul style={styles.transcriptList}>{section.items.map(item => <li key={item.itemId} style={styles.transcript}>
      <time style={styles.time}>{timeLabel(item.startAtMillis)}</time>
      <RecordingSpeakerLabel label={item.speakerLabel} colorIndex={item.speakerColorIndex} isBackground={item.isBackground} />
      <p style={styles.transcriptText}>{item.text}</p>
    </li>)}</ul>
  }

  const renderSummary = () => {
    const section = day?.summary
    if (dayLoading || section === undefined || selectedSummary === undefined) return <>
      <SectionState section={section} loading={dayLoading} />
    </>
    return <>
      <StatusBanner section={section} />
      <VersionPicker versions={section.items} selectedId={selectedSummary.id} onChange={setSummaryVersionId} />
      <SafeMarkdown content={selectedSummary.content} />
    </>
  }

  const renderTimeline = () => {
    const section = day?.timeline
    if (dayLoading || section === undefined || selectedTimeline === undefined) return <>
      <SectionState section={section} loading={dayLoading} />
    </>
    return <>
      <StatusBanner section={section} />
      <VersionPicker versions={section.items} selectedId={selectedTimeline.id} onChange={setTimelineVersionId} />
      <div style={styles.eventList}>{selectedTimeline.timelineEvents.map(event => <article key={event.eventId} style={styles.event}>
        <header style={styles.eventHeader}><time style={styles.eventTime}>{event.timeRange || '时间未标注'}</time><h3 style={styles.eventTitle}>{event.title}</h3></header>
        {event.description !== '' && <p style={styles.eventText}>{event.description}</p>}
        {event.todo !== '' && <p style={styles.eventText}><strong>待办：</strong>{event.todo}</p>}
        <div style={styles.metaRow}>
          {event.scene !== '' && <span style={styles.chip}>场景 · {event.scene}</span>}
          {event.emotion !== '' && <span style={styles.chip}>心情 · {event.emotion}</span>}
          {event.participants.map(person => <span key={`person:${person}`} style={styles.chip}>{person}</span>)}
          {event.tags.map(tag => <span key={`tag:${tag}`} style={styles.chip}>#{tag}</span>)}
        </div>
      </article>)}</div>
    </>
  }

  return <div ref={rootRef} style={styles.root}>
    <div style={{
      ...styles.layout,
      gridTemplateColumns: compact ? 'minmax(0,1fr)' : '320px minmax(0,1fr)',
      gridTemplateRows: compact ? 'auto minmax(0,1fr)' : 'minmax(0,1fr)',
    }}>
      <aside style={styles.calendar} aria-label="录音日历">
        <div style={styles.monthHeader}>
          <button type="button" style={styles.iconButton} aria-label="上个月" onClick={() => { setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() - 1, 1)) }}>‹</button>
          <h3 style={styles.monthTitle}>{visibleMonth.getFullYear()}年{visibleMonth.getMonth() + 1}月</h3>
          <button type="button" style={styles.iconButton} aria-label="下个月" onClick={() => { setVisibleMonth(value => new Date(value.getFullYear(), value.getMonth() + 1, 1)) }}>›</button>
        </div>
        {calendarError !== '' && <div style={styles.error} role="alert">{calendarError}</div>}
        <div style={styles.week}>{['一', '二', '三', '四', '五', '六', '日'].map(label => <span key={label} style={styles.weekDay}>{label}</span>)}</div>
        <div style={{ ...styles.days, opacity: calendarLoading ? .55 : 1 }}>
          {calendarCells(visibleMonth).map((date, index) => {
            if (date === undefined) return <span key={`blank:${index}`} />
            const meta: ArkmeRecordingCalendarDay | undefined = calendarByDay.get(dateKey(date))
            const selected = dateKey(date) === dateKey(selectedDate)
            const isToday = dateKey(date) === dateKey(today)
            return <RecordingCalendarCell key={dateKey(date)} date={date} meta={meta} selected={selected} isToday={isToday} onClick={() => { chooseDate(date) }} />
          })}
        </div>
      </aside>

      <section style={styles.content} aria-label="录音详情">
        <header style={styles.contentHeader}>
          <div><h2 style={styles.dateTitle}>{dateTitle(selectedDate)}</h2><div style={styles.total}>{fullDuration(totalDuration)}</div></div>
          <div style={styles.dateControls}>
            <button type="button" style={styles.iconButton} aria-label="前一天" onClick={() => { chooseDate(shiftDay(selectedDate, -1)) }}>‹</button>
            <button type="button" style={styles.todayButton} onClick={() => { chooseDate(today) }}>回到今天</button>
            <button type="button" style={styles.iconButton} aria-label="后一天" onClick={() => { chooseDate(shiftDay(selectedDate, 1)) }}>›</button>
          </div>
        </header>
        <nav style={styles.tabs} aria-label="录音内容">
          {([['transcript', '转写'], ['summary', '日总结'], ['timeline', '时间轴']] as const).map(([id, label]) => <button key={id} type="button" style={{ ...styles.tab, ...(activeTab === id ? styles.tabActive : {}) }} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setActiveTab(id) }}>{label}</button>)}
        </nav>
        <div style={styles.pane}>
          {dayError !== '' ? <div style={styles.error} role="alert">{dayError}</div>
            : activeTab === 'transcript' ? renderTranscript()
              : activeTab === 'summary' ? renderSummary() : renderTimeline()}
        </div>
      </section>
    </div>
  </div>
}
