import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { UploadSimple } from '@phosphor-icons/react/dist/icons/UploadSimple'
import { X } from '@phosphor-icons/react/dist/icons/X'
import {
  isRecordingInstantOnOrAfterUnixEpoch,
} from '../../recording-time.js'
import type {
  PublicRecordingImportHistoryItem,
  PublicRecordingImportHistoryPage,
  PublicRecordingImportJob,
  PublicRecordingImportOwnerTask,
  PublicRecordingImportCurrentSnapshot,
  PublicRecordingImportProgress,
  PublicRecordingImportProgressRow,
} from '../../recording-import-shared.js'
import { recordingImportFileNameKey } from '../../recording-import-shared.js'
import { callArkme, uploadArkmeRecording, type RecordingImportSnapshot } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'
import { inspectArkmeRecordingSelection, type ArkmeRecordingSelection } from './recording-import-selection.js'

type Ownership = 'self' | 'other'

interface StagedRecording {
  id: string
  file: File
  selected: boolean
  validating: boolean
  selection?: ArkmeRecordingSelection
  startAt: string
  ownership: Ownership
  submitting: boolean
  uploadStartedAtMillis?: number
  uploadedBytes?: number
  error: string
}

type ImportTask = RecordingImportSnapshot | PublicRecordingImportHistoryItem

type OwnershipChange =
  | { kind: 'staged'; id: string; ownership: Ownership }
  | { kind: 'owner'; sessionRef: string; ownership: Ownership; history: boolean }

type ImportDeletion =
  | { kind: 'job'; job: PublicRecordingImportJob }
  | { kind: 'owner'; sessionRef: string; fileName: string; history: boolean }

type OwnerMutationIntent =
  | { kind: 'start'; sessionRef: string; startAtMillis: number }
  | { kind: 'ownership'; sessionRef: string; ownership: Ownership }
  | { kind: 'delete'; sessionRef: string }

interface HistoryState {
  toMillis: number
  items: PublicRecordingImportHistoryItem[]
  total?: number
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string
  retryReset: boolean
}

type ProcessingDetailsStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'unavailable'

interface ProcessingDetailsRow {
  key: string
  phaseLabel: string
  modelTooltip?: string
  status: ProcessingDetailsStatus
  statusLabel?: string
  startedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  modelDurationMillis: number
  modelDurationVisible: boolean
  relationLabel: string
  relationTooltip?: string
}

interface ProcessingDetailsSource {
  key: string
  fileName: string
  durationMillis: number
  rows: ProcessingDetailsRow[]
  ownerClock?: Pick<PublicRecordingImportProgress, 'serverNowMillis' | 'observedAtMillis'>
  userStartedAtMillis?: number
}

interface BrowserUploadPresentationTiming {
  startedAtMillis: number
  acceptedAtMillis: number
}

const desktop = {
  background: arkmeTheme.base, surface: arkmeTheme.layer2, hover: arkmeTheme.hover, selected: arkmeTheme.active,
  border: arkmeTheme.border, text: arkmeTheme.text, secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary, danger: arkmeTheme.danger,
}

const processingPopoverMetrics = {
  maxWidth: 680,
  minWidth: 320,
  viewportInset: 16,
  gap: 8,
  radius: 10,
  titleHeight: 36,
  headerHeight: 32,
  rowHeight: 38,
  emptyHeight: 54,
} as const

