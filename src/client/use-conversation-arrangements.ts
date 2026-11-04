import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeConversationArrangement, ArkmeConversationArrangementPage } from '../types.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

type LoadKind = 'initial' | 'refresh' | 'more'
type State = {
  items: ArkmeConversationArrangement[]; loading: boolean; hasLoaded: boolean
  loadKind: LoadKind | null; failedKind: LoadKind | null; error: string; hasMore: boolean; nextCursor: string
}
const emptyState = (): State => ({ items: [], loading: true, hasLoaded: false, loadKind: 'initial', failedKind: null, error: '', hasMore: false, nextCursor: '' })

export function useConversationArrangements(sourceRef: string, active: boolean, refreshRevision: number) {
  const [state, setState] = useState<State>(emptyState)
  const [revision, setRevision] = useState(0)
  const request = useRef<AbortController>()
  const current = useRef(state); current.current = state
  const load = useCallback(async (more = false) => {
    if (!active || (more && (current.current.loading || !current.current.hasMore || !current.current.nextCursor))) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    const cursor = more ? current.current.nextCursor : ''
    const loadKind: LoadKind = more ? 'more' : current.current.hasLoaded ? 'refresh' : 'initial'
    setState(previous => ({ ...previous, loading: true, loadKind, failedKind: null, error: '' }))
    try {
      const page = await withArkmeReadDeadline(signal => callArkme<ArkmeConversationArrangementPage>('arrangements.conversation.list', { sourceRef, cursor }, signal), controller.signal)
      if (controller.signal.aborted) return
      if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean' || typeof page.nextCursor !== 'string'
        || (page.hasMore && (!page.nextCursor || page.nextCursor === cursor))) throw new Error('相关安排分页信息无效，请重试')
      setState(previous => {
        const items = new Map((more ? previous.items : []).map(item => [item.id, item]))
        for (const item of page.items) if (!items.has(item.id)) items.set(item.id, item)
        return { items: [...items.values()], loading: false, hasLoaded: true, loadKind: null, failedKind: null, error: '', hasMore: page.hasMore, nextCursor: page.nextCursor }
      })
    } catch (error) {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, loadKind: null, failedKind: loadKind,
        error: error instanceof Error ? error.message : '相关安排加载失败' }))
    }
  }, [sourceRef, active])
  useEffect(() => {
    if (!active) { request.current?.abort(); setState(emptyState()); return }
    // Collapse bursts of timeline events into one fresh owner read.
    const timer = setTimeout(() => { void load() }, 250)
    return () => { clearTimeout(timer); request.current?.abort() }
  }, [load, refreshRevision, revision, active])
  useEffect(() => {
    if (!active) return
    const refresh = () => { if (document.visibilityState !== 'hidden') setRevision(n => n + 1) }
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    window.addEventListener('arkme-arrangement-occurrences-changed', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('arkme-arrangement-occurrences-changed', refresh) }
  }, [active])
  return { ...state, refresh: () => setRevision(n => n + 1), loadMore: () => load(true), retry: () => load(current.current.failedKind === 'more') }
}
