import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
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
  PublicRecordingImportCurrentSnapshot,
  PublicRecordingImportProcessingTiming,
  PublicRecordingImportProcessingTimingRow,
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

const desktop = {
  background: arkmeTheme.base, surface: arkmeTheme.layer2, hover: arkmeTheme.hover, selected: arkmeTheme.active,
  border: arkmeTheme.border, text: arkmeTheme.text, secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary, danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  trigger: { minHeight: 36, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, color: desktop.text, cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  dialog: { width: 'min(780px,calc(100vw - 32px))', maxWidth: 780, maxHeight: 'calc(100vh - 48px)', padding: 0, border: 0, outline: 'none', borderRadius: 12, background: desktop.background, color: desktop.text, boxShadow: '0 16px 48px rgba(0,0,0,.18)', overflow: 'hidden' },
  header: { height: 60, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { margin: 0, fontSize: 18, lineHeight: '28px', fontWeight: 500 },
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
  fileCell: { minWidth: 0, padding: '10px 8px 10px 2px', display: 'grid', gap: 4 },
  fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: desktop.text, fontSize: 12 },
  timeEditor: { display: 'flex', alignItems: 'center', gap: 8, color: desktop.secondary, fontSize: 13 },
  timeInput: { width: 174, height: 26, boxSizing: 'border-box', padding: '3px 6px', border: `1px solid ${desktop.border}`, borderRadius: 4, background: desktop.surface, color: desktop.secondary, font: 'inherit', fontSize: 11 },
  endTime: { minWidth: 72, height: 24, padding: '2px 6px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${desktop.border}`, borderRadius: 4, color: desktop.tertiary, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  ownership: { justifySelf: 'center', width: 90, height: 28, padding: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', border: 0, borderRadius: 4, background: desktop.selected },
  ownershipButton: { border: 0, borderRadius: 3, background: 'transparent', color: desktop.tertiary, cursor: 'pointer', fontSize: 12 },
  ownershipSelected: { background: desktop.background, color: desktop.text, boxShadow: '0 1px 2px rgba(0,0,0,.08)' },
  status: { display: 'grid', placeItems: 'center', gap: 4, color: desktop.secondary, fontSize: 13, lineHeight: '20px', fontWeight: 500, textAlign: 'center' },
  progress: { width: 38, height: 4, marginBottom: 8, accentColor: desktop.text },
  historyButton: { minWidth: 54, height: 28, padding: '0 4px', border: 0, background: 'transparent', color: desktop.secondary, cursor: 'pointer', fontSize: 13 },
  durationButton: { minWidth: 48, minHeight: 28, padding: '0 6px', border: 0, borderRadius: 4, background: 'transparent', color: desktop.secondary, cursor: 'pointer', fontSize: 12 },
  detailsPopover: { position: 'fixed', zIndex: 8, width: 'min(680px,calc(100vw - 40px))', maxHeight: 'min(360px,calc(100vh - 80px))', padding: 12, overflow: 'auto', border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, boxShadow: '0 12px 36px rgba(0,0,0,.18)', color: desktop.text },
  detailsHeader: { display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 62px 82px 82px 70px', gap: 6, padding: '5px 8px', color: desktop.tertiary, fontSize: 11, borderBottom: `1px solid ${desktop.border}` },
  detailsRow: { display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 62px 82px 82px 70px', gap: 6, padding: '7px 8px', alignItems: 'center', color: desktop.secondary, fontSize: 11, borderBottom: `1px solid ${desktop.border}` },
  statusTooltip: { position: 'fixed', zIndex: 9, minWidth: 150, maxWidth: 260, padding: '9px 11px', border: `1px solid ${desktop.border}`, borderRadius: 6, background: desktop.text, color: desktop.background, boxShadow: '0 8px 24px rgba(0,0,0,.18)', fontSize: 11, lineHeight: '18px', whiteSpace: 'pre-line', pointerEvents: 'none' },
  historyDialog: { width: 'min(780px,calc(100vw - 32px))', height: 'min(560px,calc(100vh - 48px))', display: 'grid', gridTemplateRows: '60px minmax(0,1fr)', background: desktop.background },
  historyBody: { minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) auto', overflow: 'hidden' },
  historyHeader: { height: 40, display: 'grid', gridTemplateColumns: 'minmax(310px,1fr) 64px 72px 98px 80px 72px 44px', alignItems: 'center', color: desktop.tertiary, borderBottom: `1px solid ${desktop.border}`, fontSize: 12 },
  historyList: { minHeight: 0, overflowY: 'auto' },
  historyRow: { minHeight: 70, padding: '5px 0', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'minmax(310px,1fr) 64px 72px 98px 80px 72px 44px', alignItems: 'center', borderBottom: `1px solid ${desktop.border}` },
  loadMore: { height: 36, margin: '12px auto', padding: '0 18px', border: `1px solid ${desktop.border}`, borderRadius: 6, background: desktop.background, color: desktop.secondary, cursor: 'pointer' },
  error: { color: desktop.danger, fontSize: 11, lineHeight: '16px' },
  empty: { padding: '40px', display: 'grid', justifyItems: 'center', gap: 16, color: desktop.tertiary, fontSize: 14 },
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
  const timingState = taskProcessing(task)?.timingState
  if (timingState !== undefined) lines.push(`耗时采集：${processingTimingStateLabel(timingState)}`)
  if ('progress' in task && task.progress > 0 && task.progress < 1) {
    lines.push(`上传进度：${String(Math.round(task.progress * 100))}%`)
  }
  return lines.join('\n')
}

function processingTimingStateLabel(status: PublicRecordingImportProcessingTiming['timingState']): string {
  switch (status) {
    case 'processing': return '处理中'
    case 'completed': return '已完成'
    case 'unavailable': return '不可用'
  }
}

function processingOutcomeLabel(outcome: PublicRecordingImportProcessingTimingRow['outcome']): string {
  return outcome === 'success' ? '成功' : '失败'
}

function progressPhaseLabel(row: PublicRecordingImportProcessingTimingRow): string {
  const phase = row.stage === 'sd' ? '说话人识别'
    : row.stage === 'vad' ? '语音活动检测'
      : '转写'
  const model = [row.provider, row.model, row.modelVersion].filter(Boolean).join(' / ')
  return model === '' ? phase : `${phase} · ${model}`
}

function compactClock(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return '—'
  return new Date(millis).toLocaleTimeString('zh-CN', { hour12: false })
}

function processingDuration(task: ImportTask): number | undefined {
  if (isLocalImportTask(task)) return undefined
  const durationMillis = task.processingDurationMillis
  if (durationMillis === undefined || !Number.isFinite(durationMillis) || durationMillis < 0) return undefined
  return durationMillis
}

function taskProcessing(task: ImportTask): PublicRecordingImportProcessingTiming | undefined {
  return isLocalImportTask(task) ? undefined : task.processing
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
  const lifecycleAbortRef = useRef<AbortController>()
  const duplicateCheckQueueRef = useRef<Promise<void>>(Promise.resolve())
  const duplicateNamesRef = useRef<string[]>([])
  const uploadAbortRef = useRef<AbortController>()
  const submissionActiveRef = useRef(false)
  const inspectionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const inspectionActiveRef = useRef(false)
  const [rows, setRows] = useState<StagedRecording[]>([])
  const [jobs, setJobs] = useState<RecordingImportSnapshot[]>([])
  const [jobsInitialized, setJobsInitialized] = useState(false)
  const [dialogEpoch, setDialogEpoch] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [jobsError, setJobsError] = useState('')
  const [duplicateNames, setDuplicateNames] = useState<string[]>([])
  const [ownershipChange, setOwnershipChange] = useState<OwnershipChange>()
  const [jobDeletion, setJobDeletion] = useState<ImportDeletion>()
  const [history, setHistory] = useState<HistoryState>()
  const [processingDetails, setProcessingDetails] = useState<{ task: ImportTask; left: number; top: number }>()
  const [statusDetails, setStatusDetails] = useState<{ task: ImportTask; left: number; top: number }>()
  const [ownerStartOverrides, setOwnerStartOverrides] = useState<Record<string, string>>({})
  const selectedRows = useMemo(() => rows.filter(row => row.selected), [rows])
  const activeDuplicateNames = useMemo(() => {
    const stagedNameKeys = new Set(rows.map(row => recordingImportFileNameKey(row.file.name)))
    return duplicateNames.filter(name => stagedNameKeys.has(recordingImportFileNameKey(name)))
  }, [duplicateNames, rows])

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
  const close = () => { dialogRef.current?.close() }
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

  const loadJobs = async (signal?: AbortSignal) => {
    const loadRevision = ++jobsLoadRevisionRef.current
    try {
      const snapshot = await callArkme<PublicRecordingImportCurrentSnapshot>('recordings.import.list', undefined, signal)
      if (signal?.aborted === true || loadRevision !== jobsLoadRevisionRef.current) return true
      const nextItems = recordingImportItemsForSnapshot(jobsRef.current, snapshot)
      const calendarChanged = jobsInitializedRef.current && hasRecordingImportCalendarChange(jobsRef.current, nextItems)
      jobsInitializedRef.current = true
      publishJobs(nextItems)
      setJobsInitialized(true)
      setJobsError(snapshot.owner.state === 'available' ? '' : snapshot.owner.message)
      if (calendarChanged) onAccepted()
      return snapshot.owner.state === 'available'
    } catch (reason) {
      if (signal?.aborted === true) return true
      setJobsInitialized(true)
      setJobsError(reason instanceof Error ? reason.message : '导入任务读取失败')
      return false
    }
  }

  useEffect(() => {
    const knownActiveTasks = hasActiveRecordingImportTasks(jobsRef.current)
    if (!foreground && !pending && !knownActiveTasks) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const succeeded = await loadJobs(controller.signal)
      if (controller.signal.aborted) return
      if (!succeeded || hasActiveRecordingImportTasks(jobsRef.current)) {
        timer = setTimeout(() => { void poll() }, succeeded ? 1_500 : 5_000)
      }
    }
    if (!foreground && !pending && knownActiveTasks) timer = setTimeout(() => { void poll() }, 1_500)
    else void poll()
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [dialogEpoch, pending, foreground])

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
    setPending(true); setError('')
    const controller = new AbortController()
    uploadAbortRef.current = controller
    const finishSubmission = () => {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = undefined
      submissionActiveRef.current = false
      if (inspectionActiveRef.current) setPending(false)
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
      updateRow(row.id, { submitting: true, error: '' })
      try {
        const accepted = await uploadArkmeRecording(
          importPath,
          row.file,
          start,
          row.ownership === 'self' ? currentUserId : 0,
          controller.signal,
        )
        jobsInitializedRef.current = true
        publishJobs([
          accepted,
          ...jobsRef.current.filter(task => !isLocalRecordingImport(task) || task.importRef !== accepted.importRef),
        ])
        succeeded.add(row.id)
      } catch (reason) {
        if (!controller.signal.aborted) updateRow(row.id, { error: reason instanceof Error ? reason.message : '录音导入失败' })
      } finally { updateRow(row.id, { submitting: false }) }
    }
    if (succeeded.size > 0) publishRows(current => current.filter(row => !succeeded.has(row.id)))
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
    }
  }

  const openHistory = () => {
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

  const openProcessingDetails = (task: ImportTask, target?: HTMLElement) => {
    const rect = target?.getBoundingClientRect() ?? { left: 40, bottom: 100 }
    const viewportWidth = typeof window === 'undefined' ? 780 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 560 : window.innerHeight
    const width = Math.min(680, Math.max(320, viewportWidth - 40))
    const left = Math.max(20, Math.min(rect.left, viewportWidth - width - 20))
    const top = Math.max(20, Math.min(rect.bottom + 6, viewportHeight - 370))
    setProcessingDetails({ task, left, top })
  }

  const visibleJobs = jobs.filter(job => (!isLocalRecordingImport(job) || job.phase !== 'cancelled') && job.status !== 'completed')

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
    {task.status === 'uploading' && <progress style={styles.progress} max={1} value={task.progress} />}
    <span>{task.statusDetail}</span>
    {task.status === 'failed' && 'errorMessage' in task && task.errorMessage !== undefined && <small style={styles.error}>{task.errorMessage}</small>}
  </span>

  const taskDurationCell = (task: ImportTask) => {
    const durationMillis = processingDuration(task)
    if (durationMillis === undefined) return <span style={styles.cellCenter}>—</span>
    const label = durationLabel(durationMillis) || '0s'
    return <button
      type="button"
      aria-label={`处理耗时 ${label}`}
      style={styles.durationButton}
      disabled={pending}
      onClick={event => { openProcessingDetails(task, event?.currentTarget) }}
    >{label}</button>
  }

  const deleteTask = (task: RecordingImportSnapshot, historyView: boolean) => {
    if (isLocalRecordingImport(task)) setJobDeletion({ kind: 'job', job: task })
    else setJobDeletion({ kind: 'owner', sessionRef: task.sessionRef, fileName: task.fileName, history: historyView })
  }

  return <>
    <dialog ref={dialogRef} style={styles.dialog} aria-label="上传文件" tabIndex={-1} onCancel={event => {
      event.preventDefault()
      if (processingDetails !== undefined) { setProcessingDetails(undefined); return }
      if (jobDeletion !== undefined) { setJobDeletion(undefined); return }
      if (ownershipChange !== undefined) { setOwnershipChange(undefined); return }
      if (activeDuplicateNames.length > 0) { clearDuplicateNames(); return }
      if (history !== undefined) { setHistory(undefined); return }
      close()
    }} onClick={event => { if (event.target === event.currentTarget) close() }}>
      {history === undefined ? <><header style={styles.header}><h2 style={styles.title}>上传文件</h2><span style={styles.footerActions}><button type="button" style={styles.historyButton} onClick={openHistory}>已完成</button><button type="button" aria-label="关闭上传文件" style={styles.iconButton} onClick={close}><X size={16} aria-hidden /></button></span></header>
      <div style={styles.body}>
        <>
          <input ref={fileInputRef} hidden multiple disabled={pending} aria-label="选择录音文件" type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={event => { if (!pending && event.target.files !== null) addFiles(event.target.files); event.target.value = '' }} />
          <div style={{ ...styles.dropzone, ...(pending ? { opacity: .55, cursor: 'default' } : {}) }} role="button" aria-disabled={pending} tabIndex={pending ? -1 : 0} onClick={() => { if (!pending) fileInputRef.current?.click() }} onKeyDown={event => { if (!pending && (event.key === 'Enter' || event.key === ' ')) fileInputRef.current?.click() }} onDragEnter={event => { event.preventDefault(); if (!pending) setDragging(true) }} onDragOver={event => { event.preventDefault() }} onDragLeave={() => { setDragging(false) }} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); if (!pending) addFiles(event.dataTransfer.files) }}><span style={styles.dropCopy}><UploadSimple size={18} aria-hidden /><span>点击、拖拽上传音频文件（支持多选）</span><small style={styles.hint}>支持 WAV、MP3、M4A 格式</small></span>{dragging && <span style={styles.dragOverlay}>松开上传至 Arkme</span>}</div>
          {(rows.length > 0 || visibleJobs.length > 0) && <div style={styles.tableViewport}><div style={styles.table} role="table" aria-label="待导入录音"><div style={styles.tableHeader} role="row"><span /><span>文件名称</span><span style={styles.cellCenter}>录音时长</span><span style={styles.cellCenter}>文件大小</span><span style={styles.cellCenter} title="我的数据写入时间轴，他人仅保存">数据归属</span><span style={styles.cellCenter}>上传状态</span><span style={styles.cellCenter}>处理耗时</span><span /></div><div style={styles.rowList} role="rowgroup" aria-label="录音文件列表">{rows.map(row => {
            const start = new Date(row.startAt).getTime(); const duration = row.selection?.ok === true ? row.selection.durationMillis ?? 0 : 0
            const timeError = row.selection?.ok === true ? recordingImportEndTimeError(start, duration) : ''
            return <div key={row.id} style={styles.row} role="row"><span style={styles.cellCenter}><input style={styles.checkbox} aria-label={`选择 ${row.file.name}`} type="checkbox" checked={row.selected} disabled={pending} onChange={event => { updateRow(row.id, { selected: event.target.checked }) }} /></span><span style={styles.fileCell}><span style={styles.fileName}>{row.file.name}</span><span style={styles.timeEditor}><input style={styles.timeInput} aria-label={`${row.file.name}录音开始时间`} type="datetime-local" step={1} value={row.startAt} disabled={pending} onChange={event => { updateRow(row.id, { startAt: event.target.value, error: '' }) }} /><span aria-hidden>–</span><span style={styles.endTime} aria-label={`${row.file.name}录音结束时间`}>{row.selection?.ok === true ? recordingImportEndLabel(start, duration) : '—'}</span></span>{timeError !== '' && <small style={styles.error}>{timeError}</small>}</span><span style={styles.cellCenter}>{row.selection?.ok === true ? durationLabel(duration) : '—'}</span><span style={styles.cellCenter}>{fileSizeLabel(row.file.size)}</span><span style={styles.ownership} aria-label={`${row.file.name}数据归属`}><button type="button" aria-pressed={row.ownership === 'self'} disabled={pending} style={{ ...styles.ownershipButton, ...(row.ownership === 'self' ? styles.ownershipSelected : {}) }} onClick={() => { if (row.ownership !== 'self') setOwnershipChange({ kind: 'staged', id: row.id, ownership: 'self' }) }}>我的</button><button type="button" aria-pressed={row.ownership === 'other'} disabled={pending} style={{ ...styles.ownershipButton, ...(row.ownership === 'other' ? styles.ownershipSelected : {}) }} onClick={() => { if (row.ownership !== 'other') setOwnershipChange({ kind: 'staged', id: row.id, ownership: 'other' }) }}>他人</button></span><span style={styles.status}>{row.validating ? '正在校验' : row.submitting ? '上传中' : row.selection?.ok === false ? <small style={styles.error}>{row.selection.message}</small> : row.error !== '' ? <small style={styles.error}>{row.error}</small> : '待导入'}</span><span style={styles.cellCenter}>—</span><button type="button" aria-label={`删除 ${row.file.name}`} style={styles.iconButton} disabled={pending} onClick={() => { publishRows(current => current.filter(item => item.id !== row.id)) }}><Trash size={20} /></button></div>
          })}{visibleJobs.map(job => <div key={isLocalRecordingImport(job) ? job.importRef : job.taskKey} style={styles.row} role="row"><span aria-hidden />{taskTimeEditor(job, false)}<span style={styles.cellCenter}>{durationLabel(job.durationMillis)}</span><span style={styles.cellCenter}>{fileSizeLabel(job.fileSize)}</span>{taskOwnership(job, false)}{taskStatusCell(job)}<span style={styles.cellCenter}>{taskDurationCell(job)}</span><span>{isLocalRecordingImport(job) && job.retryable && <button type="button" aria-label={`重试 ${job.fileName}`} disabled={pending} style={styles.iconButton} onClick={() => { void mutateJob('recordings.import.retry', job) }}><ArrowCounterClockwise size={13} /></button>}<button type="button" aria-label={`删除 ${job.fileName}`} disabled={pending} style={styles.iconButton} onClick={() => { deleteTask(job, false) }}><Trash size={20} /></button></span></div>)}</div></div></div>}
          {!jobsInitialized && rows.length === 0 && visibleJobs.length === 0 && <div style={styles.empty}>正在读取上传任务…</div>}
          {jobsInitialized && jobsError === '' && rows.length === 0 && visibleJobs.length === 0 && <div style={styles.empty}><span>暂无文件</span><button type="button" style={styles.primaryButton} disabled={pending} onClick={() => { fileInputRef.current?.click() }}><UploadSimple size={16} aria-hidden />添加文件</button></div>}
        </>
        {jobsError !== '' && <div role="alert" style={{ ...styles.error, margin: '12px 16px 0' }}>{jobsError}</div>}
        {error !== '' && <div role="alert" style={{ ...styles.error, margin: '12px 16px 0' }}>{error}</div>}
      </div>
      <footer style={styles.footer}><span style={styles.selection}><span style={styles.checkboxSlot}>{rows.length > 0 && <input style={styles.checkbox} aria-label="全选" type="checkbox" disabled={pending} checked={selectedRows.length === rows.length} onChange={event => { publishRows(current => current.map(row => ({ ...row, selected: event.target.checked }))) }} />}</span><span>共{rows.length + visibleJobs.length}个文件{selectedRows.length > 0 ? `，已选择${String(selectedRows.length)}个` : ''}</span></span><span style={styles.footerActions}><button type="button" style={styles.primaryButton} disabled={pending || selectedRows.length === 0 || activeDuplicateNames.length > 0} onClick={() => { void submitRows() }}><UploadSimple size={16} aria-hidden />{pending ? '正在导入…' : '导入'}</button></span></footer>
      </> : <section style={styles.historyDialog} aria-label="已完成录音导入"><header style={styles.header}><h2 style={styles.title}>已完成{history.total === undefined ? '' : `（${String(history.total)}）`}</h2><button type="button" aria-label="关闭已完成" style={styles.iconButton} onClick={() => { setHistory(undefined) }}><X size={16} aria-hidden /></button></header><div style={styles.historyBody}><div style={styles.historyHeader} role="row"><span style={{ paddingLeft: 24 }}>文件名称</span><span style={styles.cellCenter}>录音时长</span><span style={styles.cellCenter}>文件大小</span><span style={styles.cellCenter}>数据归属</span><span style={styles.cellCenter}>上传状态</span><span style={styles.cellCenter}>处理耗时</span><span /></div><div style={styles.historyList}>{history.loading && history.items.length === 0 && <div style={styles.empty}>正在读取已完成任务…</div>}{!history.loading && history.items.length === 0 && history.error === '' && <div style={styles.empty}>暂无已完成文件</div>}{history.items.map(item => <div key={item.taskKey} style={styles.historyRow} role="row">{taskTimeEditor(item, true)}<span style={styles.cellCenter}>{durationLabel(item.durationMillis)}</span><span style={styles.cellCenter}>{fileSizeLabel(item.fileSize)}</span>{taskOwnership(item, true)}{taskStatusCell(item)}<span style={styles.cellCenter}>{taskDurationCell(item)}</span><button type="button" aria-label={`删除 ${item.fileName}`} disabled={pending} style={styles.iconButton} onClick={() => { setJobDeletion({ kind: 'owner', sessionRef: item.sessionRef, fileName: item.fileName, history: true }) }}><Trash size={20} /></button></div>)}{history.error !== '' && <div role="alert" style={{ ...styles.error, padding: 16 }}>{history.error}<button type="button" style={styles.secondaryButton} onClick={() => { void loadHistory(history.retryReset, history.toMillis) }}>重试</button></div>}{error !== '' && <div role="alert" style={{ ...styles.error, padding: 16 }}>{error}</div>}</div><span>{history.hasMore && <button type="button" style={styles.loadMore} disabled={history.loadingMore} onClick={() => { void loadHistory(false, history.toMillis) }}>{history.loadingMore ? '加载中…' : '加载更多'}</button>}</span></div></section>}
      {activeDuplicateNames.length > 0 && <div style={styles.modalBackdrop} onClick={event => { if (event.target === event.currentTarget) clearDuplicateNames() }}><section role="dialog" aria-modal="true" aria-label="重复录音文件" style={styles.duplicateDialog}><h3 style={styles.confirmTitle}>发现 {activeDuplicateNames.length} 个重复文件</h3><p style={styles.confirmCopy}>将跳过这些文件，并继续导入其余音频</p><div style={styles.duplicateFiles}>{activeDuplicateNames.map(name => <div key={name}>{name}</div>)}</div><span style={styles.confirmActions}><button type="button" style={styles.primaryButton} onClick={skipDuplicateRows}>跳过并继续</button></span></section></div>}
      {jobDeletion !== undefined && <div style={styles.modalBackdrop}><section role="dialog" aria-modal="true" aria-label="确认删除录音" style={styles.confirmDialog}><h3 style={styles.confirmTitle}>是否删除 {jobDeletion.kind === 'job' ? jobDeletion.job.fileName : jobDeletion.fileName} ?</h3><p style={styles.confirmCopy}>删除后无法恢复</p><span style={styles.confirmActions}><button type="button" aria-label="取消删除" style={styles.secondaryButton} onClick={() => { setJobDeletion(undefined) }}>取消</button><button type="button" aria-label="确认删除" style={styles.primaryButton} onClick={() => { const target = jobDeletion; setJobDeletion(undefined); if (target.kind === 'job') void mutateJob('recordings.import.cancel', target.job); else void mutateOwner({ kind: 'delete', sessionRef: target.sessionRef }, target.history) }}>确认</button></span></section></div>}
      {ownershipChange !== undefined && <div style={styles.modalBackdrop}><section role="dialog" aria-modal="true" aria-label="确认修改数据归属" style={styles.confirmDialog}><h3 style={styles.confirmTitle}>确定修改音频文件的数据归属吗？</h3><p style={styles.confirmCopy}>我的数据写入时间轴，他人仅保存</p><span style={styles.confirmActions}><button type="button" aria-label="取消" style={styles.secondaryButton} onClick={() => { setOwnershipChange(undefined) }}>取消</button><button type="button" aria-label="确认" style={styles.primaryButton} onClick={() => { const target = ownershipChange; setOwnershipChange(undefined); if (target.kind === 'staged') updateRow(target.id, { ownership: target.ownership }); else void mutateOwner({ kind: 'ownership', sessionRef: target.sessionRef, ownership: target.ownership }, target.history) }}>确认</button></span></section></div>}
      {processingDetails !== undefined && <div role="presentation" style={{ position: 'fixed', zIndex: 7, inset: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) setProcessingDetails(undefined) }}><section aria-label={`${processingDetails.task.fileName}处理耗时详情`} style={{ ...styles.detailsPopover, left: processingDetails.left, top: processingDetails.top }}><div style={styles.detailsHeader}><span>阶段 / 模型</span><span>结果</span><span>开始</span><span>结束</span><span>阶段耗时</span></div>{taskProcessing(processingDetails.task)?.rows.length ? taskProcessing(processingDetails.task)!.rows.map(row => <div key={`${row.stage}:${row.provider}:${row.model}:${row.modelVersion}:${String(row.startedAtMillis)}`} style={styles.detailsRow}><span>{progressPhaseLabel(row)}</span><span>{processingOutcomeLabel(row.outcome)}</span><span>{compactClock(row.startedAtMillis)}</span><span>{compactClock(row.endedAtMillis)}</span><span>{durationLabel(row.durationMillis) || '—'}</span></div>) : <div style={styles.empty}>暂无处理耗时详情</div>}</section></div>}
      {statusDetails !== undefined && <div role="tooltip" aria-label={`${statusDetails.task.fileName}上传状态详情`} style={{ ...styles.statusTooltip, left: statusDetails.left, top: statusDetails.top }}>{taskStatusTitle(statusDetails.task)}</div>}
    </dialog>
  </>
})
