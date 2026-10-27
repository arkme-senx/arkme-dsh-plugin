import { useEffect, useRef, useState } from 'react'
import { comparisonError, readDayComparisonOptions, readDayComparisonSources, type DayComparisonSource } from './recording-comparison-day.js'

export function useRecordingDayComparisons(dateStamp: number) {
  const [sources, setSources] = useState<DayComparisonSource[]>([])
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const current = useRef(sources); current.current = sources
  const life = useRef<AbortController>()
  const active = useRef<Promise<void>>()
  useEffect(() => {
    const controller = new AbortController(); life.current = controller; active.current = undefined
    setSources([]); setLoading(true); setError('')
    void readDayComparisonSources(dateStamp, controller.signal)
      .then(rows => readDayComparisonOptions(rows, controller.signal))
      .then(rows => { if (!controller.signal.aborted) setSources(rows) })
      .catch(reason => { if (!controller.signal.aborted) setError(comparisonError(reason)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [dateStamp, revision])
  const refresh = async (only?: string[]) => {
    if (active.current) await active.current
    const controller = life.current
    if (!controller || controller.signal.aborted) return
    const selected = current.current.filter(source => !only || only.includes(source.sourceRef))
    const operation = readDayComparisonOptions(selected, controller.signal).then(rows => {
      if (controller.signal.aborted) return
      const bySource = new Map(rows.map(row => [row.sourceRef, row]))
      setSources(previous => previous.map(source => bySource.get(source.sourceRef) ?? source))
    })
    active.current = operation
    try { await operation } finally { if (active.current === operation) active.current = undefined }
  }
  useEffect(() => {
    const pending = sources.filter(source => !source.error && source.options && (!source.options.officialComplete || source.options.results.some(row => !row.complete)))
    if (!pending.length) return
    const timer = setTimeout(() => { void refresh(pending.map(row => row.sourceRef)).catch(() => undefined) }, 3000)
    return () => clearTimeout(timer)
  }, [sources])
  useEffect(() => {
    const deadlines = sources.flatMap(source => source.options?.canStart ? [source.options.expiresAtMillis] : [])
    if (!deadlines.length) return
    const timer = setTimeout(() => setSources(previous => previous.map(source => source.options?.canStart && source.options.expiresAtMillis <= Date.now()
      ? { ...source, options: { ...source.options, canStart: false } } : source)), Math.max(0, Math.min(...deadlines) - Date.now()))
    return () => clearTimeout(timer)
  }, [sources])
  return { sources, loading, error, refresh, reload: () => setRevision(value => value + 1) }
}
