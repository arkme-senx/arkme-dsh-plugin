import { AnalysisDropdown as RecordingAnalysisDropdown, AnalysisModelDialog } from './AnalysisModelDialog.js'
import { RecordingSpeechStatistics, type SpeechSource } from './recordings/RecordingSpeechStatistics.js'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import { RecordingEntityPanel } from './recordings/RecordingEntityPanel.js'
import { useRecordingEntities } from './recordings/use-recording-entities.js'
import type { RecordingEntityOccurrence } from '../recording-entity-contract.js'
import { createRecordingEntityUnderliner } from './recordings/recording-entity-underlines.js'
import { CircleNotch } from '@phosphor-icons/react/dist/icons/CircleNotch'
import { FileAudio } from '@phosphor-icons/react/dist/icons/FileAudio'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { ArkmeRecordingFiles, type RecordingFilesCount } from './recordings/ArkmeRecordingFiles.js'
import { ArkmeRecordingPresence } from './recordings/ArkmeRecordingPresence.js'
import { RecordingTotalMetricsLoader } from './recordings/RecordingTotalMetrics.js'
import { reconcileRecordingDayRefresh } from './recordings/recording-day-refresh.js'
import { resolveRecordingSearchTarget } from './recordings/recording-search-target.js'
import { tr, useArkmeLocale, arkmeIntlLocale, calendarWeekdays, getArkmeLocale } from './locale.js'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArkmeCalendarMonthHeader } from './ArkmeCalendarMonthHeader.js'
import { ArkmeCalendarLunarDate } from './ArkmeCalendarLunarDate.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { Fingerprint } from '@phosphor-icons/react/dist/icons/Fingerprint'
import { RecognizedSpeakerEntry } from './recordings/RecognizedSpeakerEntry.js'
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
  ArkmeRecordingTimelineEvent,
} from '../types.js'
import { isRecordingLocalDateOnOrAfterMinimum } from '../recording-time.js'
import { recordingCoverageContains } from '../recording-coverage.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { callArkme, ArkmeClientError } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { ArkmeRecordingImportTrigger, type RecordingImportButtonStatus } from './recordings/ArkmeRecordingImportDialog.js'
import { ArkmeRecordingMobileGuideDialog } from './recordings/ArkmeRecordingMobileGuideDialog.js'
import { ArkmeDirectRecordingButton, ArkmeDirectRecordingStatus } from './recordings/ArkmeDirectRecording.js'
import { useLocalRecordingCoverage } from './recordings/recording-coverage.js'
import { ArkmeRecordingSpeakerEditor, type RecordingSpeakerPopoverAnchor, type RecordingSpeakerUpdateFeedback } from './recordings/ArkmeRecordingSpeakerEditor.js'
import { captureRecordingScrollAnchor } from './recordings/recording-scroll-anchor.js'
import { recordingDayIsEmpty } from './recordings/recording-day-empty.js'
import { RecordingTranscriptTimeline } from './recordings/RecordingTranscriptTimeline.js'
import { RecordingDayArrangements } from './recordings/RecordingDayArrangements.js'
import { recordingEmptyIllustration } from './recordings/recording-empty-illustration.js'
import { recordingSpeakerColor, recordingTranscriptContinuesSpeaker } from './recordings/recording-speaker-presentation.js'
import { useRecordingPlayback } from './recordings/useRecordingPlayback.js'
import { RecordingDesktopIcon } from './recordings/RecordingDesktopIcon.js'
import { RecordingTranscriptSearch } from './recordings/RecordingTranscriptSearch.js'
import { prepareRecordingTranscriptComparison, type PreparedRecordingComparison } from './recordings/prepare-recording-transcript-comparison.js'
import { findRecordingTranscriptMatches } from './recordings/recording-transcript-search.js'
import { RecordingTranscriptText } from './recordings/RecordingTranscriptText.js'
import { RecordingTranscriptComparison } from './recordings/RecordingTranscriptComparison.js'
import { RecordingTranscriptForward } from './recordings/RecordingTranscriptForward.js'
import { createRecordingForwardAttempt } from './recordings/recording-forward-client.js'
import { useRecordingTour } from './ArkmeRecordingTour.js'
import { recordingTourSample } from './recordings/recording-tour-sample.js'
import { RECORDING_FORWARD_MAX_SEGMENTS } from '../recording-forward-contract.js'

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
  root: { flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'grid', gridTemplateColumns: '425px minmax(0,1fr)', columnGap: 16, alignItems: 'stretch', padding: '16px 12px 0', boxSizing: 'border-box', color: colors.text, background: colors.base },
  left: { width: 425, flex: 'none', minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  calendar: { width: 409, maxWidth: '100%', padding: '12px 18px 12px 12px', boxSizing: 'border-box', border: 0, background: 'transparent' },
  calendarGrid: { border: 0, background: 'transparent' },
  monthWeekdays: { height: 32, padding: '6px 2px 2px', display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', alignItems: 'center', textAlign: 'center' },
  monthWeekday: { fontSize: 12, lineHeight: '16px', color: colors.secondary },
  monthGrid: { padding: '4px 2px 2px', display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gridAutoRows: 62, gap: 4 },
  monthSpacer: { width: '100%', height: 62 },
  monthDay: { position: 'relative', width: '100%', height: 62, display: 'grid', alignContent: 'start', justifyItems: 'center', gap: 2, padding: '7px 0 4px', boxSizing: 'border-box', border: 0, borderRadius: 11, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit' },
  cellHeight: { height: 62 },
  daySelected: { background: colors.primaryAction, color: colors.onPrimaryAction },
  monthDayNumber: { fontSize: 14, lineHeight: '16px', fontWeight: 500 },
  lunar: { color: colors.tertiary, fontSize: 10, lineHeight: '14px' },
  monthDayDisabled: { opacity: .32, cursor: 'default' },
  monthDuration: { minWidth: 15, padding: '2px 4px', background: 'transparent', color: colors.secondary, fontSize: 10, lineHeight: '10px', fontWeight: 500 },
  monthDurationBrief: { color: colors.secondary },
  selectedMonthDuration: { color: colors.onPrimaryAction },
  toolbar: { marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignItems: 'stretch', gap: 8 },
  calendarActionButton: { minHeight: 36, padding: '8px 6px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 0, whiteSpace: 'nowrap', border: `1px solid ${colors.border}`, borderRadius: 8, background: arkmeTheme.base, color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 14, fontWeight: 500 },
  content: { minWidth: 0, minHeight: 0, flex: 1, display: 'grid', gridTemplateRows: 'auto auto minmax(0,1fr)', gap: 8, paddingBottom: 12, boxSizing: 'border-box' },
  dateHeading: { minWidth: 0, color: colors.text, fontSize: 14, fontWeight: 500, lineHeight: '20px', overflowWrap: 'anywhere' },
  dayTimeline: { minWidth: 0, minHeight: 0 },
  emptyDay: { minWidth: 0, minHeight: 0, paddingTop: 88, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', color: colors.text, fontSize: 13.286, lineHeight: '19.929px', letterSpacing: '.1557px' },
  emptyDayIllustration: { width: 186, height: 133, flex: 'none', display: 'block' },
  analysisEmptyPanel: { width: '100%', minHeight: '100%', padding: '40px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 12, background: colors.layer1 },
  analysisEmptyMessage: { color: colors.secondary, fontSize: 14, lineHeight: '20px' },
  analysisEmptyCopy: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  analysisGenerateButton: { padding: 0, border: 0, background: 'transparent', color: colors.accent, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: '20px' },
  analysis: { minWidth: 0, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gridTemplateRows: '32px minmax(0,1fr)', overflow: 'hidden' },
  tabs: { minWidth: 0, padding: '0 13px 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  tabList: { minWidth: 0, display: 'flex', alignItems: 'center', overflowX: 'auto', scrollbarWidth: 'thin' },
  tabSlot: { width: 115, flexShrink: 0, display: 'flex', alignItems: 'center' },
  tab: { position: 'relative', padding: '6px 4px', display: 'flex', alignItems: 'center', gap: 4, border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: '16px', letterSpacing: '.28px' },
  tabActive: { color: colors.text, fontWeight: 500 },
  tabIndicator: { position: 'absolute', left: '50%', bottom: 4, width: 10, height: 2, transform: 'translateX(-50%)', borderRadius: 22, background: colors.text },
  actionCluster: { display: 'flex', flex: 'none', alignItems: 'center', gap: 4 },
  analysisBody: { position: 'relative', display: 'grid', gridTemplateRows: 'minmax(0,1fr)', minWidth: 0, minHeight: 0 },
  transcriptToolbar: { position: 'absolute', top: 8, right: 12, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4, maxWidth: 'calc(100% - 24px)', minWidth: 0, padding: 4, boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.base },
  actionButton: { width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  pane: { minWidth: 0, minHeight: 0, padding: '14px 18px 24px', boxSizing: 'border-box', overflowY: 'auto', overscrollBehavior: 'contain', border: `1px solid ${colors.border}`, borderBottom: 0, borderRadius: '10px 10px 0 0', background: colors.base },
  transcriptPane: { padding: 0 },
  status: { padding: '42px 16px', textAlign: 'center', color: colors.secondary, fontSize: 13 },
  error: { padding: '12px 14px', borderRadius: 10, background: colors.dangerSoft, color: colors.danger, fontSize: 13 },
  transcriptList: { width: '100%', display: 'flex', flexDirection: 'column', gap: 2, margin: 0, padding: '10px 12px 0', boxSizing: 'border-box', listStyle: 'none' },
  transcript: { position: 'relative', display: 'grid', gridTemplateColumns: 'fit-content(min(128px, 45%)) minmax(0, 1fr) 24px', columnGap: 4, alignItems: 'start', minWidth: 0, minHeight: 22, padding: 3, boxSizing: 'border-box', borderRadius: 6, contentVisibility: 'auto', containIntrinsicSize: 'auto 34px' },
  transcriptContent: { minWidth: 0, minHeight: 22, width: 'fit-content', maxWidth: '100%', justifySelf: 'start', padding: '6px 10px', boxSizing: 'border-box', borderRadius: '4px 12px 12px', background: arkmeTheme.messageOther, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, lineHeight: '22px', letterSpacing: '.28px', color: colors.secondary },
  transcriptTime: { display: 'inline-block', marginLeft: 8, marginRight: 1, whiteSpace: 'nowrap', fontSize: 12, lineHeight: '22px', letterSpacing: '.24px', color: colors.tertiary, fontVariantNumeric: 'tabular-nums' },
  transcriptSpeaker: { position: 'relative', maxWidth: '100%', justifySelf: 'start', minHeight: 24, padding: '1px 4px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', border: 0, borderRadius: 10, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit' },
  transcriptSpeakerName: { minWidth: 0, marginLeft: 4, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: 14, lineHeight: '22px', fontWeight: 500, letterSpacing: '.02px' },
  transcriptNamedSpeaker: { maxWidth: 112, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  transcriptEditSlot: { position: 'absolute', left: 'calc(100% - 2px)', top: '50%', transform: 'translateY(-50%)', zIndex: 1, width: 16, height: 20, display: 'grid', placeItems: 'center', borderRadius: 4, background: colors.base },
  speakerDot: { flex: 'none', width: 16, height: 16, borderRadius: 999 },
  transcriptLoadingList: { margin: 0, padding: '0 12px', listStyle: 'none' },
  transcriptLoadingItem: { padding: '8px 6px' },
  transcriptLoadingHeader: { display: 'flex', alignItems: 'center' },
  transcriptLoadingDot: { width: 12, height: 12, flex: 'none', borderRadius: 6, background: colors.layer2 },
  transcriptLoadingName: { width: 147, height: 16, marginLeft: 4, borderRadius: 8, background: colors.layer2 },
  transcriptLoadingTime: { width: 75, height: 16, marginLeft: 'auto', borderRadius: 8, background: colors.layer2 },
  transcriptLoadingText: { margin: '12px 0 0', color: colors.secondary, fontSize: 14, lineHeight: '22px', letterSpacing: '.28px' },
  versionBar: { minWidth: 0, minHeight: 48, marginTop: 20, paddingTop: 12, boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTop: `1px solid ${colors.border}` },
  versionSelection: { minWidth: 0, flex: '1 1 300px', display: 'flex', alignItems: 'center', gap: 8 },
  versionLabel: { flex: 'none', whiteSpace: 'nowrap', color: colors.text, fontSize: 14, lineHeight: '20px', fontWeight: 500 },
  regenerateButton: { width: 88, height: 34, marginLeft: 'auto', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 0, borderRadius: 9, background: colors.primaryAction, color: colors.onPrimaryAction, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: 1, fontWeight: 500 },
  banner: { marginBottom: 14, padding: '9px 11px', borderRadius: 8, background: colors.warningSoft, color: colors.warning, fontSize: 12 },
  eventList: { display: 'flex', flexDirection: 'column', gap: 4 },
  event: { minWidth: 0, borderBottom: `1px solid ${colors.border}` },
  eventButton: { width: '100%', minWidth: 0, padding: '12px 8px 13px', display: 'block', border: 0, borderRadius: 9, background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', textAlign: 'left' },
  eventButtonHover: { background: colors.hover },
  eventHeader: { minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 },
  eventTime: { flex: 'none', color: colors.accent, fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 650 },
  eventTitle: { minWidth: 0, flex: 1, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 15, fontWeight: 600 },
  eventScene: { flex: 'none', maxWidth: '30%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  eventArrow: { flex: 'none', color: colors.tertiary, fontSize: 14 },
  eventText: { maxHeight: 42, margin: 0, overflow: 'hidden', whiteSpace: 'pre-wrap', color: colors.secondary, fontSize: 13, lineHeight: '21px' },
  metaRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  chip: { padding: '2px 7px', borderRadius: 999, background: colors.subtle, color: colors.secondary, fontSize: 11 },
  eventMore: { color: colors.tertiary, fontSize: 11 },
  timelineDetailBackdrop: { position: 'fixed', zIndex: 1_110, inset: 0, display: 'grid', placeItems: 'center', padding: 'min(48px,5vh) min(48px,5vw)', boxSizing: 'border-box', background: 'rgba(0,0,0,.28)' },
  timelineDetailDialog: { width: 720, maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', borderRadius: 14, background: colors.layer2, boxShadow: '0 16px 48px rgba(0,0,0,.24)' },
  timelineDetailHeader: { minWidth: 0, padding: '18px 20px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: `1px solid ${colors.border}` },
  timelineDetailHeading: { minWidth: 0, flex: 1 },
  timelineDetailTitle: { margin: 0, color: colors.text, fontSize: 18, lineHeight: '25px', fontWeight: 600 },
  timelineDetailRange: { margin: '4px 0 0', color: colors.accent, fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  timelineDetailClose: { width: 32, height: 32, flex: 'none', padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 8, background: 'transparent', color: colors.secondary, cursor: 'pointer' },
  timelineDetailBody: { minHeight: 0, padding: '18px 20px 24px', overflowY: 'auto' },
  timelineDetailSection: { marginBottom: 20 },
  timelineDetailSectionLast: { marginBottom: 0 },
  timelineDetailSectionTitle: { margin: '0 0 8px', color: colors.text, fontSize: 14, lineHeight: '20px', fontWeight: 600 },
  timelineDetailCopy: { margin: 0, color: colors.secondary, fontSize: 13, lineHeight: '21px', whiteSpace: 'pre-wrap' },
  timelineDetailParticipantRow: { display: 'flex', flexWrap: 'wrap', gap: 7 },
  timelineDetailParticipant: { padding: '3px 8px', borderRadius: 999, background: colors.subtle, color: colors.secondary, fontSize: 12 },
  timelineDetailQuote: { margin: '0 0 10px', padding: '9px 11px', borderLeft: `3px solid ${colors.accent}`, background: colors.base, color: colors.secondary, fontSize: 13, lineHeight: '21px', whiteSpace: 'pre-wrap' },
  timelineDetailInfoRow: { display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 10, marginBottom: 9 },
  timelineDetailInfoLabel: { color: colors.tertiary, fontSize: 12, lineHeight: '20px' },
}

export function ArkmeRecordingEmptyState({ recorded = false }: { recorded?: boolean }) {
  return <div style={styles.emptyDay} aria-label={tr("暂无转写内容")}>
    <img src={recordingEmptyIllustration} width={186} height={133} alt="" style={styles.emptyDayIllustration} />
    <span>{recorded ? '已有录音，暂无转写内容' : tr("暂无转写内容，快去录音吧！")}</span>
  </div>
}

function recordingGenerationFailureMessage(error: string): string {
  switch (error) {
    case 'llm_request_failed': return tr('模型请求失败，请稍后重试或选择其他模型。')
    case 'llm_request_timeout':
    case 'generation_recovery_timeout': return tr('模型生成超时，请重试或选择其他模型。')
    case 'llm_request_canceled': return tr('模型生成已中断，请重试。')
    case 'llm_output_truncated': return tr('模型输出不完整，请重试或选择其他模型。')
    case 'daily_semantic_input_over_budget': return tr('当天录音内容超出本次处理范围，请联系开发团队。')
    case 'daily_semantic_coverage_incomplete':
    case 'daily_semantic_evidence_interleaved':
    case 'daily_semantic_validation_failed': return tr('生成内容未通过完整性检查，请重试。')
    default: return tr('生成未完成，请重试或选择其他模型。')
  }
}

export function ArkmeRecordingAnalysisEmptyState({ kind, state, onGenerate, modelLoading = false, modelName = '', failureReason = '' }: {
  kind: 'summary' | 'timeline'
  state: 'empty' | 'processing' | 'failed'
  onGenerate(): void
  modelLoading?: boolean
  modelName?: string
  failureReason?: string
}) {
  const label = kind === 'summary'
    ? state === 'processing' ? '生成总结中...' : state === 'failed' ? '总结生成失败，' : '暂无总结内容，'
    : state === 'processing' ? '生成时间轴中...' : state === 'failed' ? '时间轴生成失败，' : '暂无时间轴内容，'
  return <div style={styles.analysisEmptyPanel} aria-label={label}>
    <img src={recordingEmptyIllustration} width={186} height={133} alt="" style={styles.emptyDayIllustration} />
    <span style={styles.analysisEmptyMessage}>{state === 'failed' ? recordingGenerationFailureMessage(failureReason) : label}</span>
    {modelName !== '' && <span style={{ color: colors.tertiary, fontSize: 12 }}>{tr('模型：')}{modelName}</span>}
    {state !== 'processing' && <button data-arkme-feedback="neutral" type="button" style={styles.analysisGenerateButton} disabled={modelLoading} onClick={onGenerate}>
      {modelLoading ? tr('正在读取模型…') : state === 'failed' ? tr('选择模型并重试') : kind === 'summary' ? tr("点击生成总结") : tr("点击生成时间轴")}
    </button>}
  </div>
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
  if (durationSeconds < 60) return tr("{v0}秒", { v0: durationSeconds })
  if (durationSeconds < 3_600) return tr("{v0}分{v1}秒", { v0: Math.floor(durationSeconds / 60), v1: durationSeconds % 60 })
  return tr("{v0}小时{v1}分", { v0: Math.floor(durationSeconds / 3_600), v1: Math.floor((durationSeconds % 3_600) / 60) })
}

export function ArkmeRecordingTranscriptRow({ item, selected, isPlaying = false, searchHighlighted = false, repeatedSpeaker = false, speakerEditing = false, speakerUpdated = false, onEditSpeaker, onSelect, text, selectionControl, onToggleSelection, readOnly = false }: {
  item: ArkmeRecordingWorkbenchItem
  selected: boolean
  isPlaying?: boolean
  searchHighlighted?: boolean
  repeatedSpeaker?: boolean
  speakerEditing?: boolean
  speakerUpdated?: boolean
  readOnly?: boolean
  onEditSpeaker?(event: MouseEvent<HTMLButtonElement>): void
  onSelect?(): void
  text?: ReactNode
  selectionControl?: ReactNode
  onToggleSelection?(): void
}) {
  const speakerStyle: CSSProperties = {
    ...styles.transcriptSpeaker,
    marginTop: 6,
    ...(item.isSelf ? { gridColumn: 3, gridRow: 1, justifySelf: 'end', flexDirection: 'row-reverse' } : {}),
  }
  const speakerIdentity = <>
    {item.speakerAvatarRef === undefined
      ? <span aria-hidden="true" style={{ ...styles.speakerDot, background: recordingSpeakerColor(item.speakerColorIndex) }} />
      : <ArkmeUserAvatar avatarRef={item.speakerAvatarRef} size={16} label={tr("{v0}头像", { v0: item.speakerLabel })} />}
    {!item.isSelf && <span style={{
      ...styles.transcriptSpeakerName,
      ...(item.speakerAvatarRef === undefined ? {} : { color: recordingSpeakerColor(item.speakerColorIndex) }),
      ...(item.speakerLabel === tr("说话人 {v0}", { v0: item.speakerNumber }) ? {} : styles.transcriptNamedSpeaker),
    }}>{item.speakerLabel}</span>}
  </>
  return <li
    className="arkme-recording-transcript-row"
    data-recording-transcript-item={item.itemId}
    data-recording-speaker-self={item.isSelf || undefined}
    data-recording-search-highlight={searchHighlighted || undefined}
    data-recording-playing={isPlaying || undefined}
    data-recording-speaker-updated={speakerUpdated || undefined}
    style={{
      ...styles.transcript,
      ...(readOnly ? { gridTemplateColumns:'fit-content(min(64px, 45%)) minmax(0,1fr) 24px', contentVisibility:'visible' as const } : {}),
      ...(selected ? { background: colors.input } : {}),
      ...(speakerUpdated ? { background: `color-mix(in srgb, ${colors.base} 92%, ${colors.accent} 8%)` } : {}),
      ...(searchHighlighted ? { background: `color-mix(in srgb, ${colors.base} 88%, ${colors.text} 12%)` } : {}),
      ...(isPlaying ? { background: `color-mix(in srgb, ${colors.base} 92%, ${colors.accent} 8%)`, boxShadow: `inset 2px 0 ${colors.accent}` } : {}),
      ...(selectionControl ? { paddingLeft: 27 } : {}),
    }}
    onDoubleClick={!readOnly && onToggleSelection === undefined ? onSelect : undefined}
    onClick={readOnly ? undefined : onToggleSelection}
  >
    {selectionControl && <span style={{ position: 'absolute', left: 0, top: 4, zIndex: 1, display: 'flex' }}>{selectionControl}</span>}
    {readOnly ? <span style={speakerStyle}>
      {speakerIdentity}
    </span> : <button data-arkme-feedback="neutral"
      type="button"
      className="arkme-recording-transcript-speaker"
      data-recording-speaker-repeated={repeatedSpeaker || undefined}
      style={speakerStyle}
      title={item.speakerLabel}
      aria-label={tr("编辑说话人 {v0}", { v0: item.speakerLabel })}
      aria-haspopup="dialog"
      aria-expanded={speakerEditing}
      onClick={event => { event.stopPropagation(); onEditSpeaker?.(event) }}
      onDoubleClick={event => { event.stopPropagation() }}
    >
      {speakerIdentity}
      <span aria-hidden="true" className="arkme-recording-transcript-edit" style={{ ...styles.transcriptEditSlot, ...(item.isSelf ? { left: 'auto', right: 'calc(100% - 2px)' } : {}) }}><PencilSimple size={12} /></span>
    </button>}
    <div className="arkme-recording-transcript-content" style={{
      ...styles.transcriptContent,
      ...(item.isSelf ? { gridColumn: '1 / 3', gridRow: 1, justifySelf: 'end', maxWidth: 'calc(100% - 24px)', borderRadius: '12px 4px 12px 12px', background: arkmeTheme.messageOwn, textAlign: 'left' } : {}),
      ...(isPlaying ? { boxShadow: `inset 0 0 0 1px ${colors.accent}` } : {}),
    }}>
      {item.soundSource === 'playback' && <span title={tr('用户确认来自手机或电视播放')} style={{ display: 'inline-block', marginRight: 6, padding: '0 4px', borderRadius: 3, fontSize: 11, color: colors.tertiary, border: `1px solid ${colors.border}` }}>{tr('播放内容')}</span>}
      <span>{text ?? item.text}</span>
      <time style={styles.transcriptTime}>
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <span className="arkme-recording-transcript-timestamp">{recordingTranscriptTimeLabel(item.startAtMillis)}</span>
          <span className="arkme-recording-transcript-duration">{recordingTranscriptDurationLabel(item.startAtMillis, item.endAtMillis)}</span>
        </span>
        {isPlaying && <span role="status" aria-label={tr('正在播放')} title={tr('正在播放')} className="arkme-recording-transcript-playing">
          <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
        </span>}
      </time>
    </div>
  </li>
}

function ArkmeRecordingTranscriptLoading() {
  return <ul style={styles.transcriptLoadingList} aria-label={tr("转写加载中")}>
    <li style={styles.transcriptLoadingItem}>
      <div style={styles.transcriptLoadingHeader} aria-hidden="true">
        <span style={styles.transcriptLoadingDot} />
        <span style={styles.transcriptLoadingName} />
        <span style={styles.transcriptLoadingTime} />
      </div>
      <p style={styles.transcriptLoadingText}>{tr("音频文字正在导入&转写中")}</p>
    </li>
  </ul>
}

function lunarDayLabel(value: Date): string {
  if (getArkmeLocale() === 'en') return ''
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
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
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

function SectionState({ section, loading, kind = 'transcript', onGenerate = () => {}, analysisVersion, modelName = '', modelLoading = false }: {
  section: ArkmeRecordingSection<unknown> | undefined
  loading: boolean
  kind?: 'transcript' | 'summary' | 'timeline'
  onGenerate?(): void
  analysisVersion?: ArkmeRecordingVersion | undefined
  modelName?: string
  modelLoading?: boolean
}) {
  if (loading) return <div style={styles.status}>{tr("正在读取…")}</div>
  if (section === undefined) return <div style={styles.status}>{tr("暂无数据")}</div>
  if (kind !== 'transcript' && (section.state === 'empty' || section.state === 'processing' || section.state === 'failed')) {
    return <ArkmeRecordingAnalysisEmptyState kind={kind} state={section.state} onGenerate={onGenerate}
      modelLoading={modelLoading} modelName={section.state === 'empty' ? modelName : analysisVersion?.modelDisplayName ?? ''} failureReason={analysisVersion?.error ?? ''} />
  }
  const message = section.message || (section.state === 'empty' ? '暂无已生成内容' : '读取失败')
  return section.state === 'error'
    ? <div style={styles.error} role="alert">{message}</div>
    : <div style={styles.status}>{message}</div>
}

function StatusBanner({ section }: { section: ArkmeRecordingSection<ArkmeRecordingVersion> }) {
  if (section.state !== 'processing' && section.state !== 'failed') return null
  return <div style={styles.banner}>{section.state === 'failed' ? <>
    {recordingGenerationFailureMessage(section.items[0]?.error ?? '')}
    {section.items[0]?.modelDisplayName && <> {tr('模型：')}{section.items[0].modelDisplayName}</>}
  </> : section.message}</div>
}


function VersionPicker({ kind, versions, selectedId, generating, regenerateAvailable, onChange, onGenerate, onExport }: {
  kind: ArkmeRecordingProjectionKind
  versions: ArkmeRecordingVersion[]
  selectedId: string
  generating: boolean
  regenerateAvailable: boolean
  onChange(id: string): void
  onGenerate(): void
  onExport(): void
}) {
  const selectable = versions.filter(version => version.selectable)
  const disabled = generating || !regenerateAvailable
  return <footer style={styles.versionBar} role="group" aria-label={kind === 'summary' ? tr('总结操作') : tr('时间轴操作')}>
    {selectable.length > 0 && <>
    <div style={styles.versionSelection}>
    <span style={styles.versionLabel}>{tr("历史版本：")}</span>
    {selectable[0] && selectable[0].id !== selectedId && <span style={{ color: colors.accent, fontSize: 12, whiteSpace: 'nowrap' }}>{tr('有更新版本')}</span>}
    <RecordingAnalysisDropdown
      ariaLabel={`切换${kind === 'summary' ? tr("总结") : tr("时间轴")}版本`}
      value={selectedId}
      options={selectable.map((version, index) => ({ value: version.id, label: versionLabel(version), latest: index === 0 }))}
      width={320}
      variant="version"
      onChange={onChange}
    />
    </div>
    <button data-arkme-feedback="neutral" type="button" aria-label={`重新生成${kind === 'summary' ? tr("总结") : tr("时间轴")}`} disabled={disabled} style={{ ...styles.regenerateButton, flex: 'none', ...(disabled ? { opacity: .5, cursor: 'default' } : {}) }} onClick={onGenerate}>{generating && <ArrowCounterClockwise size={14} aria-hidden />}{tr("重新生成")}</button>
    </>}
    <Tooltip label={tr('导出')} side="top" delayMs={200}>
      <button data-arkme-feedback="neutral" type="button" aria-label={tr('导出')} style={{ ...styles.actionButton, flex: 'none' }} onClick={onExport}><RecordingDesktopIcon name="export" size={20} /></button>
    </Tooltip>
  </footer>
}

function RecordingModelDialog({ kind, config, onClose, onConfirm }: {
  kind: ArkmeRecordingProjectionKind
  config: ArkmeRecordingSummaryModelConfig
  onClose(): void
  onConfirm(routeKey: string): void
}) {
  const initial = config.options.some(option => option.routeKey === config.effectiveRouteKey)
    ? config.effectiveRouteKey : config.options[0]?.routeKey ?? ''
  return <AnalysisModelDialog ariaLabel={`选择${kind === 'summary' ? tr("总结") : tr("时间轴")}生成模型`}
    initialValue={initial} options={config.options.map(option => ({ value: option.routeKey, label: option.displayName }))}
    onClose={onClose} onConfirm={onConfirm} />
}

function RecordingTimelineDetailDialog({ event, onClose }: { event: ArkmeRecordingTimelineEvent; onClose(): void }) {
  const titleId = `arkme-recording-timeline-detail-${event.eventId}`
  const participants = [...new Set([
    ...event.participants,
    ...(event.dialoguePoints ?? []).map(point => point.speakerName),
  ].map(value => value.trim()).filter(value => value !== ''))]
  const summaries = (event.dialoguePoints ?? []).filter(point => point.summary.trim() !== '')
  const quotes = (event.dialoguePoints ?? []).filter(point => point.quote.trim() !== '')
  const info = [
    ...(event.scene === '' ? [] : [{ label: tr("场景类型"), value: event.scene }]),
    ...(event.emotion === '' ? [] : [{ label: tr("心情"), value: event.emotion }]),
    ...(event.positionNote === undefined || event.positionNote === '' ? [] : [{ label: tr("场景说明"), value: event.positionNote }]),
    ...(event.environmentNote === undefined || event.environmentNote === '' ? [] : [{ label: tr("环境说明"), value: event.environmentNote }]),
    ...(event.praise === undefined || event.praise === '' ? [] : [{ label: tr("评价"), value: event.praise }]),
    ...(event.praisePoint === undefined ? [] : [{ label: tr("评价分数"), value: String(event.praisePoint) }]),
    ...(event.tags.length === 0 ? [] : [{ label: tr("事件标签"), value: event.tags.join(' · ') }]),
    ...(event.otherInfo ?? []),
  ]
  return <div style={styles.timelineDetailBackdrop} role="presentation" onKeyDown={eventKey => { if (eventKey.key === 'Escape') onClose() }} onMouseDown={eventMouse => { if (eventMouse.target === eventMouse.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} style={styles.timelineDetailDialog}>
      <header style={styles.timelineDetailHeader}>
        <div style={styles.timelineDetailHeading}>
          <h2 id={titleId} style={styles.timelineDetailTitle}>{event.title || tr("时间轴记录")}</h2>
          {(event.timeRange !== '' || event.durationText !== undefined) && <p style={styles.timelineDetailRange}>{event.timeRange || tr("时间未标注")}{event.durationText !== undefined && event.durationText !== '' ? ` · ${event.durationText}` : ''}</p>}
        </div>
        <button data-arkme-feedback="neutral" type="button" aria-label={tr("关闭")} style={styles.timelineDetailClose} onClick={onClose}><X size={18} aria-hidden /></button>
      </header>
      <div style={styles.timelineDetailBody}>
        {event.description !== '' && <section style={styles.timelineDetailSection}>
          <h3 style={styles.timelineDetailSectionTitle}>{tr("时段总结")}</h3>
          <p style={styles.timelineDetailCopy}>{event.description}</p>
        </section>}
        {(participants.length > 0 || event.speakerNote !== undefined && event.speakerNote !== '') && <section style={styles.timelineDetailSection}>
          <h3 style={styles.timelineDetailSectionTitle}>{tr("参与者")}</h3>
          {participants.length > 0 && <div style={styles.timelineDetailParticipantRow}>{participants.map(person => <span key={person} style={styles.timelineDetailParticipant}>{person}</span>)}</div>}
          {event.speakerNote !== undefined && event.speakerNote !== '' && <p style={{ ...styles.timelineDetailCopy, marginTop: participants.length > 0 ? 10 : 0 }}>{event.speakerNote}</p>}
        </section>}
        {event.todo !== '' && <section style={styles.timelineDetailSection}>
          <h3 style={styles.timelineDetailSectionTitle}>{tr("待办")}</h3>
          <p style={styles.timelineDetailCopy}>{event.todo}</p>
        </section>}
        {quotes.length > 0 && <section style={styles.timelineDetailSection}>
          <h3 style={styles.timelineDetailSectionTitle}>{tr("代表性原话")}</h3>
          {quotes.map((point, index) => <p key={`quote:${index}`} style={styles.timelineDetailQuote}>{point.speakerName !== '' ? `${point.speakerName}：` : ''}{point.quote}</p>)}
        </section>}
        {summaries.length > 0 && <section style={styles.timelineDetailSection}>
          <h3 style={styles.timelineDetailSectionTitle}>{tr("对话摘要")}</h3>
          {summaries.map((point, index) => <p key={`summary:${index}`} style={styles.timelineDetailCopy}>{point.speakerName !== '' ? `${point.speakerName}：` : ''}{point.summary}</p>)}
        </section>}
        {info.length > 0 && <section style={{ ...styles.timelineDetailSection, ...styles.timelineDetailSectionLast }}>
          <h3 style={styles.timelineDetailSectionTitle}>{tr("其他信息")}</h3>
          {info.map((item, index) => <div key={`${item.label}:${index}`} style={styles.timelineDetailInfoRow}><span style={styles.timelineDetailInfoLabel}>{item.label}</span><span style={styles.timelineDetailCopy}>{item.value}</span></div>)}
        </section>}
      </div>
    </section>
  </div>
}

function RecordingTimelineEvents({ events, onOpen }: { events: ArkmeRecordingTimelineEvent[]; onOpen(event: ArkmeRecordingTimelineEvent): void }) {
  return <div style={styles.eventList}>{events.map(event => <article key={event.eventId} style={styles.event}>
    <button data-arkme-feedback="neutral" type="button" style={styles.eventButton} aria-label={`${event.timeRange || tr("时间未标注")} ${event.title}`} onClick={() => { onOpen(event) }}>
      <header data-arkme-recording-timeline-event-header style={styles.eventHeader}><time style={styles.eventTime}>{event.timeRange || tr("时间未标注")}</time><h3 style={styles.eventTitle}>{event.title || tr("时间轴记录")}</h3>{event.scene !== '' && <span data-arkme-recording-timeline-scene style={{ ...styles.chip, ...styles.eventScene }}>{event.scene}</span>}<span aria-hidden style={styles.eventArrow}>›</span></header>
      {event.description !== '' && <p style={styles.eventText}>{event.description}</p>}
      {event.participants.length > 0 && <div data-arkme-recording-timeline-participants style={styles.metaRow}>
        {event.participants.slice(0, 3).map(person => <span key={`person:${person}`} style={styles.chip}>{person}</span>)}
        {event.participants.length > 3 && <span style={styles.eventMore}>+{event.participants.length - 3}</span>}
      </div>}
    </button>
  </article>)}</div>
}

function RecordingTourSample({ tab, onTab }: { tab: RecordingTab; onTab(tab: RecordingTab): void }) {
  const [detailEvent, setDetailEvent] = useState<ArkmeRecordingTimelineEvent>()
  return <section data-arkme-recording-tour-sample aria-label={tr("示例体验 · 我的一天")} style={{ ...styles.analysis, gridTemplateRows: 'minmax(40px,auto) 40px minmax(0,1fr)', minHeight: 280, marginTop:'var(--arkme-recording-tour-sample-offset, 0px)' }}>
    <header style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr)', alignItems:'center', gap:6, padding:'0 12px', color:colors.secondary, fontSize:13 }}><span style={{ minWidth:0, overflowWrap:'anywhere', lineHeight:'18px' }}>{tr("示例体验 · 我的一天")}</span></header>
    <nav style={styles.tabs} aria-label={tr("示例录音内容")}><span style={{ ...styles.tabList, width:'100%', minWidth:0 }} data-arkme-recording-tour-target="tabs">{([['transcript','转写'],['summary','总结'],['timeline','时间轴']] as const).map(([id,label]) => <span key={id} style={{ ...styles.tabSlot, width:'auto', flex:1, minWidth:0 }}><button data-arkme-feedback="neutral" type="button" style={{ ...styles.tab, ...(tab === id ? styles.tabActive : {}) }} aria-current={tab === id ? 'page' : undefined} onClick={() => onTab(id)}><RecordingDesktopIcon name={id} size={14}/>{label}{tab === id && <span style={styles.tabIndicator}/>}</button></span>)}</span></nav>
    <div style={{ ...styles.pane, ...(tab === 'transcript' ? styles.transcriptPane : {}) }}>
      {tab === 'transcript' ? <ul style={styles.transcriptList}>{recordingTourSample.transcript.items.map(item => <ArkmeRecordingTranscriptRow key={item.itemId} item={item} selected={false} readOnly />)}</ul> : tab === 'summary' ? <ArkmeMarkdownBody text={recordingTourSample.summary.items[0]!.content} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.75 }} /> : <RecordingTimelineEvents events={recordingTourSample.timeline.items[0]!.timelineEvents} onOpen={setDetailEvent}/>}
    </div>
    {detailEvent !== undefined && <RecordingTimelineDetailDialog event={detailEvent} onClose={() => { setDetailEvent(undefined) }} />}
  </section>
}

export interface ArkmeRecordingSurfaceProps {
  active?: boolean
  onOpenRecordingImport(defaultStartAtMillis: number): void
  recordingRefreshRevision: number
  recordingImportStatus?: RecordingImportButtonStatus
}

export function ArkmeRecordingSurface({ onOpenRecordingImport, recordingRefreshRevision, recordingImportStatus = 'idle', active = true }: ArkmeRecordingSurfaceProps) {
  useArkmeLocale()
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const tour = useRecordingTour({ root: surfaceRef, auth: auth.auth, active: active && ui.mode === 'recordings', blocked: auth.busy || ui.webLoginDialogOpen === true, deepLink: ui.recordingTarget !== undefined, notificationRevision: ui.notificationActivationRevision ?? 0 })
  const [sampleTab, setSampleTab] = useState<RecordingTab>('transcript')
  const [mobileGuideOpen, setMobileGuideOpen] = useState(false)
  const mobileGuideTrigger = useRef<HTMLButtonElement>(null)
  const workbenchEnabled = auth.config?.recordingWorkbenchEnabled !== false
  const recordingMediaPath = auth.config?.mediaPath ?? '/arkme-self/api/media'
  const today = useRecordingCurrentLocalDay()
  const [selectedDate, setSelectedDate] = useState(today)
  const selectedDateRef = useRef(selectedDate.getTime())
  selectedDateRef.current = selectedDate.getTime()
  const [visibleMonth, setVisibleMonth] = useState(monthStart(today))
  const [activeTab, setActiveTab] = useState<RecordingTab | 'files'>('transcript')
  const [fileRefreshRevision, setFileRefreshRevision] = useState(0)
  const entityAccount = auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : ''
  const entities = useRecordingEntities(entityAccount, selectedDate.getTime(), active && workbenchEnabled && !tour.sample, `${recordingRefreshRevision}:${fileRefreshRevision}`)
  const [speechScope, setSpeechScope] = useState('')
  const [speechRevision, setSpeechRevision] = useState(0)
  useEffect(() => { setSpeechScope('') }, [entities.scope])
  useEffect(() => { if (entities.open) setSpeechScope('') }, [entities.open])
  const [entityFocus, setEntityFocus] = useState<{ scope: string; version: string; key: string; occurrence: RecordingEntityOccurrence }>()
  const [entityReveal, setEntityReveal] = useState<{ scope: string; version: string; key: string; sequence: number }>()
  const currentEntityReveal = entityReveal?.scope === entities.scope && entityReveal.version === entities.data?.version ? entityReveal : undefined
  const [calendar, setCalendar] = useState<ArkmeRecordingCalendarMonth>()
  const notificationWindow = ui.recordingTarget?.window && dateKey(new Date(`${ui.recordingTarget.window.date}T12:00:00`)) === dateKey(selectedDate) ? ui.recordingTarget.window : undefined
  const dayScope = `${entityAccount}:${selectedDate.getTime()}:${JSON.stringify(notificationWindow ?? null)}`
  const currentDayScope = useRef(dayScope)
  currentDayScope.current = dayScope
  const [daySnapshot, setDaySnapshot] = useState<{ scope: string; value: ArkmeRecordingDay }>()
  const day = daySnapshot?.scope === dayScope ? daySnapshot.value : undefined
  const dayRef = useRef(day)
  dayRef.current = day
  const dayReadRevision = useRef(0)
  const setDay = (update: ArkmeRecordingDay | undefined | ((current: ArkmeRecordingDay | undefined) => ArkmeRecordingDay | undefined)) => {
    setDaySnapshot(current => {
      if (currentDayScope.current !== dayScope) return current
      const previous = current?.scope === dayScope ? current.value : undefined
      const value = typeof update === 'function' ? update(previous) : update
      return value === undefined ? undefined : { scope: dayScope, value }
    })
  }
  const [dayRefreshError, setDayRefreshError] = useState('')
  const [dayRetryRevision, setDayRetryRevision] = useState(0)
  const localCoverage = useLocalRecordingCoverage(auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${String(auth.auth.userId)}` : undefined, selectedDate.getTime(), day?.coverage?.intervals)
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [dayLoading, setDayLoading] = useState(true)
  const [calendarError, setCalendarError] = useState('')
  const [dayError, setDayError] = useState('')
  // Do not retain local placeholders once the cloud has confirmed their complete range.
  const coverage = [...(day?.coverage?.intervals ?? []), ...localCoverage.filter(local => local.status === 'recording' || !recordingCoverageContains(day?.coverage?.intervals ?? [], local.startAtMillis, local.endAtMillis))]
  const awaitingCoverageSync = coverage.some(range => range.status === 'submitted')
  const awaitingAsrInputMetrics = (day?.transcript.dailyMetrics?.asrInputPendingCount ?? 0) > 0
  const [summaryVersionId, setSummaryVersionId] = useState('')
  const [timelineVersionId, setTimelineVersionId] = useState('')
  const [generatingKinds, setGeneratingKinds] = useState<Record<ArkmeRecordingProjectionKind, boolean>>({ summary: false, timeline: false })
  const [generationErrors, setGenerationErrors] = useState<Partial<Record<ArkmeRecordingProjectionKind, string>>>({})
  const generationAbortRef = useRef<Partial<Record<ArkmeRecordingProjectionKind, AbortController>>>({})
  const modelConfigAbortRef = useRef<AbortController>()
  const [modelConfig, setModelConfig] = useState<RecordingModelConfigState>({ state: 'loading' })
  const [modelDialogKind, setModelDialogKind] = useState<ArkmeRecordingProjectionKind>()
  const [timelineDetailEvent, setTimelineDetailEvent] = useState<ArkmeRecordingTimelineEvent>()
  const [editingSpeaker, setEditingSpeaker] = useState<{ item: ArkmeRecordingWorkbenchItem; anchor: RecordingSpeakerPopoverAnchor; initialBatchUpdate: boolean; initialReview?: boolean }>()
  const [exportNotice, setExportNotice] = useState('')
  const [audioFileCount, setAudioFileCount] = useState<RecordingFilesCount>()
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const [transcriptMatchIndex, setTranscriptMatchIndex] = useState(0)
  const transcriptRootRef = useRef<HTMLDivElement>(null)
  const speakerMutationRevision = useRef(0)
  const speakerScrollAnchor = useRef<ReturnType<typeof captureRecordingScrollAnchor>>()
  const [speakerFeedback, setSpeakerFeedback] = useState<{ itemId: string; message: string; visible: boolean }>()
  useEffect(() => { setSpeakerFeedback(undefined); speakerScrollAnchor.current = undefined }, [selectedDate, auth.auth?.environment, auth.auth?.userId])
  useEffect(() => {
    if (!speakerFeedback?.visible) return
    const timer = setTimeout(() => { setSpeakerFeedback(current => current ? { ...current, visible: false } : current) }, 4_000)
    return () => { clearTimeout(timer) }
  }, [speakerFeedback])
  useLayoutEffect(() => {
    const anchor = speakerScrollAnchor.current
    speakerScrollAnchor.current = undefined
    if (!anchor) return
    anchor.restore()
    const scrollTop = anchor.pane.scrollTop
    if (typeof requestAnimationFrame === 'undefined') return
    // content-visibility may finish layout in the next frame. Respect any intervening user scroll.
    const frame = requestAnimationFrame(() => { if (anchor.pane.scrollTop === scrollTop) anchor.restore() })
    return () => { cancelAnimationFrame(frame) }
  }, [day])
  const applySpeakerUpdate = (next: ArkmeRecordingDay, removal?: RecordingSpeakerUpdateFeedback) => {
    if (next.dateStamp !== (notificationWindow?.dateStamp ?? selectedDateRef.current)) return
    speakerMutationRevision.current += 1
    setSpeechRevision(value => value + 1)
    speakerScrollAnchor.current = captureRecordingScrollAnchor(transcriptRootRef.current, removal?.itemId ?? editingSpeaker?.item.itemId)
    setDay(next)
    setSpeakerFeedback(undefined)
    if (removal && !removal.warning) {
      const item = next.transcript.items.find(candidate => candidate.itemId === removal.itemId)
      if (item && !item.assignedSpeakerOptionKey) setSpeakerFeedback({ itemId: item.itemId, visible: true,
        message: removal.scope === 'speaker' ? tr('已取消 {v0} 处标记', { v0: removal.count })
          : tr('已取消标记，恢复为「{v0}」', { v0: item.speakerLabel }) })
    }
  }
  const [comparison, setComparison] = useState<PreparedRecordingComparison>()
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const comparisonRequest = useRef<AbortController>()
  const [selectionMode, setSelectionMode] = useState(false)
  const [forwardAttempt, setForwardAttempt] = useState(() => createRecordingForwardAttempt([]))
  const selectedForwardItems = forwardAttempt.items
  const [forwardOpen, setForwardOpen] = useState(false)
  const playback = useRecordingPlayback(recordingMediaPath)
  const selectedTimelineMillis = playback.positionAtMillis
  const layoutMode = useSyncExternalStore(subscribeRecordingLayout, currentRecordingLayoutMode, () => 'wide')
  const entityDrawer = useSyncExternalStore(subscribeRecordingLayout, () => typeof window !== 'undefined' && window.innerWidth < 1440, () => false)

  useEffect(() => {
    if (!active || !workbenchEnabled) setMobileGuideOpen(false)
  }, [active, workbenchEnabled])

  useEffect(() => {
    for (const controller of Object.values(generationAbortRef.current)) controller?.abort()
    generationAbortRef.current = {}
    setGeneratingKinds({ summary: false, timeline: false })
    setGenerationErrors({})
    setModelDialogKind(undefined)
    setEditingSpeaker(undefined)
    return () => {
      for (const controller of Object.values(generationAbortRef.current)) controller?.abort()
      generationAbortRef.current = {}
      playback.stop()
    }
  }, [playback.stop, selectedDate, entityAccount])

  useEffect(() => {
    setEditingSpeaker(undefined)
  }, [auth.auth?.status, auth.auth?.environment, auth.auth?.userId])

  const loadModelConfig = (dialogKind?: ArkmeRecordingProjectionKind) => {
    const controller = new AbortController()
    const requestedDateStamp = selectedDate.getTime()
    modelConfigAbortRef.current?.abort()
    modelConfigAbortRef.current = controller
    setModelConfig({ state: 'loading' })
    void callArkme<ArkmeRecordingSummaryModelConfig>('recordings.summary-model-config', undefined, controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        setModelConfig({ state: 'ready', value })
        if (dialogKind !== undefined && selectedDateRef.current === requestedDateStamp) {
          if (value.options.length > 0) setModelDialogKind(dialogKind)
          else setGenerationErrors(current => ({ ...current, [dialogKind]: tr('暂无可用生成模型，请稍后重试。') }))
        }
      })
      .catch(error => {
        if (controller.signal.aborted) return
        const message = errorMessage(error)
        setModelConfig({ state: 'error', message })
        if (dialogKind !== undefined && selectedDateRef.current === requestedDateStamp) setGenerationErrors(current => ({ ...current, [dialogKind]: message }))
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
    const target = ui.recordingTarget
    if (target === undefined || !isRecordingLocalDateOnOrAfterMinimum(target.dateStamp)) return
    const targetDate = startOfLocalDay(target.window ? new Date(`${target.window.date}T12:00:00`) : new Date(target.dateStamp))
    setSelectedDate(current => current.getTime() === targetDate.getTime() ? current : targetDate)
    setVisibleMonth(current => current.getTime() === monthStart(targetDate).getTime() ? current : monthStart(targetDate))
    setActiveTab(target.summary ? 'summary' : target.timeline ? 'timeline' : 'transcript')
    setSelectionMode(false)
    setEditingSpeaker(undefined)
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
  }, [visibleMonth, recordingRefreshRevision, fileRefreshRevision, entityAccount])

  useEffect(() => {
    const controller = new AbortController()
    const readRevision = ++dayReadRevision.current
    const initialRead = dayRef.current === undefined
    if (initialRead) {
      setDay(undefined); setDayLoading(true)
      setSummaryVersionId(''); setTimelineVersionId('')
    }
    setDayError(''); setDayRefreshError('')
    const mutationRevision = speakerMutationRevision.current
    void callArkme<ArkmeRecordingDay>('recordings.day', { dateStamp: selectedDate.getTime(), ...(notificationWindow ? { window: notificationWindow } : {}) }, controller.signal)
      .then(result => {
        if (controller.signal.aborted || currentDayScope.current !== dayScope || readRevision !== dayReadRevision.current || mutationRevision !== speakerMutationRevision.current) return
        const { day: value, error } = reconcileRecordingDayRefresh(dayRef.current, result)
        setDay(value)
        setDayRefreshError(error)
        setSummaryVersionId(current => initialRead && notificationWindow && ui.recordingTarget?.summary?.versionId ? ui.recordingTarget.summary.versionId : notificationWindow && current === ui.recordingTarget?.summary?.versionId ? current : reconcileRecordingVersionId(current, value.summary.items))
        setTimelineVersionId(current => initialRead && notificationWindow && ui.recordingTarget?.timeline?.versionId ? ui.recordingTarget.timeline.versionId : notificationWindow && current === ui.recordingTarget?.timeline?.versionId ? current : reconcileRecordingVersionId(current, value.timeline.items))
      })
      .catch(error => {
        if (controller.signal.aborted || currentDayScope.current !== dayScope || readRevision !== dayReadRevision.current) return
        if (dayRef.current) setDayRefreshError(errorMessage(error))
        else setDayError(errorMessage(error))
      })
      .finally(() => { if (!controller.signal.aborted) setDayLoading(false) })
    return () => { controller.abort() }
  }, [dayScope, recordingRefreshRevision, fileRefreshRevision, dayRetryRevision])

  useEffect(() => {
    if (!active || (!awaitingCoverageSync && !awaitingAsrInputMetrics && day?.summary.state !== 'processing' && day?.timeline.state !== 'processing' && day?.transcript.state !== 'processing' && !day?.coverage?.intervals.some(range => range.status === 'processing'))) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const poll = async () => {
      if (controller.signal.aborted) return
      attempts += 1
      const readRevision = ++dayReadRevision.current
      const mutationRevision = speakerMutationRevision.current
      try {
        const result = await callArkme<ArkmeRecordingDay>(
          'recordings.day',
          { dateStamp: selectedDate.getTime(), ...(notificationWindow ? { window: notificationWindow } : {}) },
          controller.signal,
        )
        if (controller.signal.aborted || currentDayScope.current !== dayScope) return
        if (readRevision !== dayReadRevision.current || mutationRevision !== speakerMutationRevision.current) {
          timer = setTimeout(() => { void poll() }, 1_500)
          return
        }
        const { day: next, error } = reconcileRecordingDayRefresh(dayRef.current, result)
        setDay(next)
        setDayRefreshError(error)
        setSummaryVersionId(current => notificationWindow && current === ui.recordingTarget?.summary?.versionId ? current : reconcileRecordingVersionId(current, next.summary.items))
        setTimelineVersionId(current => notificationWindow && current === ui.recordingTarget?.timeline?.versionId ? current : reconcileRecordingVersionId(current, next.timeline.items))
        if (!controller.signal.aborted && (awaitingCoverageSync || (next.transcript.dailyMetrics?.asrInputPendingCount ?? 0) > 0 || next.summary.state === 'processing' || next.timeline.state === 'processing' || next.transcript.state === 'processing' || next.coverage?.intervals.some(range => range.status === 'processing'))) {
          timer = setTimeout(() => { void poll() }, attempts < 90 ? 3_000 : 15_000)
        }
      } catch (error) {
        if (!controller.signal.aborted && currentDayScope.current === dayScope && readRevision === dayReadRevision.current) setDayRefreshError(errorMessage(error))
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, attempts < 90 ? 5_000 : 15_000)
      }
    }
    timer = setTimeout(() => { void poll() }, 1_500)
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [active, awaitingCoverageSync, awaitingAsrInputMetrics, day?.summary.state, day?.timeline.state, day?.transcript.state, day?.coverage?.intervals.some(range => range.status === 'processing'), dayScope, recordingRefreshRevision, fileRefreshRevision, dayRetryRevision])

  const appliedSummaryTarget = useRef<typeof ui.recordingTarget>()
  const [missingSummaryTarget, setMissingSummaryTarget] = useState<typeof ui.recordingTarget>()
  useEffect(() => {
    const target = ui.recordingTarget
    if (target?.window || !target?.summary || dayLoading || !day || day.dateStamp !== selectedDate.getTime()
      || dateKey(new Date(target.dateStamp)) !== dateKey(selectedDate) || appliedSummaryTarget.current === target) return
    const version = target.summary.versionId ? day.summary.items.find(item => item.id === target.summary!.versionId && item.selectable) : undefined
    if (version) setSummaryVersionId(version.id)
    if (!version && day.summary.state === 'processing') return
    appliedSummaryTarget.current = target
    setMissingSummaryTarget(target.summary.versionId && !version ? target : undefined)
  }, [ui.recordingTarget, day, dayLoading, selectedDate])
  const summarySourceUnavailable = missingSummaryTarget !== undefined && missingSummaryTarget === ui.recordingTarget
    && dateKey(new Date(missingSummaryTarget.dateStamp)) === dateKey(selectedDate)

  const appliedTimelineTarget = useRef<typeof ui.recordingTarget>()
  const [missingTimelineTarget, setMissingTimelineTarget] = useState<typeof ui.recordingTarget>()
  useEffect(() => {
    const target = ui.recordingTarget
    if (target?.window || !target?.timeline || dayLoading || !day || day.dateStamp !== selectedDate.getTime()
      || dateKey(new Date(target.dateStamp)) !== dateKey(selectedDate) || appliedTimelineTarget.current === target) return
    const version = target.timeline.versionId ? day.timeline.items.find(item => item.id === target.timeline!.versionId && item.selectable) : undefined
    if (version) setTimelineVersionId(version.id)
    if (!version && day.timeline.state === 'processing') return
    appliedTimelineTarget.current = target
    setMissingTimelineTarget(target.timeline.versionId && !version ? target : undefined)
  }, [ui.recordingTarget, day, dayLoading, selectedDate])
  const timelineSourceUnavailable = missingTimelineTarget !== undefined && missingTimelineTarget === ui.recordingTarget
    && dateKey(new Date(missingTimelineTarget.dateStamp)) === dateKey(selectedDate)

  const [exactVersion, setExactVersion] = useState<{ target: typeof ui.recordingTarget; version: ArkmeRecordingVersion | null; error?: string }>()
  const [exactVersionReadRevision, setExactVersionReadRevision] = useState(0)
  useEffect(() => {
    const target = ui.recordingTarget
    const versionId = target?.summary?.versionId ?? target?.timeline?.versionId
    if (!target?.window || !versionId) { setExactVersion(undefined); return }
    const controller = new AbortController()
    if (target.summary) setSummaryVersionId(versionId); else setTimelineVersionId(versionId)
    setExactVersion(undefined)
    void callArkme<{ version: ArkmeRecordingVersion | null }>('recordings.workflow', {
      operation: 'version', versionId, kind: target?.summary ? 'summary' : 'timeline',
    }, controller.signal).then(result => {
      if (!controller.signal.aborted) setExactVersion({ target, version: result.version })
    }).catch(error => { if (!controller.signal.aborted) setExactVersion({ target, version: null, error: errorMessage(error) }) })
    return () => controller.abort()
  }, [ui.recordingTarget, auth.auth, exactVersionReadRevision])
  const exactTargetActive = ui.recordingTarget !== undefined && (ui.recordingTarget.window ? dateKey(new Date(`${ui.recordingTarget.window.date}T12:00:00`)) : dateKey(new Date(ui.recordingTarget.dateStamp))) === dateKey(selectedDate)
  const exactTargetVersion = exactTargetActive && exactVersion?.target === ui.recordingTarget ? exactVersion : undefined

  const calendarByDay = useMemo(() => new Map((calendar?.days ?? []).map(item => [dateKey(item.dateStamp), item])), [calendar])
  const monthDates = useMemo(() => monthCalendarCells(visibleMonth), [visibleMonth])
  const selectedSummary = exactTargetActive && ui.recordingTarget?.window && ui.recordingTarget.summary?.versionId && summaryVersionId === ui.recordingTarget.summary.versionId ? exactTargetVersion?.version ?? undefined : day?.summary.items.find(version => version.id === summaryVersionId && version.selectable)
  const selectedTimeline = exactTargetActive && ui.recordingTarget?.window && ui.recordingTarget.timeline?.versionId && timelineVersionId === ui.recordingTarget.timeline.versionId ? exactTargetVersion?.version ?? undefined : day?.timeline.items.find(version => version.id === timelineVersionId && version.selectable)
  const transcriptItems = useMemo(() => day?.transcript.state === 'ready' ? day.transcript.items : [], [day?.transcript])
  const entityUnderlinesByItem = useMemo(() => {
    const underline = createRecordingEntityUnderliner(entities.data?.entities ?? [])
    return new Map(transcriptItems.map(item => [item.itemId, underline(item.text)]))
  }, [transcriptItems, entities.data?.entities])
  const openTranscriptEntity = (key: string) => {
    if (!entities.data?.entities?.some(entity => entity.key === key)) return
    setEntityReveal(previous => ({ scope: entities.scope, version: entities.data!.version, key, sequence: (previous?.sequence ?? 0) + 1 }))
    entities.setOpen(true)
  }
  const [transcriptNavigation, setTranscriptNavigation] = useState<{ dateStamp: number; itemId: string }>()
  const entityOccurrence = entityFocus?.scope === entities.scope && entityFocus.version === entities.data?.version ? entityFocus.occurrence : undefined
  const entityTarget = entityOccurrence?.target
  const focusedEntity = entityOccurrence ? entities.data?.entities?.find(entity => entity.key === entityFocus?.key) : undefined
  const entityItem = entityTarget ? transcriptItems.find(item => item.searchIdentityHash === entityTarget.identityHash && item.searchVersion === entityTarget.transcriptVersion && item.transcriptSource === entityTarget.transcriptSource && Array.from(item.text).slice(entityTarget.start, entityTarget.start + entityTarget.length).join('') === entityOccurrence?.observedText) : undefined
  const locateEntity = (occurrence: RecordingEntityOccurrence, key: string): boolean => {
    const target = occurrence.target
    const item = target && transcriptItems.find(item => item.searchIdentityHash === target.identityHash && item.searchVersion === target.transcriptVersion && item.transcriptSource === target.transcriptSource && Array.from(item.text).slice(target.start, target.start + target.length).join('') === occurrence.observedText)
    if (!item || !entities.data) return false
    setEntityFocus({ scope: entities.scope, version: entities.data.version, key, occurrence })
    setActiveTab('transcript'); setSelectionMode(false)
    setTranscriptNavigation({ dateStamp: selectedDate.getTime(), itemId: item.itemId })
    return true
  }
  const openSpeechSource = (source: SpeechSource, action: 'play' | 'locate') => {
    const item = source.items.find(value => value.itemId === source.focusItemId)
    if (!item || !item.isSelf) throw new Error(tr('人物标记已变化，请更新统计'))
    if (action === 'play') {
      const target = source.playbackTargets?.find(value => value.itemId === item.itemId)?.item ?? (item.transcriptSource === 'system' ? item : undefined)
      if (!target) throw new Error(tr('这段原文暂无可播放的音频'))
      void playback.playItem(target, item.startAtMillis)
    } else {
      if (source.segment) arkmeUi.showRecordingTarget(source.dateStamp, item.startAtMillis, source.segment)
      else if (transcriptItems.some(value => value.itemId === item.itemId)) {
        setActiveTab('transcript'); setTranscriptNavigation({ dateStamp: source.dateStamp, itemId: item.itemId })
      } else throw new Error(tr('当前转写中找不到精确位置，请切换到对应转写版本'))
      setSpeechScope('')
    }
  }
  const navigateTranscript = (value: number) => {
    const item = transcriptItems.find(item => item.endAtMillis > value) ?? transcriptItems.at(-1)
    if (!item) return
    setActiveTab('transcript')
    setTranscriptNavigation({ dateStamp: selectedDate.getTime(), itemId: item.itemId })
  }
  useEffect(() => {
    if (!transcriptNavigation || transcriptNavigation.dateStamp !== selectedDate.getTime() || activeTab !== 'transcript') return
    const row = [...(transcriptRootRef.current?.querySelectorAll<HTMLElement>('[data-recording-transcript-item]') ?? [])].find(row => row.dataset.recordingTranscriptItem === transcriptNavigation.itemId)
    row?.scrollIntoView({ block: 'start' })
  }, [transcriptNavigation, activeTab, selectedDate])
  const preciseTarget = ui.recordingTarget?.segment
  const preciseTargetDay = ui.recordingTarget !== undefined && (ui.recordingTarget.window ? dateKey(new Date(`${ui.recordingTarget.window.date}T12:00:00`)) : dateKey(new Date(ui.recordingTarget.dateStamp))) === dateKey(selectedDate)
  const [preciseResolution, setPreciseResolution] = useState<{ target: typeof preciseTarget; items: typeof transcriptItems; item?: ArkmeRecordingWorkbenchItem }>()
  useEffect(() => {
    let cancelled = false
    if (!preciseTarget || !preciseTargetDay) { setPreciseResolution(undefined); return }
    void resolveRecordingSearchTarget(transcriptItems, preciseTarget).then(item => {
      if (!cancelled) setPreciseResolution({target:preciseTarget,items:transcriptItems,...(item ? {item} : {})})
    }).catch(() => { if (!cancelled) setPreciseResolution({target:preciseTarget,items:transcriptItems}) })
    return () => { cancelled = true }
  }, [preciseTarget,preciseTargetDay,transcriptItems])
  const preciseResolved = preciseResolution?.target === preciseTarget && preciseResolution?.items === transcriptItems
  const preciseItem = preciseTargetDay && preciseResolved ? preciseResolution?.item : undefined
  const preciseUnavailable = preciseTarget !== undefined && preciseTargetDay && preciseResolved && !dayLoading && day !== undefined && day.dateStamp === selectedDate.getTime() && day.transcript.state !== 'processing' && preciseItem === undefined
  useEffect(() => {
    if (preciseItem === undefined || activeTab !== 'transcript') return
    const row = [...(transcriptRootRef.current?.querySelectorAll<HTMLElement>('[data-recording-transcript-item]') ?? [])].find(element => element.dataset.recordingTranscriptItem === preciseItem.itemId)
    row?.scrollIntoView({block:'center'})
  }, [preciseItem, activeTab])
  const transcriptMatches = useMemo(() => findRecordingTranscriptMatches(transcriptItems, transcriptSearch), [transcriptItems, transcriptSearch])
  const matchesByItem = useMemo(() => {
    const grouped = new Map<string, Array<(typeof transcriptMatches)[number] & { index: number }>>()
    transcriptMatches.forEach((match, index) => { const items = grouped.get(match.itemId) ?? []; items.push({ ...match, index }); grouped.set(match.itemId, items) })
    return grouped
  }, [transcriptMatches])
  const activeMatchIndex = Math.min(transcriptMatchIndex, Math.max(0, transcriptMatches.length - 1))
  useEffect(() => {
    setTranscriptSearch(''); setTranscriptMatchIndex(0); setComparison(undefined)
    setTimelineDetailEvent(undefined)
    comparisonRequest.current?.abort(); comparisonRequest.current = undefined; setComparisonLoading(false)
    setForwardOpen(false); setSelectionMode(false); setForwardAttempt(createRecordingForwardAttempt([]))
    return () => { comparisonRequest.current?.abort(); comparisonRequest.current = undefined }
  }, [selectedDate, activeTab, auth.auth?.userId, auth.auth?.environment])
  useEffect(() => {
    transcriptRootRef.current?.querySelector(`[data-recording-match="${String(activeMatchIndex)}"]`)?.scrollIntoView({ block: 'center' })
  }, [activeMatchIndex, transcriptMatches])
  const emptyDay = !dayLoading && dayError === '' && day?.transcript.state === 'empty'
  const noRecordings = !dayLoading && dayError === '' && recordingImportStatus === 'idle' && recordingDayIsEmpty(day, selectedDate.getTime(), coverage)
  const cleanEmptyDay = noRecordings && !tour.sample && !(exactTargetActive && ui.recordingTarget?.window && (ui.recordingTarget.summary || ui.recordingTarget.timeline))
  const selectedDayKey = dateKey(selectedDate).split('-').map(part => part.padStart(2, '0')).join('-')
  const configuredModelName = modelConfig.state === 'ready'
    ? modelConfig.value.options.find(option => option.routeKey === modelConfig.value.effectiveRouteKey)?.displayName ?? ''
    : ''

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
        { dateStamp, kind, ...(routeKey === '' ? {} : { routeKey }), ...(notificationWindow ? { window: notificationWindow } : {}) },
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
    if (modelConfig.state === 'loading') return
    setGenerationErrors(current => {
      const next = { ...current }
      delete next[kind]
      return next
    })
    if (modelConfig.state === 'ready' && modelConfig.value.options.length > 0) {
      setModelDialogKind(kind)
      return
    }
    loadModelConfig(kind)
  }

  const openComparison = async () => {
    if (comparisonRequest.current !== undefined) return
    const controller = new AbortController(); comparisonRequest.current = controller
    setComparisonLoading(true); setExportNotice('')
    const timeout = setTimeout(() => { controller.abort(); if (comparisonRequest.current === controller) { comparisonRequest.current = undefined; setComparisonLoading(false); setExportNotice('读取转写超时，请重试') } }, 30_000)
    try {
      const prepared = await prepareRecordingTranscriptComparison(selectedDate.getTime(), controller.signal)
      if (!controller.signal.aborted) { playback.stop(); setComparison(prepared) }
    } catch (reason) {
      if (!controller.signal.aborted) setExportNotice(errorMessage(reason))
    } finally {
      clearTimeout(timeout)
      if (comparisonRequest.current === controller) { comparisonRequest.current = undefined; setComparisonLoading(false) }
    }
  }

  const toggleTranscriptSelection = (item: ArkmeRecordingWorkbenchItem) => {
    if (selectedForwardItems.some(selected => selected.itemId === item.itemId)) {
      setForwardAttempt(createRecordingForwardAttempt(selectedForwardItems.filter(selected => selected.itemId !== item.itemId))); return
    }
    if (selectedForwardItems.length >= RECORDING_FORWARD_MAX_SEGMENTS) { setExportNotice('最多选择 150 个录音片段'); return }
    if (selectedForwardItems[0] !== undefined && (selectedForwardItems[0].sessionKey !== item.sessionKey || selectedForwardItems[0].transcriptSource !== item.transcriptSource)) { setExportNotice('请选择同一次录音、同一转写来源的片段'); return }
    setExportNotice(''); setForwardAttempt(createRecordingForwardAttempt([...selectedForwardItems, item]))
  }

  const renderTranscript = () => {
    const section = day?.transcript
    if (dayLoading) return <ArkmeRecordingTranscriptLoading />
    if (preciseUnavailable) return <p role="alert">{tr('该转写条目已更新或不可用，请重新搜索')}</p>
    if (section?.state === 'processing') return <ArkmeRecordingTranscriptLoading />
    if (section === undefined || section.state !== 'ready') return <SectionState section={section} loading={false} />
    return <>{section.processingCount > 0 && <ArkmeRecordingTranscriptLoading />}<ul style={styles.transcriptList}>{section.items.map((item, index) => {
      const selected = selectedTimelineMillis !== undefined && selectedTimelineMillis >= item.startAtMillis && selectedTimelineMillis < item.endAtMillis
      const editSpeaker = (event: MouseEvent<HTMLButtonElement>) => {
        if (!workbenchEnabled) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (speakerFeedback?.itemId !== item.itemId) setSpeakerFeedback(undefined)
        setEditingSpeaker(current => current?.item.itemRef === item.itemRef ? undefined : {
          item,
          anchor: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          initialBatchUpdate: false,
        })
      }
      return <ArkmeRecordingTranscriptRow
        key={item.itemId}
        item={item}
        repeatedSpeaker={speakerFeedback?.itemId !== item.itemId && recordingTranscriptContinuesSpeaker(section.items[index - 1], item)}
        speakerUpdated={speakerFeedback?.itemId === item.itemId && speakerFeedback.visible}
        speakerEditing={editingSpeaker?.item.itemRef === item.itemRef}
        isPlaying={playback.isPlaying && playback.activeItemRef === item.itemRef}
        selected={preciseItem?.itemId === item.itemId || selected}
        searchHighlighted={preciseItem?.itemId === item.itemId || entityItem?.itemId === item.itemId}
        selectionControl={selectionMode && <input type="checkbox" aria-label={`选择录音片段 ${recordingTranscriptTimeLabel(item.startAtMillis)}`} checked={selectedForwardItems.some(selected => selected.itemId === item.itemId)} onClick={event => { event.stopPropagation() }} onChange={() => { toggleTranscriptSelection(item) }} />}
        {...(selectionMode ? { onToggleSelection: () => { toggleTranscriptSelection(item) } } : {})}
        text={<RecordingTranscriptText text={item.text} matches={matchesByItem.get(item.itemId) ?? []} activeIndex={activeMatchIndex} entityRanges={entityUnderlinesByItem.get(item.itemId) ?? []} onEntityClick={openTranscriptEntity} {...(entityItem?.itemId === item.itemId && entityTarget ? { entityRange: { ...entityTarget, ...(focusedEntity ? { entityKey: focusedEntity.key, name: focusedEntity.name } : {}) } } : {})} />}
        onEditSpeaker={editSpeaker}
        onSelect={() => { tour.finish(false); void playback.playItem(item) }}
      />
    })}</ul></>
  }

  // Notification reads never imply generation or silently select a different result.
  const renderNotificationVersionState = (kind: 'summary' | 'timeline', selectedId: string, onChange: (id: string) => void) => {
    const requestedId = ui.recordingTarget?.[kind]?.versionId
    if (!exactTargetActive || !ui.recordingTarget?.window || !requestedId || (selectedId && selectedId !== requestedId)) return null
    if (!exactTargetVersion) return <SectionState section={undefined} loading kind={kind} />
    if (exactTargetVersion.version) return null
    const alternatives = (day?.[kind].items ?? []).filter(item => item.selectable && item.id !== requestedId)
    const message = exactTargetVersion.error !== undefined
      ? tr(kind === 'summary' ? '读取总结失败：{v0}' : '读取时间轴失败：{v0}', { v0: exactTargetVersion.error })
      : tr(kind === 'summary' ? '当前账号下未找到该总结版本。' : '当前账号下未找到该时间轴版本。')
    return <>
      <div role={exactTargetVersion.error !== undefined ? 'alert' : 'status'} style={exactTargetVersion.error !== undefined ? styles.error : styles.status}>
        {message} <button type="button" style={{ color: 'inherit', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { setExactVersion(undefined); setExactVersionReadRevision(value => value + 1) }}>{tr('重新读取')}</button>
      </div>
      {alternatives.length > 0 && <div style={styles.versionBar}>
        <span style={styles.versionLabel}>{tr('历史版本：')}</span>
        <RecordingAnalysisDropdown ariaLabel={`切换${kind === 'summary' ? tr('总结') : tr('时间轴')}版本`} value={requestedId}
          options={[{ value: requestedId, label: tr('选择其他版本') }, ...alternatives.map(item => ({ value: item.id, label: versionLabel(item) }))]}
          width={320} variant="version" onChange={onChange} />
      </div>}
    </>
  }

  const renderSummary = () => {
    const section = day?.summary
    const notificationState = renderNotificationVersionState('summary', summaryVersionId, setSummaryVersionId)
    if (notificationState) return notificationState
    const sourceNotice = summarySourceUnavailable && <div role="status" style={styles.status}>{tr('来源总结版本暂不可用，当前显示该日可用内容。')}</div>
    if (dayLoading || section === undefined || selectedSummary === undefined) return <>
      {sourceNotice}
      <SectionState
        section={generatingKinds.summary && section?.state !== 'processing'
          ? { state: 'processing', items: section?.items ?? [], message: '内容仍在生成' }
          : section}
        loading={dayLoading}
        kind="summary"
        analysisVersion={section?.items[0]}
        modelName={configuredModelName}
        modelLoading={modelConfig.state === 'loading'}
        onGenerate={() => { openModelDialog('summary') }}
      />
    </>
    return <>
      {sourceNotice}
      <StatusBanner section={section} />
      <ArkmeMarkdownBody text={selectedSummary.content} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.75 }} />
    </>
  }

  const renderTimeline = () => {
    const section = day?.timeline
    const notificationState = renderNotificationVersionState('timeline', timelineVersionId, setTimelineVersionId)
    if (notificationState) return notificationState
    const sourceNotice = timelineSourceUnavailable && <div role="status" style={styles.status}>{tr('来源时间轴版本暂不可用，当前显示该日可用内容。')}</div>
    if (dayLoading || section === undefined || selectedTimeline === undefined) return <>
      {sourceNotice}
      <SectionState
        section={generatingKinds.timeline && section?.state !== 'processing'
          ? { state: 'processing', items: section?.items ?? [], message: '内容仍在生成' }
          : section}
        loading={dayLoading}
        kind="timeline"
        analysisVersion={section?.items[0]}
        modelName={configuredModelName}
        modelLoading={modelConfig.state === 'loading'}
        onGenerate={() => { openModelDialog('timeline') }}
      />
    </>
    return <>
      {sourceNotice}
      <StatusBanner section={section} />
      <RecordingTimelineEvents events={selectedTimeline.timelineEvents} onOpen={setTimelineDetailEvent} />
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

  const analysisKind = activeTab === 'summary' || activeTab === 'timeline' ? activeTab : undefined
  const analysisSection = analysisKind === undefined ? undefined : day?.[analysisKind]
  const analysisVersion = analysisKind === 'summary' ? selectedSummary : analysisKind === 'timeline' ? selectedTimeline : undefined
  const analysisFooter = !tour.sample && !dayLoading && dayError === '' && (!emptyDay || notificationWindow !== undefined)
    && analysisKind !== undefined && analysisSection !== undefined && analysisVersion !== undefined
    ? <VersionPicker
      kind={analysisKind}
      versions={analysisSection.items.some(item => item.id === analysisVersion.id) ? analysisSection.items : [analysisVersion, ...analysisSection.items]}
      selectedId={analysisVersion.id}
      generating={generatingKinds[analysisKind] || analysisSection.state === 'processing'}
      regenerateAvailable={modelConfig.state !== 'loading'}
      onChange={analysisKind === 'summary' ? setSummaryVersionId : setTimelineVersionId}
      onGenerate={() => { openModelDialog(analysisKind) }}
      onExport={downloadCurrent}
    /> : null

  return <div ref={surfaceRef} onClickCapture={event => {
    const target = event.target
    if (target instanceof Element && !target.closest('[data-arkme-recording-tour-sample], [data-arkme-recording-tour-panel]') && target.closest('button, [role="button"], input, select')) tour.finish(false)
  }} style={{
    ...styles.root,
    ...(layoutMode === 'compact' ? { gridTemplateColumns: '360px minmax(0,1fr)', padding: '16px 10px 0' } : {}),
    ...(layoutMode === 'stacked' ? { gridTemplateColumns: 'minmax(0,1fr)', gridTemplateRows: 'minmax(390px,52%) minmax(0,1fr)', padding: '12px 10px 0', overflowY: 'auto' } : {}),
    ...(tour.sample && layoutMode === 'stacked' ? { gridTemplateRows: '420px minmax(460px,1fr)' } : {}),
  }} data-arkme-recording-layout={layoutMode}>
    {tour.panel}
    {mobileGuideOpen && active && workbenchEnabled && <ArkmeRecordingMobileGuideDialog returnFocusRef={mobileGuideTrigger} onClose={() => { setMobileGuideOpen(false) }} />}
    <style data-arkme-recording-transcript-interactions>{`
      .arkme-recording-transcript-duration { position: absolute; right: 0; top: 0; width: max-content; visibility: hidden; }
      .arkme-recording-transcript-row:hover .arkme-recording-transcript-timestamp,
      .arkme-recording-transcript-row:focus-within .arkme-recording-transcript-timestamp { visibility: hidden; }
      .arkme-recording-transcript-row:hover .arkme-recording-transcript-duration,
      .arkme-recording-transcript-row:focus-within .arkme-recording-transcript-duration { visibility: visible; }
      .arkme-recording-transcript-playing { display: inline-flex; vertical-align: middle; align-items: center; justify-content: center; gap: 2px; margin-left: 4px; width: 12px; height: 12px; color: ${colors.accent}; }
      .arkme-recording-transcript-playing > span { width: 2px; height: 10px; border-radius: 1px; background: currentColor; animation: arkme-transcript-playing 800ms ease-in-out infinite alternate; }
      .arkme-recording-transcript-playing > span:nth-child(2) { animation-delay: -400ms; }
      .arkme-recording-transcript-playing > span:nth-child(3) { animation-delay: -200ms; }
      @keyframes arkme-transcript-playing { from { transform: scaleY(.3); } to { transform: scaleY(1); } }
      @media (prefers-reduced-motion: reduce) { .arkme-recording-transcript-playing > span { animation: none; } }
      .arkme-recording-transcript-speaker:hover { background: ${colors.hover} !important; }
      .arkme-recording-transcript-speaker:focus-visible { background: ${colors.hover} !important; outline: 2px solid ${colors.accent}; outline-offset: 1px; }
      .arkme-recording-transcript-speaker[data-recording-speaker-repeated="true"] { opacity: 0; }
      .arkme-recording-transcript-speaker[data-recording-speaker-repeated="true"]:hover,
      .arkme-recording-transcript-speaker[data-recording-speaker-repeated="true"]:focus-visible,
      .arkme-recording-transcript-speaker[data-recording-speaker-repeated="true"][aria-expanded="true"] { opacity: 1; }
      .arkme-recording-transcript-edit { opacity: 0; pointer-events: none; }
      .arkme-recording-transcript-speaker:hover .arkme-recording-transcript-edit,
      .arkme-recording-transcript-speaker:focus-visible .arkme-recording-transcript-edit,
      .arkme-recording-transcript-speaker[aria-expanded="true"] .arkme-recording-transcript-edit { opacity: 1; pointer-events: auto; }
      @media (hover: none) {
        .arkme-recording-transcript-speaker[data-recording-speaker-repeated="true"] { opacity: 1; }
      }
    `}</style>
    <aside style={{ ...styles.left, ...(layoutMode === 'wide' ? {} : { width: '100%', overflowY: 'auto' }) }} aria-label={tr("录音日历")}>
      <section data-arkme-recording-tour-target="calendar" style={{ ...styles.calendar, ...(layoutMode === 'wide' ? {} : { width: '100%' }) }} aria-label={tr("选择录音日期")} aria-busy={calendarLoading}>
        <div style={{ paddingBottom: 8 }}><ArkmeCalendarMonthHeader visibleMonth={visibleMonth} selectedDate={selectedDate} today={today}
          onVisibleMonthChange={setVisibleMonth} onToday={() => { setVisibleMonth(monthStart(today)); setSelectedDate(today) }} /></div>
        <div style={styles.calendarGrid}><div style={styles.monthWeekdays} aria-hidden="true">{calendarWeekdays().map(value => <span key={value} style={styles.monthWeekday}>{value}</span>)}</div><div style={styles.monthGrid}>{monthDates.map((value, index) => {
          if (value === undefined) return <span key={`empty-${index}`} aria-hidden="true" style={styles.monthSpacer} />
          const meta = calendarByDay.get(dateKey(value)); const selected = dateKey(value) === dateKey(selectedDate); const future = value.getTime() > today.getTime()
          return <button data-arkme-feedback={selected ? "primary" : "neutral"} key={value.getTime()} type="button" style={{ ...styles.monthDay, ...styles.cellHeight, ...(selected ? styles.daySelected : {}), ...(future ? styles.monthDayDisabled : {}) }} aria-label={new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'long', day: 'numeric' }).format(value)} aria-pressed={selected} disabled={future} onClick={() => { chooseDate(value) }}><strong style={styles.monthDayNumber}>{value.getDate()}</strong><span style={{ ...styles.lunar, ...(selected ? { color: colors.onPrimaryAction } : {}) }}>{dateKey(value) === dateKey(today) ? tr("今天") : lunarDayLabel(value)}</span>{calendarLoading && selected ? <span style={{ ...styles.monthDuration, ...styles.selectedMonthDuration }} role="status">{tr("更新中")}</span> : meta !== undefined && meta.durationMillis > 0 && <span style={{ ...styles.monthDuration, ...(meta.durationMillis <= 60 * 60 * 1_000 ? styles.monthDurationBrief : {}), ...(selected ? styles.selectedMonthDuration : {}) }}>{recordingCalendarDuration(meta.durationMillis)}</span>}{meta !== undefined && meta.unreviewedCount > 0 && <span aria-label={tr("新录音")} style={{ position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: 4, background: colors.accent }} />}</button>
        })}</div></div>
      </section>
      <div style={styles.toolbar}>{workbenchEnabled && <>
        <ArkmeDirectRecordingButton onStart={() => { tour.finish(false); const now = new Date(); now.setHours(0, 0, 0, 0); setVisibleMonth(monthStart(now)); setSelectedDate(now) }} />
        <button data-arkme-feedback="neutral" ref={mobileGuideTrigger} type="button" style={styles.calendarActionButton} aria-haspopup="dialog" aria-expanded={mobileGuideOpen}
          onClick={() => { tour.finish(false); setMobileGuideOpen(true) }}><Microphone size={16} style={{ flexShrink: 0 }} aria-hidden />{tr("全天候录音")}</button>
        <RecognizedSpeakerEntry style={styles.calendarActionButton}
          accountKey={auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : undefined}
          active={active && ui.mode === 'recordings'}
          onOpen={() => { tour.finish(false); arkmeUi.showRecognizedSpeakers(selectedDate.getTime()) }} />
        <button data-arkme-feedback="neutral" type="button" style={styles.calendarActionButton}
          onClick={() => { tour.finish(false); arkmeUi.showVoiceprint() }}><Fingerprint size={16} aria-hidden />{tr("声纹管理")}<CaretRight size={12} aria-hidden /></button>
        <ArkmeRecordingImportTrigger fullWidth status={recordingImportStatus} onClick={() => { tour.finish(false); onOpenRecordingImport(selectedDate.getTime()) }} />
      </>}</div>
      {workbenchEnabled && <RecordingTotalMetricsLoader account={entityAccount} active={active && workbenchEnabled && !tour.sample} refreshRevision={`${recordingRefreshRevision}:${fileRefreshRevision}`} />}
      {workbenchEnabled && <ArkmeRecordingPresence accountKey={auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : undefined} active={active && ui.mode === 'recordings'} />}
      {workbenchEnabled && <ArkmeDirectRecordingStatus onShowTasks={() => onOpenRecordingImport(selectedDate.getTime())} />}
      {calendarError !== '' && <div style={styles.error} role="alert">{tr("录音日历更新失败")}：{calendarError} <button type="button" style={{ color: 'inherit', background: 'transparent', border: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setFileRefreshRevision(value => value + 1)}>{tr("重试更新日历")}</button></div>}{calendarLoading && calendar === undefined && <div style={styles.status}>{tr("正在读取录音…")}</div>}
    </aside>
    <section style={{ ...styles.content, ...((selectionMode || cleanEmptyDay) ? { gridTemplateRows: 'auto minmax(0,1fr)' } : {}) }} aria-label={tr("录音详情")}>
      <header style={styles.dateHeading}>
        <time dateTime={selectedDayKey}>
          {new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(selectedDate)} · {new Intl.DateTimeFormat(arkmeIntlLocale(), { weekday: 'long' }).format(selectedDate)}
          <ArkmeCalendarLunarDate date={selectedDayKey} />
        </time>
      </header>
      {cleanEmptyDay ? <div role="status" aria-label={tr('当天暂无录音')} style={{ display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 10, minHeight: 160, color: colors.tertiary, fontSize: 13 }}>
        <span>{tr('当天暂无录音')}</span>
      </div> : <>
      {!selectionMode && <div style={styles.dayTimeline}>{workbenchEnabled && <RecordingTranscriptTimeline key={selectedDate.getTime()} transcriptRoot={transcriptRootRef} followTranscript={active && activeTab === 'transcript' && !tour.sample && !dayLoading} onNavigateAtMillis={navigateTranscript} arrangementEntry={!tour.sample && <RecordingDayArrangements dateStamp={selectedDate.getTime()} accountScope={auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : ''} active={active && ui.mode === 'recordings'} refreshRevision={`${recordingRefreshRevision}:${fileRefreshRevision}`} />} items={transcriptItems} coverage={coverage} dailyMetrics={dayError || day?.dateStamp !== selectedDate.getTime() ? undefined : day?.transcript.dailyMetrics} coverageState={dayError || day?.transcript.state === 'error' ? 'error' : day?.coverage?.state ?? 'partial'} dayStartMillis={selectedDate.getTime()} loading={dayLoading} emptyState={emptyDay} onEditSpeaker={(item, anchor) => { tour.finish(false); setEditingSpeaker(current => current?.item.itemRef === item.itemRef ? undefined : { item, anchor, initialBatchUpdate: true }) }} onReviewSpeaker={(item, anchor) => { tour.finish(false); setEditingSpeaker({ item, anchor, initialBatchUpdate: true, initialReview: true }) }} onImportAudio={() => { tour.finish(false); onOpenRecordingImport(selectedDate.getTime()) }} {...(selectedTimelineMillis === undefined ? {} : { playheadMillis: selectedTimelineMillis })} isPlaying={playback.isPlaying} playbackLoading={playback.isLoading} onSelectAtMillis={value => { tour.finish(false); navigateTranscript(value); void playback.selectAt(transcriptItems, value) }} onTogglePlayback={() => { tour.finish(false); if (transcriptItems[0] !== undefined) void playback.toggleAt(transcriptItems, selectedTimelineMillis ?? transcriptItems[0].startAtMillis) }} />}{workbenchEnabled && playback.isLoading && <div role="status" style={{ color: colors.secondary, fontSize: 12 }}>{tr("录音加载中…")}</div>}{workbenchEnabled && playback.error !== '' && <div style={styles.error} role="alert">{playback.error}</div>}</div>}
      {tour.sample ? <RecordingTourSample tab={sampleTab} onTab={setSampleTab} /> : <div style={{ position: 'relative', display: 'flex', minHeight: 0, minWidth: 0 }}><div style={{ ...styles.analysis, flex: 1, minWidth: 0, ...(activeTab === 'transcript' ? { gridTemplateRows: `32px minmax(0,1fr)${selectionMode ? ' 72px' : ''}` } : {}) }}><nav style={styles.tabs} aria-label={tr("录音内容")}><span style={{ ...styles.tabList, flex: 1, minWidth: 0, overflowX: 'auto' }}>{([['transcript', '转写'], ['summary', '总结'], ['timeline', '时间轴'], ['files', '音频文件']] as const).filter(([id]) => id !== 'files' || workbenchEnabled).map(([id, label]) => <span key={id} style={{ ...styles.tabSlot, width: id === 'files' ? 'auto' : 100, minWidth: 80 }}><button data-arkme-feedback="neutral" type="button" style={{ ...styles.tab, ...(activeTab === id ? styles.tabActive : {}) }} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setActiveTab(id); setSelectionMode(false); setEditingSpeaker(undefined); setExportNotice('') }}>{id === 'files' ? <FileAudio size={14} aria-hidden /> : <RecordingDesktopIcon name={id} size={14} />}{label}{id === 'files' && audioFileCount?.dateStamp === selectedDate.getTime() && (audioFileCount.count > 0 || audioFileCount.complete) && <span aria-label={tr(audioFileCount.complete ? '共 {v0} 个文件' : '已找到 {v0} 个文件', { v0: String(audioFileCount.count) })} title={tr(audioFileCount.complete ? '共 {v0} 个文件' : '已找到 {v0} 个文件', { v0: String(audioFileCount.count) })} style={{ marginLeft: 2, fontSize: 11, fontWeight: 400, color: colors.tertiary, fontVariantNumeric: 'tabular-nums' }}>{audioFileCount.count}{!audioFileCount.complete && '+'}</span>}{id === 'files' && audioFileCount?.loading && <CircleNotch size={12} className="arkme-icon-spin" aria-label={tr('正在查找音频文件…')} />}{activeTab === id && <span style={styles.tabIndicator} />}</button></span>)}</span></nav><div style={styles.analysisBody}>{activeTab === 'transcript' && <div role="group" aria-label={tr('转写操作')} style={styles.transcriptToolbar}>
        <RecordingTranscriptSearch key={selectedDate.getTime()} query={transcriptSearch} position={transcriptMatches.length === 0 ? 0 : activeMatchIndex + 1} count={transcriptMatches.length} onChange={value => { setTranscriptSearch(value); setTranscriptMatchIndex(0) }} onFind={() => { setTranscriptMatchIndex(0); transcriptRootRef.current?.querySelector('[data-recording-match="0"]')?.scrollIntoView({ block: 'center' }) }} onPrevious={() => { if (transcriptMatches.length > 0) setTranscriptMatchIndex((activeMatchIndex + transcriptMatches.length - 1) % transcriptMatches.length) }} onNext={() => { if (transcriptMatches.length > 0) setTranscriptMatchIndex((activeMatchIndex + 1) % transcriptMatches.length) }} />
        <span style={styles.actionCluster}>
          {workbenchEnabled && <>
            <Tooltip label={selectionMode ? tr('取消多选') : tr('多选')} side="bottom" delayMs={200}>
            <button data-arkme-feedback="neutral" type="button" aria-label={selectionMode ? tr('取消多选') : tr('多选')}
              disabled={dayLoading || transcriptItems.length === 0} aria-pressed={selectionMode}
              style={{ ...styles.actionButton, ...(selectionMode ? { background: colors.subtle, color: colors.text } : {}) }}
              onClick={() => { setSelectionMode(value => !value); setForwardAttempt(createRecordingForwardAttempt([])); setExportNotice('') }}><RecordingDesktopIcon name="select" /></button>
            </Tooltip>
            <Tooltip label={comparisonLoading ? tr('正在准备转写对比') : tr('转写对比')} side="bottom" delayMs={200}>
            <button data-arkme-feedback="neutral" type="button" aria-label={comparisonLoading ? tr('正在准备转写对比') : tr('转写对比')}
              style={styles.actionButton} disabled={dayLoading || comparisonLoading || transcriptItems.length === 0}
              onClick={() => { void openComparison() }}><RecordingDesktopIcon name="compare" /></button>
            </Tooltip>
            {!selectionMode && <Tooltip label={tr('实体')} side="bottom" delayMs={200}>
              <button data-arkme-feedback="neutral" type="button" aria-label={tr('查看录音实体')} aria-expanded={entities.open}
                style={{ ...styles.actionButton, ...(entities.open ? { background: colors.subtle, color: colors.text } : {}) }}
                data-recording-entity-trigger onClick={() => { setSpeechScope(''); setEntityReveal(undefined); entities.setOpen(!entities.open) }}><RecordingDesktopIcon name="entities" size={18} /></button>
            </Tooltip>}
          </>}
          {workbenchEnabled && !tour.sample && <Tooltip label={tr('我的说话统计')} side="bottom" delayMs={200}>
            <button data-arkme-feedback="neutral" type="button" aria-label={tr('我的说话统计')} aria-expanded={speechScope === entities.scope}
              style={{ ...styles.actionButton, ...(speechScope === entities.scope ? { background: colors.subtle, color: colors.text } : {}) }}
              onClick={() => { entities.setOpen(false); setSpeechScope(speechScope === entities.scope ? '' : entities.scope) }}><ChartBar size={18} aria-hidden /></button>
          </Tooltip>}
          <Tooltip label={tr('导出')} side="bottom" delayMs={200}>
            <button data-arkme-feedback="neutral" type="button" aria-label={tr('导出')} style={styles.actionButton} onClick={downloadCurrent}><RecordingDesktopIcon name="export" size={20} /></button>
          </Tooltip>
        </span>
      </div>}{activeTab === 'transcript' && speakerFeedback?.visible && <div role="status" aria-live="polite" data-recording-speaker-feedback style={{ position: 'absolute', right: 18, bottom: 12, zIndex: 3, maxWidth: 'calc(100% - 36px)', padding: '8px 12px', border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.base, color: colors.text, boxShadow: '0 2px 8px rgba(0,0,0,.08)', fontSize: 12, pointerEvents: 'none' }}>{speakerFeedback.message}</div>}{dayRefreshError && day && <div role="status" title={dayRefreshError} style={{ position: 'absolute', bottom: 12, right: 18, zIndex: 3, padding: '6px 10px', borderRadius: 8, border: `1px solid ${colors.border}`, background: colors.base, color: colors.secondary, fontSize: 12 }}>
        {tr('更新暂未完成，当前内容已保留')}
        <button type="button" onClick={() => setDayRetryRevision(value => value + 1)} style={{ border: 0, background: 'transparent', color: colors.accent, font: 'inherit', cursor: 'pointer', marginLeft: 8 }}>{tr('重试更新')}</button>
      </div>}<div ref={transcriptRootRef} style={{ ...styles.pane, ...(activeTab === 'transcript' ? styles.transcriptPane : {}) }}>{exportNotice !== '' && <div role="status" style={styles.status}>{exportNotice}</div>}{(activeTab === 'summary' || activeTab === 'timeline') && generationErrors[activeTab] !== undefined && <div style={styles.error} role="alert">{generationErrors[activeTab]}</div>}<div hidden={activeTab !== 'files'}><ArkmeRecordingFiles
        accountKey={auth.auth?.status === 'authenticated' ? `${auth.auth.environment}:${auth.auth.userId}` : undefined}
        dateStamp={selectedDate.getTime()} active={active && activeTab === 'files'} refreshRevision={recordingRefreshRevision}
        onCountChange={setAudioFileCount}
        onChanged={() => { playback.stop(); setComparison(undefined); setFileRefreshRevision(value => value + 1) }} /></div>{activeTab === 'files' ? null
        : dayError !== '' ? <div style={styles.error} role="alert">{dayError}</div>
        : emptyDay && !(exactTargetActive && ui.recordingTarget?.window && activeTab !== 'transcript') ? <ArkmeRecordingEmptyState recorded={coverage.length > 0} />
        : activeTab === 'transcript' ? renderTranscript() : activeTab === 'summary' ? renderSummary() : renderTimeline()}{analysisFooter}</div></div>{selectionMode && <footer aria-label={tr("录音多选操作")} style={{ height: 72, display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) auto minmax(20px,1fr)', alignItems: 'center', borderTop: `1px solid ${colors.border}`, padding: '0 24px' }}><span style={{ fontSize: 13 }}>{tr("已选择")} {selectedForwardItems.length}/150</span><span style={{ display: 'flex', gap: 8 }}>{(['forward', 'exit'] as const).map(action => <button data-arkme-feedback="neutral" type="button" key={action} aria-label={action === 'forward' ? tr("转发录音片段") : tr("退出多选")} disabled={action === 'forward' && selectedForwardItems.length === 0} onClick={() => { if (action === 'forward') setForwardOpen(true); else { setSelectionMode(false); setForwardAttempt(createRecordingForwardAttempt([])) } }} style={{ width: 64, border: 0, padding: 0, background: 'transparent', color: colors.text, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, cursor: 'pointer', opacity: action === 'forward' && selectedForwardItems.length === 0 ? .4 : 1 }}><span style={{ width: 36, height: 36, borderRadius: 7, display: 'grid', placeItems: 'center', background: arkmeTheme.elevated }}><RecordingDesktopIcon name={action} size={22} /></span><span style={{ fontSize: 12 }}>{action === 'forward' ? tr("转发") : tr("退出")}</span></button>)}</span><span /></footer>}</div><RecordingEntityPanel key={entities.scope} open={entities.open} {...(currentEntityReveal ? { reveal: currentEntityReveal } : {})} data={entities.data} loading={entities.loading} error={entities.error} paused={entities.paused} starting={entities.starting} startError={entities.startError} onStart={() => { void entities.start() }} compact={entityDrawer} onClose={() => entities.setOpen(false)} onRefresh={entities.refresh} onLocate={locateEntity} /></div>}
      </>}
    </section>
    {active && activeTab === 'transcript' && workbenchEnabled && !tour.sample && speechScope === entities.scope && <RecordingSpeechStatistics
      key={entities.scope} query={{ accountScope: entityAccount, date: selectedDayKey, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }}
      refreshRevision={`${recordingRefreshRevision}:${fileRefreshRevision}:${speechRevision}`} onClose={() => setSpeechScope('')} onSource={openSpeechSource} />}
    {workbenchEnabled && comparison !== undefined && <RecordingTranscriptComparison key={`${String(selectedDate.getTime())}:${String(auth.auth?.userId)}`} dateStamp={selectedDate.getTime()} mediaPath={recordingMediaPath} prepared={comparison} onClose={() => { setComparison(undefined) }} />}
    {workbenchEnabled && forwardOpen && <RecordingTranscriptForward attempt={forwardAttempt} onClose={() => { setForwardOpen(false) }} onComplete={message => { setForwardOpen(false); setSelectionMode(false); setExportNotice(message) }} />}
    {workbenchEnabled && editingSpeaker !== undefined && <ArkmeRecordingSpeakerEditor
      item={editingSpeaker.item}
      items={transcriptItems}
      onPlay={item => { void playback.playItem(item) }}
      anchor={editingSpeaker.anchor}
      initialBatchUpdate={editingSpeaker.initialBatchUpdate}
      initialReview={editingSpeaker.initialReview ?? false}
      onUpdated={applySpeakerUpdate}
      onClose={() => { setEditingSpeaker(undefined) }}
    />}
    {workbenchEnabled && timelineDetailEvent !== undefined && <RecordingTimelineDetailDialog event={timelineDetailEvent} onClose={() => { setTimelineDetailEvent(undefined) }} />}
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
