import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExploreDetail, ExploreItem, ExploreModule } from '../../explore-contract.js'
import { mergeExploreEvidence } from '../../explore-evidence.js'
import { callArkme } from '../api.js'
import { tr } from '../locale.js'

const cache = new Map<string, { value: ExploreDetail; at: number }>()
let cacheScope = ''
const message = (error: unknown) => error instanceof Error ? error.message : tr('加载失败，请重试')
const empty = (item: ExploreItem): ExploreDetail => ({ item, fields: [], evidence: [], actions: [] })

export function useExploreDetail(selected: ExploreItem | undefined, module: ExploreModule, accountScope: string) {
  if (cacheScope !== accountScope) { cache.clear(); cacheScope = accountScope }
  const [detail, setDetail] = useState<ExploreDetail>()
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [overviewLoading, setOverviewLoading] = useState(false), [overviewError, setOverviewError] = useState('')
  const recordsRequest = useRef<AbortController>(), overviewRequest = useRef<AbortController>()
  const currentItem = useRef(selected); currentItem.current = selected
  const key = selected ? `${module}:${selected.key}${module==='relations'?'':`:${selected.ref}`}` : ''

  const readOverview = useCallback(async (item: ExploreItem) => {
    overviewRequest.current?.abort()
    const c = new AbortController(); overviewRequest.current = c
    setOverviewLoading(true); setOverviewError('')
    try {
      const value = await callArkme<ExploreDetail>('explore.detail', { ref: item.ref, part: 'overview' }, c.signal)
      if (c.signal.aborted) return
      setDetail(previous => ({ ...value, evidence: previous?.evidence ?? [], ...(previous?.nextCursor ? { nextCursor: previous.nextCursor } : {}) }))
    } catch (e) { if (!c.signal.aborted) setOverviewError(message(e)) }
    finally { if (!c.signal.aborted) setOverviewLoading(false) }
  }, [])

  const readDetail = useCallback(async (item: ExploreItem, cursor?: string, recordsOnly = false) => {
    recordsRequest.current?.abort()
    const c = new AbortController(); recordsRequest.current = c
    setLoading(true); setError('')
    if (module === 'relations' && !cursor && !recordsOnly) void readOverview(item)
    try {
      const value = await callArkme<ExploreDetail>('explore.detail', {
        ref: item.ref, ...(cursor ? { cursor } : {}), ...(module === 'relations' ? { part: 'records' } : {}),
      }, c.signal)
      if (c.signal.aborted) return
      setDetail(previous => {
        const { nextCursor: _, ...base } = module === 'relations' ? previous ?? empty(item) : cursor && previous ? previous : value
        return {
          ...base, evidence: module === 'relations' || cursor ? mergeExploreEvidence(cursor && previous ? previous.evidence : [], value.evidence) : value.evidence,
          ...(value.nextCursor ? { nextCursor: value.nextCursor } : {}),
        }
      })
    } catch (e) { if (!c.signal.aborted) setError(message(e)) }
    finally { if (!c.signal.aborted) setLoading(false) }
  }, [module, readOverview])

  useEffect(() => {
    recordsRequest.current?.abort(); overviewRequest.current?.abort()
    setError(''); setOverviewError(''); setLoading(false); setOverviewLoading(false)
    const item = currentItem.current
    const saved = cache.get(key)
    const valid = module === 'relations' && saved && Date.now() - saved.at < 120_000 ? saved : undefined
    setDetail(valid?.value ?? (item && module === 'relations' ? empty(item) : undefined))
    if (item && (!valid || Date.now() - valid.at > 30_000)) void readDetail(item)
    return () => { recordsRequest.current?.abort(); overviewRequest.current?.abort() }
  }, [key, module, accountScope, readDetail])

  useEffect(() => {
    if (module !== 'relations' || cacheScope !== accountScope || !detail || !key || detail.item.key !== currentItem.current?.key || loading || overviewLoading || error || overviewError) return
    if (cache.get(key)?.value === detail) return
    cache.delete(key); cache.set(key, { value: detail, at: Date.now() })
    if (cache.size > 30) cache.delete(cache.keys().next().value!)
  }, [detail, key, loading, overviewLoading, error, overviewError, module, accountScope])

  const invalidate = useCallback(() => { cache.delete(key) }, [key])
  return { detail: detail?.item.key === selected?.key ? detail : undefined, loading, error, overviewLoading, overviewError, readDetail, readOverview, invalidate }
}
