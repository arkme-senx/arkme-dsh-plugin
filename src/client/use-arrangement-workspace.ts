import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeArrangementPage, ArkmeDeletedArrangementPage } from '../types.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arrangementMatchesView, arrangementViewRange, arrangementViewStatuses, sortArrangementRows,
  type ArrangementView, type ArrangementWorkspaceItem } from './arrangement-workspace-model.js'

type Branch = { items: ArrangementWorkspaceItem[]; total?: number | undefined; nextOffset?: number | undefined; loading: boolean; error: boolean }
type Page = { key: string; branches: Record<string, Branch> }
const cache = new Map<string, Page>()
const emptyBranch = (): Branch => ({ items: [], loading: false, error: false })
const emptyPage = (key: string, view: ArrangementView): Page => ({ key, branches: Object.fromEntries(arrangementViewStatuses(view).map(status => [status, emptyBranch()])) })

export function useArrangementWorkspace(scope: string, view: ArrangementView, now: number) {
  const range = arrangementViewRange(view, now)
  const key = JSON.stringify([scope, view, range?.dueStartAtMillis])
  const [page, setPage] = useState<Page>(() => cache.get(key) ?? emptyPage(key, view))
  const current = page.key === key ? page : cache.get(key) ?? emptyPage(key, view)
  const live = useRef(current); live.current = current
  const requests = useRef(new Map<string, AbortController>())
  const activeKey = useRef(key); activeKey.current = key
  const lifetime = useRef<AbortController>()
  const write = useCallback((status: string, branch: Branch, requestKey: string) => {
    if (activeKey.current !== requestKey || lifetime.current?.signal.aborted) return
    live.current = { ...live.current, branches: { ...live.current.branches, [status]: branch } }
    setPage(live.current)
    // Keep a bounded first page for a quick return; never cache an in-flight error.
    const bounded: Page = { key: requestKey, branches: Object.fromEntries(Object.entries(live.current.branches).map(([s,b]) => [s,
      { ...b, items: b.items.slice(0,50), nextOffset: b.items.length > 50 ? 50 : b.nextOffset, loading: false }])) }
    cache.set(requestKey, bounded)
    if (cache.size > 40) cache.delete(cache.keys().next().value!)
  }, [])

  const loadBranch = useCallback(async (status: string, reset: boolean) => {
    if (!scope || lifetime.current?.signal.aborted || activeKey.current !== key) return
    const before = live.current.branches[status] ?? emptyBranch()
    if (!reset && (before.loading || before.nextOffset === undefined)) return
    requests.current.get(status)?.abort()
    const controller = new AbortController(); requests.current.set(status, controller)
    write(status, { ...before, loading: true, error: false }, key)
    let offset = reset ? 0 : before.nextOffset!
    const items = new Map((reset ? [] : before.items).map(item => [item.arrangementRef, item]))
    const wanted = reset ? Math.max(1, before.items.length) : 0
    try {
      do {
        const result = await withArkmeReadDeadline(signal => callArkme<ArkmeArrangementPage | ArkmeDeletedArrangementPage>(
          status === 'deleted' ? 'arrangements.deleted.list' : 'arrangements.list',
          { ...(status === 'deleted' ? {} : { status, ...range }), limit: 50, offset }, signal), controller.signal)
        if (controller.signal.aborted || activeKey.current !== key) return
        if (!Array.isArray(result.items) || result.items.some(item => item.status !== status || !arrangementMatchesView(item, view, now))) throw new Error('Arrangement view response mismatch')
        for (const item of result.items) items.set(item.arrangementRef, item)
        const nextOffset = result.hasMore && result.nextOffset !== undefined && result.nextOffset > offset ? result.nextOffset : undefined
        if (result.hasMore && nextOffset === undefined) throw new Error('Arrangement pagination did not advance')
        if (nextOffset === undefined || items.size >= wanted) {
          write(status, { items: [...items.values()], total: result.total, nextOffset, loading: false, error: false }, key)
          break
        }
        offset = nextOffset
      } while (true)
    } catch {
      if (!controller.signal.aborted && activeKey.current === key) write(status, { ...before, loading: false, error: true }, key)
    }
  }, [scope, key, view, range?.dueStartAtMillis, range?.dueEndAtMillis, write])

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    setPage(cache.get(key) ?? emptyPage(key, view))
    for (const status of arrangementViewStatuses(view)) void loadBranch(status, true)
    return () => { controller.abort(); for (const request of requests.current.values()) request.abort(); requests.current.clear() }
  }, [key, loadBranch])

  const refresh = () => Promise.all(arrangementViewStatuses(view).map(status => loadBranch(status, true)))
  function updateItem(item: ArrangementWorkspaceItem) {
    // An older list read must not overwrite the just-confirmed owner mutation.
    for (const cacheKey of cache.keys()) if (JSON.parse(cacheKey)[0] === scope) cache.delete(cacheKey)
    for (const status of arrangementViewStatuses(view)) {
      const before = live.current.branches[status] ?? emptyBranch()
      const had = before.items.some(row => row.arrangementRef === item.arrangementRef)
      const belongs = item.status === status && arrangementMatchesView(item, view, now)
      if (!had && !belongs) continue
      requests.current.get(status)?.abort()
      const items = before.items.filter(row => row.arrangementRef !== item.arrangementRef)
      if (belongs) items.push(item)
      const delta = belongs && !had ? 1 : !belongs && had ? -1 : 0
      write(status, { ...before, items, loading: false,
        nextOffset: before.nextOffset === undefined ? undefined : Math.max(0, before.nextOffset + delta),
        total: before.total === undefined ? undefined : Math.max(0, before.total + delta) }, key)
    }
  }
  const branches = Object.values(current.branches)
  return {
    rows: sortArrangementRows(branches.flatMap(branch => branch.items), view),
    total: branches.every(branch => branch.total !== undefined) ? branches.reduce((sum, branch) => sum + branch.total!, 0) : undefined,
    loading: branches.some(branch => branch.loading), error: branches.some(branch => branch.error),
    hasMore: branches.some(branch => branch.nextOffset !== undefined), refresh, updateItem,
    loadMore: () => Promise.all(arrangementViewStatuses(view).map(status => loadBranch(status, false))),
  }
}
