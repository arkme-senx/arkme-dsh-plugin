import { useEffect, useRef, useState } from 'react'
import type { RecordingStrategy, RecordingStrategyPage } from '../../recording-strategy-contract.js'
import { callArkme } from '../api.js'
import { comparisonDayRange, comparisonError, comparisonSourceState, type DayComparisonSource } from './recording-comparison-day.js'

type SourcePage = { items: RecordingStrategyPage['items']; cursor?: string | undefined; done: boolean; waiting: boolean; failed: boolean }

/** One bounded request per column. Completed/empty sources advance naturally;
 * a pending source never prevents later recordings from being read. */
export function useRecordingDayStrategyPages(sources: DayComparisonSource[], selection: RecordingStrategy | 'official', dateStamp: number) {
  const [pages, setPages] = useState<Map<string, SourcePage>>(new Map())
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const life = useRef<AbortController>(), inFlight = useRef(false)
  const latest = useRef({ sources, pages }); latest.current = { sources, pages }
  useEffect(() => {
    const controller = new AbortController(); life.current = controller; inFlight.current = false
    setPages(new Map()); setError(''); setLoading(false)
    return () => controller.abort()
  }, [selection, dateStamp])
  const nextSource = (rows: DayComparisonSource[], loaded: Map<string, SourcePage>) => rows.find(source => {
    const state = comparisonSourceState(source, selection), page = loaded.get(source.sourceRef)
    return state.exists && !!state.strategy && !source.error && !page?.done && (!page?.waiting || !state.processing)
  })
  const candidate = nextSource(sources, pages)
  const page = candidate && pages.get(candidate.sourceRef)
  const cursor = candidate ? `${candidate.sourceRef}:${page?.cursor ?? 'first'}:${page?.waiting ? 'ready' : 'page'}` : undefined
  const next = async () => {
    const controller = life.current
    if (!controller || controller.signal.aborted || inFlight.current) return
    const source = nextSource(latest.current.sources, latest.current.pages)
    if (!source) return
    const state = comparisonSourceState(source, selection), prior = latest.current.pages.get(source.sourceRef)
    inFlight.current = true; setLoading(true); setError('')
    try {
      const result = await callArkme<RecordingStrategyPage>('recordings.strategies', { action: 'page', sourceRef: source.sourceRef, strategy: state.strategy, ...(prior?.cursor ? { cursor: prior.cursor } : {}) }, controller.signal)
      if (controller.signal.aborted) return
      const { start, end } = comparisonDayRange(dateStamp)
      const items = result.items.filter(item => item.startAtMillis < end && (item.endAtMillis > start || item.startAtMillis >= start))
      setPages(previous => new Map(previous).set(source.sourceRef, {
        items: [...(prior?.items ?? []), ...items], cursor: result.nextCursor ?? prior?.cursor,
        done: result.complete && !result.nextCursor, waiting: !result.complete && !result.nextCursor,
        failed: !!prior?.failed || result.failed,
      }))
    } catch (reason) { if (!controller.signal.aborted) setError(comparisonError(reason)) }
    finally { if (life.current === controller) { inFlight.current = false; if (!controller.signal.aborted) setLoading(false) } }
  }
  // Initial load also works in a hidden/test viewport. Subsequent pages are
  // requested by the shared pane only as the reader approaches its bottom.
  useEffect(() => { if (!pages.size && cursor && !loading && !error) void next() }, [cursor, pages.size, loading, error])
  return { pages, pagination: { cursor, loading, error, next } }
}
