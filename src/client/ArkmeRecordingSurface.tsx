import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/icons/ClockCounterClockwise'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import { ArrowsOut } from '@phosphor-icons/react/dist/icons/ArrowsOut'
import { Export } from '@phosphor-icons/react/dist/icons/Export'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type {
  ArkmeRecordingCalendarDay,
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingDay,
  ArkmeRecordingProjectionKind,
  ArkmeRecordingSection,
  ArkmeRecordingSummaryModelConfig,
  ArkmeRecordingSummaryModelRouteUpdate,
  ArkmeRecordingWorkbenchItem,
  ArkmeRecordingVersion,
} from '../types.js'
import { isRecordingLocalDateOnOrAfterMinimum } from '../recording-time.js'
import { arkmeTheme } from './arkme-theme.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { ArkmeRecordingImportTrigger } from './recordings/ArkmeRecordingImportDialog.js'
import { ArkmeRecordingSpeakerEditor, type RecordingSpeakerPopoverAnchor } from './recordings/ArkmeRecordingSpeakerEditor.js'
import { ArkmeRecordingTimeline } from './recordings/ArkmeRecordingTimeline.js'
import { recordingEmptyIllustration } from './recordings/recording-empty-illustration.js'
import { recordingSpeakerColor } from './recordings/recording-speaker-presentation.js'
import { useRecordingPlayback } from './recordings/useRecordingPlayback.js'

type RecordingTab = 'transcript' | 'summary' | 'timeline'
type RecordingModelConfigState =
  | { state: 'loading' }
  | { state: 'ready'; value: ArkmeRecordingSummaryModelConfig }
  | { state: 'error'; message: string }

