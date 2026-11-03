import { useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingTranscriptPage } from '../../types.js'
import { callArkme } from '../api.js'
import { readRecordingDayOverview, recordingDayOverviewKey, type RecordingDayOverview } from './recording-day-overview.js'
export type { RecordingDailyMetricsProjection } from './recording-day-overview.js'

export async function readRecordingDailyMetrics(first: ArkmeRecordingTranscriptPage,
  read: (cursor: string) => Promise<ArkmeRecordingTranscriptPage>, signal: AbortSignal) {
  return (await readRecordingDayOverview(first, read, signal)).metrics
}

export function useRecordingDayOverview(page: ArkmeRecordingTranscriptPage | undefined, scope: string, active: boolean, refreshVersion: string | number = 0) {
  const latest = useRef(page)
  const lastComplete = useRef<{ scope: string; value: RecordingDayOverview }>()
  latest.current = page
  if (lastComplete.current?.scope !== scope) lastComplete.current = undefined
  const key = recordingDayOverviewKey(page, scope, refreshVersion)
  const [result, setResult] = useState<{ key: string; value?: RecordingDayOverview; error?: string }>()
  const [retryRevision, setRetryRevision] = useState(0)
  useEffect(() => {
    const first = latest.current
    if (!active || first === undefined || first.state === 'error') return
    const controller = new AbortController()
    setResult(undefined)
    const pending = first.nextCursor ? callArkme<RecordingDayOverview & { viewRef: string }>('recordings.day.overview', {
      dateStamp: first.dateStamp, viewRef: first.viewRef, cursor: first.nextCursor,
    }, controller.signal).then(value => {
      if (value.viewRef !== first.viewRef || !Array.isArray(value.items)) throw new Error('全天概览版本不匹配，请重新读取')
      return value
    }) : readRecordingDayOverview(first, async () => { throw new Error('完整转写不应继续翻页') }, controller.signal)
    void pending.then(value => {
      if (!controller.signal.aborted) { lastComplete.current = { scope, value }; setResult({ key, value }) }
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : '读取全天录音概览失败' })
    })
    return () => { controller.abort() }
  }, [key, active, retryRevision])
  const current = active && result?.key === key ? result : undefined
  const previous = active && page !== undefined && page.state !== 'error' && lastComplete.current?.scope === scope ? lastComplete.current.value : undefined
  // Storage/input counters are authoritative for the whole window on every
  // page; refreshing them must not rescan the unchanged transcript snapshot.
  const value = current?.value && current.value.metrics && page?.dailyMetrics ? { ...current.value,
    metrics: { ...page.dailyMetrics, textCount: current.value.metrics.textCount, speakerTextCounts: current.value.metrics.speakerTextCounts } } : current?.value ?? previous
  return { value, loading: active && page !== undefined && page.state !== 'error' && current === undefined,
    error: current?.error ?? '', retry: () => setRetryRevision(value => value + 1) }
}

export function useRecordingDailyMetrics(page: ArkmeRecordingTranscriptPage | undefined, scope: string, active: boolean) {
  return useRecordingDayOverview(page, scope, active).value?.metrics
}
