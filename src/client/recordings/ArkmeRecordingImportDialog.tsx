import { useRef, useState, type CSSProperties } from 'react'
import { uploadArkmeRecording, type RecordingImportSnapshot } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'
import {
  inspectArkmeRecordingSelection,
  type ArkmeRecordingSelection,
} from './recording-import-selection.js'

const styles: Record<string, CSSProperties> = {
  button: { border: 0, borderRadius: 9, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', padding: '7px 11px', fontSize: 12 },
  dialog: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 14, padding: 18, width: 'min(390px,calc(100vw - 48px))', color: arkmeTheme.text, background: arkmeTheme.base },
  grid: { display: 'grid', gap: 12 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  secondary: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.layer1, color: arkmeTheme.text, padding: '7px 11px' },
  validation: { padding: '8px 10px', borderRadius: 8, background: arkmeTheme.layer1, color: arkmeTheme.secondary, fontSize: 11 },
}

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function recordingDurationLabel(durationMillis: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMillis / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor(totalSeconds % 3_600 / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

export function ArkmeRecordingImportDialog({ importPath, onAccepted }: {
  importPath: string
  onAccepted(job: RecordingImportSnapshot): void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const selectionRevisionRef = useRef(0)
  const [file, setFile] = useState<File>()
  const [selection, setSelection] = useState<ArkmeRecordingSelection>()
  const [validating, setValidating] = useState(false)
  const [startAt, setStartAt] = useState(localInputValue(new Date()))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (file === undefined || selection?.ok !== true || pending || validating) return
    setPending(true); setError('')
    try {
      onAccepted(await uploadArkmeRecording(importPath, file, new Date(startAt).getTime()))
      dialogRef.current?.close()
      setFile(undefined)
      setSelection(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录音导入失败')
    } finally { setPending(false) }
  }
  const selectFile = async (nextFile?: File) => {
    const revision = ++selectionRevisionRef.current
    setFile(nextFile); setSelection(undefined); setError('')
    if (nextFile === undefined) { setValidating(false); return }
    setValidating(true)
    const result = await inspectArkmeRecordingSelection(nextFile)
    if (selectionRevisionRef.current !== revision) return
    setSelection(result); setValidating(false)
  }

  return <>
    <button type="button" style={styles.button} onClick={() => { dialogRef.current?.showModal() }}>导入录音</button>
    <dialog ref={dialogRef} style={styles.dialog} aria-label="导入录音">
      <div style={styles.grid}>
        <strong>导入录音</strong>
        <input aria-label="选择录音文件" type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={event => { void selectFile(event.target.files?.[0]) }} />
        {file !== undefined && <small>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</small>}
        {file !== undefined && <div style={styles.validation} role="status" aria-live="polite">
          {validating
            ? '正在校验格式与时长…'
            : selection?.ok === true
              ? `${selection.format} · ${recordingDurationLabel(selection.durationMillis ?? 0)} · 大小/时长通过（导入时由本机再次校验）`
              : selection?.message ?? '等待校验'}
        </div>}
        <label>录音开始时间<input aria-label="录音开始时间" type="datetime-local" value={startAt} onChange={event => { setStartAt(event.target.value) }} /></label>
        {error !== '' && <div role="alert" style={{ color: arkmeTheme.danger }}>{error}</div>}
        <div style={styles.footer}>
          <button type="button" style={styles.secondary} disabled={pending} onClick={() => { dialogRef.current?.close() }}>取消</button>
          <button type="button" style={styles.button} disabled={file === undefined || selection?.ok !== true || pending || validating || !Number.isFinite(new Date(startAt).getTime())} onClick={() => { void submit() }}>{pending ? '正在接收…' : '开始导入'}</button>
        </div>
      </div>
    </dialog>
  </>
}
