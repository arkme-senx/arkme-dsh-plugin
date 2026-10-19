import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationWordsQuery } from '../../conversation-word-frequency.js'
import type { ConversationActivityState } from '../../conversation-activity.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'

/** Mount keyed by account, conversation, dates and sender. No AI/create operation. */
export function useConversationActivity(query: ConversationWordsQuery, refreshRevision: string) {
  const [state, setState] = useState<ConversationActivityState>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const request = useRef<AbortController>(), key = JSON.stringify(query)
  const read = useCallback(async () => {
    request.current?.abort(); const c = new AbortController(); request.current = c; setLoading(true); setError('')
    try {
      const next = await withArkmeReadDeadline(signal => callArkme<ConversationActivityState>('chat.activity.read', { ...query }, signal), c.signal)
      if (!c.signal.aborted) setState(next)
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : '活跃时间读取失败') }
    finally { if (!c.signal.aborted) setLoading(false) }
  }, [key])
  useEffect(() => { void read(); return () => request.current?.abort() }, [read, refreshRevision])
  useEffect(() => {
    if (!state?.progress || loading || error) return
    const refresh = () => { if (document.visibilityState === 'visible') void read() }
    const timer = setTimeout(refresh, 5000); document.addEventListener('visibilitychange', refresh)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [state?.progress, loading, error, read])
  return { state, loading, error, read }
}
