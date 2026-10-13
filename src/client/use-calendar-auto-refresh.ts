import { useEffect, useRef } from 'react'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'

/** Only refresh the selected day; foreground events are coalesced, never polled. */
export function useCalendarAutoRefresh(accountScope: string, dateKey: string, onRefresh: (hard: boolean) => void) {
  const latest = useRef(onRefresh)
  latest.current = onRefresh
  useEffect(() => {
    if (!accountScope) return
    let lastForeground = -Infinity
    const foreground = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastForeground < 500) return
      lastForeground = now
      latest.current(false)
    }
    const stop = arkmeCalendarInvalidations.subscribe(event => {
      if (event.hard || !event.dates || event.dates.includes(dateKey)) latest.current(event.hard)
    })
    if (typeof window !== 'undefined') window.addEventListener('focus', foreground)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', foreground)
    return () => {
      stop()
      if (typeof window !== 'undefined') window.removeEventListener('focus', foreground)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', foreground)
    }
  }, [accountScope, dateKey])
}