const styles: Record<string, CSSProperties> = {
  trigger: { minHeight: 36, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, color: desktop.text, cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  dialog: { width: 'min(780px,calc(100vw - 32px))', maxWidth: 780, maxHeight: 'calc(100vh - 48px)', padding: 0, border: 0, outline: 'none', borderRadius: 12, background: desktop.background, color: desktop.text, boxShadow: '0 16px 48px rgba(0,0,0,.18)', overflow: 'hidden' },
  header: { height: 60, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { margin: 0, fontSize: 18, lineHeight: '28px', fontWeight: 500 },
  historyTitle: { margin: 0, color: desktop.text, fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  historyTotal: { color: desktop.secondary, fontSize: 16, lineHeight: '24px', fontWeight: 500 },
  iconButton: { width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, background: 'transparent', color: desktop.secondary, cursor: 'pointer' },
  body: { minHeight: 0, overflow: 'hidden' },
  dropzone: { position: 'relative', minHeight: 100, width: 'calc(100% - 32px)', margin: '0 16px', padding: '10px 16px', boxSizing: 'border-box', display: 'grid', placeItems: 'center', border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, color: desktop.text, cursor: 'pointer', textAlign: 'center', overflow: 'hidden' },
  dropCopy: { display: 'grid', justifyItems: 'center', gap: 8, fontSize: 13, lineHeight: '20px' },
  hint: { color: desktop.tertiary, fontSize: 11 },
  dragOverlay: { position: 'absolute', inset: 1, display: 'grid', placeItems: 'center', borderRadius: 7, background: 'rgba(23,25,28,.82)', color: desktop.background, fontSize: 18, fontWeight: 600 },
  tableViewport: { width: '100%', overflowX: 'auto' },
  table: { marginTop: 0, width: '100%', minWidth: 763, fontSize: 12 },
  tableHeader: { height: 40, display: 'grid', gridTemplateColumns: '44px minmax(280px,1fr) 60px 66px 98px 80px 72px 44px', alignItems: 'center', color: desktop.tertiary, borderBottom: `1px solid ${desktop.border}`, fontWeight: 500 },
  rowList: { minHeight: 70, maxHeight: 250, overflowY: 'auto' },
  row: { minHeight: 70, padding: '5px 0', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: '44px minmax(280px,1fr) 60px 66px 98px 80px 72px 44px', alignItems: 'center', borderBottom: `1px solid ${desktop.border}` },
  cellCenter: { display: 'grid', placeItems: 'center', textAlign: 'center', color: desktop.secondary },
  historyMetricCell: { padding: '0 6px', boxSizing: 'border-box', display: 'grid', placeItems: 'center', overflow: 'hidden', color: desktop.secondary, textAlign: 'center', whiteSpace: 'nowrap', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  fileCell: { minWidth: 0, padding: '10px 8px 10px 2px', display: 'grid', gap: 4 },
  fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: desktop.text, fontSize: 12 },
  timeEditor: { display: 'flex', alignItems: 'center', gap: 8, color: desktop.secondary, fontSize: 13 },
  timeInput: { width: 174, height: 26, boxSizing: 'border-box', padding: '3px 6px', border: `1px solid ${desktop.border}`, borderRadius: 4, background: desktop.surface, color: desktop.secondary, font: 'inherit', fontSize: 11 },
  endTime: { minWidth: 72, height: 24, padding: '2px 6px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${desktop.border}`, borderRadius: 4, color: desktop.tertiary, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  ownership: { justifySelf: 'center', width: 90, height: 28, padding: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', border: 0, borderRadius: 4, background: desktop.selected },
  ownershipButton: { border: 0, borderRadius: 3, background: 'transparent', color: desktop.tertiary, cursor: 'pointer', fontSize: 12 },
  ownershipSelected: { background: desktop.background, color: desktop.text, boxShadow: '0 1px 2px rgba(0,0,0,.08)' },
  status: { display: 'grid', placeItems: 'center', gap: 4, color: desktop.secondary, fontSize: 13, lineHeight: '20px', fontWeight: 500, textAlign: 'center' },
  progress: { width: 38, height: 4, marginBottom: 12, overflow: 'hidden', borderRadius: 8, background: arkmeTheme.subtle },
  progressValue: { height: 4, borderRadius: 8, background: desktop.text },
  historyButton: { height: 28, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 2, border: 0, borderRadius: 4, background: 'transparent', color: desktop.secondary, cursor: 'pointer', fontSize: 13, lineHeight: '20px' },
  durationButton: { minWidth: 48, minHeight: 28, padding: '0 6px', border: 0, borderRadius: 4, background: 'transparent', color: desktop.secondary, cursor: 'pointer', fontSize: 12 },
  detailsPopover: { position: 'fixed', zIndex: 8, padding: 0, overflow: 'hidden', border: `1px solid ${desktop.border}`, borderRadius: processingPopoverMetrics.radius, background: desktop.surface, boxShadow: '0 8px 20px rgba(0,0,0,.18)', color: desktop.text },
  detailsTitle: { height: processingPopoverMetrics.titleHeight, padding: '0 4px 0 12px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: desktop.text, fontSize: 12, lineHeight: '18px', fontWeight: 500 },
  detailsGrid: { display: 'grid', gridTemplateColumns: 'minmax(0,9fr) minmax(0,4fr) minmax(0,6fr) minmax(0,6fr) minmax(0,5fr) minmax(0,5fr) minmax(0,7fr)', columnGap: 4, padding: '6px', boxSizing: 'border-box', alignItems: 'center', fontSize: 11, lineHeight: '16px' },
  detailsHeader: { minHeight: processingPopoverMetrics.headerHeight, background: desktop.hover, color: desktop.tertiary, fontWeight: 500 },
  detailsRow: { minHeight: processingPopoverMetrics.rowHeight, color: desktop.secondary, borderBottom: `1px solid ${desktop.border}` },
  detailsCell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' },
  detailsPhaseCell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  detailsStatus: { minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden', whiteSpace: 'nowrap' },
  detailsStatusDot: { width: 7, height: 7, flex: '0 0 auto', borderRadius: 999 },
  statusTooltip: { position: 'fixed', zIndex: 9, minWidth: 150, maxWidth: 260, padding: '9px 11px', border: `1px solid ${desktop.border}`, borderRadius: 6, background: desktop.text, color: desktop.background, boxShadow: '0 8px 24px rgba(0,0,0,.18)', fontSize: 11, lineHeight: '18px', whiteSpace: 'pre-line', pointerEvents: 'none' },
  historyDialog: { width: 'min(780px,calc(100vw - 32px))', height: 'min(560px,calc(100vh - 48px))', display: 'grid', gridTemplateRows: '60px minmax(0,1fr)', background: desktop.background },
  historyBody: { minHeight: 0, padding: '0 16px 12px', boxSizing: 'border-box', overflow: 'hidden' },
  historyTableViewport: { width: '100%', height: '100%', overflowX: 'auto' },
  historyTable: { width: '100%', minWidth: 748, height: '100%', display: 'grid', gridTemplateRows: '40px minmax(0,1fr)' },
  historyHeader: { height: 40, display: 'grid', gridTemplateColumns: 'minmax(328px,1fr) 60px 66px 98px 80px 72px 44px', alignItems: 'center', color: desktop.tertiary, borderBottom: `1px solid ${desktop.border}`, fontSize: 12 },
  historyList: { minHeight: 0, overflowY: 'auto' },
  historyRow: { minHeight: 70, padding: '5px 0', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'minmax(328px,1fr) 60px 66px 98px 80px 72px 44px', alignItems: 'center', borderBottom: `1px solid ${desktop.border}` },
  error: { color: desktop.danger, fontSize: 11, lineHeight: '16px' },
  empty: { padding: '40px', display: 'grid', justifyItems: 'center', gap: 16, color: desktop.tertiary, fontSize: 14 },
  historyEmpty: { height: 488, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: desktop.secondary, fontSize: 14 },
  historyEmptyHint: { color: desktop.tertiary, fontSize: 12 },
  historyReady: { height: 488, display: 'flex', flexDirection: 'column' },
  historySync: { height: 32, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: desktop.tertiary, fontSize: 12 },
  historyLoadMore: { height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: desktop.tertiary, fontSize: 12 },
  historySpinner: { width: 36, height: 36, boxSizing: 'border-box', border: `3px solid ${arkmeTheme.subtle}`, borderTopColor: arkmeTheme.accent, borderRadius: 999, animation: 'arkme-recording-history-spin .8s linear infinite' },
  historyTailSpinner: { width: 14, height: 14, boxSizing: 'border-box', border: `1.5px solid ${arkmeTheme.subtle}`, borderTopColor: arkmeTheme.accent, borderRadius: 999, animation: 'arkme-recording-history-spin .8s linear infinite' },
  footer: { minHeight: 68, padding: '12px 24px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxSizing: 'border-box' },
  selection: { display: 'flex', alignItems: 'center', gap: 4, color: desktop.text, fontSize: 14, fontWeight: 500 },
  checkboxSlot: { width: 44, display: 'grid', placeItems: 'center' },
  checkbox: { width: 15, height: 15, margin: 0, accentColor: desktop.text, cursor: 'pointer' },
  footerActions: { display: 'flex', gap: 8 },
  secondaryButton: { minWidth: 72, height: 36, border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, color: desktop.text, cursor: 'pointer', fontSize: 14 },
  primaryButton: { minWidth: 88, height: 40, padding: '0 16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: `1px solid ${desktop.text}`, borderRadius: 8, background: desktop.text, color: desktop.background, cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  modalBackdrop: { position: 'fixed', zIndex: 3, inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.28)' },
  confirmDialog: { width: 'min(420px,calc(100vw - 64px))', padding: '24px 28px 20px', boxSizing: 'border-box', borderRadius: 12, background: desktop.background, boxShadow: '0 16px 48px rgba(0,0,0,.2)' },
  duplicateDialog: { width: 'min(560px,calc(100vw - 64px))', maxHeight: 'calc(100vh - 64px)', padding: '24px 28px 20px', boxSizing: 'border-box', borderRadius: 12, background: desktop.background, boxShadow: '0 16px 48px rgba(0,0,0,.2)' },
  confirmTitle: { margin: 0, color: desktop.text, fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  confirmCopy: { margin: '8px 0 24px', color: desktop.secondary, fontSize: 14, lineHeight: '20px' },
  duplicateFiles: { maxHeight: 220, margin: '0 0 24px', padding: '12px 16px', overflowY: 'auto', borderRadius: 8, background: desktop.surface, color: desktop.secondary, fontSize: 13, lineHeight: '22px' },
  confirmActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
}

const activePhases = new Set<PublicRecordingImportJob['phase']>(['prepared', 'uploading', 'finalizing'])

export function recordingImportLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 19)
}

export function recordingImportStartFromFileName(fileName: string, fallbackStartAtMillis: number): number {
  const match = /(?:^|\D)(20\d{2})(\d{2})(\d{2})[_\-. ]?(\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(fileName)
  if (match === null) return fallbackStartAtMillis
  const values = match.slice(1).map(Number)
  const parsedDate = new Date(values[0]!, values[1]! - 1, values[2]!, values[3]!, values[4]!, values[5]!)
  if (parsedDate.getFullYear() !== values[0] || parsedDate.getMonth() !== values[1]! - 1
    || parsedDate.getDate() !== values[2] || parsedDate.getHours() !== values[3]
    || parsedDate.getMinutes() !== values[4] || parsedDate.getSeconds() !== values[5]) return fallbackStartAtMillis
  return parsedDate.getTime()
}

export function recordingImportEndTimeError(startAtMillis: number, durationMillis: number, nowMillis = Date.now()): string {
  if (!Number.isSafeInteger(startAtMillis)) return '录音开始时间无效'
  if (!isRecordingInstantOnOrAfterUnixEpoch(startAtMillis)) return '仅支持1970年至今的日期'
  return startAtMillis + durationMillis > nowMillis ? '录音结束时间不能晚于当前时间' : ''
}

export function hasRecordingImportCalendarChange(previous: readonly RecordingImportSnapshot[], next: readonly RecordingImportSnapshot[]): boolean {
  const previousOwnerTasks = new Set(previous.filter(item => !isLocalRecordingImport(item)).map(item => item.taskKey))
  if (next.filter(item => !isLocalRecordingImport(item)).some(item => !previousOwnerTasks.has(item.taskKey))) return true
  const nextOwnerTasks = new Set(next.filter(item => !isLocalRecordingImport(item)).map(item => item.taskKey))
  if (previous.filter(item => !isLocalRecordingImport(item)).some(item => !nextOwnerTasks.has(item.taskKey))) return true
  const nextLocalRefs = new Set(next.filter(isLocalRecordingImport).map(item => item.importRef))
  return previous.filter(isLocalRecordingImport)
    .some(item => activePhases.has(item.phase) && !nextLocalRefs.has(item.importRef))
}

function recordingImportItemsForSnapshot(
  previous: readonly RecordingImportSnapshot[],
  snapshot: PublicRecordingImportCurrentSnapshot,
): RecordingImportSnapshot[] {
  if (snapshot.owner.state === 'available') return snapshot.items
  const ownerTasks = new Map(previous.filter(item => !isLocalRecordingImport(item)).map(item => [item.taskKey, item]))
  for (const item of snapshot.items) {
    if (!isLocalRecordingImport(item)) ownerTasks.set(item.taskKey, item)
  }
  return [
    ...snapshot.items.filter(isLocalRecordingImport),
    ...ownerTasks.values(),
  ].sort((left, right) => right.createdAtMillis - left.createdAtMillis)
}

function isLocalRecordingImport(task: RecordingImportSnapshot): task is PublicRecordingImportJob {
  return task.kind === 'local'
}

function isLocalImportTask(task: ImportTask): task is PublicRecordingImportJob {
  return 'kind' in task && task.kind === 'local'
}

function hasActiveRecordingImportTasks(tasks: readonly RecordingImportSnapshot[]): boolean {
  return tasks.some(task => isLocalRecordingImport(task) ? activePhases.has(task.phase) : true)
}

function taskSessionRef(task: ImportTask): string | undefined {
  return isLocalImportTask(task) ? undefined : task.sessionRef
}

function durationLabel(durationMillis: number): string {
  const seconds = Math.max(0, Math.floor(durationMillis / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainingSeconds = seconds % 60
  return `${hours > 0 ? `${String(hours)}h` : ''}${minutes > 0 ? `${String(minutes)}m` : ''}${remainingSeconds > 0 ? `${String(remainingSeconds)}s` : ''}`
}

function fileSizeLabel(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = Math.max(0, bytes)
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const raw = String(value)
  const fraction = raw.includes('.') ? raw.split('.')[1] ?? '' : ''
  const formatted = fraction === '' || Number(fraction) === 0
    ? String(Math.trunc(value))
    : fraction.length >= 2 ? value.toFixed(2) : raw
  return `${formatted}${units[unitIndex]}`
}

function recordingImportEndLabel(startAtMillis: number, durationMillis: number): string {
  if (!Number.isFinite(startAtMillis) || !Number.isFinite(durationMillis)) return '—'
  const start = new Date(startAtMillis)
  const end = new Date(startAtMillis + Math.max(0, durationMillis))
  const time = [end.getHours(), end.getMinutes(), end.getSeconds()].map(value => String(value).padStart(2, '0')).join(':')
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  const dayDifference = Math.max(0, Math.round((endDay - startDay) / 86_400_000))
  return `${time}${dayDifference === 0 ? '' : ` +${String(dayDifference)}`}`
}

function taskStatusTitle(task: ImportTask): string {
  const lines = [task.statusDetail]
  if ('progress' in task && task.progress > 0 && task.progress < 1) {
    lines.push(`上传进度：${String(Math.round(task.progress * 100))}%`)
  }
  return lines.join('\n')
}

function progressStatusLabel(row: ProcessingDetailsRow): string {
  if (row.statusLabel !== undefined) return row.statusLabel
  switch (row.status) {
    case 'pending': return '未开始'
    case 'processing': return '处理中'
    case 'completed': return '已完成'
    case 'partial': return '部分完成'
    case 'failed': return '失败'
    case 'unavailable': return '暂无统计'
  }
}

function progressStatusColor(status: ProcessingDetailsStatus): string {
  switch (status) {
    case 'completed': return arkmeTheme.success
    case 'processing': return arkmeTheme.accent
    case 'partial': return arkmeTheme.warning
    case 'failed': return desktop.danger
    case 'pending':
    case 'unavailable': return desktop.tertiary
  }
}

function friendlyProgressModel(row: PublicRecordingImportProgressRow): string {
  const normalizedModel = row.model.toLowerCase().replaceAll('-', '')
  if (row.code === 'primary_transcript' && (normalizedModel.includes('sensevoice') || row.model === '')) return 'SenseVoice'
  if (row.code === 'enhancement_transcript' && (row.provider.toLowerCase() === 'doubao' || row.model === '')) return '豆包'
  return row.model.trim()
}

function progressPhaseLabel(row: PublicRecordingImportProgressRow): string {
  const phase = row.code === 'upload' ? '上传'
    : row.code === 'import' ? '导入'
      : row.code === 'voice_recognition' ? '人声识别'
        : row.code === 'primary_transcript' ? '基础转写'
          : '优化转写'
  const model = friendlyProgressModel(row)
  return model === '' ? phase : `${phase} · ${model}`
}

function progressModelTooltip(row: PublicRecordingImportProgressRow): string | undefined {
  const detail = [row.provider.trim(), row.model.trim(), row.modelVersion.trim()].filter(Boolean).join(' / ')
  return detail === '' ? undefined : detail
}

function ownerProcessingDetailsRow(row: PublicRecordingImportProgressRow): ProcessingDetailsRow {
  const modelTooltip = progressModelTooltip(row)
  const relationTooltip = progressRelationTooltip(row)
  return {
    key: `owner:${row.code}`,
    phaseLabel: progressPhaseLabel(row),
    ...(modelTooltip === undefined ? {} : { modelTooltip }),
    status: row.status,
    ...(row.status === 'unavailable' && row.code === 'enhancement_transcript' ? { statusLabel: '未开启' } : {}),
    startedAtMillis: row.startedAtMillis,
    endedAtMillis: row.endedAtMillis,
    durationMillis: row.durationMillis,
    modelDurationMillis: row.modelDurationMillis,
    modelDurationVisible: row.code === 'primary_transcript' || row.code === 'enhancement_transcript',
    relationLabel: progressRelation(row),
    ...(relationTooltip === undefined ? {} : { relationTooltip }),
  }
}

function compactClock(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return '—'
  const date = new Date(millis)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(value => String(value).padStart(2, '0')).join(':')
}

function progressDurationLabel(
  durationMillis: number,
  options: { precise?: boolean; wholeSeconds?: boolean } = {},
): string {
  if (durationMillis <= 0) return options.wholeSeconds === true && durationMillis === 0 ? '0s' : '—'
  const hours = Math.floor(durationMillis / 3_600_000)
  const minutes = Math.floor(durationMillis % 3_600_000 / 60_000)
  if (hours > 0) return `${String(hours)}h${String(minutes).padStart(2, '0')}m`
  const wholeSeconds = Math.floor(durationMillis % 60_000 / 1_000)
  if (minutes > 0) return `${String(minutes)}m${String(wholeSeconds)}s`
  if (durationMillis < 1_000) return options.wholeSeconds === true ? '0s' : `${String(Math.floor(durationMillis))}ms`
  const seconds = durationMillis / 1_000
  if (options.precise === true) return `${seconds.toFixed(1)}s`
  return options.wholeSeconds === true ? `${String(Math.floor(seconds))}s` : `${String(Math.round(seconds))}s`
}

function taskIdentity(task: ImportTask): string {
  return isLocalImportTask(task) ? `local:${task.importRef}` : `owner:${task.taskKey}`
}

function localTimingPresentationKey(fileName: string, startedAtMillis: number): string {
  return `local-timing:${String(startedAtMillis)}:${recordingImportFileNameKey(fileName)}`
}

function taskProcessingKey(task: ImportTask): string {
  if (isLocalImportTask(task)) return localTimingPresentationKey(task.fileName, task.createdAtMillis)
  if (isOwnerImportTask(task) && task.localImportTiming !== undefined) {
    return localTimingPresentationKey(task.fileName, task.localImportTiming.startedAtMillis)
  }
  return taskIdentity(task)
}

function stagedProcessingKey(row: StagedRecording): string {
  return `staged:${row.id}`
}

function withoutStagedUpload(row: StagedRecording): StagedRecording {
  const next = { ...row, submitting: false }
  delete next.uploadStartedAtMillis
  delete next.uploadedBytes
  return next
}

function taskProgress(task: ImportTask): PublicRecordingImportProgress | undefined {
  return isLocalImportTask(task) ? undefined : task.importProgress
}

function isOwnerImportTask(task: ImportTask): task is PublicRecordingImportOwnerTask {
  return 'kind' in task && task.kind === 'owner'
}

function localStageRows(
  startedAtMillis: number,
  uploadCompleted: boolean,
  acceptedAtMillis = 0,
): ProcessingDetailsRow[] {
  const row = (
    key: string,
    phaseLabel: string,
    status: ProcessingDetailsStatus,
    startedAtMillis = 0,
    endedAtMillis = 0,
  ): ProcessingDetailsRow => ({
    key,
    phaseLabel,
    status,
    startedAtMillis,
    endedAtMillis,
    durationMillis: endedAtMillis > startedAtMillis ? endedAtMillis - startedAtMillis : 0,
    modelDurationMillis: 0,
    modelDurationVisible: key === 'primary_transcript' || key === 'enhancement_transcript',
    relationLabel: key === 'primary_transcript' ? '决定文字可用'
      : key === 'enhancement_transcript' ? '并行增强，不阻塞完成'
        : '—',
  })
  return [
    row('browser_upload', '上传', uploadCompleted ? 'completed' : 'processing', startedAtMillis, uploadCompleted ? acceptedAtMillis : 0),
    row('host_import', '导入', uploadCompleted ? 'processing' : 'pending', uploadCompleted ? acceptedAtMillis : 0),
    row('voice_recognition', '人声识别', 'pending'),
    row('primary_transcript', '基础转写 · SenseVoice', 'pending'),
    row('enhancement_transcript', '优化转写 · 豆包', 'pending'),
  ]
}

function localProgressRows(
  task: ImportTask,
  browserUploadTiming?: BrowserUploadPresentationTiming,
): ProcessingDetailsRow[] {
  if (isLocalImportTask(task)) {
    if (task.errorMessage !== undefined || task.phase === 'failed' || task.phase === 'cancelled') return []
    if (browserUploadTiming !== undefined) {
      return localStageRows(browserUploadTiming.startedAtMillis, true, browserUploadTiming.acceptedAtMillis)
    }
    const uploadCompleted = task.phase === 'finalizing' || task.phase === 'accepted'
    return localStageRows(task.createdAtMillis, uploadCompleted, uploadCompleted ? task.updatedAtMillis : 0)
  }
  if (!isOwnerImportTask(task) || task.importProgress !== undefined || task.localImportTiming === undefined
    || ['completed', 'partial', 'failed', 'unavailable'].includes(task.status)) return []
  if (browserUploadTiming !== undefined) {
    return localStageRows(browserUploadTiming.startedAtMillis, true, browserUploadTiming.acceptedAtMillis)
  }
  return localStageRows(task.localImportTiming.startedAtMillis, true, task.localImportTiming.acceptedAtMillis)
}

function taskProgressRows(
  task: ImportTask,
  browserUploadTiming?: BrowserUploadPresentationTiming,
): ProcessingDetailsRow[] {
  const progress = taskProgress(task)
  if (progress === undefined) return localProgressRows(task, browserUploadTiming)
  return progress.rows.map(ownerProcessingDetailsRow)
}

function earliestPositiveMillis(left: number, right: number): number {
  if (right <= 0) return left
  if (left <= 0 || right < left) return right
  return left
}

function userStartedAtOnOwnerTimeline(
  userStartedAtMillis: number,
  ownerClock?: Pick<PublicRecordingImportProgress, 'serverNowMillis' | 'observedAtMillis'>,
): number {
  if (userStartedAtMillis <= 0) return 0
  if (ownerClock === undefined || ownerClock.serverNowMillis <= 0 || ownerClock.observedAtMillis <= 0) {
    return userStartedAtMillis
  }
  return userStartedAtMillis + ownerClock.serverNowMillis - ownerClock.observedAtMillis
}

function effectiveProgressNow(
  clock: Pick<PublicRecordingImportProgress, 'serverNowMillis' | 'observedAtMillis'>,
  nowMillis: number,
): number {
  if (clock.serverNowMillis <= 0) return 0
  return clock.serverNowMillis + Math.max(0, nowMillis - clock.observedAtMillis)
}

function processingDuration(
  task: ImportTask,
  nowMillis: number,
  browserUploadTiming?: BrowserUploadPresentationTiming,
): number | undefined {
  if (isLocalImportTask(task)) {
    const startedAtMillis = browserUploadTiming?.startedAtMillis ?? task.createdAtMillis
    if (localProgressRows(task, browserUploadTiming).length === 0 || startedAtMillis <= 0) return undefined
    return Math.max(0, nowMillis - startedAtMillis)
  }
  const progress = taskProgress(task)
  if (progress === undefined) {
    const startedAtMillis = browserUploadTiming?.startedAtMillis
      ?? (isOwnerImportTask(task) ? task.localImportTiming?.startedAtMillis ?? 0 : 0)
    return localProgressRows(task, browserUploadTiming).length === 0 || startedAtMillis <= 0
      ? undefined
      : Math.max(0, nowMillis - startedAtMillis)
  }
  if (['completed', 'partial', 'failed'].includes(progress.status)) {
    if (progress.totalDurationMillis <= 0) return undefined
    const remoteStartedAtMillis = progress.rows.find(row => row.code === 'upload')?.startedAtMillis ?? 0
    const userStartedAtMillis = userStartedAtOnOwnerTimeline(browserUploadTiming?.startedAtMillis ?? 0, progress)
    const startedAtMillis = earliestPositiveMillis(remoteStartedAtMillis, userStartedAtMillis)
    if (remoteStartedAtMillis <= 0 || startedAtMillis <= 0) return progress.totalDurationMillis
    return Math.max(
      progress.totalDurationMillis,
      remoteStartedAtMillis + progress.totalDurationMillis - startedAtMillis,
    )
  }
  const remoteStartedAtMillis = progress.rows.find(row => row.code === 'upload')?.startedAtMillis ?? 0
  const userStartedAtMillis = userStartedAtOnOwnerTimeline(browserUploadTiming?.startedAtMillis ?? 0, progress)
  const startedAtMillis = earliestPositiveMillis(remoteStartedAtMillis, userStartedAtMillis)
  const effectiveNowMillis = effectiveProgressNow(progress, nowMillis)
  if (startedAtMillis <= 0 || effectiveNowMillis < startedAtMillis) return progress.totalDurationMillis
  return Math.max(progress.totalDurationMillis, effectiveNowMillis - startedAtMillis)
}

function stagedProcessingSource(row: StagedRecording, nowMillis: number): ProcessingDetailsSource | undefined {
  const startedAtMillis = row.uploadStartedAtMillis ?? 0
  if (!row.submitting || startedAtMillis <= 0) return undefined
  return {
    key: stagedProcessingKey(row),
    fileName: row.file.name,
    durationMillis: Math.max(0, nowMillis - startedAtMillis),
    rows: localStageRows(startedAtMillis, false),
  }
}

function taskProcessingSource(
  task: ImportTask,
  nowMillis: number,
  browserUploadTiming?: BrowserUploadPresentationTiming,
): ProcessingDetailsSource | undefined {
  const durationMillis = processingDuration(task, nowMillis, browserUploadTiming)
  if (durationMillis === undefined) return undefined
  const progress = taskProgress(task)
  return {
    key: taskProcessingKey(task),
    fileName: task.fileName,
    durationMillis,
    rows: taskProgressRows(task, browserUploadTiming),
    ...(progress === undefined ? {} : {
      ownerClock: {
        serverNowMillis: progress.serverNowMillis,
        observedAtMillis: progress.observedAtMillis,
      },
      ...(browserUploadTiming === undefined ? {} : {
        userStartedAtMillis: browserUploadTiming.startedAtMillis,
      }),
    }),
  }
}

function progressUserDuration(
  row: ProcessingDetailsRow,
  source: ProcessingDetailsSource,
  nowMillis: number,
): string {
  const startedAtMillis = row.key === 'owner:upload'
    ? earliestPositiveMillis(
      row.startedAtMillis,
      userStartedAtOnOwnerTimeline(source.userStartedAtMillis ?? 0, source.ownerClock),
    )
    : row.startedAtMillis
  if (startedAtMillis <= 0) return '—'
  if (row.status === 'completed' && row.endedAtMillis > 0) {
    return progressDurationLabel(Math.max(row.durationMillis, row.endedAtMillis - startedAtMillis), { wholeSeconds: true })
  }
  if (row.status === 'processing') {
    const effectiveNowMillis = source.ownerClock === undefined ? nowMillis : effectiveProgressNow(source.ownerClock, nowMillis)
    if (effectiveNowMillis >= startedAtMillis) {
      return progressDurationLabel(Math.max(row.durationMillis, effectiveNowMillis - startedAtMillis), { wholeSeconds: true })
    }
  }
  return progressDurationLabel(row.durationMillis, { wholeSeconds: true })
}

function progressModelDuration(row: ProcessingDetailsRow): string {
  if (!row.modelDurationVisible) return '—'
  return progressDurationLabel(row.modelDurationMillis, { precise: true })
}

function progressRelation(row: PublicRecordingImportProgressRow): string {
  if (row.code === 'primary_transcript') return '决定文字可用'
  if (row.code === 'enhancement_transcript') return '并行增强，不阻塞完成'
  const duration = progressDurationLabel(row.relationDurationMillis)
  const withDuration = (label: string) => duration === '—' ? label : `${label} ${duration}`
  switch (row.nextRelation) {
    case 'wait': return withDuration('等待')
    case 'continuous': return '无间隔'
    case 'overlap': return withDuration('并行重叠')
    case 'sidecar': return '旁路'
    default: return '—'
  }
}

function progressRelationTooltip(row: PublicRecordingImportProgressRow): string | undefined {
  if (row.nextRelation !== 'wait') return undefined
  if (row.code === 'import') return '系统为人声识别做准备的时间，包括排队、分配资源、读取及转换音频等。'
  if (row.code === 'voice_recognition') return '系统为基础转写做准备的时间，包括排队、分配资源、读取及转换音频等。'
  return undefined
}

export interface ArkmeRecordingImportDialogHandle {
  open(): void
  close(): void
}

export function ArkmeRecordingImportTrigger({ onClick }: { onClick(): void }) {
  return <button type="button" style={styles.trigger} onClick={onClick}><UploadSimple size={16} aria-hidden />导入历史音频</button>
}

export const ArkmeRecordingImportDialog = forwardRef<ArkmeRecordingImportDialogHandle, {
  importPath: string
  defaultStartAtMillis: number
  currentUserId: number
  foreground?: boolean
  onAccepted(): void
}>(function ArkmeRecordingImportDialog({ importPath, defaultStartAtMillis, currentUserId, foreground = true, onAccepted }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rowsRef = useRef<StagedRecording[]>([])
  const jobsRef = useRef<RecordingImportSnapshot[]>([])
  const jobsInitializedRef = useRef(false)
  const jobsLoadRevisionRef = useRef(0)
  const historyLoadKeysRef = useRef(new Set<string>())
  const lifecycleAbortRef = useRef<AbortController>()
  const duplicateCheckQueueRef = useRef<Promise<void>>(Promise.resolve())
  const duplicateNamesRef = useRef<string[]>([])
  const browserUploadTimingsRef = useRef(new Map<string, BrowserUploadPresentationTiming>())
  const uploadAbortRef = useRef<AbortController>()
  const submissionActiveRef = useRef(false)
  const inspectionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const inspectionActiveRef = useRef(false)
  const [rows, setRows] = useState<StagedRecording[]>([])
  const [jobs, setJobs] = useState<RecordingImportSnapshot[]>([])
  const [dialogEpoch, setDialogEpoch] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [jobsError, setJobsError] = useState('')
  const [duplicateNames, setDuplicateNames] = useState<string[]>([])
  const [ownershipChange, setOwnershipChange] = useState<OwnershipChange>()
  const [jobDeletion, setJobDeletion] = useState<ImportDeletion>()
  const [history, setHistory] = useState<HistoryState>()
  const [processingDetails, setProcessingDetails] = useState<{ sourceKey: string; left: number; top: number; width: number }>()
  const [statusDetails, setStatusDetails] = useState<{ task: ImportTask; left: number; top: number }>()
  const [ownerStartOverrides, setOwnerStartOverrides] = useState<Record<string, string>>({})
  const [durationNowMillis, setDurationNowMillis] = useState(() => Date.now())
  const selectableRows = useMemo(() => rows.filter(row => !row.submitting), [rows])
  const selectedRows = useMemo(() => selectableRows.filter(row => row.selected), [selectableRows])
  const submittingRows = useMemo(() => rows.filter(row => row.submitting), [rows])
  const hasActiveTasks = hasActiveRecordingImportTasks(jobs)
  const activeDuplicateNames = useMemo(() => {
    const stagedNameKeys = new Set(rows.map(row => recordingImportFileNameKey(row.file.name)))
    return duplicateNames.filter(name => stagedNameKeys.has(recordingImportFileNameKey(name)))
  }, [duplicateNames, rows])
  const liveDurationTasks: ImportTask[] = [...jobs, ...(history?.items ?? [])]
  const processingSources = [
    ...rows.flatMap(row => {
      const source = stagedProcessingSource(row, durationNowMillis)
      return source === undefined ? [] : [source]
    }),
    ...liveDurationTasks.flatMap(task => {
      const source = taskProcessingSource(
        task,
        durationNowMillis,
        browserUploadTimingsRef.current.get(taskProcessingKey(task)),
      )
      return source === undefined ? [] : [source]
    }),
  ]
  const processingSource = processingDetails === undefined
    ? undefined
    : processingSources.find(source => source.key === processingDetails.sourceKey)
  const hasLiveDuration = processingSources.some(source =>
    source.rows.some(row => row.status === 'processing'))

  const publishRows = (update: (current: readonly StagedRecording[]) => StagedRecording[]) => {
    const next = update(rowsRef.current)
    rowsRef.current = next
    setRows(next)
    const stagedNameKeys = new Set(next.map(row => recordingImportFileNameKey(row.file.name)))
    const nextDuplicateNames = duplicateNamesRef.current.filter(
      name => stagedNameKeys.has(recordingImportFileNameKey(name)),
    )
    if (nextDuplicateNames.length !== duplicateNamesRef.current.length) {
      duplicateNamesRef.current = nextDuplicateNames
      setDuplicateNames(nextDuplicateNames)
    }
  }

  const publishJobs = (next: RecordingImportSnapshot[]) => {
    jobsRef.current = next
    setJobs(next)
  }

  const publishDuplicateNames = (names: string[]) => {
    const uniqueByKey = new Map<string, string>()
    for (const name of names) {
      const key = recordingImportFileNameKey(name)
      if (key !== '' && !uniqueByKey.has(key)) uniqueByKey.set(key, name)
    }
    const next = [...uniqueByKey.values()]
    duplicateNamesRef.current = next
    setDuplicateNames(next)
  }

  const clearDuplicateNames = () => {
    duplicateNamesRef.current = []
    setDuplicateNames([])
  }

  const open = () => {
    setError('')
    dialogRef.current?.showModal()
    dialogRef.current?.focus()
    setDialogEpoch(value => value + 1)
  }
  const close = () => {
    setProcessingDetails(undefined)
    setStatusDetails(undefined)
    dialogRef.current?.close()
  }
  useImperativeHandle(ref, () => ({ open, close }))

  useEffect(() => {
    const controller = new AbortController()
    lifecycleAbortRef.current = controller
    inspectionActiveRef.current = true
    return () => {
      inspectionActiveRef.current = false
      controller.abort()
      if (lifecycleAbortRef.current === controller) lifecycleAbortRef.current = undefined
      uploadAbortRef.current?.abort()
      submissionActiveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!foreground) {
      setProcessingDetails(undefined)
      return
    }
    if (!hasLiveDuration) return
    setDurationNowMillis(Date.now())
    const timer = setInterval(() => { setDurationNowMillis(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [foreground, hasLiveDuration])

  useEffect(() => {
    if (processingDetails === undefined || typeof window === 'undefined') return
    const hide = () => { setProcessingDetails(undefined) }
    const hideWhenInactive = () => { if (document.visibilityState !== 'visible') hide() }
    window.addEventListener('blur', hide)
    window.addEventListener('scroll', hide, true)
    document.addEventListener('visibilitychange', hideWhenInactive)
    return () => {
      window.removeEventListener('blur', hide)
      window.removeEventListener('scroll', hide, true)
      document.removeEventListener('visibilitychange', hideWhenInactive)
    }
  }, [processingDetails?.sourceKey])

  const loadJobs = async (signal?: AbortSignal) => {
    const loadRevision = ++jobsLoadRevisionRef.current
    try {
      const snapshot = await callArkme<PublicRecordingImportCurrentSnapshot>('recordings.import.list', undefined, signal)
      if (signal?.aborted === true || loadRevision !== jobsLoadRevisionRef.current) return true
      const nextItems = recordingImportItemsForSnapshot(jobsRef.current, snapshot)
      const calendarChanged = jobsInitializedRef.current && hasRecordingImportCalendarChange(jobsRef.current, nextItems)
      jobsInitializedRef.current = true
      publishJobs(nextItems)
      setJobsError(snapshot.owner.state === 'available' ? '' : snapshot.owner.message)
      if (calendarChanged) onAccepted()
      return snapshot.owner.state === 'available'
    } catch (reason) {
      if (signal?.aborted === true) return true
      setJobsError(reason instanceof Error ? reason.message : '导入任务读取失败')
      return false
    }
  }

  useEffect(() => {
    if (!foreground && !hasActiveTasks) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const succeeded = await loadJobs(controller.signal)
      if (controller.signal.aborted) return
      if (!succeeded || hasActiveRecordingImportTasks(jobsRef.current)) {
        timer = setTimeout(() => { void poll() }, succeeded ? 1_500 : 5_000)
      }
    }
    if (hasActiveTasks) timer = setTimeout(() => { void poll() }, 1_500)
    else void poll()
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [dialogEpoch, foreground, hasActiveTasks])

  const addFiles = (files: FileList | File[]) => {
    const fileNameKeys = new Set(rowsRef.current.map(row => recordingImportFileNameKey(row.file.name)))
    const duplicateFileNames: string[] = []
    const unique = [...files].filter(file => {
      const key = recordingImportFileNameKey(file.name)
      if (fileNameKeys.has(key)) {
        duplicateFileNames.push(file.name)
        return false
      }
      fileNameKeys.add(key)
      return true
    })
    if (duplicateFileNames.length > 0) {
      setError(`同一批次不能包含同名录音：${[...new Set(duplicateFileNames)].join('、')}`)
    }
    const additions = unique.map((file, index): StagedRecording => ({
      id: `${String(Date.now())}:${String(index)}:${file.name}:${String(file.size)}`, file, selected: true, validating: true,
      startAt: recordingImportLocalInputValue(new Date(recordingImportStartFromFileName(file.name, defaultStartAtMillis))),
      ownership: 'self', submitting: false, error: '',
    }))
    if (additions.length === 0) return
    publishRows(current => [...current, ...additions])
    const lifecycleSignal = lifecycleAbortRef.current?.signal
    duplicateCheckQueueRef.current = duplicateCheckQueueRef.current.then(async () => {
      try {
        const preflight = await callArkme<{ duplicateFileNames: string[] }>(
          'recordings.import.preflight',
          { fileNames: additions.map(addition => addition.file.name) },
          lifecycleSignal,
        )
        if (lifecycleSignal?.aborted === true || !inspectionActiveRef.current) return
        if (preflight.duplicateFileNames.length > 0) {
          publishDuplicateNames([...duplicateNamesRef.current, ...preflight.duplicateFileNames])
        }
      } catch (reason) {
        if (lifecycleSignal?.aborted !== true && inspectionActiveRef.current) {
          setError(reason instanceof Error ? reason.message : '重复文件检查失败')
        }
      }
    })
    for (const addition of additions) {
      inspectionQueueRef.current = inspectionQueueRef.current.then(async () => {
        if (!inspectionActiveRef.current) return
        let selection: ArkmeRecordingSelection
        try {
          selection = await inspectArkmeRecordingSelection(addition.file)
        } catch {
          selection = { ok: false, message: '音频格式与时长校验失败' }
        }
        if (!inspectionActiveRef.current) return
        publishRows(current => current.map(row => row.id === addition.id ? { ...row, validating: false, selection } : row))
      })
    }
  }

  const updateRow = (id: string, update: Partial<StagedRecording>) => {
    publishRows(current => current.map(row => row.id === id ? { ...row, ...update } : row))
  }

  const skipDuplicateRows = () => {
    const nameKeys = new Set(activeDuplicateNames.map(recordingImportFileNameKey))
    publishRows(current => current.filter(row => !nameKeys.has(recordingImportFileNameKey(row.file.name))))
    clearDuplicateNames()
  }

  const submitRows = async () => {
    if (pending || submissionActiveRef.current) return
    if (currentUserId <= 0 && selectedRows.some(row => row.ownership === 'self')) {
      setError('请先登录后再导入我的录音')
      return
    }
    const prepared = selectedRows.map(row => {
      const start = new Date(row.startAt).getTime()
      const duration = row.selection?.ok === true ? row.selection.durationMillis ?? 0 : 0
      const validationError = row.selection?.ok === false ? row.selection.message : row.validating ? '正在校验格式与时长…' : recordingImportEndTimeError(start, duration)
      if (validationError !== '') updateRow(row.id, { error: validationError })
      return { row, start, error: validationError }
    })
    if (prepared.some(item => item.error !== '')) return
    if (prepared.length === 0) return
    submissionActiveRef.current = true
    setError('')
    const preparedIds = new Set(prepared.map(item => item.row.id))
    publishRows(current => current.map(row => preparedIds.has(row.id) ? { ...row, submitting: true } : row))
    const controller = new AbortController()
    uploadAbortRef.current = controller
    const finishSubmission = () => {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = undefined
      submissionActiveRef.current = false
      if (inspectionActiveRef.current) {
        publishRows(current => current.map(row => preparedIds.has(row.id) ? withoutStagedUpload(row) : row))
      }
    }
    await duplicateCheckQueueRef.current
    if (controller.signal.aborted) {
      finishSubmission()
      return
    }
    const selectedNameKeys = new Set(prepared.map(item => recordingImportFileNameKey(item.row.file.name)))
    if (duplicateNamesRef.current.some(name => selectedNameKeys.has(recordingImportFileNameKey(name)))) {
      finishSubmission()
      return
    }
    try {
      const preflight = await callArkme<{ duplicateFileNames: string[] }>(
        'recordings.import.preflight',
        { fileNames: prepared.map(item => item.row.file.name) },
        controller.signal,
      )
      if (preflight.duplicateFileNames.length > 0) {
        publishDuplicateNames(preflight.duplicateFileNames)
        finishSubmission()
        return
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '重复文件检查失败')
      finishSubmission()
      return
    }
    clearDuplicateNames()
    const succeeded = new Set<string>()
    for (const { row, start } of prepared) {
      if (controller.signal.aborted) break
      const uploadStartedAtMillis = Date.now()
      updateRow(row.id, { error: '', uploadStartedAtMillis, uploadedBytes: 0 })
      try {
        const accepted = await uploadArkmeRecording(
          importPath,
          row.file,
          start,
          row.ownership === 'self' ? currentUserId : 0,
          {
            signal: controller.signal,
            onProgress: progress => {
              if (controller.signal.aborted || !inspectionActiveRef.current) return
              updateRow(row.id, { uploadedBytes: progress.uploadedBytes })
            },
          },
        )
        browserUploadTimingsRef.current.set(taskProcessingKey(accepted), {
          startedAtMillis: uploadStartedAtMillis,
          acceptedAtMillis: Date.now(),
        })
        jobsInitializedRef.current = true
        publishJobs([
          accepted,
          ...jobsRef.current.filter(task => !isLocalRecordingImport(task) || task.importRef !== accepted.importRef),
        ])
        setProcessingDetails(current => current?.sourceKey === stagedProcessingKey(row)
          ? { ...current, sourceKey: taskProcessingKey(accepted) }
          : current)
        succeeded.add(row.id)
        publishRows(current => current.filter(item => item.id !== row.id))
      } catch (reason) {
        if (!controller.signal.aborted) {
          publishRows(current => current.map(item => item.id === row.id
            ? { ...withoutStagedUpload(item), error: reason instanceof Error ? reason.message : '录音导入失败' }
            : item))
        }
      }
    }
    if (succeeded.size > 0) await loadJobs(controller.signal)
    finishSubmission()
  }

  const mutateJob = async (intent: 'recordings.import.retry' | 'recordings.import.cancel', job: PublicRecordingImportJob) => {
    if (pending) return
    setPending(true); setError('')
    try { await callArkme(intent, { importRef: job.importRef, expectedRevision: job.revision }); await loadJobs() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '导入任务操作失败') }
    finally { setPending(false) }
  }

  const loadHistory = async (
    reset: boolean,
    fixedToMillis?: number,
  ): Promise<boolean> => {
    const existing = history
    const toMillis = fixedToMillis ?? existing?.toMillis ?? Date.now()
    const offset = reset ? 0 : existing?.items.length ?? 0
    const requestKey = `${String(toMillis)}:${String(offset)}`
    if (historyLoadKeysRef.current.has(requestKey)) return false
    historyLoadKeysRef.current.add(requestKey)
    const lifecycleSignal = lifecycleAbortRef.current?.signal
    setHistory(current => ({
      toMillis,
      items: current?.toMillis === toMillis ? current.items : [],
      ...(current?.toMillis !== toMillis || current.total === undefined ? {} : { total: current.total }),
      loading: reset,
      loadingMore: !reset,
      hasMore: reset ? false : current?.hasMore ?? false,
      error: '',
      retryReset: reset,
    }))
    try {
      const page = await callArkme<PublicRecordingImportHistoryPage>(
        'recordings.import.history',
        { toMillis, limit: 50, offset },
        lifecycleSignal,
      )
      setHistory(current => {
        if (current === undefined || current.toMillis !== toMillis) return current
        const prior = reset ? [] : current.items
        const known = new Set(prior.map(item => item.taskKey))
        const appended = page.items.filter(item => !known.has(item.taskKey))
        const mergedItems = [...prior, ...appended]
        const items = page.total === undefined ? mergedItems : mergedItems.slice(0, page.total)
        return {
          toMillis,
          items,
          ...(page.total === undefined ? {} : { total: page.total }),
          loading: false,
          loadingMore: false,
          hasMore: page.hasMore,
          error: '',
          retryReset: false,
        }
      })
      return true
    } catch (reason) {
      if (lifecycleSignal?.aborted === true) return false
      setHistory(current => current === undefined || current.toMillis !== toMillis ? current : {
        ...current,
        loading: false,
        loadingMore: false,
        error: reason instanceof Error ? reason.message : '已完成任务读取失败',
        retryReset: reset,
      })
      return false
    } finally {
      historyLoadKeysRef.current.delete(requestKey)
    }
  }

  const openHistory = () => {
    setProcessingDetails(undefined)
    setStatusDetails(undefined)
    const toMillis = Date.now()
    void loadHistory(true, toMillis)
  }

  const reloadOwnerViews = async (historyView: boolean) => {
    await loadJobs()
    if (historyView && history !== undefined) await loadHistory(true, history.toMillis)
  }

  const applyOwnerMutationProjection = (intent: OwnerMutationIntent) => {
    const project = <Task extends ImportTask>(task: Task): Task => {
      if (taskSessionRef(task) !== intent.sessionRef) return task
      if (intent.kind === 'start') return {
        ...task,
        startAtMillis: intent.startAtMillis,
        endAtMillis: intent.startAtMillis + task.durationMillis,
      }
      if (intent.kind === 'ownership') return { ...task, ownership: intent.ownership }
      return task
    }
    publishJobs(intent.kind === 'delete'
      ? jobsRef.current.filter(task => taskSessionRef(task) !== intent.sessionRef)
      : jobsRef.current.map(project))
    setHistory(current => current === undefined ? current : {
      ...current,
      items: intent.kind === 'delete'
        ? current.items.filter(task => task.sessionRef !== intent.sessionRef)
        : current.items.map(project),
      ...(intent.kind === 'delete' && current.total !== undefined
        ? { total: Math.max(0, current.total - 1) }
        : {}),
    })
    setProcessingDetails(undefined)
    setStatusDetails(undefined)
  }

  const mutateOwner = async (intent: OwnerMutationIntent, historyView: boolean) => {
    if (pending) return
    setPending(true); setError('')
    try {
      if (intent.kind === 'start') {
        await callArkme('recordings.import.session.update-start', {
          sessionRef: intent.sessionRef,
          startAtMillis: intent.startAtMillis,
        })
      } else if (intent.kind === 'ownership') {
        await callArkme('recordings.import.session.update-ownership', {
          sessionRef: intent.sessionRef,
          ownership: intent.ownership,
        })
      } else {
        await callArkme('recordings.import.session.delete', { sessionRef: intent.sessionRef })
      }
      applyOwnerMutationProjection(intent)
      await reloadOwnerViews(historyView)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录音任务操作失败')
    } finally { setPending(false) }
  }

  const changeOwnerStart = (task: ImportTask, historyView: boolean, value: string) => {
    const sessionRef = taskSessionRef(task)
    if (sessionRef === undefined) return
    const key = sessionRef
    const startAtMillis = new Date(value).getTime()
    const validationError = recordingImportEndTimeError(startAtMillis, task.durationMillis)
    if (validationError !== '') { setError(validationError); return }
    void mutateOwner({
      kind: 'start',
      sessionRef,
      startAtMillis,
    }, historyView).finally(() => {
      setOwnerStartOverrides(current => {
        const next = { ...current }
        delete next[key]
        return next
      })
    })
  }

  const openProcessingDetails = (source: ProcessingDetailsSource, target?: HTMLElement) => {
    if (processingDetails?.sourceKey === source.key) {
      setProcessingDetails(undefined)
      return
    }
    const rect = target?.getBoundingClientRect() ?? { left: 40, right: 88, top: 72, bottom: 100 }
    const viewportWidth = typeof window === 'undefined' ? 780 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 560 : window.innerHeight
    const width = Math.max(processingPopoverMetrics.minWidth, Math.min(
      processingPopoverMetrics.maxWidth,
      viewportWidth - processingPopoverMetrics.viewportInset * 2,
      rect.right - processingPopoverMetrics.viewportInset,
    ))
    const estimatedHeight = processingPopoverMetrics.titleHeight + processingPopoverMetrics.headerHeight
      + Math.max(processingPopoverMetrics.emptyHeight, source.rows.length * processingPopoverMetrics.rowHeight)
    const showAbove = rect.top >= estimatedHeight + processingPopoverMetrics.gap
      || viewportHeight - rect.bottom < estimatedHeight + processingPopoverMetrics.gap
    const desiredTop = showAbove
      ? rect.top - estimatedHeight - processingPopoverMetrics.gap
      : rect.bottom + processingPopoverMetrics.gap
    const left = Math.max(processingPopoverMetrics.viewportInset, Math.min(
      rect.right - width,
      viewportWidth - width - processingPopoverMetrics.viewportInset,
    ))
    const top = Math.max(processingPopoverMetrics.viewportInset, Math.min(
      desiredTop,
      viewportHeight - estimatedHeight - processingPopoverMetrics.viewportInset,
    ))
    setProcessingDetails({ sourceKey: source.key, left, top, width })
  }

  const visibleJobs = jobs.filter(job => (!isLocalRecordingImport(job) || job.phase !== 'cancelled') && job.status !== 'completed')
  const importDisabled = pending || submittingRows.length > 0
    || selectedRows.length === 0 || activeDuplicateNames.length > 0

  const taskTimeEditor = (task: ImportTask, historyView: boolean) => {
    const sessionRef = taskSessionRef(task)
    const key = sessionRef ?? ('importRef' in task ? task.importRef : task.taskKey)
    const value = ownerStartOverrides[key] ?? recordingImportLocalInputValue(new Date(task.startAtMillis))
    const displayedStartAtMillis = new Date(value).getTime()
    return <span style={styles.fileCell}><span style={styles.fileName} title={task.fileName}>{task.fileName}</span><span style={styles.timeEditor}><input
      style={styles.timeInput}
      aria-label={`${task.fileName}录音开始时间`}
      type="datetime-local"
      step={1}
      value={value}
      disabled={pending || sessionRef === undefined}
      onChange={event => { setOwnerStartOverrides(current => ({ ...current, [key]: event.target.value })) }}
      onBlur={event => { if (event.target.value !== recordingImportLocalInputValue(new Date(task.startAtMillis))) changeOwnerStart(task, historyView, event.target.value) }}
    /><span aria-hidden>–</span><span style={styles.endTime} aria-label={`${task.fileName}录音结束时间`}>{recordingImportEndLabel(displayedStartAtMillis, task.durationMillis)}</span></span></span>
  }

  const taskOwnership = (task: ImportTask, historyView: boolean) => <span style={styles.ownership} aria-label={`${task.fileName}数据归属`}>
    <button type="button" aria-pressed={task.ownership === 'self'} disabled={pending || taskSessionRef(task) === undefined} style={{ ...styles.ownershipButton, ...(task.ownership === 'self' ? styles.ownershipSelected : {}) }} onClick={() => { const sessionRef = taskSessionRef(task); if (task.ownership !== 'self' && sessionRef !== undefined) setOwnershipChange({ kind: 'owner', sessionRef, ownership: 'self', history: historyView }) }}>我的</button>
    <button type="button" aria-pressed={task.ownership === 'other'} disabled={pending || taskSessionRef(task) === undefined} style={{ ...styles.ownershipButton, ...(task.ownership === 'other' ? styles.ownershipSelected : {}) }} onClick={() => { const sessionRef = taskSessionRef(task); if (task.ownership !== 'other' && sessionRef !== undefined) setOwnershipChange({ kind: 'owner', sessionRef, ownership: 'other', history: historyView }) }}>他人</button>
  </span>

  const taskStatusCell = (task: ImportTask) => <span
    style={styles.status}
    title={taskStatusTitle(task)}
    onMouseEnter={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      const viewportWidth = typeof window === 'undefined' ? 780 : window.innerWidth
      setStatusDetails({ task, left: Math.max(16, Math.min(rect.left, viewportWidth - 276)), top: rect.bottom + 6 })
    }}
    onMouseLeave={() => { setStatusDetails(undefined) }}
  >
    {task.status !== 'completed' && <span style={styles.progress} aria-label={`上传进度 ${String(Math.round(Math.max(0, Math.min(1, task.progress)) * 100))}%`}><span style={{ ...styles.progressValue, display: 'block', width: `${String(Math.max(0, Math.min(1, task.progress)) * 100)}%` }} /></span>}
    <span>{task.statusDetail}</span>
    {task.status === 'failed' && 'errorMessage' in task && task.errorMessage !== undefined && <small style={styles.error}>{task.errorMessage}</small>}
  </span>

  const processingDurationCell = (source?: ProcessingDetailsSource) => {
    if (source === undefined) return <span style={styles.cellCenter}>—</span>
    const label = durationLabel(source.durationMillis) || '0s'
    const selected = processingDetails?.sourceKey === source.key
    return <button
      type="button"
      aria-label={`处理耗时 ${label}`}
      style={{ ...styles.durationButton, ...(selected ? { background: desktop.selected } : {}) }}
      disabled={pending}
      onClick={event => { openProcessingDetails(source, event?.currentTarget) }}
    >{label}</button>
  }

  const taskDurationCell = (task: ImportTask) => processingDurationCell(
    taskProcessingSource(
      task,
      durationNowMillis,
      browserUploadTimingsRef.current.get(taskProcessingKey(task)),
    ),
  )

  const deleteTask = (task: RecordingImportSnapshot, historyView: boolean) => {
    if (isLocalRecordingImport(task)) setJobDeletion({ kind: 'job', job: task })
    else setJobDeletion({ kind: 'owner', sessionRef: task.sessionRef, fileName: task.fileName, history: historyView })
  }

  return <>
    <style>{'@keyframes arkme-recording-history-spin{to{transform:rotate(360deg)}}'}</style>
    <dialog ref={dialogRef} style={styles.dialog} aria-label="上传文件" tabIndex={-1} onCancel={event => {
      event.preventDefault()
      if (processingDetails !== undefined) { setProcessingDetails(undefined); return }
      if (jobDeletion !== undefined) { setJobDeletion(undefined); return }
      if (ownershipChange !== undefined) { setOwnershipChange(undefined); return }
      if (activeDuplicateNames.length > 0) { clearDuplicateNames(); return }
      if (history !== undefined) { setHistory(undefined); return }
      close()
    }} onClick={event => { if (event.target === event.currentTarget) close() }}>
      {history === undefined ? <><header style={styles.header}><h2 style={styles.title}>上传文件</h2><span style={styles.footerActions}><button type="button" style={styles.historyButton} onClick={openHistory}>已完成<CaretRight size={8} aria-hidden /></button><button type="button" aria-label="关闭上传文件" style={styles.iconButton} onClick={close}><X size={16} aria-hidden /></button></span></header>
      <div style={styles.body}>
        <>
          <input ref={fileInputRef} hidden multiple disabled={pending} aria-label="选择录音文件" type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={event => { if (!pending && event.target.files !== null) addFiles(event.target.files); event.target.value = '' }} />
          <div style={{ ...styles.dropzone, ...(pending ? { opacity: .55, cursor: 'default' } : {}) }} role="button" aria-disabled={pending} tabIndex={pending ? -1 : 0} onClick={() => { if (!pending) fileInputRef.current?.click() }} onKeyDown={event => { if (!pending && (event.key === 'Enter' || event.key === ' ')) fileInputRef.current?.click() }} onDragEnter={event => { event.preventDefault(); if (!pending) setDragging(true) }} onDragOver={event => { event.preventDefault() }} onDragLeave={() => { setDragging(false) }} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); if (!pending) addFiles(event.dataTransfer.files) }}><span style={styles.dropCopy}><UploadSimple size={18} aria-hidden /><span>点击、拖拽上传音频文件（支持多选）</span><small style={styles.hint}>支持 WAV、MP3、M4A 格式</small></span>{dragging && <span style={styles.dragOverlay}>松开上传至 Arkme</span>}</div>
          {(rows.length > 0 || visibleJobs.length > 0) && <div style={styles.tableViewport}><div style={styles.table} role="table" aria-label="待导入录音"><div style={styles.tableHeader} role="row"><span /><span>文件名称</span><span style={styles.cellCenter}>录音时长</span><span style={styles.cellCenter}>文件大小</span><span style={styles.cellCenter} title="我的数据写入时间轴，他人仅保存">数据归属</span><span style={styles.cellCenter}>上传状态</span><span style={styles.cellCenter}>处理耗时</span><span /></div><div style={styles.rowList} role="rowgroup" aria-label="录音文件列表">{rows.map(row => {
            const start = new Date(row.startAt).getTime(); const duration = row.selection?.ok === true ? row.selection.durationMillis ?? 0 : 0
            const timeError = row.selection?.ok === true ? recordingImportEndTimeError(start, duration) : ''
            const rowLocked = pending || row.submitting
            const uploadActive = row.submitting && (row.uploadStartedAtMillis ?? 0) > 0
            const uploadProgress = row.file.size <= 0 ? 0 : Math.max(0, Math.min(1, (row.uploadedBytes ?? 0) / row.file.size))
            const processingSource = stagedProcessingSource(row, durationNowMillis)
            return <div key={row.id} style={styles.row} role="row">
              <span style={styles.cellCenter}>{row.submitting ? null : <input style={styles.checkbox} aria-label={`选择 ${row.file.name}`} type="checkbox" checked={row.selected} disabled={pending} onChange={event => { updateRow(row.id, { selected: event.target.checked }) }} />}</span>
              <span style={styles.fileCell}><span style={styles.fileName}>{row.file.name}</span><span style={styles.timeEditor}><input style={styles.timeInput} aria-label={`${row.file.name}录音开始时间`} type="datetime-local" step={1} value={row.startAt} disabled={rowLocked} onChange={event => { updateRow(row.id, { startAt: event.target.value, error: '' }) }} /><span aria-hidden>–</span><span style={styles.endTime} aria-label={`${row.file.name}录音结束时间`}>{row.selection?.ok === true ? recordingImportEndLabel(start, duration) : '—'}</span></span>{timeError !== '' && <small style={styles.error}>{timeError}</small>}</span>
              <span style={styles.cellCenter}>{row.selection?.ok === true ? durationLabel(duration) : '—'}</span><span style={styles.cellCenter}>{fileSizeLabel(row.file.size)}</span>
              <span style={styles.ownership} aria-label={`${row.file.name}数据归属`}><button type="button" aria-pressed={row.ownership === 'self'} disabled={rowLocked} style={{ ...styles.ownershipButton, ...(row.ownership === 'self' ? styles.ownershipSelected : {}) }} onClick={() => { if (row.ownership !== 'self') setOwnershipChange({ kind: 'staged', id: row.id, ownership: 'self' }) }}>我的</button><button type="button" aria-pressed={row.ownership === 'other'} disabled={rowLocked} style={{ ...styles.ownershipButton, ...(row.ownership === 'other' ? styles.ownershipSelected : {}) }} onClick={() => { if (row.ownership !== 'other') setOwnershipChange({ kind: 'staged', id: row.id, ownership: 'other' }) }}>他人</button></span>
              <span style={styles.status}>{row.validating ? '正在校验' : row.submitting ? uploadActive ? <><span style={styles.progress} aria-label={`上传进度 ${String(Math.round(uploadProgress * 100))}%`}><span style={{ ...styles.progressValue, display: 'block', width: `${String(uploadProgress * 100)}%` }} /></span><span>上传中</span></> : '等待中' : row.selection?.ok === false ? <small style={styles.error}>{row.selection.message}</small> : row.error !== '' ? <small style={styles.error}>{row.error}</small> : '待导入'}</span><span style={styles.cellCenter}>{processingDurationCell(processingSource)}</span>
              <button type="button" aria-label={`删除 ${row.file.name}`} style={styles.iconButton} disabled={rowLocked} onClick={() => { publishRows(current => current.filter(item => item.id !== row.id)) }}><Trash size={20} /></button>
            </div>
          })}{visibleJobs.map(job => <div key={isLocalRecordingImport(job) ? job.importRef : job.taskKey} style={styles.row} role="row"><span aria-hidden />{taskTimeEditor(job, false)}<span style={styles.cellCenter}>{durationLabel(job.durationMillis)}</span><span style={styles.cellCenter}>{fileSizeLabel(job.fileSize)}</span>{taskOwnership(job, false)}{taskStatusCell(job)}<span style={styles.cellCenter}>{taskDurationCell(job)}</span><span>{isLocalRecordingImport(job) && job.retryable && <button type="button" aria-label={`重试 ${job.fileName}`} disabled={pending} style={styles.iconButton} onClick={() => { void mutateJob('recordings.import.retry', job) }}><ArrowCounterClockwise size={13} /></button>}<button type="button" aria-label={`删除 ${job.fileName}`} disabled={pending} style={styles.iconButton} onClick={() => { deleteTask(job, false) }}><Trash size={20} /></button></span></div>)}</div></div></div>}
        </>
        {jobsError !== '' && <div role="alert" style={{ ...styles.error, margin: '12px 16px 0' }}>{jobsError}</div>}
        {error !== '' && <div role="alert" style={{ ...styles.error, margin: '12px 16px 0' }}>{error}</div>}
      </div>
      <footer style={styles.footer}><span style={styles.selection}><span style={styles.checkboxSlot}>{selectableRows.length > 0 && <input style={styles.checkbox} aria-label="全选" type="checkbox" disabled={pending || submittingRows.length > 0} checked={selectedRows.length === selectableRows.length} onChange={event => { publishRows(current => current.map(row => row.submitting ? row : { ...row, selected: event.target.checked })) }} />}</span><span>共{rows.length + visibleJobs.length}个文件{selectedRows.length > 0 ? `，已选择${String(selectedRows.length)}个` : ''}</span></span><span style={styles.footerActions}><button type="button" style={{ ...styles.primaryButton, ...(importDisabled ? { borderColor: arkmeTheme.subtle, background: arkmeTheme.subtle, color: desktop.tertiary, cursor: 'default' } : {}) }} disabled={importDisabled} onClick={() => { void submitRows() }}><UploadSimple size={16} aria-hidden />导入</button></span></footer>
      </> : <section style={styles.historyDialog} aria-label="已完成录音导入">
        <header style={styles.header}><h2 style={styles.historyTitle}><span>已完成</span>{history.total !== undefined && <span style={styles.historyTotal}>（{history.total}）</span>}</h2><button type="button" aria-label="关闭已完成" style={styles.iconButton} onClick={() => { setProcessingDetails(undefined); setStatusDetails(undefined); setHistory(undefined) }}><X size={16} aria-hidden /></button></header>
        <div style={styles.historyBody} aria-label="已完成任务内容">
          {history.loading && history.items.length === 0
            ? <div style={styles.historyEmpty} aria-label="正在读取已完成任务"><span data-arkme-recording-history-spinner="large" style={styles.historySpinner} /></div>
            : history.error !== '' && history.items.length === 0
              ? <div role="alert" style={styles.historyEmpty} aria-label="已完成任务加载失败"><span>暂时无法加载已完成任务</span><small style={styles.historyEmptyHint}>请检查网络后重新加载</small><button type="button" style={styles.secondaryButton} onClick={() => { void loadHistory(true, history.toMillis) }}>重新加载</button></div>
              : history.items.length === 0
                ? <div style={styles.historyEmpty} aria-label="暂无已完成任务"><span>暂无已完成任务</span><small style={styles.historyEmptyHint}>导入完成的音频会显示在这里</small></div>
                : <div style={styles.historyReady}>
                  {(history.loading || (history.error !== '' && history.retryReset)) && <div role={history.error === '' ? 'status' : 'alert'} style={styles.historySync}>
                    {history.error === '' ? '正在同步云端记录' : <>当前显示上次结果，云端同步失败 <button type="button" style={{ ...styles.historyButton, color: arkmeTheme.accent }} onClick={() => { void loadHistory(true, history.toMillis) }}>重试</button></>}
                  </div>}
                  <div style={{ ...styles.historyTableViewport, minHeight: 0, flex: 1 }}><div style={styles.historyTable} aria-label="已完成任务表格">
                    <div style={styles.historyHeader} role="row"><span>文件名称</span><span style={styles.historyMetricCell}>录音时长</span><span style={styles.historyMetricCell}>文件大小</span><span style={styles.cellCenter}>数据归属</span><span style={styles.cellCenter}>上传状态</span><span style={styles.cellCenter}>处理耗时</span><span /></div>
                    <div style={styles.historyList} aria-label="已完成任务列表" onScroll={event => {
                      const target = event.currentTarget
                      if (history.hasMore && !history.loadingMore && history.error === ''
                        && target.scrollHeight - target.scrollTop - target.clientHeight <= 160) {
                        void loadHistory(false, history.toMillis)
                      }
                    }}>
                      {history.items.map(item => {
                        const duration = durationLabel(item.durationMillis)
                        const fileSize = fileSizeLabel(item.fileSize)
                        return <div key={item.taskKey} style={styles.historyRow} role="row">{taskTimeEditor(item, true)}<span aria-label={`${item.fileName}录音时长 ${duration}`} style={styles.historyMetricCell}>{duration}</span><span aria-label={`${item.fileName}文件大小 ${fileSize}`} style={styles.historyMetricCell}>{fileSize}</span>{taskOwnership(item, true)}{taskStatusCell(item)}<span style={styles.cellCenter}>{taskDurationCell(item)}</span><button type="button" aria-label={`删除 ${item.fileName}`} disabled={pending} style={styles.iconButton} onClick={() => { setJobDeletion({ kind: 'owner', sessionRef: item.sessionRef, fileName: item.fileName, history: true }) }}><Trash size={20} /></button></div>
                      })}
                      {history.loadingMore && <div style={styles.historyLoadMore}><span data-arkme-recording-history-spinner="small" style={styles.historyTailSpinner} />正在加载更多...</div>}
                      {history.error !== '' && !history.retryReset && <div role="alert" style={styles.historyLoadMore}><button type="button" style={{ ...styles.historyButton, color: arkmeTheme.accent }} onClick={() => { void loadHistory(false, history.toMillis) }}>加载失败，点击重试</button></div>}
                      {error !== '' && <div role="alert" style={{ ...styles.error, padding: 16 }}>{error}</div>}
                    </div>
                  </div></div>
                </div>}
        </div>
      </section>}
      {activeDuplicateNames.length > 0 && <div style={styles.modalBackdrop} onClick={event => { if (event.target === event.currentTarget) clearDuplicateNames() }}><section role="dialog" aria-modal="true" aria-label="重复录音文件" style={styles.duplicateDialog}><h3 style={styles.confirmTitle}>发现 {activeDuplicateNames.length} 个重复文件</h3><p style={styles.confirmCopy}>将跳过这些文件，并继续导入其余音频</p><div style={styles.duplicateFiles}>{activeDuplicateNames.map(name => <div key={name}>{name}</div>)}</div><span style={styles.confirmActions}><button type="button" style={styles.primaryButton} onClick={skipDuplicateRows}>跳过并继续</button></span></section></div>}
      {jobDeletion !== undefined && <div style={styles.modalBackdrop}><section role="dialog" aria-modal="true" aria-label="确认删除录音" style={styles.confirmDialog}><h3 style={styles.confirmTitle}>是否删除 {jobDeletion.kind === 'job' ? jobDeletion.job.fileName : jobDeletion.fileName} ?</h3><p style={styles.confirmCopy}>删除后无法恢复</p><span style={styles.confirmActions}><button type="button" aria-label="取消删除" style={styles.secondaryButton} onClick={() => { setJobDeletion(undefined) }}>取消</button><button type="button" aria-label="确认删除" style={styles.primaryButton} onClick={() => { const target = jobDeletion; setJobDeletion(undefined); if (target.kind === 'job') void mutateJob('recordings.import.cancel', target.job); else void mutateOwner({ kind: 'delete', sessionRef: target.sessionRef }, target.history) }}>确认</button></span></section></div>}
      {ownershipChange !== undefined && <div style={styles.modalBackdrop}><section role="dialog" aria-modal="true" aria-label="确认修改数据归属" style={styles.confirmDialog}><h3 style={styles.confirmTitle}>确定修改音频文件的数据归属吗？</h3><p style={styles.confirmCopy}>我的数据写入时间轴，他人仅保存</p><span style={styles.confirmActions}><button type="button" aria-label="取消" style={styles.secondaryButton} onClick={() => { setOwnershipChange(undefined) }}>取消</button><button type="button" aria-label="确认" style={styles.primaryButton} onClick={() => { const target = ownershipChange; setOwnershipChange(undefined); if (target.kind === 'staged') updateRow(target.id, { ownership: target.ownership }); else void mutateOwner({ kind: 'ownership', sessionRef: target.sessionRef, ownership: target.ownership }, target.history) }}>确认</button></span></section></div>}
      {processingDetails !== undefined && processingSource !== undefined && (() => {
        const progressRows = processingSource.rows
        return <div role="presentation" style={{ position: 'fixed', zIndex: 7, inset: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) setProcessingDetails(undefined) }}>
          <section aria-label={`${processingSource.fileName}处理耗时详情`} style={{ ...styles.detailsPopover, left: processingDetails.left, top: processingDetails.top, width: processingDetails.width }}>
            <div style={styles.detailsTitle}><span>处理耗时</span><button type="button" aria-label={`关闭 ${processingSource.fileName}处理耗时详情`} style={styles.iconButton} onClick={() => { setProcessingDetails(undefined) }}><X size={12} aria-hidden /></button></div>
            <div style={{ ...styles.detailsGrid, ...styles.detailsHeader }}>
              <span style={styles.detailsPhaseCell}>阶段 / 模型</span><span style={styles.detailsCell}>状态</span><span style={styles.detailsCell}>开始时间</span><span style={styles.detailsCell}>结束时间</span><span style={styles.detailsCell}>用户耗时</span><span style={styles.detailsCell}>模型耗时</span><span style={styles.detailsCell}>关系 / 说明</span>
            </div>
            {progressRows.length === 0
              ? <div style={{ ...styles.empty, minHeight: processingPopoverMetrics.emptyHeight, padding: '0 12px' }}>暂无耗时信息</div>
              : progressRows.map((row, index) => <div key={row.key} style={{ ...styles.detailsGrid, ...styles.detailsRow, ...(index === progressRows.length - 1 ? { borderBottom: 0 } : {}) }}>
                <span style={styles.detailsPhaseCell} title={row.modelTooltip}>{row.phaseLabel}</span>
                <span style={styles.detailsStatus}><span style={{ ...styles.detailsStatusDot, background: progressStatusColor(row.status) }} /><span style={styles.detailsCell}>{progressStatusLabel(row)}</span></span>
                <span style={styles.detailsCell} title={compactClock(row.startedAtMillis)}>{compactClock(row.startedAtMillis)}</span>
                <span style={styles.detailsCell} title={compactClock(row.endedAtMillis)}>{compactClock(row.endedAtMillis)}</span>
                <span style={styles.detailsCell}>{progressUserDuration(row, processingSource, durationNowMillis)}</span>
                <span style={styles.detailsCell}>{progressModelDuration(row)}</span>
                <span style={styles.detailsCell} title={row.relationTooltip}>{row.relationLabel}</span>
              </div>)}
          </section>
        </div>
      })()}
      {statusDetails !== undefined && <div role="tooltip" aria-label={`${statusDetails.task.fileName}上传状态详情`} style={{ ...styles.statusTooltip, left: statusDetails.left, top: statusDetails.top }}>{taskStatusTitle(statusDetails.task)}</div>}
    </dialog>
  </>
})
