import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArkmeAiPointsConsumption } from '../ai-points.js'
import { pointsUnits } from '../ai-points.js'
import type { ArkmeAiPointsRangeQuery } from '../ai-points-statistics.js'
import { PointsHistoryError, pointsCategory, pointsDateKey, type PointsCategory, type PointsHistoryReader, type PointsStatistics } from './ai-points-history.js'

type State = { key: string; status: 'loading' | 'ready' | 'error'; items: ArkmeAiPointsConsumption[]; next: string; loadingMore: boolean; error?: unknown; moreError?: unknown }

export function usePointsHistoryDetails(reader: PointsHistoryReader, data: PointsStatistics | undefined, from: number, until: number, category: PointsCategory | undefined, active: boolean) {
  const expectedTotal = category ? data?.categories.find(item => item.category === category)?.chargedPoints ?? '0' : data?.selectedPoints ?? '0'
  const query = useMemo<ArkmeAiPointsRangeQuery | undefined>(() => {
    if (!data?.snapshot) return undefined
    const codes = category ? [...new Set(data.snapshot.buckets.filter(bucket => bucket.fromDate >= pointsDateKey(from) && bucket.untilDate <= pointsDateKey(until))
      .flatMap(bucket => bucket.types).filter(type => pointsCategory(type.businessCode) === category).map(type => type.businessCode))] : undefined
    return { fromDate: pointsDateKey(from), untilDate: pointsDateKey(until), timezone: 'Asia/Shanghai', settledBefore: data.observedAt, limit: 20, ...(codes ? { businessCodes: codes } : {}) }
  }, [data?.snapshot, data?.observedAt, from, until, category])
  const key = JSON.stringify([query, expectedTotal]), keyRef = useRef(key)
  keyRef.current = key
  const [state, setState] = useState<State>()
  const request = useRef<AbortController>(), pending = useRef('')
  const read = useCallback(async (cursor = '') => {
    if (!query) return
    const pendingKey = `${key}:${cursor}`
    if (pending.current === pendingKey && !request.current?.signal.aborted) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller; pending.current = pendingKey
    setState(previous => cursor && previous?.key === key ? { ...previous, loadingMore: true, moreError: undefined } : { key, status: 'loading', items: [], next: '', loadingMore: false })
    try {
      const page = pointsUnits(expectedTotal) === 0n ? { items: [], nextBeforeId: '' } : await reader.details({ ...query, ...(cursor ? { beforeId: cursor } : {}) }, expectedTotal, controller.signal)
      if (controller.signal.aborted || keyRef.current !== key) return
      setState(previous => {
        const before = cursor && previous?.key === key ? previous.items : [], items = [...before, ...page.items]
        const loaded = items.reduce((sum, item) => sum + pointsUnits(item.chargedPoints), 0n), expected = pointsUnits(expectedTotal)
        if (new Set(items.map(item => item.requestUid)).size !== items.length || items.length > 25_000 || loaded > expected || (!page.nextBeforeId && loaded !== expected)) return { key, status: 'error', items: [], next: '', loadingMore: false, error: new PointsHistoryError('changed') }
        return { key, status: 'ready', items, next: page.nextBeforeId, loadingMore: false }
      })
    } catch (error) {
      if (!controller.signal.aborted && keyRef.current === key) setState(previous => cursor && previous?.key === key
        ? { ...previous, loadingMore: false, moreError: error } : { key, status: 'error', items: [], next: '', loadingMore: false, error })
    } finally { if (pending.current === pendingKey) pending.current = '' }
  }, [reader, query, key, expectedTotal])
  useEffect(() => {
    if (!active || !query) return
    void read()
    return () => request.current?.abort()
  }, [active, query, read])
  const current = state?.key === key ? state : undefined
  return { ...current, total: expectedTotal, ready: current?.status === 'ready', retry: () => { void read() }, loadMore: () => { if (current?.next) void read(current.next) } }
}
