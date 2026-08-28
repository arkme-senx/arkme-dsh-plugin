import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { callArkme, type RecordingImportSnapshot } from '../api.js'
import { arkmeTheme } from '../arkme-theme.js'

const styles: Record<string, CSSProperties> = {
  list: { display: 'grid', gap: 6, marginTop: 14 },
  row: { padding: '8px 9px', borderRadius: 9, background: arkmeTheme.layer2, fontSize: 11 },
  line: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  button: { border: 0, background: 'transparent', color: arkmeTheme.accent, cursor: 'pointer', fontSize: 10 },
}

const activePhases = new Set<RecordingImportSnapshot['phase']>(['receiving', 'validating', 'prepared', 'uploading', 'finalizing', 'processing'])
const phaseLabel: Record<RecordingImportSnapshot['phase'], string> = {
  receiving: '正在接收', validating: '正在校验', prepared: '准备上传', uploading: '上传中',
  finalizing: '正在确认', processing: '处理中', accepted: '已导入', failed: '导入失败', cancelled: '已取消',
}

export function ArkmeRecordingImportJobs({ refreshKey, onAccepted }: { refreshKey: number; onAccepted(): void }) {
  const [jobs, setJobs] = useState<RecordingImportSnapshot[]>([])
  const jobsRef = useRef<RecordingImportSnapshot[]>([])
  const [error, setError] = useState('')
  const load = async () => {
    try {
      const next = await callArkme<RecordingImportSnapshot[]>('recordings.import.list')
      const previous = jobsRef.current
      const newlyAccepted = next.some(item => item.phase === 'accepted') && !previous.some(item => item.phase === 'accepted')
      jobsRef.current = next
      setJobs(next); setError('')
      if (newlyAccepted) onAccepted()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入任务读取失败')
      return false
    }
  }
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let failures = 0
    const poll = async () => {
      if (cancelled) return
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(() => { void poll() }, 1_500)
        return
      }
      const succeeded = await load()
      if (cancelled) return
      failures = succeeded ? 0 : failures + 1
      const active = jobsRef.current.some(item => activePhases.has(item.phase))
      if (active || !succeeded) {
        const delay = succeeded ? 1_500 : Math.min(30_000, 1_500 * 2 ** Math.min(5, failures))
        timer = window.setTimeout(() => { void poll() }, delay)
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [refreshKey])

  if (jobs.length === 0 && error === '') return null
  return <section style={styles.list} aria-label="最近导入">
    <strong style={{ fontSize: 11 }}>最近导入</strong>
    {error !== '' && <div role="alert" style={{ color: arkmeTheme.danger }}>{error}</div>}
    {jobs.slice(0, 5).map(job => <div key={job.importRef} style={styles.row}>
      <div style={styles.line}><span>{job.fileName}</span><span>{phaseLabel[job.phase]}</span></div>
      {job.phase === 'uploading' && <progress max={1} value={job.progress} aria-label={`${job.fileName}上传进度`} />}
      {job.phase === 'failed' && <div style={styles.line}>
        <span style={{ color: arkmeTheme.danger }}>{job.errorMessage}</span>
        {job.retryable && <button type="button" style={styles.button} onClick={() => { void callArkme('recordings.import.retry', { importRef: job.importRef, expectedRevision: job.revision }).then(load) }}>重试</button>}
      </div>}
      {activePhases.has(job.phase) && job.phase !== 'processing' && <button type="button" style={styles.button} onClick={() => { void callArkme('recordings.import.cancel', { importRef: job.importRef, expectedRevision: job.revision }).then(load) }}>取消</button>}
    </div>)}
  </section>
}
