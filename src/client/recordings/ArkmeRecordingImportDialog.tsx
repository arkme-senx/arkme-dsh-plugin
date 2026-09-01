import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/icons/ArrowCounterClockwise'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { FileAudio } from '@phosphor-icons/react/dist/icons/FileAudio'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { UploadSimple } from '@phosphor-icons/react/dist/icons/UploadSimple'
import { X } from '@phosphor-icons/react/dist/icons/X'
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

const desktop = {
  background: arkmeTheme.base, surface: arkmeTheme.layer2, hover: arkmeTheme.hover, selected: arkmeTheme.active,
  border: arkmeTheme.border, text: arkmeTheme.text, secondary: arkmeTheme.secondary,
  tertiary: arkmeTheme.tertiary, danger: arkmeTheme.danger,
}

const styles: Record<string, CSSProperties> = {
  trigger: { minHeight: 36, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, color: desktop.text, cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  dialog: { width: 'min(740px,calc(100vw - 32px))', maxWidth: 740, maxHeight: 'calc(100vh - 48px)', padding: 0, border: `1px solid ${desktop.border}`, borderRadius: 12, background: desktop.background, color: desktop.text, boxShadow: '0 16px 48px rgba(0,0,0,.18)', overflow: 'hidden' },
  header: { height: 60, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { margin: 0, fontSize: 18, lineHeight: '28px', fontWeight: 500 },
  textButton: { padding: '6px 8px', border: 0, borderRadius: 4, background: 'transparent', color: desktop.secondary, cursor: 'pointer', fontSize: 13 },
  iconButton: { width: 28, height: 28, padding: 0, display: 'grid', placeItems: 'center', border: 0, borderRadius: 4, background: 'transparent', color: desktop.secondary, cursor: 'pointer' },
  body: { maxHeight: 'calc(100vh - 168px)', padding: '0 16px', overflowX: 'auto', overflowY: 'auto' },
  dropzone: { minHeight: 100, padding: '10px 16px', display: 'grid', placeItems: 'center', border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, color: desktop.secondary, cursor: 'pointer', textAlign: 'center' },
  dropCopy: { display: 'grid', justifyItems: 'center', gap: 8, fontSize: 13, lineHeight: '20px' },
  hint: { color: desktop.tertiary, fontSize: 11 },
  table: { marginTop: 16, minWidth: 708, fontSize: 12 },
  tableHeader: { height: 40, display: 'grid', gridTemplateColumns: '44px minmax(300px,1fr) 60px 66px 98px 80px 35px', alignItems: 'center', color: desktop.secondary, borderBottom: `1px solid ${desktop.border}` },
  row: { minHeight: 70, display: 'grid', gridTemplateColumns: '44px minmax(300px,1fr) 60px 66px 98px 80px 35px', alignItems: 'center', borderBottom: `1px solid ${desktop.border}` },
  fileCell: { minWidth: 0, padding: '10px 8px 10px 2px', display: 'grid', gap: 4 },
  fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: desktop.text, fontSize: 12, fontWeight: 500 },
  timeEditor: { display: 'flex', alignItems: 'center', gap: 8, color: desktop.secondary, fontSize: 13 },
  timeInput: { width: 174, height: 26, boxSizing: 'border-box', padding: '3px 6px', border: `1px solid ${desktop.border}`, borderRadius: 4, background: desktop.surface, color: desktop.secondary, font: 'inherit', fontSize: 11 },
  endTime: { minWidth: 72, height: 24, padding: '2px 6px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${desktop.border}`, borderRadius: 4, color: desktop.tertiary, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  ownership: { width: 90, height: 28, padding: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', border: 0, borderRadius: 4, background: desktop.selected },
  ownershipButton: { border: 0, borderRadius: 3, background: 'transparent', color: desktop.tertiary, cursor: 'pointer', fontSize: 12 },
  ownershipSelected: { background: desktop.background, color: desktop.text, boxShadow: '0 1px 2px rgba(0,0,0,.08)' },
  status: { display: 'grid', gap: 4, color: desktop.secondary, fontSize: 12 },
  progress: { width: 80, height: 4, accentColor: desktop.text },
  error: { color: desktop.danger, fontSize: 11, lineHeight: '16px' },
  empty: { padding: '48px 16px', display: 'grid', justifyItems: 'center', gap: 8, color: desktop.tertiary, fontSize: 13 },
  footer: { height: 72, padding: '12px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${desktop.border}`, boxSizing: 'border-box' },
  selection: { display: 'flex', alignItems: 'center', gap: 8, color: desktop.secondary, fontSize: 14 },
  footerActions: { display: 'flex', gap: 8 },
  secondaryButton: { minWidth: 72, height: 36, border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.background, color: desktop.text, cursor: 'pointer', fontSize: 14 },
  primaryButton: { minWidth: 88, height: 36, border: 0, borderRadius: 8, background: desktop.text, color: desktop.background, cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  modalBackdrop: { position: 'fixed', zIndex: 3, inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.28)' },
  confirmDialog: { width: 'min(420px,calc(100vw - 64px))', padding: '24px 28px 20px', boxSizing: 'border-box', borderRadius: 12, background: desktop.background, boxShadow: '0 16px 48px rgba(0,0,0,.2)' },
  duplicateDialog: { width: 'min(560px,calc(100vw - 64px))', maxHeight: 'calc(100vh - 64px)', padding: '24px 28px 20px', boxSizing: 'border-box', borderRadius: 12, background: desktop.background, boxShadow: '0 16px 48px rgba(0,0,0,.2)' },
  confirmTitle: { margin: 0, color: desktop.text, fontSize: 20, lineHeight: '28px', fontWeight: 600 },
  confirmCopy: { margin: '8px 0 24px', color: desktop.secondary, fontSize: 14, lineHeight: '20px' },
  duplicateFiles: { maxHeight: 220, margin: '0 0 24px', padding: '12px 16px', overflowY: 'auto', borderRadius: 8, background: desktop.surface, color: desktop.secondary, fontSize: 13, lineHeight: '22px' },
  confirmActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
}

const activePhases = new Set<RecordingImportSnapshot['phase']>(['prepared', 'uploading', 'finalizing'])
const phaseLabel: Record<RecordingImportSnapshot['phase'], string> = {
  prepared: '等待上传', uploading: '上传中', finalizing: '正在确认',
  accepted: '已完成', failed: '上传失败', cancelled: '已取消',
}

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
  if (!Number.isSafeInteger(startAtMillis) || startAtMillis <= 0) return '录音开始时间无效'
  return startAtMillis + durationMillis > nowMillis ? '录音结束时间不能晚于当前时间' : ''
}

export function hasNewlyAcceptedRecordingImport(previous: readonly RecordingImportSnapshot[], next: readonly RecordingImportSnapshot[]): boolean {
  const previousPhases = new Map(previous.map(item => [item.importRef, item.phase]))
  return next.some(item => item.phase === 'accepted' && previousPhases.get(item.importRef) !== 'accepted')
}

function durationLabel(durationMillis: number): string {
  const seconds = Math.max(0, Math.round(durationMillis / 1_000))
  return [Math.floor(seconds / 3_600), Math.floor(seconds % 3_600 / 60), seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')
}

function fileSizeLabel(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
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

export interface ArkmeRecordingImportDialogHandle {
  open(): void
}

export const ArkmeRecordingImportDialog = forwardRef<ArkmeRecordingImportDialogHandle, {
  importPath: string
  defaultStartAtMillis: number
  currentUserId: number
  onAccepted(): void
}>(function ArkmeRecordingImportDialog({ importPath, defaultStartAtMillis, currentUserId, onAccepted }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jobsRef = useRef<RecordingImportSnapshot[]>([])
  const jobsInitializedRef = useRef(false)
  const jobsLoadRevisionRef = useRef(0)
  const skippedDuplicateNamesRef = useRef(new Set<string>())
  const pendingAbortRef = useRef<AbortController>()
  const submissionActiveRef = useRef(false)
  const inspectionQueueRef = useRef<Promise<void>>(Promise.resolve())
  const inspectionActiveRef = useRef(false)
  const [rows, setRows] = useState<StagedRecording[]>([])
  const [jobs, setJobs] = useState<RecordingImportSnapshot[]>([])
  const [dialogEpoch, setDialogEpoch] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [duplicateNames, setDuplicateNames] = useState<string[]>([])
  const [ownershipChange, setOwnershipChange] = useState<{ id: string; ownership: Ownership }>()
  const selectedRows = useMemo(() => rows.filter(row => row.selected), [rows])

  const open = () => {
    setError('')
    dialogRef.current?.showModal()
    setDialogEpoch(value => value + 1)
  }
  useImperativeHandle(ref, () => ({ open }))

  useEffect(() => {
    inspectionActiveRef.current = true
    return () => {
      inspectionActiveRef.current = false
      pendingAbortRef.current?.abort()
      submissionActiveRef.current = false
    }
  }, [])

  const loadJobs = async (signal?: AbortSignal) => {
    const loadRevision = ++jobsLoadRevisionRef.current
    try {
      const next = await callArkme<RecordingImportSnapshot[]>('recordings.import.list', undefined, signal)
      if (signal?.aborted === true || loadRevision !== jobsLoadRevisionRef.current) return true
      const accepted = jobsInitializedRef.current && hasNewlyAcceptedRecordingImport(jobsRef.current, next)
      jobsInitializedRef.current = true
      jobsRef.current = next; setJobs(next)
      if (accepted) onAccepted()
      return true
    } catch (reason) {
      if (signal?.aborted === true) return true
      setError(reason instanceof Error ? reason.message : '导入任务读取失败')
      return false
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const succeeded = await loadJobs(controller.signal)
      if (controller.signal.aborted) return
      if (!succeeded || jobsRef.current.some(job => activePhases.has(job.phase))) timer = setTimeout(() => { void poll() }, succeeded ? 1_500 : 5_000)
    }
    void poll()
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [dialogEpoch, pending])

  const addFiles = (files: FileList | File[]) => {
    const identities = new Set(rows.map(row => `${row.file.name}\u0000${String(row.file.size)}`))
    const unique = [...files].filter(file => {
      const identity = `${file.name}\u0000${String(file.size)}`
      if (identities.has(identity)) return false
      identities.add(identity)
      return true
    })
    const additions = unique.map((file, index): StagedRecording => ({
      id: `${String(Date.now())}:${String(index)}:${file.name}:${String(file.size)}`, file, selected: true, validating: true,
      startAt: recordingImportLocalInputValue(new Date(recordingImportStartFromFileName(file.name, defaultStartAtMillis))),
      ownership: 'self', submitting: false, error: '',
    }))
    if (additions.length === 0) return
    setRows(current => [...current, ...additions])
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
        setRows(current => current.map(row => row.id === addition.id ? { ...row, validating: false, selection } : row))
      })
    }
  }

  const updateRow = (id: string, update: Partial<StagedRecording>) => {
    setRows(current => current.map(row => row.id === id ? { ...row, ...update } : row))
  }

  const submitRows = async (skippedDuplicates = new Set<string>()) => {
    if (pending || submissionActiveRef.current) return
    if (skippedDuplicates.size === 0) skippedDuplicateNamesRef.current.clear()
    else for (const name of skippedDuplicates) skippedDuplicateNamesRef.current.add(name)
    if (currentUserId <= 0 && selectedRows.some(row => row.ownership === 'self')) {
      setError('请先登录后再导入我的录音')
      return
    }
    const skippedIds = new Set(selectedRows.filter(row => skippedDuplicates.has(row.file.name)).map(row => row.id))
    const prepared = selectedRows.filter(row => !skippedIds.has(row.id)).map(row => {
      const start = new Date(row.startAt).getTime()
      const duration = row.selection?.ok === true ? row.selection.durationMillis ?? 0 : 0
      const validationError = row.selection?.ok === false ? row.selection.message : row.validating ? '正在校验格式与时长…' : recordingImportEndTimeError(start, duration)
      if (validationError !== '') updateRow(row.id, { error: validationError })
      return { row, start, error: validationError }
    })
    if (prepared.some(item => item.error !== '')) return
    if (prepared.length === 0) {
      setRows(current => current.filter(row => !skippedIds.has(row.id)))
      setDuplicateNames([])
      return
    }
    submissionActiveRef.current = true
    setPending(true); setError('')
    const controller = new AbortController()
    pendingAbortRef.current = controller
    const finishSubmission = () => {
      if (pendingAbortRef.current === controller) pendingAbortRef.current = undefined
      submissionActiveRef.current = false
      if (inspectionActiveRef.current) setPending(false)
    }
    try {
      const preflight = await callArkme<{ duplicateFileNames: string[] }>(
        'recordings.import.preflight',
        { fileNames: prepared.map(item => item.row.file.name) },
        controller.signal,
      )
      if (preflight.duplicateFileNames.length > 0) {
        setDuplicateNames(preflight.duplicateFileNames)
        finishSubmission()
        return
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '重复文件检查失败')
      finishSubmission()
      return
    }
    setDuplicateNames([])
    const succeeded = new Set<string>()
    for (const { row, start } of prepared) {
      if (controller.signal.aborted) break
      updateRow(row.id, { submitting: true, error: '' })
      try {
        await uploadArkmeRecording(importPath, row.file, start, row.ownership === 'self' ? currentUserId : 0, controller.signal)
        succeeded.add(row.id)
      } catch (reason) {
        if (!controller.signal.aborted) updateRow(row.id, { error: reason instanceof Error ? reason.message : '录音导入失败' })
      } finally { updateRow(row.id, { submitting: false }) }
    }
    if (succeeded.size > 0 || skippedIds.size > 0) setRows(current => current.filter(row => !succeeded.has(row.id) && !skippedIds.has(row.id)))
    if (succeeded.size > 0) await loadJobs(controller.signal)
    finishSubmission()
  }

  const mutateJob = async (intent: 'recordings.import.retry' | 'recordings.import.cancel', job: RecordingImportSnapshot) => {
    if (pending) return
    setPending(true); setError('')
    const controller = new AbortController()
    pendingAbortRef.current = controller
    try {
      await callArkme(intent, { importRef: job.importRef, expectedRevision: job.revision }, controller.signal)
      await loadJobs(controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '导入任务操作失败')
    } finally {
      if (pendingAbortRef.current === controller) pendingAbortRef.current = undefined
      if (inspectionActiveRef.current) setPending(false)
    }
  }

  const close = () => { if (!pending) dialogRef.current?.close() }
  const cancelPendingOperation = () => { pendingAbortRef.current?.abort() }
  const visibleJobs = jobs.filter(job => job.phase !== 'cancelled')

  return <>
    <button type="button" style={styles.trigger} onClick={open}><UploadSimple size={16} aria-hidden />导入历史音频</button>
    <dialog ref={dialogRef} style={styles.dialog} aria-label="上传文件" onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
      <header style={styles.header}><h2 style={styles.title}>上传文件</h2><button type="button" aria-label="关闭上传文件" disabled={pending} style={{ ...styles.iconButton, ...(pending ? { cursor: 'default', opacity: .45 } : {}) }} onClick={close}><X size={18} aria-hidden /></button></header>
      <div style={styles.body}>
        <>
          <input ref={fileInputRef} hidden multiple disabled={pending} aria-label="选择录音文件" type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={event => { if (!pending && event.target.files !== null) addFiles(event.target.files); event.target.value = '' }} />
          <div style={{ ...styles.dropzone, ...(dragging ? { background: desktop.hover, borderColor: desktop.secondary } : {}), ...(pending ? { opacity: .55, cursor: 'default' } : {}) }} role="button" aria-disabled={pending} tabIndex={pending ? -1 : 0} onClick={() => { if (!pending) fileInputRef.current?.click() }} onKeyDown={event => { if (!pending && (event.key === 'Enter' || event.key === ' ')) fileInputRef.current?.click() }} onDragEnter={event => { event.preventDefault(); if (!pending) setDragging(true) }} onDragOver={event => { event.preventDefault() }} onDragLeave={() => { setDragging(false) }} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); if (!pending) addFiles(event.dataTransfer.files) }}><span style={styles.dropCopy}><UploadSimple size={18} aria-hidden /><span>点击、拖拽上传音频文件（支持多选）</span><small style={styles.hint}>支持 WAV、MP3、M4A 格式</small></span></div>
          {(rows.length > 0 || visibleJobs.length > 0) && <div style={styles.table} role="table" aria-label="待导入录音"><div style={styles.tableHeader} role="row"><span /><span>文件名称</span><span>录音时长</span><span>文件大小</span><span title="我的数据写入时间轴，他人仅保存">数据归属</span><span>上传状态</span><span /></div>{rows.map(row => {
            const start = new Date(row.startAt).getTime(); const duration = row.selection?.ok === true ? row.selection.durationMillis ?? 0 : 0
            const timeError = row.selection?.ok === true ? recordingImportEndTimeError(start, duration) : ''
            return <div key={row.id} style={styles.row} role="row"><input aria-label={`选择 ${row.file.name}`} type="checkbox" checked={row.selected} disabled={pending} onChange={event => { updateRow(row.id, { selected: event.target.checked }) }} /><span style={styles.fileCell}><span style={styles.fileName}><FileAudio size={14} aria-hidden /> {row.file.name}</span><span style={styles.timeEditor}><input style={styles.timeInput} aria-label={`${row.file.name}录音开始时间`} type="datetime-local" step={1} value={row.startAt} disabled={pending} onChange={event => { updateRow(row.id, { startAt: event.target.value, error: '' }) }} /><span aria-hidden>–</span><span style={styles.endTime} aria-label={`${row.file.name}录音结束时间`}>{row.selection?.ok === true ? recordingImportEndLabel(start, duration) : '—'}</span></span>{timeError !== '' && <small style={styles.error}>{timeError}</small>}</span><span>{row.selection?.ok === true ? durationLabel(duration) : '—'}</span><span>{fileSizeLabel(row.file.size)}</span><span style={styles.ownership} aria-label={`${row.file.name}数据归属`}><button type="button" aria-pressed={row.ownership === 'self'} disabled={pending} style={{ ...styles.ownershipButton, ...(row.ownership === 'self' ? styles.ownershipSelected : {}) }} onClick={() => { if (row.ownership !== 'self') setOwnershipChange({ id: row.id, ownership: 'self' }) }}>我的</button><button type="button" aria-pressed={row.ownership === 'other'} disabled={pending} style={{ ...styles.ownershipButton, ...(row.ownership === 'other' ? styles.ownershipSelected : {}) }} onClick={() => { if (row.ownership !== 'other') setOwnershipChange({ id: row.id, ownership: 'other' }) }}>他人</button></span><span style={styles.status}>{row.validating ? '正在校验' : row.submitting ? '正在接收' : row.selection?.ok === false ? <small style={styles.error}>{row.selection.message}</small> : row.error !== '' ? <small style={styles.error}>{row.error}</small> : '待上传'}</span><button type="button" aria-label={`删除 ${row.file.name}`} style={styles.iconButton} disabled={pending} onClick={() => { setRows(current => current.filter(item => item.id !== row.id)) }}><Trash size={15} /></button></div>
          })}{visibleJobs.map(job => <div key={job.importRef} style={styles.row} role="row"><span aria-hidden /><span style={styles.fileCell}><span style={styles.fileName}><FileAudio size={14} aria-hidden /> {job.fileName}</span></span><span>{durationLabel(job.durationMillis)}</span><span>{fileSizeLabel(job.fileSize)}</span><span>—</span><span style={styles.status}>{phaseLabel[job.phase]}{job.phase === 'uploading' && <progress style={styles.progress} max={1} value={job.progress} />}{job.phase === 'failed' && <small style={styles.error}>{job.errorMessage}</small>}{job.phase === 'accepted' && <Check size={14} />}</span><span>{job.retryable && <button type="button" aria-label={`重试 ${job.fileName}`} disabled={pending} style={styles.iconButton} onClick={() => { void mutateJob('recordings.import.retry', job) }}><ArrowCounterClockwise size={13} /></button>}{job.phase !== 'accepted' && <button type="button" aria-label={`取消 ${job.fileName}`} disabled={pending} style={styles.textButton} onClick={() => { void mutateJob('recordings.import.cancel', job) }}>取消</button>}</span></div>)}</div>}
          {rows.length === 0 && visibleJobs.length === 0 && <div style={styles.empty}><FileAudio size={28} aria-hidden /><span>暂无文件</span><button type="button" style={styles.primaryButton} disabled={pending} onClick={() => { fileInputRef.current?.click() }}>添加文件</button></div>}
        </>
        {error !== '' && <div role="alert" style={{ ...styles.error, marginTop: 12 }}>{error}</div>}
      </div>
      <footer style={styles.footer}><label style={styles.selection}><input aria-label="全选" type="checkbox" disabled={pending} checked={rows.length > 0 && selectedRows.length === rows.length} onChange={event => { setRows(current => current.map(row => ({ ...row, selected: event.target.checked }))) }} /><span>共 {rows.length + visibleJobs.length} 个文件{selectedRows.length > 0 ? `，已选择 ${String(selectedRows.length)} 个` : ''}</span></label><span style={styles.footerActions}>{pending && <button type="button" style={styles.secondaryButton} onClick={cancelPendingOperation}>停止当前操作</button>}<button type="button" style={styles.primaryButton} disabled={pending || selectedRows.length === 0} onClick={() => { void submitRows() }}>{pending ? '正在导入…' : '导入'}</button></span></footer>
      {duplicateNames.length > 0 && <div style={styles.modalBackdrop} onClick={event => { if (event.target === event.currentTarget) { skippedDuplicateNamesRef.current.clear(); setDuplicateNames([]) } }}><section role="dialog" aria-modal="true" aria-label="重复录音文件" style={styles.duplicateDialog}><h3 style={styles.confirmTitle}>发现 {duplicateNames.length} 个重复文件</h3><p style={styles.confirmCopy}>将跳过这些文件，并继续导入其余音频</p><div style={styles.duplicateFiles}>{duplicateNames.map(name => <div key={name}>{name}</div>)}</div><span style={styles.confirmActions}><button type="button" style={styles.primaryButton} onClick={() => { void submitRows(new Set([...skippedDuplicateNamesRef.current, ...duplicateNames])) }}>跳过并继续</button></span></section></div>}
      {ownershipChange !== undefined && <div style={styles.modalBackdrop}><section role="dialog" aria-modal="true" aria-label="确认修改数据归属" style={styles.confirmDialog}><h3 style={styles.confirmTitle}>确定修改音频文件的数据归属吗？</h3><p style={styles.confirmCopy}>我的数据写入时间轴，他人仅保存</p><span style={styles.confirmActions}><button type="button" aria-label="取消" style={styles.secondaryButton} onClick={() => { setOwnershipChange(undefined) }}>取消</button><button type="button" aria-label="确认" style={styles.primaryButton} onClick={() => { updateRow(ownershipChange.id, { ownership: ownershipChange.ownership }); setOwnershipChange(undefined) }}>确认</button></span></section></div>}
    </dialog>
  </>
})
