import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ArrowRight } from '@phosphor-icons/react/dist/icons/ArrowRight'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import type {
  ArkmeRecordingCalendarDay,
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingDay,
  ArkmeRecordingSection,
  ArkmeRecordingVersion,
} from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeUi } from './ui-controller.js'

type RecordingTab = 'transcript' | 'summary' | 'timeline'

const colors = {
  base: arkmeTheme.base,
  layer1: arkmeTheme.layer1,
  layer2: arkmeTheme.layer2,
  elevated: arkmeTheme.elevated,
  input: arkmeTheme.input,
  subtle: arkmeTheme.subtle,
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary,
  border: arkmeTheme.border,
  primaryAction: arkmeTheme.primaryAction,
  onPrimaryAction: arkmeTheme.onPrimaryAction,
  accent: arkmeTheme.accent,
  danger: arkmeTheme.danger,
  dangerSoft: arkmeTheme.dangerSoft,
  warning: arkmeTheme.warning,
  warningSoft: arkmeTheme.warningSoft,
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
  root: { flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: '384px minmax(0,1fr)', color: colors.text, background: colors.base },
  browser: { minWidth: 0, minHeight: 0, padding: '30px 15px 17px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', borderRight: `1px solid ${colors.border}`, background: colors.base },
  browserHeading: { padding: '0 1px' },
  browserTitle: { margin: 0, fontSize: 19, lineHeight: '26px', letterSpacing: '-.02em', fontWeight: 650 },
  browserSubtitle: { margin: '5px 0 0', color: colors.secondary, fontSize: 12, lineHeight: '18px' },
  calendar: { width: 354, marginTop: 22, padding: '16px 17px 18px', boxSizing: 'border-box', border: '1px solid rgba(216,217,221,.9)', borderRadius: 18, background: 'rgba(255,255,255,.98)' },
  monthHeader: { height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  navCluster: { display: 'flex', alignItems: 'center', gap: 3 },
  iconButton: { width: 27, height: 27, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: '#777b84', cursor: 'pointer', font: 'inherit', lineHeight: 1 },
  navDisabled: { opacity: .32, cursor: 'default' },
  caretLeft: { transform: 'rotate(180deg)' },
  monthTitle: { margin: '0 0 0 9px', fontSize: 13, lineHeight: '20px', fontWeight: 500 },
  todayButton: { width: 'auto', height: 27, flex: 'none', padding: '0 7px', border: 0, borderRadius: 8, background: 'transparent', color: '#747984', cursor: 'pointer', font: 'inherit', fontSize: 11, fontWeight: 400 },
  todayDisabled: { color: colors.tertiary, opacity: .45, cursor: 'default' },
  daySelected: { borderColor: colors.primaryAction, background: colors.primaryAction, color: colors.onPrimaryAction },
  monthWeekdays: { height: 32, marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', alignItems: 'center', color: '#9a9da5', textAlign: 'center' },
  monthWeekday: { fontSize: 10, lineHeight: '16px', fontWeight: 400 },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 4 },
  monthSpacer: { minWidth: 0, height: 45 },
  monthDay: { position: 'relative', minWidth: 0, height: 45, display: 'grid', alignContent: 'center', justifyItems: 'center', gap: 3, padding: 0, boxSizing: 'border-box', borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent', borderRadius: 11, background: 'transparent', color: '#50545d', cursor: 'pointer', font: 'inherit' },
  monthDayNumber: { fontSize: 12, lineHeight: '16px', fontWeight: 500 },
  monthDayDisabled: { opacity: .32, cursor: 'default' },
  monthDuration: { minWidth: 15, padding: '0 4px', borderRadius: 8, background: '#f0f1f5', color: '#626878', fontSize: 9, lineHeight: '9px', fontWeight: 500 },
  monthDurationBrief: { background: '#f5e4e2', color: '#9d331a' },
  selectedMonthDuration: { background: 'transparent', color: colors.onPrimaryAction },
  dayLabel: { margin: '21px 3px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dayLabelTitle: { fontSize: 12, fontWeight: 500 },
  dayLabelMeta: { color: colors.tertiary, fontSize: 10, fontStyle: 'normal' },
  recordingList: { display: 'grid', gap: 4 },
  recordingRow: { minWidth: 0, minHeight: 68, padding: 9, display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 16px', alignItems: 'center', gap: 10, border: 0, borderRadius: 12, background: colors.layer2, color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
  rowIcon: { width: 34, height: 34, display: 'grid', placeItems: 'center', border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.elevated, color: colors.secondary },
  rowCopy: { minWidth: 0, display: 'grid', gap: 5 },
  rowTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 },
  rowMeta: { color: colors.tertiary, fontSize: 11 },
  empty: { margin: '34px 16px 0', display: 'grid', justifyItems: 'center', color: colors.secondary, textAlign: 'center' },
  emptyIcon: { width: 40, height: 40, marginBottom: 12, display: 'grid', placeItems: 'center', border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.secondary },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: 500 },
  emptyText: { margin: '7px 0 0', fontSize: 11, lineHeight: 1.55 },
  content: { minWidth: 0, minHeight: 0, padding: '24px 25px 20px 27px', display: 'grid', gridTemplateRows: '90px minmax(0,1fr)', gap: 12, boxSizing: 'border-box', background: colors.base },
  dayTimeline: { minWidth: 0, padding: '14px 16px 12px', border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.layer1 },
  timelineTitle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  timelineTitleLeft: { display: 'flex', alignItems: 'center', gap: 9, color: colors.secondary },
  timelineTitleCopy: { display: 'grid', gap: 2 },
  timelineStrong: { color: colors.text, fontSize: 12, fontWeight: 500 },
  timelineSmall: { color: colors.tertiary, fontSize: 9 },
  timelineRange: { color: colors.secondary, fontSize: 10, fontStyle: 'normal' },
  track: { position: 'relative', height: 27, margin: '10px 7px 0' },
  trackBase: { position: 'absolute', top: 5, left: 0, right: 0, height: 2, borderRadius: 2, background: colors.border },
  trackSegment: { position: 'absolute', top: 3, left: '5%', width: '90%', height: 6, borderRadius: 4, background: colors.text, boxShadow: '0 2px 6px rgba(24,27,35,.16)' },
  trackNode: { position: 'absolute', zIndex: 1, top: -2, left: 0, width: 10, height: 10, border: `2px solid ${colors.base}`, borderRadius: '50%', background: colors.text, boxShadow: `0 0 0 1px ${colors.border}` },
  trackTime: { position: 'absolute', top: 11, left: 0, color: colors.tertiary, fontSize: 9 },
  analysis: { minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: '43px minmax(0,1fr)', border: `1px solid ${colors.border}`, borderRadius: 15, overflow: 'hidden', background: colors.base },
  tabs: { padding: '0 10px', display: 'flex', alignItems: 'stretch', gap: 2, borderBottom: `1px solid ${colors.border}`, background: colors.layer1 },
  tab: { position: 'relative', minWidth: 94, padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: 0, borderBottom: '2px solid transparent', background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  tabActive: { borderBottomColor: colors.text, color: colors.text, fontWeight: 500 },
  pane: { minWidth: 0, minHeight: 0, padding: '14px 18px 24px', boxSizing: 'border-box', overflowY: 'auto', overscrollBehavior: 'contain' },
  status: { padding: '42px 16px', textAlign: 'center', color: colors.secondary, fontSize: 13 },
  error: { padding: '12px 14px', borderRadius: 10, background: colors.dangerSoft, color: colors.danger, fontSize: 13 },
  transcriptList: { width: 'min(780px,100%)', display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: 0, listStyle: 'none' },
  transcript: { minWidth: 0, padding: '13px 12px', display: 'grid', gridTemplateColumns: '32px minmax(0,1fr)', alignItems: 'start', gap: 11, borderRadius: 12 },
  transcriptAvatar: { width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: '50%', color: arkmeTheme.foreground, fontSize: 11, fontWeight: 650 },
  transcriptBody: { minWidth: 0 },
  transcriptHeader: { display: 'flex', alignItems: 'baseline', gap: 8 },
  time: { color: colors.tertiary, fontVariantNumeric: 'tabular-nums', fontSize: 10 },
  speaker: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 650, lineHeight: '22px' },
  speakerDot: { flex: 'none', width: 16, height: 16, borderRadius: 999 },
  transcriptText: { margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: colors.text, fontSize: 12, lineHeight: 1.65 },
  background: { display: 'inline-block', marginLeft: 6, padding: '0 5px', borderRadius: 999, background: colors.layer2, color: colors.secondary, fontSize: 9, lineHeight: '17px', verticalAlign: 1 },
  versionBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 },
  select: { maxWidth: '100%', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '7px 9px', background: colors.input, color: 'inherit' },
  banner: { marginBottom: 14, padding: '9px 11px', borderRadius: 8, background: colors.warningSoft, color: colors.warning, fontSize: 12 },
  markdown: { fontSize: 14, lineHeight: 1.75, wordBreak: 'break-word' },
  markdownHeading: { margin: '18px 0 8px', fontWeight: 700 },
  markdownLine: { margin: '4px 0', whiteSpace: 'pre-wrap' },
  eventList: { display: 'flex', flexDirection: 'column', gap: 12 },
  event: { padding: 14, border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.layer1 },
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

function shiftMonth(value: Date, amount: number): Date {
  const target = new Date(value.getFullYear(), value.getMonth() + amount, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(value.getDate(), lastDay))
}

function monthCalendarCells(value: Date): Array<Date | undefined> {
  const first = monthStart(value)
  const mondayOffset = (first.getDay() + 6) % 7
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const total = Math.ceil((mondayOffset + days) / 7) * 7
  return Array.from({ length: total }, (_, index) => {
    const day = index - mondayOffset + 1
    return day < 1 || day > days ? undefined : new Date(first.getFullYear(), first.getMonth(), day)
  })
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

export function recordingCalendarDuration(milliseconds: number): string {
  if (milliseconds <= 0) return ''
  const hours = Math.max(.1, Math.round(milliseconds / 360_000) / 10)
  return `${hours.toFixed(1)}h`
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

function RecordingSpeakerAvatar({ label, colorIndex, avatarRef }: {
  label: string
  colorIndex: number
  avatarRef?: string
}) {
  if (avatarRef !== undefined) {
    return <ArkmeUserAvatar avatarRef={avatarRef} size={32} label={`${label}的头像`} />
  }
  return <span aria-hidden style={{ ...styles.transcriptAvatar, background: speakerColorAt(colorIndex) }}>{label.slice(0, 1) || '声'}</span>
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
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const today = useMemo(() => startOfLocalDay(new Date()), [])
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
    const target = ui.recordingTarget
    if (target === undefined || target.dateStamp <= 0) return
    const targetDate = startOfLocalDay(new Date(target.dateStamp))
    setSelectedDate(targetDate)
    setVisibleMonth(monthStart(targetDate))
    setActiveTab('transcript')
  }, [ui.recordingTarget])

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
  const monthDates = useMemo(() => monthCalendarCells(visibleMonth), [visibleMonth])
  const selectedCalendarDay = calendarByDay.get(dateKey(selectedDate))
  const totalDuration = selectedCalendarDay?.durationMillis ?? day?.totalDurationMillis ?? 0
  const selectedSummary = day?.summary.items.find(version => version.id === summaryVersionId && version.selectable)
  const selectedTimeline = day?.timeline.items.find(version => version.id === timelineVersionId && version.selectable)
  const transcriptItems = day?.transcript.state === 'ready' ? day.transcript.items : []
  const firstTranscript = transcriptItems[0]
  const lastTranscript = transcriptItems.at(-1)
  const recordingRange = firstTranscript !== undefined && lastTranscript !== undefined
    ? `${timeLabel(firstTranscript.startAtMillis).slice(0, 5)}–${timeLabel(lastTranscript.endAtMillis).slice(0, 5)}`
    : totalDuration > 0 ? fullDuration(totalDuration).replace('当天录音 ', '') : '暂无录音'
  const canGoNext = visibleMonth < monthStart(today)
  const canJumpToday = dateKey(selectedDate) !== dateKey(today) || visibleMonth.getTime() !== monthStart(today).getTime()

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
      <RecordingSpeakerAvatar label={item.speakerLabel} colorIndex={item.speakerColorIndex}
        {...(item.speakerAvatarRef === undefined ? {} : { avatarRef: item.speakerAvatarRef })} />
      <span style={styles.transcriptBody}>
        <span style={styles.transcriptHeader}>
          <strong style={{ fontSize: 12, fontWeight: 500 }}>{item.speakerLabel}</strong>
          <time style={styles.time}>{timeLabel(item.startAtMillis).slice(0, 5)}</time>
          {item.isBackground && <span style={styles.background}>背景音</span>}
        </span>
        <p style={styles.transcriptText}>{item.text}</p>
      </span>
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

  const dayLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(selectedDate)

  return <div style={styles.root}>
    <aside style={styles.browser} aria-label="录音列表">
      <header style={styles.browserHeading}>
        <h2 style={styles.browserTitle}>全天候录音</h2>
        <p style={styles.browserSubtitle}>查看每天的录音、转写、总结与时间轴。</p>
      </header>
      <section style={styles.calendar} aria-label="选择录音日期">
        <header style={styles.monthHeader}>
          <div style={styles.navCluster}>
            <button type="button" style={styles.iconButton} aria-label="上个月" onClick={() => { setVisibleMonth(value => shiftMonth(value, -1)) }}><CaretRight size={16} style={styles.caretLeft} aria-hidden /></button>
            <button type="button" disabled={!canGoNext} style={{ ...styles.iconButton, ...(!canGoNext ? styles.navDisabled : {}) }} aria-label="下个月" onClick={() => { if (canGoNext) setVisibleMonth(value => shiftMonth(value, 1)) }}><CaretRight size={16} aria-hidden /></button>
          </div>
          <h2 style={styles.monthTitle}>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(visibleMonth)}</h2>
          <button type="button" disabled={!canJumpToday} style={{ ...styles.todayButton, ...(!canJumpToday ? styles.todayDisabled : {}) }} onClick={() => { setVisibleMonth(monthStart(today)); setSelectedDate(today) }}>回到今日</button>
        </header>
        <div style={styles.monthWeekdays} aria-hidden="true">
          {['一', '二', '三', '四', '五', '六', '日'].map(value => <span key={value} style={styles.monthWeekday}>{value}</span>)}
        </div>
        <div style={styles.monthGrid}>
          {monthDates.map((value, index) => {
            if (value === undefined) return <span key={`empty-${index}`} aria-hidden="true" style={styles.monthSpacer} />
            const meta = calendarByDay.get(dateKey(value))
            const selected = dateKey(value) === dateKey(selectedDate)
            const future = value.getTime() > today.getTime()
            return <button
              key={value.getTime()}
              type="button"
              style={{ ...styles.monthDay, ...(selected ? styles.daySelected : {}), ...(future ? styles.monthDayDisabled : {}) }}
              aria-label={new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(value)}
              aria-pressed={selected}
              disabled={future}
              onClick={() => { chooseDate(value) }}
            >
              <strong style={styles.monthDayNumber}>{value.getDate()}</strong>
              {meta !== undefined && meta.durationMillis > 0 && <span style={{
                ...styles.monthDuration,
                ...(meta.durationMillis <= 60 * 60 * 1_000 ? styles.monthDurationBrief : {}),
                ...(selected ? styles.selectedMonthDuration : {}),
              }}>{recordingCalendarDuration(meta.durationMillis)}</span>}
            </button>
          })}
        </div>
      </section>
      <div style={styles.dayLabel}><span style={styles.dayLabelTitle}>{dayLabel}{dateKey(selectedDate) === dateKey(today) ? ' · 今天' : ''}</span><em style={styles.dayLabelMeta}>{totalDuration > 0 ? '1 段录音' : '暂无录音'}</em></div>
      {calendarError !== '' && <div style={styles.error} role="alert">{calendarError}</div>}
      {calendarLoading && calendar === undefined ? <div style={styles.status}>正在读取录音…</div>
        : totalDuration > 0 ? <div style={styles.recordingList}>
          <button type="button" style={styles.recordingRow} onClick={() => { setActiveTab('transcript') }}>
            <span style={styles.rowIcon}><Waveform size={19} aria-hidden /></span>
            <span style={styles.rowCopy}><strong style={styles.rowTitle}>{dayLabel}的录音</strong><small style={styles.rowMeta}>{recordingRange} · {shortDuration(totalDuration) || '不足1分钟'}</small></span>
            <ArrowRight size={15} aria-hidden />
          </button>
        </div> : <div style={styles.empty}><span style={styles.emptyIcon}><Waveform size={19} aria-hidden /></span><strong style={styles.emptyTitle}>这一天没有录音</strong><p style={styles.emptyText}>选择显示时长的日期查看录音。</p></div>}
    </aside>

    <section style={styles.content} aria-label="录音详情">
      <div style={styles.dayTimeline}>
        <div style={styles.timelineTitle}>
          <div style={styles.timelineTitleLeft}><ClockCounterClockwise size={17} aria-hidden /><span style={styles.timelineTitleCopy}><strong style={styles.timelineStrong}>当天时间轴</strong><small style={styles.timelineSmall}>{dateTitle(selectedDate)}</small></span></div>
          <em style={styles.timelineRange}>{recordingRange}</em>
        </div>
        <div style={styles.track} aria-label="当天录音时间轴"><span style={styles.trackBase} />{totalDuration > 0 && <span style={styles.trackSegment}><i style={styles.trackNode} /><span style={styles.trackTime}>{firstTranscript === undefined ? dayLabel : timeLabel(firstTranscript.startAtMillis).slice(0, 5)}</span></span>}</div>
      </div>
      <div style={styles.analysis}>
        <nav style={styles.tabs} aria-label="录音内容">
          {([['transcript', '转写', FileText], ['summary', '总结', Sparkle], ['timeline', '时间轴', ClockCounterClockwise]] as const).map(([id, label, Icon]) => <button key={id} type="button" style={{ ...styles.tab, ...(activeTab === id ? styles.tabActive : {}) }} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setActiveTab(id) }}><Icon size={16} aria-hidden />{label}</button>)}
        </nav>
        <div style={styles.pane}>
          {dayError !== '' ? <div style={styles.error} role="alert">{dayError}</div>
            : activeTab === 'transcript' ? renderTranscript()
              : activeTab === 'summary' ? renderSummary() : renderTimeline()}
        </div>
      </div>
    </section>
  </div>
}
