import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExploreDetail, ExploreItem, ExploreModule } from '../../explore-contract.js'
import { mergeExploreEvidence } from '../../explore-evidence.js'
import { callArkme } from '../api.js'
import { tr } from '../locale.js'
import { isRelationDetail, relationViewCache } from './relation-view-cache.js'

const message = (error: unknown) => error instanceof Error ? error.message : tr('加载失败，请重试')
const empty = (item: ExploreItem): ExploreDetail => ({ item, fields: [], evidence: [], actions: [] })

export function useExploreDetail(selected: ExploreItem | undefined, module: ExploreModule, accountScope: string) {
  const [detail, setDetail] = useState<ExploreDetail>()
  const [loading, setLoading] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('')
  const [overviewLoading, setOverviewLoading] = useState(false), [overviewError, setOverviewError] = useState('')
  const recordsRequest = useRef<AbortController>(), overviewRequest = useRef<AbortController>()
  const currentItem = useRef(selected); currentItem.current = selected
  const detailRef = useRef(detail); detailRef.current = detail
  const failedCursor = useRef<string>()
  const cachedAt = useRef(0)
  const metadata = useRef({ recordsAt: 0, overviewAt: 0, firstKeys: [] as string[] })
  const key = selected ? `${module}:${selected.key}${module==='relations'?'':`:${selected.ref}`}` : ''

  const readOverview = useCallback(async (item: ExploreItem) => {
    overviewRequest.current?.abort()
    const c = new AbortController(); overviewRequest.current = c
    setOverviewLoading(true); setOverviewError('')
    try {
      const value = await callArkme<ExploreDetail>('explore.detail', { ref: item.ref, part: 'overview' }, c.signal)
      if (c.signal.aborted) return
      metadata.current.overviewAt = Date.now()
      setDetail(previous => ({ ...value, evidence: previous?.evidence ?? [], ...(previous?.nextCursor ? { nextCursor: previous.nextCursor } : {}) }))
    } catch (e) { if (!c.signal.aborted) setOverviewError(message(e)) }
    finally { if (!c.signal.aborted) setOverviewLoading(false) }
  }, [])

  const readDetail = useCallback(async (item: ExploreItem, cursor?: string, recordsOnly = false) => {
    recordsRequest.current?.abort()
    const c = new AbortController(); recordsRequest.current = c
    setLoading(true); setRefreshing(!cursor && !!detailRef.current?.evidence.length); setError('')
    failedCursor.current = cursor
    if (module === 'relations' && !cursor && !recordsOnly) void readOverview(item)
    try {
      const value = await callArkme<ExploreDetail>('explore.detail', {
        ref: item.ref, ...(cursor ? { cursor } : {}), ...(module === 'relations' ? { part: 'records' } : {}),
      }, c.signal)
      if (c.signal.aborted) return
      const oldFirstKeys = new Set(metadata.current.firstKeys)
      if (!cursor) metadata.current = { ...metadata.current, recordsAt: Date.now(), firstKeys: value.evidence.map(x => x.key) }
      setDetail(previous => {
        const { nextCursor: _, ...base } = module === 'relations' ? previous ?? empty(item) : cursor && previous ? previous : value
        // Revalidate the first page without discarding already read later pages.
        const tail = !cursor && module === 'relations' && value.nextCursor ? previous?.evidence.filter(x => !oldFirstKeys.has(x.key)) ?? [] : []
        const nextCursor = tail.length ? previous?.nextCursor ?? value.nextCursor : value.nextCursor
        return {
          ...base,
          evidence: module === 'relations' || cursor
            ? cursor ? mergeExploreEvidence(previous?.evidence ?? [], value.evidence) : mergeExploreEvidence(value.evidence, tail)
            : value.evidence,
          ...(nextCursor ? { nextCursor } : {}),
        }
      })
    } catch (e) { if (!c.signal.aborted) setError(message(e)) }
    finally { if (!c.signal.aborted) { setLoading(false); setRefreshing(false) } }
  }, [module, readOverview])

  useEffect(() => {
    recordsRequest.current?.abort(); overviewRequest.current?.abort()
    setError(''); setOverviewError(''); setLoading(false); setRefreshing(false); setOverviewLoading(false)
    const item = currentItem.current
    const entry = module === 'relations' ? relationViewCache.read(accountScope, key, isRelationDetail) : undefined
    const saved = entry?.value
    cachedAt.current = entry?.at ?? 0
    metadata.current = saved ? { recordsAt: saved.recordsAt, overviewAt: saved.overviewAt, firstKeys: saved.firstKeys } : { recordsAt: 0, overviewAt: 0, firstKeys: [] }
    // The list is a different projection: it must not overwrite an already read
    // overview. Only renew the opaque action reference from the current list.
    const initial = saved ? { ...saved.detail, item: { ...saved.detail.item, ref: item?.ref ?? saved.detail.item.ref } } : item && module === 'relations' ? empty(item) : undefined
    detailRef.current = initial; setDetail(initial)
    if (item) {
      if (!saved || Date.now() - saved.recordsAt > 30_000) void readDetail(item, undefined, !!saved)
      if (saved && Date.now() - saved.overviewAt > 30_000) void readOverview(item)
    }
    return () => { recordsRequest.current?.abort(); overviewRequest.current?.abort() }
  }, [key, module, accountScope, readDetail, readOverview])

  useEffect(() => {
    if (module !== 'relations' || !detail || !key || detail.item.key !== currentItem.current?.key) return
    // Cache independent successful regions, including when the other region failed.
    const at = Math.max(metadata.current.recordsAt, metadata.current.overviewAt)
    if (at) {
      // Later cached pages may still contain older signed references. Do not extend their lifetime.
      cachedAt.current ||= at
      relationViewCache.write(accountScope, key, { detail, ...metadata.current }, cachedAt.current)
    }
  }, [detail, key, module, accountScope])

  const invalidate = useCallback(() => { relationViewCache.remove(accountScope, key) }, [accountScope, key])
  const retryDetail = useCallback((item: ExploreItem) => readDetail(item, failedCursor.current, true), [readDetail])
  return { detail: detail?.item.key === selected?.key ? detail : undefined, loading, refreshing, error, overviewLoading, overviewError, readDetail, readOverview, retryDetail, invalidate }
}
