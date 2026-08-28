import { useRef, useState, type CSSProperties } from 'react'
import { uploadArkmeRecording, type RecordingImportSnapshot } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'

const styles: Record<string, CSSProperties> = {
  button: { border: 0, borderRadius: 9, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, cursor: 'pointer', padding: '7px 11px', fontSize: 12 },
  dialog: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 14, padding: 18, width: 390, color: arkmeTheme.text, background: arkmeTheme.base },
  grid: { display: 'grid', gap: 12 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  secondary: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.layer1, color: arkmeTheme.text, padding: '7px 11px' },
}

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function ArkmeRecordingImportDialog({ importPath, onAccepted }: {
  importPath: string
  onAccepted(job: RecordingImportSnapshot): void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [file, setFile] = useState<File>()
  const [startAt, setStartAt] = useState(localInputValue(new Date()))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (file === undefined || pending) return
    setPending(true); setError('')
    try {
      onAccepted(await uploadArkmeRecording(importPath, file, new Date(startAt).getTime()))
      dialogRef.current?.close()
      setFile(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '录音导入失败')
    } finally { setPending(false) }
  }

  return <>
    <button type="button" style={styles.button} onClick={() => { dialogRef.current?.showModal() }}>导入录音</button>
    <dialog ref={dialogRef} style={styles.dialog} aria-label="导入录音">
      <div style={styles.grid}>
        <strong>导入录音</strong>
        <input aria-label="选择录音文件" type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={event => { setFile(event.target.files?.[0]); setError('') }} />
        {file !== undefined && <small>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</small>}
        <label>录音开始时间<input aria-label="录音开始时间" type="datetime-local" value={startAt} onChange={event => { setStartAt(event.target.value) }} /></label>
        {error !== '' && <div role="alert" style={{ color: arkmeTheme.danger }}>{error}</div>}
        <div style={styles.footer}>
          <button type="button" style={styles.secondary} disabled={pending} onClick={() => { dialogRef.current?.close() }}>取消</button>
          <button type="button" style={styles.button} disabled={file === undefined || pending} onClick={() => { void submit() }}>{pending ? '正在接收…' : '开始导入'}</button>
        </div>
      </div>
    </dialog>
  </>
}
