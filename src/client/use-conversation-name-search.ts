import { useCallback, useEffect, useState } from 'react'
import type { ArkmeConversationNameSearchResult, ArkmeSearchSourceMatch } from '../types.js'
import { callArkme } from './api.js'

/** Name lookup is independent of message search, with progressive, cancellable directory paging. */
export function useConversationNameSearch(query: string, enabled: boolean) {
  const keyword = query.trim()
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ query: string; revision: number; items: ArkmeSearchSourceMatch[]; loading: boolean; error: string }>({ query: '', revision: 0, items: [], loading: false, error: '' })
  const retry = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!enabled || keyword === '') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ query: keyword, revision, items: [], loading: true, error: '' })
      void (async () => {
        const items = new Map<string, ArkmeSearchSourceMatch>()
        const cursors = new Set<string>()
        let cursor: string | undefined
        try {
          do {
            const page: ArkmeConversationNameSearchResult = await callArkme('search.conversations', {
              query: keyword, ...(cursor === undefined ? {} : { cursor }),
            }, controller.signal)
            if (controller.signal.aborted) return
            for (const item of page.items) items.set(`${String(item.sourceKind)}:${item.sourceUid}`, item)
            setState({ query: keyword, revision, items: [...items.values()], loading: page.hasMore, error: '' })
            if (!page.hasMore) break
            if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('会话名称查找未完成，请重试')
            cursors.add(page.nextCursor)
            cursor = page.nextCursor
          } while (!controller.signal.aborted)
        } catch (error) {
          if (!controller.signal.aborted) setState({ query: keyword, revision, items: [...items.values()], loading: false,
            error: error instanceof Error ? error.message : String(error) })
        }
      })()
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [keyword, enabled, revision])
  const current = state.query === keyword && state.revision === revision
  return { items: current ? state.items : [], error: current ? state.error : '',
    loading: enabled && keyword !== '' && (!current || state.loading), retry }
}
