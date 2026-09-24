import { useEffect, useState, useRef } from 'react'
import { callArkme } from './api.js'
import type { ReactionHistoryPage } from '../reaction-contract.js'
import { expressionLabel } from './reaction-expression.js'
import type { ReactionPreviewEvent } from './reaction-preview-store.js'

/** Explicit cursor pages; never silently presents a capped history as complete. */
export function useReactionHistory(scope: string | undefined, start?: number, end?: number) {
  const [page, setPage] = useState<ReactionHistoryPage>()
  const loadedFor = useRef<string>()
  const queryKey = JSON.stringify([scope, start, end])
  const visiblePage = loadedFor.current === queryKey ? page : undefined
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController>()
  const load = async (more = false) => {
    if (!scope || !start || !end) return
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller
    setBusy(true); setError('')
    try {
      const result = await callArkme<ReactionHistoryPage>('reactions', { action: 'history', accountKey: scope, start_at: start, end_at: end, limit: 100,
        ...(more && visiblePage?.has_more ? { before_at: visiblePage.before_at, before_id: visiblePage.before_id } : {}) }, controller.signal)
      if (!controller.signal.aborted) { loadedFor.current = queryKey; setPage({ ...result, items: more ? [...(visiblePage?.items ?? []), ...result.items] : result.items }) }
    } catch (error) { if (!controller.signal.aborted) { setPage(undefined); setError(error instanceof Error ? error.message : '表态记录加载失败') } }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  useEffect(() => { setPage(undefined); void load(); return () => abort.current?.abort() }, [scope, start, end])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const refresh = () => { setPage(undefined); void load() }
    window.addEventListener('arkme-reaction-policy-changed', refresh)
    return () => window.removeEventListener('arkme-reaction-policy-changed', refresh)
  }, [scope, start, end])
  const events: ReactionPreviewEvent[] = (visiblePage?.items ?? []).map(item => ({
    id: item.target_id, source: item.restricted ? '原消息已不可访问' : item.source_kind === 'world' ? '公开消息' : item.source_kind === 'group_chat' ? '群聊消息' : item.source_kind === 'send_to_self' ? '个人记录' : '聊天消息',
    ...(['private_chat', 'group_chat', 'send_to_self'].includes(item.source_kind ?? '') ? { sourceKind: item.source_kind as 'private_chat' | 'group_chat' | 'send_to_self' } : {}),
    eventId: item.event_uid, expression: item.expression, restricted: item.restricted,
    ...(!item.restricted ? { sourceName: item.sourceName, authorName: item.authorName, avatar: item.avatar, originalMessage: item.originalMessage } : {}),
    text: item.restricted ? '' : item.text ?? '', label: expressionLabel(item.expression), added: item.active, at: item.at,
  }))
  return { events, error, busy, hasMore: visiblePage?.has_more === true, load }
}