const colors = {
  base: arkmeTheme.base,
  layer1: arkmeTheme.layer1,
  layer2: arkmeTheme.layer2,
  input: arkmeTheme.input,
  subtle: arkmeTheme.subtle,
  hover: arkmeTheme.hover,
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
const styles: Record<string, CSSProperties> = {
  root: { flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: '425px minmax(0,1fr)', alignItems: 'stretch', padding: '32px 12px 0', boxSizing: 'border-box', color: colors.text, background: colors.base },
  left: { width: 425, flex: 'none', minHeight: 0, display: 'flex', flexDirection: 'column' },
  calendar: { width: 409, maxWidth: '100%', padding: '16px 18px 16px 24px', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.base },
  monthHeader: { minHeight: 32, paddingBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  navCluster: { display: 'flex', alignItems: 'center', gap: 2 },
  iconButton: { width: 26, height: 26, flex: 'none', display: 'grid', placeItems: 'center', padding: 7, boxSizing: 'border-box', border: 0, borderRadius: 4, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', lineHeight: 1 },
  navDisabled: { opacity: .32, cursor: 'default' },
  caretLeft: { transform: 'rotate(180deg)' },
  monthSelects: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6 },
  monthDropdownButton: { height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, border: 0, borderRadius: 6, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500 },
  monthDropdownBackdrop: { position: 'fixed', zIndex: 1_009, inset: 0, padding: 0, border: 0, background: 'transparent', cursor: 'default' },
  monthDropdownMenu: { position: 'fixed', zIndex: 1_010, maxHeight: 200, padding: '5px 2px', boxSizing: 'border-box', overflowY: 'auto', border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.base, boxShadow: '0 4px 10px rgba(0,0,0,.12)' },
  monthDropdownOption: { width: '100%', height: 24, padding: '0 8px', border: 0, borderRadius: 4, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12, textAlign: 'center' },
  todayButton: { width: 110, height: 32, flex: 'none', padding: '0 12px 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${colors.border}`, borderRadius: 6, background: colors.layer1, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500 },
  todayDisabled: { color: colors.tertiary, opacity: .45, cursor: 'default' },
  calendarGrid: { border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.layer2, overflow: 'hidden' },
  monthWeekdays: { height: 32, padding: '6px 2px 2px', display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', alignItems: 'center', borderBottom: `1.5px solid ${colors.border}`, textAlign: 'center' },
  monthWeekday: { fontSize: 12, lineHeight: '16px', color: colors.secondary },
  monthGrid: { padding: '4px 2px 2px', display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gridAutoRows: 70, gap: 2 },
  monthSpacer: { width: '100%', height: 70 },
  monthDay: { position: 'relative', width: '100%', height: 70, display: 'grid', alignContent: 'start', justifyItems: 'center', gap: 2, padding: '8px 0 4px', boxSizing: 'border-box', border: '0.5px solid transparent', borderRadius: 4, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit' },
  cellHeight: { height: 70 },
  daySelected: { borderColor: colors.tertiary, background: colors.base, color: colors.text },
  monthDayNumber: { fontSize: 14, lineHeight: '16px', fontWeight: 500 },
  lunar: { color: colors.tertiary, fontSize: 10, lineHeight: '14px' },
  monthDayDisabled: { opacity: .32, cursor: 'default' },
  monthDuration: { minWidth: 15, padding: '2px 6px', borderRadius: 99, background: colors.layer2, color: colors.secondary, fontSize: 10, lineHeight: '10px', fontWeight: 500 },
  monthDurationBrief: { background: colors.warningSoft, color: colors.warning },
  selectedMonthDuration: { color: colors.text },
  toolbar: { marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 11 },
  content: { minWidth: 0, minHeight: 0, flex: 1, display: 'grid', gridTemplateRows: '146px minmax(0,1fr)', gap: 16, paddingBottom: 20, boxSizing: 'border-box' },
  dayTimeline: { minWidth: 0, minHeight: 0 },
  emptyDay: { minWidth: 0, minHeight: 0, paddingTop: 88, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', color: colors.text, fontSize: 13.286, lineHeight: '19.929px', letterSpacing: '.1557px' },
  emptyDayIllustration: { width: 186, height: 133, flex: 'none', display: 'block' },
  analysisEmptyPanel: { width: '100%', minHeight: '100%', padding: '40px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 12, background: colors.layer1 },
  analysisEmptyMessage: { color: colors.secondary, fontSize: 14, lineHeight: '20px' },
  analysisEmptyCopy: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  analysisGenerateButton: { padding: 0, border: 0, background: 'transparent', color: colors.accent, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: '20px' },
  analysis: { minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: '40px minmax(0,1fr)', overflow: 'hidden' },
  tabs: { padding: '0 13px 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  tabList: { display: 'flex', alignItems: 'center' },
  tabSlot: { width: 115, display: 'flex', alignItems: 'center' },
  tab: { position: 'relative', padding: '6px 4px', display: 'flex', alignItems: 'center', gap: 4, border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: '16px', letterSpacing: '.28px' },
  tabActive: { color: colors.text, fontWeight: 500 },
  tabIndicator: { position: 'absolute', left: '50%', bottom: 4, width: 10, height: 2, transform: 'translateX(-50%)', borderRadius: 22, background: colors.text },
  actionCluster: { width: 124, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  actionButton: { width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  pane: { minWidth: 0, minHeight: 0, padding: '14px 18px 24px', boxSizing: 'border-box', overflowY: 'auto', overscrollBehavior: 'contain', border: `1px solid ${colors.border}`, borderBottom: 0, borderRadius: '10px 10px 0 0', background: colors.base },
  transcriptPane: { padding: 0 },
  status: { padding: '42px 16px', textAlign: 'center', color: colors.secondary, fontSize: 13 },
  error: { padding: '12px 14px', borderRadius: 10, background: colors.dangerSoft, color: colors.danger, fontSize: 13 },
  transcriptList: { width: '100%', display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: '10px 12px 0', boxSizing: 'border-box', listStyle: 'none' },
  transcript: { position: 'relative', minWidth: 0, minHeight: 22, padding: 3, boxSizing: 'border-box', borderRadius: 6, contentVisibility: 'auto', containIntrinsicSize: '28px' },
  transcriptContent: { minWidth: 0, minHeight: 22, marginLeft: 20, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '22px', letterSpacing: '.28px', color: colors.secondary },
  transcriptLeading: { display: 'inline-block', width: 88, height: 0 },
  transcriptTime: { float: 'right', marginLeft: 4, marginRight: 1, whiteSpace: 'nowrap', fontSize: 12, lineHeight: '22px', letterSpacing: '.24px', color: colors.tertiary, fontVariantNumeric: 'tabular-nums' },
  transcriptSpeaker: { position: 'absolute', top: -1, left: 0, width: 108, minHeight: 24, padding: '1px 4px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', border: 0, borderRadius: 10, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit' },
  transcriptSpeakerName: { width: 66, flex: 'none', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '22px', fontWeight: 500, letterSpacing: '.02px' },
  transcriptEditSlot: { width: 12, height: 12, flex: 'none', marginLeft: 2, display: 'grid', placeItems: 'center' },
  speakerDot: { flex: 'none', width: 16, height: 16, borderRadius: 999 },
  transcriptLoadingList: { margin: 0, padding: '0 12px', listStyle: 'none' },
  transcriptLoadingItem: { padding: '8px 6px' },
  transcriptLoadingHeader: { display: 'flex', alignItems: 'center' },
  transcriptLoadingDot: { width: 12, height: 12, flex: 'none', borderRadius: 6, background: colors.layer2 },
  transcriptLoadingName: { width: 147, height: 16, marginLeft: 4, borderRadius: 8, background: colors.layer2 },
  transcriptLoadingTime: { width: 75, height: 16, marginLeft: 'auto', borderRadius: 8, background: colors.layer2 },
  transcriptLoadingText: { margin: '12px 0 0', color: colors.secondary, fontSize: 14, lineHeight: '22px', letterSpacing: '.28px' },
  versionBar: { minWidth: 510, height: 48, padding: '0 12px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, borderBottom: `1px solid ${colors.border}` },
  versionLabel: { color: colors.text, fontSize: 14, lineHeight: '20px', fontWeight: 500 },
  analysisDropdownButton: { height: 36, minWidth: 0, padding: '0 12px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.input, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, textAlign: 'left' },
  analysisDropdownLabel: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  analysisDropdownBackdrop: { position: 'fixed', zIndex: 1_119, inset: 0, padding: 0, border: 0, background: 'transparent', cursor: 'default' },
  analysisDropdownMenu: { position: 'fixed', zIndex: 1_120, maxHeight: 360, padding: '4px 0', boxSizing: 'border-box', overflowY: 'auto', border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.layer2, boxShadow: '0 8px 24px rgba(0,0,0,.18)' },
  analysisDropdownOption: { width: 'calc(100% - 8px)', minHeight: 34, margin: '4px', padding: '10px 16px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 10, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, textAlign: 'left' },
  analysisDropdownBadge: { flex: 'none', padding: '4px 10px', borderRadius: 99, background: colors.subtle, color: colors.secondary, fontSize: 12, lineHeight: 1 },
  analysisDropdownCheck: { width: 18, height: 18, flex: 'none', display: 'grid', placeItems: 'center', color: colors.secondary },
  regenerateButton: { width: 88, height: 34, marginLeft: 'auto', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 0, borderRadius: 9, background: colors.primaryAction, color: colors.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, fontWeight: 500 },
  modelBackdrop: { position: 'fixed', zIndex: 1_100, inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.28)' },
  modelDialog: { width: 360, maxWidth: 'calc(100vw - 40px)', padding: '18px 20px', boxSizing: 'border-box', borderRadius: 14, background: colors.layer2, boxShadow: '0 16px 48px rgba(0,0,0,.2)' },
  modelDialogHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modelDialogTitle: { margin: 0, color: colors.text, fontSize: 18, lineHeight: 1, fontWeight: 600 },
  modelDialogClose: { width: 36, height: 36, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 9, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  modelField: { marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 },
  modelFieldLabel: { color: colors.text, fontSize: 14, lineHeight: 1, fontWeight: 500 },
  modelDialogActions: { marginTop: 26, display: 'flex', justifyContent: 'flex-end', gap: 10 },
  modelDialogButton: { width: 72, height: 34, padding: 0, border: `1px solid ${colors.border}`, borderRadius: 9, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, fontWeight: 500 },
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

export function ArkmeRecordingEmptyState() {
  return <div style={styles.emptyDay} aria-label="暂无转写内容">
    <img src={recordingEmptyIllustration} width={186} height={133} alt="" style={styles.emptyDayIllustration} />
    <span>暂无转写内容，快去录音吧！</span>
  </div>
}

export function ArkmeRecordingAnalysisEmptyState({ kind, state, onGenerate }: {
  kind: 'summary' | 'timeline'
  state: 'empty' | 'processing' | 'failed'
  onGenerate(): void
}) {
  const label = kind === 'summary'
    ? state === 'processing' ? '生成总结中...' : state === 'failed' ? '总结生成失败，' : '暂无总结内容，'
    : state === 'processing' ? '生成时间轴中...' : state === 'failed' ? '时间轴生成失败，' : '暂无时间轴内容，'
  return <div style={styles.analysisEmptyPanel} aria-label={label}>
    <img src={recordingEmptyIllustration} width={186} height={133} alt="" style={styles.emptyDayIllustration} />
    <span style={styles.analysisEmptyCopy}><span style={styles.analysisEmptyMessage}>{label}</span>{state !== 'processing' && <button type="button" style={styles.analysisGenerateButton} onClick={onGenerate}>{kind === 'summary' ? '点击生成总结' : '点击生成时间轴'}</button>}</span>
  </div>
}

interface RecordingDropdownAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

function RecordingCalendarDropdown({ label, value, options, suffix, width, onChange }: {
  label: '月份' | '年份'
  value: number
  options: number[]
  suffix: string
  width: number
  onChange(value: number): void
}) {
  const [anchor, setAnchor] = useState<RecordingDropdownAnchor>()
  const open = anchor !== undefined
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchor(undefined) }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  const menuHeight = Math.min(200, options.length * 24 + 10)
  const viewport = typeof window === 'undefined' ? { width: 1_024, height: 768 } : { width: window.innerWidth, height: window.innerHeight }
  const menuLeft = anchor === undefined ? 0 : Math.min(Math.max(8, anchor.left), Math.max(8, viewport.width - width - 8))
  const menuTop = anchor === undefined ? 0 : anchor.bottom + 4 + menuHeight <= viewport.height - 8
    ? anchor.bottom + 4
    : Math.max(8, anchor.top - menuHeight - 4)
  const menu = anchor === undefined ? null : <><button type="button" tabIndex={-1} aria-label={`关闭${label}选择`} style={styles.monthDropdownBackdrop} onClick={() => { setAnchor(undefined) }} />
    <div role="listbox" aria-label={`${label}选项`} style={{ ...styles.monthDropdownMenu, left: menuLeft, top: menuTop, width }}>
      {options.map(option => <button key={option} type="button" role="option" aria-selected={option === value} style={{ ...styles.monthDropdownOption, ...(option === value ? { background: colors.subtle, fontWeight: 500 } : {}) }} onClick={() => { onChange(option); setAnchor(undefined) }}>{option}{suffix}</button>)}
    </div></>
  return <>
    <button type="button" aria-label={`选择${label}`} aria-haspopup="listbox" aria-expanded={open} style={{ ...styles.monthDropdownButton, width }} onClick={(event) => {
      if (open) { setAnchor(undefined); return }
      const rect = event.currentTarget.getBoundingClientRect()
      setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    }}><span>{value}{suffix}</span><CaretRight aria-hidden size={11} style={{ transform: 'rotate(90deg)', color: colors.secondary }} /></button>
    {menu !== null && (typeof document === 'undefined' || document.body === undefined ? menu : createPortal(menu, document.body))}
  </>
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function recordingMillisUntilNextLocalDay(value: Date): number {
  const next = new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1)
  return next.getTime() - value.getTime()
}

function useRecordingCurrentLocalDay(): Date {
  const [today, setToday] = useState(() => startOfLocalDay(new Date()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const now = new Date()
      timer = setTimeout(() => {
        setToday(startOfLocalDay(new Date()))
        schedule()
      }, recordingMillisUntilNextLocalDay(now) + 50)
    }
    schedule()
    return () => { if (timer !== undefined) clearTimeout(timer) }
  }, [])
  return today
}

function monthStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

export function recordingMonthForYearChange(value: Date, targetYear: number, today: Date): Date {
  const month = targetYear === today.getFullYear() ? Math.min(value.getMonth(), today.getMonth()) : value.getMonth()
  return new Date(targetYear, month, 1)
}

export function recordingCanGoPreviousMonth(value: Date): boolean {
  return value.getFullYear() > 1970 || value.getMonth() > 0
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

export function recordingCalendarDuration(milliseconds: number): string {
  if (milliseconds <= 0) return ''
  const hours = Math.max(.1, Math.round(milliseconds / 360_000) / 10)
  return `${hours.toFixed(1)}h`
}

export type RecordingWorkbenchLayoutMode = 'wide' | 'compact' | 'stacked'

export function recordingWorkbenchLayoutMode(viewportWidth: number): RecordingWorkbenchLayoutMode {
  if (viewportWidth < 720) return 'stacked'
  if (viewportWidth < 1_000) return 'compact'
  return 'wide'
}

function currentRecordingLayoutMode(): RecordingWorkbenchLayoutMode {
  return typeof window === 'undefined' ? 'wide' : recordingWorkbenchLayoutMode(window.innerWidth)
}

function subscribeRecordingLayout(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener('resize', onChange)
  return () => { window.removeEventListener('resize', onChange) }
}

export function recordingTranscriptTimeLabel(value: number): string {
  return timeLabel(value)
}

export function recordingTranscriptDurationLabel(startAtMillis: number, endAtMillis: number): string {
  const durationSeconds = Math.max(0, Math.floor((endAtMillis - startAtMillis) / 1_000))
  if (durationSeconds < 60) return `${durationSeconds}秒`
  if (durationSeconds < 3_600) return `${Math.floor(durationSeconds / 60)}分${durationSeconds % 60}秒`
  return `${Math.floor(durationSeconds / 3_600)}小时${Math.floor((durationSeconds % 3_600) / 60)}分`
}

export function ArkmeRecordingTranscriptRow({ item, selected, onEditSpeaker, onSelect }: {
  item: ArkmeRecordingWorkbenchItem
  selected: boolean
  onEditSpeaker(event: MouseEvent<HTMLButtonElement>): void
  onSelect(): void
}) {
  return <li
    data-recording-transcript-item={item.itemId}
    style={{
      ...styles.transcript,
      ...(selected ? { background: colors.input } : {}),
    }}
    onDoubleClick={onSelect}
  >
    <button
      type="button"
      className="arkme-recording-transcript-speaker"
      style={styles.transcriptSpeaker}
      aria-label={`编辑说话人 ${item.speakerLabel}`}
      onClick={onEditSpeaker}
    >
      <span aria-hidden="true" style={{ ...styles.speakerDot, background: recordingSpeakerColor(item.speakerColorIndex) }} />
      <span style={styles.transcriptSpeakerName}>{item.speakerLabel}</span>
      <span aria-hidden="true" style={styles.transcriptEditSlot}><PencilSimple className="arkme-recording-transcript-edit" size={12} /></span>
    </button>
    <div style={styles.transcriptContent}>
      <span aria-hidden="true" style={styles.transcriptLeading} />
      <span>{item.text}</span>
      <time style={styles.transcriptTime}>
        {recordingTranscriptTimeLabel(item.startAtMillis)} {recordingTranscriptDurationLabel(item.startAtMillis, item.endAtMillis)}
      </time>
    </div>
  </li>
}

function ArkmeRecordingTranscriptLoading() {
  return <ul style={styles.transcriptLoadingList} aria-label="转写加载中">
    <li style={styles.transcriptLoadingItem}>
      <div style={styles.transcriptLoadingHeader} aria-hidden="true">
        <span style={styles.transcriptLoadingDot} />
        <span style={styles.transcriptLoadingName} />
        <span style={styles.transcriptLoadingTime} />
      </div>
      <p style={styles.transcriptLoadingText}>音频文字正在导入&amp;转写中</p>
    </li>
  </ul>
}

function lunarDayLabel(value: Date): string {
  try {
    const numeric = Number(new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { day: 'numeric' }).format(value).replace(/\D/g, ''))
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 30) return ''
    if (numeric <= 10) return `初${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][numeric - 1]}`
    if (numeric < 20) return `十${['一', '二', '三', '四', '五', '六', '七', '八', '九'][numeric - 11]}`
    if (numeric === 20) return '二十'
    if (numeric < 30) return `廿${['一', '二', '三', '四', '五', '六', '七', '八', '九'][numeric - 21]}`
    return '三十'
  } catch { return '' }
}

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
}

function versionLabel(version: ArkmeRecordingVersion): string {
  const generatedAt = new Date(version.generatedAtMillis)
  const time = version.generatedAtMillis > 0 && !Number.isNaN(generatedAt.getTime())
    ? `${String(generatedAt.getFullYear())}-${String(generatedAt.getMonth() + 1).padStart(2, '0')}-${String(generatedAt.getDate()).padStart(2, '0')} ${[generatedAt.getHours(), generatedAt.getMinutes(), generatedAt.getSeconds()].map(value => String(value).padStart(2, '0')).join(':')}`
    : '时间未知'
  return `${time}${version.modelDisplayName === '' ? '' : ` · ${version.modelDisplayName}`}`
}

function reconcileRecordingVersionId(currentId: string, versions: readonly ArkmeRecordingVersion[]): string {
  return versions.some(version => version.selectable && version.id === currentId)
    ? currentId
    : versions.find(version => version.selectable)?.id ?? ''
}

function SectionState({ section, loading, kind = 'transcript', onGenerate = () => {} }: {
  section: ArkmeRecordingSection<unknown> | undefined
  loading: boolean
  kind?: 'transcript' | 'summary' | 'timeline'
  onGenerate?(): void
}) {
  if (loading) return <div style={styles.status}>正在读取…</div>
  if (section === undefined) return <div style={styles.status}>暂无数据</div>
  if (kind !== 'transcript' && (section.state === 'empty' || section.state === 'processing' || section.state === 'failed')) {
    return <ArkmeRecordingAnalysisEmptyState kind={kind} state={section.state} onGenerate={onGenerate} />
  }
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

interface RecordingAnalysisDropdownOption {
  value: string
  label: string
  latest?: boolean
}

function RecordingAnalysisDropdown({ ariaLabel, value, options, width, variant, autoFocus = false, onChange }: {
  ariaLabel: string
  value: string
  options: RecordingAnalysisDropdownOption[]
  width: number
  variant: 'version' | 'model'
  autoFocus?: boolean
  onChange(value: string): void
}) {
  const [anchor, setAnchor] = useState<RecordingDropdownAnchor>()
  const selected = options.find(option => option.value === value) ?? options[0]
  const open = anchor !== undefined
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAnchor(undefined) }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [open])
  const menuHeight = Math.min(360, options.length * 42 + 8)
  const viewport = typeof window === 'undefined' ? { width: 1_024, height: 768 } : { width: window.innerWidth, height: window.innerHeight }
  const menuLeft = anchor === undefined ? 0 : Math.min(Math.max(8, anchor.left), Math.max(8, viewport.width - width - 8))
  const menuTop = anchor === undefined ? 0 : anchor.bottom + 4 + menuHeight <= viewport.height - 8
    ? anchor.bottom + 4
    : Math.max(8, anchor.top - menuHeight - 4)
  const menu = anchor === undefined ? null : <>
    <button type="button" tabIndex={-1} aria-label={`关闭${ariaLabel}`} style={styles.analysisDropdownBackdrop} onClick={() => { setAnchor(undefined) }} />
    <div role="listbox" aria-label={`${ariaLabel}选项`} style={{ ...styles.analysisDropdownMenu, left: menuLeft, top: menuTop, width }}>
      {options.map(option => {
        const isSelected = option.value === selected?.value
        return <button key={option.value} type="button" role="option" aria-selected={isSelected} title={option.label} style={{ ...styles.analysisDropdownOption, ...(variant === 'model' ? { paddingLeft: 20, paddingRight: 20 } : {}), ...(isSelected ? { background: colors.subtle } : {}) }} onClick={() => { onChange(option.value); setAnchor(undefined) }}>
          <span style={styles.analysisDropdownLabel}>{option.label}</span>
          {variant === 'version' && option.latest && <span style={styles.analysisDropdownBadge}>New</span>}
          {variant === 'model' && <span style={styles.analysisDropdownCheck}>{isSelected && <Check size={18} aria-hidden />}</span>}
        </button>
      })}
    </div>
  </>
  return <>
    <button type="button" autoFocus={autoFocus} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={options.length === 0} style={{ ...styles.analysisDropdownButton, width }} onClick={event => {
      if (open) { setAnchor(undefined); return }
      const rect = event.currentTarget.getBoundingClientRect()
      setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    }}><span style={styles.analysisDropdownLabel}>{selected?.label ?? '当前暂无可用模型'}</span><CaretRight aria-hidden size={18} style={{ flex: 'none', transform: 'rotate(90deg)', color: colors.secondary }} /></button>
    {menu !== null && (typeof document === 'undefined' || document.body === undefined ? menu : createPortal(menu, document.body))}
  </>
}

function VersionPicker({ kind, versions, selectedId, generating, regenerateAvailable, onChange, onGenerate }: {
  kind: ArkmeRecordingProjectionKind
  versions: ArkmeRecordingVersion[]
  selectedId: string
  generating: boolean
  regenerateAvailable: boolean
  onChange(id: string): void
  onGenerate(): void
}) {
  const selectable = versions.filter(version => version.selectable)
  if (selectable.length === 0) return null
  const disabled = generating || !regenerateAvailable
  return <div style={styles.versionBar}>
    <span style={styles.versionLabel}>历史版本：</span>
    <RecordingAnalysisDropdown
      ariaLabel={`切换${kind === 'summary' ? '总结' : '时间轴'}版本`}
      value={selectedId}
      options={selectable.map((version, index) => ({ value: version.id, label: versionLabel(version), latest: index === 0 }))}
      width={320}
      variant="version"
      onChange={onChange}
    />
    <button type="button" aria-label={`重新生成${kind === 'summary' ? '总结' : '时间轴'}`} disabled={disabled} style={{ ...styles.regenerateButton, ...(disabled ? { opacity: .5, cursor: 'default' } : {}) }} onClick={onGenerate}>{generating && <ArrowCounterClockwise size={14} aria-hidden />}重新生成</button>
  </div>
}

function RecordingModelDialog({ kind, config, onClose, onConfirm }: {
  kind: ArkmeRecordingProjectionKind
  config: ArkmeRecordingSummaryModelConfig
  onClose(): void
  onConfirm(routeKey: string): void
}) {
  const initialRouteKey = config.options.some(option => option.routeKey === config.effectiveRouteKey)
    ? config.effectiveRouteKey
    : config.options[0]?.routeKey ?? ''
  const [routeKey, setRouteKey] = useState(initialRouteKey)
  const dialog = <div style={styles.modelBackdrop} role="presentation" onKeyDown={event => { if (event.key === 'Escape') onClose() }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={`选择${kind === 'summary' ? '总结' : '时间轴'}生成模型`} style={styles.modelDialog}>
      <header style={styles.modelDialogHeader}><h2 style={styles.modelDialogTitle}>选择模型</h2><button type="button" aria-label="关闭" style={styles.modelDialogClose} onClick={onClose}><X size={20} aria-hidden /></button></header>
      <div style={styles.modelField}><span style={styles.modelFieldLabel}>模型：</span><RecordingAnalysisDropdown autoFocus ariaLabel="选择生成模型" value={routeKey} options={config.options.map(option => ({ value: option.routeKey, label: option.displayName }))} width={280} variant="model" onChange={setRouteKey} /></div>
      <footer style={styles.modelDialogActions}><button type="button" style={styles.modelDialogButton} onClick={onClose}>取消</button><button type="button" disabled={routeKey === ''} style={{ ...styles.modelDialogButton, background: colors.primaryAction, color: colors.onPrimaryAction, borderColor: 'transparent', ...(routeKey === '' ? { opacity: .5, cursor: 'default' } : {}) }} onClick={() => { onConfirm(routeKey) }}>确认</button></footer>
    </section>
  </div>
  return typeof document === 'undefined' || document.body === undefined ? dialog : createPortal(dialog, document.body)
}

export interface ArkmeRecordingSurfaceProps {
  onOpenRecordingImport(defaultStartAtMillis: number): void
  recordingRefreshRevision: number
}

export function ArkmeRecordingSurface({ onOpenRecordingImport, recordingRefreshRevision }: ArkmeRecordingSurfaceProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const workbenchEnabled = auth.config?.recordingWorkbenchEnabled !== false
  const recordingMediaPath = auth.config?.mediaPath ?? '/arkme-self/api/media'
  const today = useRecordingCurrentLocalDay()
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
  const [generatingKinds, setGeneratingKinds] = useState<Record<ArkmeRecordingProjectionKind, boolean>>({ summary: false, timeline: false })
  const [generationErrors, setGenerationErrors] = useState<Partial<Record<ArkmeRecordingProjectionKind, string>>>({})
  const generationAbortRef = useRef<Partial<Record<ArkmeRecordingProjectionKind, AbortController>>>({})
  const modelConfigAbortRef = useRef<AbortController>()
  const [modelConfig, setModelConfig] = useState<RecordingModelConfigState>({ state: 'loading' })
  const [modelDialogKind, setModelDialogKind] = useState<ArkmeRecordingProjectionKind>()
  const [editingSpeaker, setEditingSpeaker] = useState<{ item: ArkmeRecordingWorkbenchItem; anchor: RecordingSpeakerPopoverAnchor; forceBatchUpdate: boolean }>()
  const [selectedTimelineMillis, setSelectedTimelineMillis] = useState<number>()
  const [analysisMaximized, setAnalysisMaximized] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const playback = useRecordingPlayback(recordingMediaPath)
  const layoutMode = useSyncExternalStore(subscribeRecordingLayout, currentRecordingLayoutMode, () => 'wide')

  useEffect(() => {
    for (const controller of Object.values(generationAbortRef.current)) controller?.abort()
    generationAbortRef.current = {}
    setGeneratingKinds({ summary: false, timeline: false })
    setGenerationErrors({})
    setModelDialogKind(undefined)
    setSelectedTimelineMillis(undefined)
    setEditingSpeaker(undefined)
    return () => {
      for (const controller of Object.values(generationAbortRef.current)) controller?.abort()
      generationAbortRef.current = {}
      playback.stop()
    }
  }, [playback.stop, selectedDate])

  const loadModelConfig = (dialogKind?: ArkmeRecordingProjectionKind) => {
    const controller = new AbortController()
    modelConfigAbortRef.current?.abort()
    modelConfigAbortRef.current = controller
    setModelConfig({ state: 'loading' })
    void callArkme<ArkmeRecordingSummaryModelConfig>('recordings.summary-model-config', undefined, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        setModelConfig({ state: 'ready', value })
        if (dialogKind !== undefined && value.options.length > 0) setModelDialogKind(dialogKind)
      })
      .catch(error => {
        if (controller.signal.aborted) return
        const message = errorMessage(error)
        setModelConfig({ state: 'error', message })
        if (dialogKind !== undefined) setGenerationErrors(current => ({ ...current, [dialogKind]: message }))
      })
      .finally(() => {
        if (modelConfigAbortRef.current === controller) modelConfigAbortRef.current = undefined
      })
  }

  useEffect(() => {
    loadModelConfig()
    return () => { modelConfigAbortRef.current?.abort() }
  }, [])

  useEffect(() => {
    if (playback.positionAtMillis !== undefined) setSelectedTimelineMillis(playback.positionAtMillis)
  }, [playback.positionAtMillis])

  useEffect(() => {
    const target = ui.recordingTarget
    if (target === undefined || !isRecordingLocalDateOnOrAfterMinimum(target.dateStamp)) return
    const targetDate = startOfLocalDay(new Date(target.dateStamp))
    setSelectedDate(targetDate)
    setVisibleMonth(monthStart(targetDate))
    setActiveTab('transcript')
  }, [ui.recordingTarget])

  useEffect(() => {
    const controller = new AbortController()
    const from = monthStart(visibleMonth)
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
    setCalendar(undefined); setCalendarLoading(true); setCalendarError('')
    void callArkme<ArkmeRecordingCalendarMonth>('recordings.calendar', { fromStamp: from.getTime(), toStamp: to.getTime() }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCalendar(value) })
      .catch(error => { if (!controller.signal.aborted) { setCalendar(undefined); setCalendarError(errorMessage(error)) } })
      .finally(() => { if (!controller.signal.aborted) setCalendarLoading(false) })
    return () => { controller.abort() }
  }, [visibleMonth, recordingRefreshRevision])

  useEffect(() => {
    const controller = new AbortController()
    setDay(undefined); setDayLoading(true); setDayError('')
    setSummaryVersionId(''); setTimelineVersionId('')
    void callArkme<ArkmeRecordingDay>('recordings.day', { dateStamp: selectedDate.getTime() }, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        setDay(value)
        setSummaryVersionId(value.summary.items.find(version => version.selectable)?.id ?? '')
        setTimelineVersionId(value.timeline.items.find(version => version.selectable)?.id ?? '')
      })
      .catch(error => { if (!controller.signal.aborted) setDayError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setDayLoading(false) })
    return () => { controller.abort() }
  }, [selectedDate, recordingRefreshRevision])

  useEffect(() => {
    if (day?.summary.state !== 'processing' && day?.timeline.state !== 'processing') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const next = await callArkme<ArkmeRecordingDay>(
          'recordings.day',
          { dateStamp: selectedDate.getTime() },
          controller.signal,
        )
        if (controller.signal.aborted) return
        setDay(next)
        setSummaryVersionId(current => reconcileRecordingVersionId(current, next.summary.items))
        setTimelineVersionId(current => reconcileRecordingVersionId(current, next.timeline.items))
        if (next.summary.state === 'processing' || next.timeline.state === 'processing') {
          timer = setTimeout(() => { void poll() }, attempts < 90 ? 3_000 : 15_000)
        }
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, attempts < 90 ? 5_000 : 15_000)
      }
    }
    timer = setTimeout(() => { void poll() }, 1_500)
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [day?.summary.state, day?.timeline.state, selectedDate])

  const calendarByDay = useMemo(() => new Map((calendar?.days ?? []).map(item => [dateKey(item.dateStamp), item])), [calendar])
  const monthDates = useMemo(() => monthCalendarCells(visibleMonth), [visibleMonth])
  const selectedSummary = day?.summary.items.find(version => version.id === summaryVersionId && version.selectable)
  const selectedTimeline = day?.timeline.items.find(version => version.id === timelineVersionId && version.selectable)
  const transcriptItems = day?.transcript.state === 'ready' ? day.transcript.items : []
  const emptyDay = !dayLoading && dayError === '' && day?.transcript.state === 'empty'
  const canGoPrevious = recordingCanGoPreviousMonth(visibleMonth)
  const canGoNext = visibleMonth < monthStart(today)
  const canJumpToday = dateKey(selectedDate) !== dateKey(today) || visibleMonth.getTime() !== monthStart(today).getTime()

  const chooseDate = (value: Date) => {
    const normalized = startOfLocalDay(value)
    setSelectedDate(normalized)
    if (normalized.getFullYear() !== visibleMonth.getFullYear() || normalized.getMonth() !== visibleMonth.getMonth()) {
      setVisibleMonth(monthStart(normalized))
    }
  }

  const generateRecording = async (kind: ArkmeRecordingProjectionKind, requestedRouteKey = '') => {
    if (generationAbortRef.current[kind] !== undefined) return
    const controller = new AbortController()
    generationAbortRef.current[kind] = controller
    const dateStamp = selectedDate.getTime()
    setGeneratingKinds(current => ({ ...current, [kind]: true }))
    setGenerationErrors(current => {
      const next = { ...current }
      delete next[kind]
      return next
    })
    try {
      const routeKey = requestedRouteKey.trim()
      if (routeKey !== '' && modelConfig.state === 'ready' && routeKey !== modelConfig.value.effectiveRouteKey) {
        const updated = await callArkme<ArkmeRecordingSummaryModelRouteUpdate>(
          'recordings.summary-model-config.set',
          { routeKey },
          controller.signal,
        )
        if (controller.signal.aborted) return
        setModelConfig(current => current.state !== 'ready' ? current : {
          state: 'ready',
          value: { ...current.value, effectiveRouteKey: updated.effectiveRouteKey, personalRouteKey: updated.effectiveRouteKey },
        })
      }
      const section = await callArkme<ArkmeRecordingSection<ArkmeRecordingVersion>>(
        'recordings.generate',
        { dateStamp, kind, ...(routeKey === '' ? {} : { routeKey }) },
        controller.signal,
      )
      if (controller.signal.aborted) return
      setDay(current => current?.dateStamp === dateStamp ? { ...current, [kind]: section } : current)
      const firstVersionId = section.items.find(version => version.selectable)?.id ?? ''
      if (kind === 'summary') setSummaryVersionId(firstVersionId)
      else setTimelineVersionId(firstVersionId)
    } catch (error) {
      if (!controller.signal.aborted) setGenerationErrors(current => ({ ...current, [kind]: errorMessage(error) }))
    } finally {
      if (generationAbortRef.current[kind] === controller) {
        delete generationAbortRef.current[kind]
        setGeneratingKinds(current => ({ ...current, [kind]: false }))
      }
    }
  }

  const openModelDialog = (kind: ArkmeRecordingProjectionKind) => {
    if (modelConfig.state === 'ready') {
      if (modelConfig.value.options.length > 0) setModelDialogKind(kind)
      return
    }
    if (modelConfig.state !== 'error') return
    setGenerationErrors(current => {
      const next = { ...current }
      delete next[kind]
      return next
    })
    loadModelConfig(kind)
  }

  const renderTranscript = () => {
    const section = day?.transcript
    if (dayLoading) return <ArkmeRecordingTranscriptLoading />
    if (section?.state === 'processing') return <ArkmeRecordingTranscriptLoading />
    if (section === undefined || section.state !== 'ready') return <SectionState section={section} loading={false} />
    return <>{section.processingCount > 0 && <ArkmeRecordingTranscriptLoading />}<ul style={styles.transcriptList}>{section.items.map(item => {
      const selected = selectedTimelineMillis !== undefined && selectedTimelineMillis >= item.startAtMillis && selectedTimelineMillis < item.endAtMillis
      const editSpeaker = (event: MouseEvent<HTMLButtonElement>) => {
        if (!workbenchEnabled) return
        const rect = event.currentTarget.getBoundingClientRect()
        setEditingSpeaker(current => current?.item.itemRef === item.itemRef ? undefined : {
          item,
          anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          forceBatchUpdate: false,
        })
      }
      return <ArkmeRecordingTranscriptRow
        key={item.itemId}
        item={item}
        selected={selected}
        onEditSpeaker={editSpeaker}
        onSelect={() => { setSelectedTimelineMillis(item.startAtMillis) }}
      />
    })}</ul></>
  }

  const renderSummary = () => {
    const section = day?.summary
    if (dayLoading || section === undefined || selectedSummary === undefined) return <>
      <SectionState
        section={generatingKinds.summary && section?.state !== 'processing'
          ? { state: 'processing', items: section?.items ?? [], message: '内容仍在生成' }
          : section}
        loading={dayLoading}
        kind="summary"
        onGenerate={() => { void generateRecording('summary') }}
      />
    </>
    return <>
      <StatusBanner section={section} />
      <VersionPicker
        kind="summary"
        versions={section.items}
        selectedId={selectedSummary.id}
        generating={generatingKinds.summary || section.state === 'processing'}
        regenerateAvailable={modelConfig.state === 'error' || (modelConfig.state === 'ready' && modelConfig.value.options.length > 0)}
        onChange={setSummaryVersionId}
        onGenerate={() => { openModelDialog('summary') }}
      />
      <SafeMarkdown content={selectedSummary.content} />
    </>
  }

  const renderTimeline = () => {
    const section = day?.timeline
    if (dayLoading || section === undefined || selectedTimeline === undefined) return <>
      <SectionState
        section={generatingKinds.timeline && section?.state !== 'processing'
          ? { state: 'processing', items: section?.items ?? [], message: '内容仍在生成' }
          : section}
        loading={dayLoading}
        kind="timeline"
        onGenerate={() => { void generateRecording('timeline') }}
      />
    </>
    return <>
      <StatusBanner section={section} />
      <VersionPicker
        kind="timeline"
        versions={section.items}
        selectedId={selectedTimeline.id}
        generating={generatingKinds.timeline || section.state === 'processing'}
        regenerateAvailable={modelConfig.state === 'error' || (modelConfig.state === 'ready' && modelConfig.value.options.length > 0)}
        onChange={setTimelineVersionId}
        onGenerate={() => { openModelDialog('timeline') }}
      />
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

  const downloadCurrent = () => {
    if (typeof document === 'undefined') return
    const content = activeTab === 'transcript' ? transcriptItems.map(item => `${item.speakerLabel} [${timeLabel(item.startAtMillis)}]\n${item.text}`).join('\n\n')
      : activeTab === 'summary' ? selectedSummary?.content ?? '' : selectedTimeline?.content ?? ''
    if (content === '') { setExportNotice('当前无内容可导出'); return }
    setExportNotice('')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${activeTab}_${dateKey(selectedDate)}.txt`; anchor.click(); URL.revokeObjectURL(url)
  }
  const years = Array.from({ length: today.getFullYear() - 1970 + 1 }, (_, index) => today.getFullYear() - index)

  return <div style={{
    ...styles.root,
    ...(analysisMaximized ? { gridTemplateColumns: 'minmax(0,1fr)' } : {}),
    ...(!analysisMaximized && layoutMode === 'compact' ? { gridTemplateColumns: '360px minmax(0,1fr)', padding: '20px 10px 0' } : {}),
    ...(!analysisMaximized && layoutMode === 'stacked' ? { gridTemplateColumns: 'minmax(0,1fr)', gridTemplateRows: 'minmax(390px,52%) minmax(0,1fr)', padding: '12px 10px 0', overflowY: 'auto' } : {}),
  }} data-arkme-recording-layout={layoutMode}>
    <style data-arkme-recording-transcript-interactions>{`
      .arkme-recording-transcript-speaker:hover { background: ${colors.hover} !important; }
      .arkme-recording-transcript-speaker:focus-visible { background: ${colors.hover} !important; outline: 2px solid ${colors.accent}; outline-offset: 1px; }
      .arkme-recording-transcript-edit { opacity: 0; }
      .arkme-recording-transcript-speaker:hover .arkme-recording-transcript-edit,
      .arkme-recording-transcript-speaker:focus-visible .arkme-recording-transcript-edit { opacity: 1; }
    `}</style>
    {!analysisMaximized && <aside style={{ ...styles.left, ...(layoutMode === 'wide' ? {} : { width: '100%', overflowY: 'auto' }) }} aria-label="录音日历">
      <section style={{ ...styles.calendar, ...(layoutMode === 'wide' ? {} : { width: '100%' }) }} aria-label="选择录音日期">
        <header style={styles.monthHeader}><div style={{ display: 'flex', alignItems: 'center' }}><div style={styles.navCluster}><button type="button" disabled={!canGoPrevious} style={{ ...styles.iconButton, ...(!canGoPrevious ? styles.navDisabled : {}) }} aria-label="上个月" onClick={() => { if (canGoPrevious) setVisibleMonth(value => shiftMonth(value, -1)) }}><CaretRight size={12} style={styles.caretLeft} aria-hidden /></button><button type="button" disabled={!canGoNext} style={{ ...styles.iconButton, ...(!canGoNext ? styles.navDisabled : {}) }} aria-label="下个月" onClick={() => { if (canGoNext) setVisibleMonth(value => shiftMonth(value, 1)) }}><CaretRight size={12} aria-hidden /></button></div><div style={styles.monthSelects}><RecordingCalendarDropdown label="月份" value={visibleMonth.getMonth() + 1} options={Array.from({ length: visibleMonth.getFullYear() === today.getFullYear() ? today.getMonth() + 1 : 12 }, (_, index) => index + 1)} suffix="月" width={54} onChange={month => { setVisibleMonth(new Date(visibleMonth.getFullYear(), month - 1, 1)) }} /><RecordingCalendarDropdown label="年份" value={visibleMonth.getFullYear()} options={years} suffix="" width={68} onChange={year => { setVisibleMonth(recordingMonthForYearChange(visibleMonth, year, today)) }} /></div></div><button type="button" disabled={!canJumpToday} style={{ ...styles.todayButton, ...(!canJumpToday ? styles.todayDisabled : {}) }} onClick={() => { setVisibleMonth(monthStart(today)); setSelectedDate(today) }}><ClockCounterClockwise size={18} />回到今日</button></header>
        <div style={styles.calendarGrid}><div style={styles.monthWeekdays} aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(value => <span key={value} style={styles.monthWeekday}>{value}</span>)}</div><div style={styles.monthGrid}>{monthDates.map((value, index) => {
          if (value === undefined) return <span key={`empty-${index}`} aria-hidden="true" style={styles.monthSpacer} />
          const meta = calendarByDay.get(dateKey(value)); const selected = dateKey(value) === dateKey(selectedDate); const future = value.getTime() > today.getTime()
          return <button key={value.getTime()} type="button" style={{ ...styles.monthDay, ...styles.cellHeight, ...(selected ? styles.daySelected : {}), ...(future ? styles.monthDayDisabled : {}) }} aria-label={new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(value)} aria-pressed={selected} disabled={future} onClick={() => { chooseDate(value) }}><strong style={styles.monthDayNumber}>{value.getDate()}</strong><span style={styles.lunar}>{dateKey(value) === dateKey(today) ? '今天' : lunarDayLabel(value)}</span>{meta !== undefined && meta.durationMillis > 0 && <span style={{ ...styles.monthDuration, ...(meta.durationMillis <= 60 * 60 * 1_000 ? styles.monthDurationBrief : {}), ...(selected ? styles.selectedMonthDuration : {}) }}>{recordingCalendarDuration(meta.durationMillis)}</span>}{meta !== undefined && meta.unreviewedCount > 0 && <span aria-label="新录音" style={{ position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: 4, background: colors.accent }} />}</button>
        })}</div></div>
      </section>
      <div style={styles.toolbar}>{workbenchEnabled && <ArkmeRecordingImportTrigger onClick={() => { onOpenRecordingImport(selectedDate.getTime()) }} />}</div>
      {calendarError !== '' && <div style={styles.error} role="alert">{calendarError}</div>}{calendarLoading && calendar === undefined && <div style={styles.status}>正在读取录音…</div>}
    </aside>}
    <section style={styles.content} aria-label="录音详情">
      <div style={styles.dayTimeline}>{workbenchEnabled && <ArkmeRecordingTimeline items={transcriptItems} dayStartMillis={selectedDate.getTime()} loading={dayLoading || day?.transcript.state === 'processing'} emptyState={emptyDay} onEditSpeaker={(item, anchor) => { setEditingSpeaker(current => current?.item.itemRef === item.itemRef ? undefined : { item, anchor, forceBatchUpdate: true }) }} onImportAudio={() => { onOpenRecordingImport(selectedDate.getTime()) }} {...(selectedTimelineMillis === undefined ? {} : { playheadMillis: selectedTimelineMillis })} isPlaying={playback.isPlaying} onSelectAtMillis={setSelectedTimelineMillis} onTogglePlayback={() => { if (playback.isPlaying) playback.pause(); else if (transcriptItems[0] !== undefined) void playback.playAt(transcriptItems, selectedTimelineMillis ?? playback.positionAtMillis ?? transcriptItems[0].startAtMillis) }} />}{workbenchEnabled && playback.error !== '' && <div style={styles.error} role="alert">{playback.error}</div>}</div>
      {emptyDay ? <ArkmeRecordingEmptyState /> : <div style={styles.analysis}><nav style={styles.tabs} aria-label="录音内容"><span style={styles.tabList}>{([['transcript', '转写 · 系统', FileText], ['summary', '总结', Sparkle], ['timeline', '时间轴', ClockCounterClockwise]] as const).map(([id, label, Icon]) => <span key={id} style={styles.tabSlot}><button type="button" style={{ ...styles.tab, ...(activeTab === id ? styles.tabActive : {}) }} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setActiveTab(id); setEditingSpeaker(undefined); setExportNotice('') }}><Icon size={14} aria-hidden />{label}{activeTab === id && <span style={styles.tabIndicator} />}</button></span>)}</span><span style={styles.actionCluster}><span style={{ width: 28 }} /><button type="button" aria-label={analysisMaximized ? '缩小' : '最大化'} style={styles.actionButton} onClick={() => { setAnalysisMaximized(value => !value) }}><ArrowsOut size={16} /></button><button type="button" aria-label="导出" style={styles.actionButton} onClick={downloadCurrent}><Export size={16} /></button></span></nav><div style={{ ...styles.pane, ...(activeTab === 'transcript' ? styles.transcriptPane : {}) }}>{exportNotice !== '' && <div role="status" style={styles.status}>{exportNotice}</div>}{(activeTab === 'summary' || activeTab === 'timeline') && generationErrors[activeTab] !== undefined && <div style={styles.error} role="alert">{generationErrors[activeTab]}</div>}{dayError !== '' ? <div style={styles.error} role="alert">{dayError}</div> : activeTab === 'transcript' ? renderTranscript() : activeTab === 'summary' ? renderSummary() : renderTimeline()}</div></div>}
    </section>
    {workbenchEnabled && editingSpeaker !== undefined && <ArkmeRecordingSpeakerEditor
      item={editingSpeaker.item}
      anchor={editingSpeaker.anchor}
      forceBatchUpdate={editingSpeaker.forceBatchUpdate}
      onUpdated={setDay}
      onClose={() => { setEditingSpeaker(undefined) }}
    />}
    {modelDialogKind !== undefined && modelConfig.state === 'ready' && <RecordingModelDialog
      key={modelDialogKind}
      kind={modelDialogKind}
      config={modelConfig.value}
      onClose={() => { setModelDialogKind(undefined) }}
      onConfirm={routeKey => {
        const kind = modelDialogKind
        setModelDialogKind(undefined)
        void generateRecording(kind, routeKey)
      }}
    />}
  </div>
}
