import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpeechQuery, SpeechState } from '../../recording-speech-statistics.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
const message = (e: unknown) => e instanceof Error ? e.message : '说话统计读取失败，请重试'

/** Mounted only while open; account/day ownership is enforced by the parent's key. */
export function useSpeechStatistics(q: SpeechQuery, refreshRevision: string) {
  const [state, setState] = useState<SpeechState>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false), [uncertain, setUncertain] = useState(false)
  const readController = useRef<AbortController>(), writeController = useRef<AbortController>(), busy = useRef(false)
  const storageKey = `arkme:speech-statistics-request:v1:${q.accountScope}:${q.date}:${q.timezone}`
  const pending = useRef('')
  const [locallyStale, setLocallyStale] = useState(false)
  const previousResult = useRef<string>()
  const read = useCallback(async () => {
    if (busy.current) return
    readController.current?.abort(); const c = new AbortController(); readController.current = c
    setLoading(true); setError('')
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<SpeechState>('recordings.speech-statistics.state', { ...q }, signal), c.signal)
      if (!c.signal.aborted) {
        if (value.result?.id !== previousResult.current) setLocallyStale(false)
        previousResult.current = value.result?.id; setState(value)
      }
    } catch (e) { if (!c.signal.aborted) setError(message(e)) }
    finally { if (!c.signal.aborted) setLoading(false) }
  }, [q.accountScope, q.date, q.timezone])
  useEffect(() => {
    try { pending.current = sessionStorage.getItem(storageKey) ?? ''; setUncertain(!!pending.current) } catch { /* Checked before creating a task. */ }
    void read()
    return () => { readController.current?.abort(); writeController.current?.abort() }
  }, [read, storageKey])
  const previousRevision = useRef(refreshRevision)
  useEffect(() => {
    if (previousRevision.current === refreshRevision) return
    previousRevision.current = refreshRevision; setLocallyStale(true); void read()
  }, [refreshRevision, read])
  const running = !!state?.job && state.job.stage !== 'failed'
  useEffect(() => {
    if (!running || loading || submitting || error) return
    const refresh = () => { if (document.visibilityState === 'visible') void read() }
    const timer = setTimeout(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [running, loading, submitting, error, read])
  const generate = async () => {
    if (busy.current || !state?.supported || (running && !uncertain)) return
    busy.current = true; setSubmitting(true); setError(''); readController.current?.abort(); setLoading(false)
    const c = new AbortController(); writeController.current = c
    let submitted = false
    try {
      pending.current ||= crypto.randomUUID()
      // Keep an uncertain submission recoverable after closing/reloading the panel.
      sessionStorage.setItem(storageKey, pending.current)
      submitted = true
      const value = await withArkmeReadDeadline(signal => callArkme<SpeechState>('recordings.speech-statistics.create', { ...q, requestId: pending.current }, signal), c.signal)
      if (!c.signal.aborted) {
        if (value.result?.id !== previousResult.current) setLocallyStale(false)
        previousResult.current = value.result?.id
        setState(value); sessionStorage.removeItem(storageKey); pending.current = ''; setUncertain(false)
      }
    } catch (e) {
      if (!c.signal.aborted) { setUncertain(submitted); setError(submitted ? message(e) : '无法保存分析请求，请允许本机存储后重试。本次尚未提交。') }
    } finally { busy.current = false; if (!c.signal.aborted) setSubmitting(false) }
  }
  return { state, loading, error, submitting, uncertain, running, locallyStale, read, generate }
}
