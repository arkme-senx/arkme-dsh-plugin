import { useEffect, useState } from 'react'
import type { RecordingComparisonAvailabilityState } from '../../recording-strategy-contract.js'
import { readDayComparisonSources, readSessionComparisonAvailability } from './recording-comparison-day.js'

type Availability = { strategy: RecordingComparisonAvailabilityState; doubao: RecordingComparisonAvailabilityState }
const unknown: Availability = { strategy: 'unknown', doubao: 'unknown' }

/** Metadata only, with bounded server source pages; never loads transcripts or
 * starts jobs. Unknown/error cannot erase historical results as a false empty. */
export function useRecordingComparisonAvailability(dateStamp: number, active: boolean, refreshRevision: string | number = 0, sessionRef?: string) {
  const [revision, retry] = useState(0)
  const scope = `${dateStamp}:${sessionRef ?? "day"}:${refreshRevision}:${revision}`
  const [value, setValue] = useState<{ scope: string; availability: Availability; loading: boolean; error: boolean }>({ scope: '', availability: unknown, loading: true, error: false })
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let expiration: ReturnType<typeof setTimeout> | undefined
    setValue({ scope, availability: unknown, loading: true, error: false })
    void (sessionRef ? readSessionComparisonAvailability(sessionRef, controller.signal) : readDayComparisonSources(dateStamp, controller.signal, true)).then(sources => {
      if (controller.signal.aborted) return
      const state = (kind: keyof Availability): RecordingComparisonAvailabilityState => sources.some(source => source.availability?.[kind] === 'available') ? 'available'
        : sources.some(source => !source.availability || source.availability[kind] === 'unknown') ? 'unknown' : 'unavailable'
      const availability = { strategy: state('strategy'), doubao: state('doubao') }
      setValue({ scope, availability, loading: false, error: Object.values(availability).includes('unknown') })
      const deadlines = sources.flatMap(source => source.availability?.expiresAtMillis && source.availability.expiresAtMillis > Date.now() ? [source.availability.expiresAtMillis] : [])
      if (deadlines.length) expiration = setTimeout(() => retry(n => n + 1), Math.max(0, Math.min(...deadlines) - Date.now()))
    }).catch(() => { if (!controller.signal.aborted) setValue({ scope, availability: unknown, loading: false, error: true }) })
    const onFocus = () => retry(n => n + 1)
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
    return () => { controller.abort(); clearTimeout(expiration); if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus) }
  }, [dateStamp, active, scope, sessionRef])
  const current = value.scope === scope ? value : { availability: unknown, loading: true, error: false }
  return { ...current, retry: () => retry(n => n + 1) }
}
