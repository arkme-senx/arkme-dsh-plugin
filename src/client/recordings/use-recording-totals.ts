import { useEffect, useRef, useState } from 'react'
import type { RecordingTotalsBucket, RecordingTotalsIndexPage } from '../../recording-total-metrics.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { readRecordingTotalsCache, scanRecordingTotals, type RecordingTotalsCache, type RecordingTotalsProgress } from './recording-total-scan.js'

export function useRecordingTotals(account: string, active: boolean, refreshRevision: string) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const scope = `${account}:${zone}`
  const key = `arkme.recording-totals.v2:${scope}`
  const current = useRef<{ scope: string; cache: RecordingTotalsCache; revision: string }>()
  const [state, setState] = useState<{ scope: string; value: RecordingTotalsProgress }>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!account || !active) return
    const controller = new AbortController()
    if (current.current?.scope !== scope) {
      let raw: string | null = null
      try { raw = localStorage.getItem(key) } catch { /* Storage can be unavailable. */ }
      current.current = { scope, cache: readRecordingTotalsCache(raw), revision: refreshRevision }
    }
    const session = current.current
    const force = session.revision !== refreshRevision
    session.revision = refreshRevision
    if (session.cache.snapshot) setState({ scope, value: session.cache.snapshot })
    let timer: ReturnType<typeof setTimeout> | undefined, lastSaved = 0, running = true
    const persist = () => {
      try { localStorage.setItem(key, JSON.stringify(session.cache)) } catch { /* In-memory caching still works. */ }
      lastSaved = Date.now()
    }
    const recover = () => { if (!document.hidden && !running) setRetry(value => value + 1) }
    window.addEventListener('online', recover)
    document.addEventListener('visibilitychange', recover)
    const index = (toMillis: number, offset: number) => withArkmeReadDeadline(signal => callArkme<RecordingTotalsIndexPage>(
      'recordings.totals.index', { account, toMillis, offset }, signal, { priority: 'background' }), controller.signal)
    const bucket = (dateStamp: number) => withArkmeReadDeadline(signal => callArkme<RecordingTotalsBucket>(
      'recordings.totals.bucket', { account, dateStamp }, signal, { priority: 'background' }), controller.signal)
    void scanRecordingTotals({ cache: session.cache, signal: controller.signal, force, index, bucket, publish: value => {
      if (controller.signal.aborted) return
      setState({ scope, value })
      if (Date.now() - lastSaved > 1_000 || value.phase === 'complete' || value.phase === 'error') persist()
    } }).then(() => {
      if (controller.signal.aborted) return
      running = false
      // Retry interrupted days; refresh recent/processing buckets without
      // loading stable historical transcripts again on every visit.
      timer = setTimeout(recover, session.cache.snapshot?.phase === 'error' ? 30_000 : 120_000)
    }).catch(() => { /* Cancelling the surface/account must not publish old data. */ })
    return () => {
      controller.abort(); clearTimeout(timer); window.removeEventListener('online', recover); document.removeEventListener('visibilitychange', recover)
      persist()
    }
  }, [account, active, scope, key, refreshRevision, retry])
  return { progress: state?.scope === scope ? state.value : undefined, retry: () => setRetry(value => value + 1) }
}
