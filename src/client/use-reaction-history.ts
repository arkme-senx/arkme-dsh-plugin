import { useEffect, useState, useRef } from 'react'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import type { ReactionHistoryPage } from '../reaction-contract.js'
import { expressionLabel } from './reaction-expression.js'
import type { ReactionPreviewEvent } from './reaction-preview-store.js'

/** Explicit cursor pages; never silently presents a capped history as complete. */
export function useReactionHistory(scope: string | undefined, start?: number, end?: number, refreshVersion = 0, privacyRevision = 0) {
  const [page, setPage] = useState<ReactionHistoryPage>()
  const loadedFor = useRef<string>()
  const queryKey = JSON.stringify([scope, start, end, privacyRevision])
  const visiblePage = loadedFor.current === queryKey ? page : undefined
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController>()
  const load = async (more = false) => {
    if (!scope || !start || !end) { setBusy(false); setError(''); return }
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller
    setBusy(true); setError('')
    try {
      let result = await withArkmeReadDeadline(signal => callArkme<ReactionHistoryPage>('reactions', { action: 'history', accountKey: scope, start_at: start, end_at: end, limit: 100,
        ...(more && visiblePage?.has_more ? { before_at: visiblePage.before_at, before_id: visiblePage.before_id } : {}) }, signal), controller.signal)
      const wanted = more ? 0 : visiblePage?.items.length ?? 0
      const cursors = new Set<string>()
      while (!controller.signal.aborted && result.has_more && result.items.length < wanted) {
        const cursor = JSON.stringify([result.before_at, result.before_id])
        if (cursors.has(cursor)) throw Error('表态记录分页已变化，请重试')
        cursors.add(cursor)
        const next = await withArkmeReadDeadline(signal => callArkme<ReactionHistoryPage>('reactions', { action: 'history', accountKey: scope, start_at: start, end_at: end, limit: 100,
          before_at: result.before_at, before_id: result.before_id }, signal), controller.signal)
        result = { ...next, items: [...result.items, ...next.items] }
      }
      if (!controller.signal.aborted) { loadedFor.current = queryKey; setPage({ ...result, items: more ? [...(visiblePage?.items ?? []), ...result.items] : result.items }) }
    } catch (error) { if (!controller.signal.aborted) { setPage(undefined); setError(error instanceof Error ? error.message : '表态记录加载失败') } }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    if (loadedFor.current !== queryKey) setPage(undefined)
    void load()
    return () => abort.current?.abort()
  }, [scope, start, end, refreshVersion, privacyRevision])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const refresh = () => { setPage(undefined); void load() }
    window.addEventListener('arkme-reaction-policy-changed', refresh)
    return () => window.removeEventListener('arkme-reaction-policy-changed', refresh)
  }, [scope, start, end, privacyRevision])
  const events: ReactionPreviewEvent[] = (visiblePage?.items ?? []).map(item => ({
    id: item.target_id, source: item.restricted ? '原消息已不可访问' : item.source_kind === 'world' ? '公开消息' : item.source_kind === 'group_chat' ? '群聊消息' : item.source_kind === 'send_to_self' ? '个人记录' : '聊天消息',
    ...(['private_chat', 'group_chat', 'send_to_self'].includes(item.source_kind ?? '') ? { sourceKind: item.source_kind as 'private_chat' | 'group_chat' | 'send_to_self' } : {}),
    eventId: item.event_uid, expression: item.expression, restricted: item.restricted,
    ...(!item.restricted ? { sourceName: item.sourceName, authorName: item.authorName, avatar: item.avatar, originalMessage: item.originalMessage } : {}),
    text: item.restricted ? '' : item.text ?? '', label: expressionLabel(item.expression), added: item.active, at: item.at,
  }))
  return { events, error, busy, hasMore: visiblePage?.has_more === true, load }
}
