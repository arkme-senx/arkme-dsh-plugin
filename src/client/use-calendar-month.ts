import { useEffect, useMemo, useState, useSyncExternalStore, useCallback } from 'react'
import { CalendarMonthCache, arkmeCalendarMonths, type CalendarMonthQuery } from './calendar-month-cache.js'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'

/** Both calendar entry points observe the same per-account month resource. */
export function useCalendarMonth(query: CalendarMonthQuery, enabled = true, account?: string) {
  const [local] = useState(() => { const cache = new CalendarMonthCache(undefined, () => undefined); cache.activateAccount('local'); return cache })
  const cache = account ? arkmeCalendarMonths : local
  const owner = account ?? 'local'
  const stable = useMemo(() => query, [query.scopeKey, query.sourceRef, query.startDate, query.endDate, query.timezone, query.timezoneOffsetMillis])
  const subscribe = useCallback((notify: () => void) => enabled ? cache.subscribe(owner, stable, notify) : () => {}, [cache, owner, stable, enabled])
  const get = useCallback(() => cache.get(owner, stable), [cache, owner, stable])
  const snapshot = useSyncExternalStore(subscribe, get, get)
  useEffect(() => {
    if (cache !== local) return
    return arkmeCalendarInvalidations.subscribe(event => { cache.invalidate(event) })
  }, [cache, local])
  useEffect(() => { if (enabled) void cache.ensure(owner, stable) }, [cache, owner, stable, enabled])
  // One previous month, only after the visible month succeeds and the UI is idle.
  useEffect(() => {
    if (!account || !enabled || stable.timezoneOffsetMillis !== undefined || snapshot.loading || !snapshot.value || snapshot.error) return
    const timer = setTimeout(() => {
      const [year, month] = stable.startDate.split('-').map(Number)
      const first = new Date(year!, month! - 2, 1)
      const last = new Date(year!, month! - 1, 0)
      const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      void cache.ensure(owner, { ...stable, startDate: key(first), endDate: key(last) }, true)
    }, 1500)
    return () => clearTimeout(timer)
  }, [account, cache, owner, stable, enabled, snapshot.loading, snapshot.value, snapshot.error])
  const retry = useCallback(() => cache.refresh(owner, stable), [cache, owner, stable])
  const revalidate = useCallback(() => { void cache.ensure(owner, stable) }, [cache, owner, stable])
  return { ...snapshot, retry, revalidate }
}
