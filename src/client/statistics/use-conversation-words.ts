import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationWordsQuery, ConversationWordsState } from '../../conversation-word-frequency.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'

/** A separate mount per account, conversation, date range and sender. */
export function useConversationWords(query: ConversationWordsQuery, refreshRevision: string) {
  const [state, setState] = useState<ConversationWordsState>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false), [uncertain, setUncertain] = useState(false), [locallyStale, setLocallyStale] = useState(false)
  const readRequest = useRef<AbortController>(), writeRequest = useRef<AbortController>(), busy = useRef(false), pending = useRef(''), version = useRef<string>()
  const key = JSON.stringify(query), storageKey = `arkme:conversation-words-request:v1:${key}`
  const accept = (next: ConversationWordsState) => { if (version.current !== next.result?.id) setLocallyStale(false); version.current = next.result?.id; setState(next) }
  const read = useCallback(async () => {
    if (busy.current) return
    readRequest.current?.abort(); const c = new AbortController(); readRequest.current = c
    setLoading(true); setError('')
    try {
      const next = await withArkmeReadDeadline(signal => callArkme<ConversationWordsState>('chat.word-frequency.state', { ...query }, signal), c.signal)
      if (!c.signal.aborted) accept(next)
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : '对话词频读取失败') }
    finally { if (!c.signal.aborted) setLoading(false) }
  }, [key])
  useEffect(() => {
    try { pending.current = sessionStorage.getItem(storageKey) ?? ''; setUncertain(!!pending.current) } catch { /* Rechecked before creating a task. */ }
    void read()
    return () => { readRequest.current?.abort(); writeRequest.current?.abort() }
  }, [read, storageKey])
  const revision = useRef(refreshRevision)
  useEffect(() => {
    if (revision.current !== refreshRevision) { revision.current = refreshRevision; setLocallyStale(true); void read() }
  }, [refreshRevision, read])
  const running = !!state?.job && state.job.status !== 'failed'
  useEffect(() => {
    if (!running || loading || submitting || error) return
    const refresh = () => { if (document.visibilityState === 'visible') void read() }
    const timer = setTimeout(refresh, 5000); document.addEventListener('visibilitychange', refresh)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [running, loading, submitting, error, read])
  const generate = async () => {
    if (busy.current || !state?.supported || (running && !uncertain)) return
    busy.current = true; setSubmitting(true); setLoading(false); setError(''); readRequest.current?.abort()
    const c = new AbortController(); writeRequest.current = c
    let submitted = false
    try {
      pending.current ||= crypto.randomUUID(); sessionStorage.setItem(storageKey, pending.current); submitted = true
      const next = await withArkmeReadDeadline(signal => callArkme<ConversationWordsState>('chat.word-frequency.create', { ...query, requestId: pending.current }, signal), c.signal)
      if (!c.signal.aborted) { accept(next); sessionStorage.removeItem(storageKey); pending.current = ''; setUncertain(false) }
    } catch (e) { if (!c.signal.aborted) { setUncertain(submitted); setError(submitted ? e instanceof Error ? e.message : '提交结果尚未确认' : '无法保存分析请求，请允许本机存储后重试。本次尚未提交。') } }
    finally { busy.current = false; if (!c.signal.aborted) setSubmitting(false) }
  }
  return { state, loading, error, submitting, uncertain, locallyStale, running, read, generate }
}
