import { useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingDailyMetrics, ArkmeRecordingTranscriptPage } from '../../types.js'
import { appendRecordingTranscriptPage } from '../../recording-transcript-page.js'
import { recordingTextCount } from '../../recording-daily-metrics.js'
import { callArkme } from '../api.js'

export type RecordingDailyMetricsProjection = ArkmeRecordingDailyMetrics & { speakerTextCounts: Readonly<Record<string, number>> }

/** Independently consume bounded pages for totals. Never retain a whole day's
 * text, block first-page playback, or publish a partial count as the day total. */
export async function readRecordingDailyMetrics(first: ArkmeRecordingTranscriptPage,
  read: (cursor: string) => Promise<ArkmeRecordingTranscriptPage>, signal: AbortSignal): Promise<RecordingDailyMetricsProjection | undefined> {
  if (first.dailyMetrics === undefined) return undefined
  let page = first
  let count = first.dailyMetrics?.textCount ?? 0
  const speakerTextCounts: Record<string, number> = Object.create(null) as Record<string, number>
  const countSpeakers = (value: ArkmeRecordingTranscriptPage) => {
    for (const item of value.items) if (!item.isBackground) speakerTextCounts[item.speakerKey] = (speakerTextCounts[item.speakerKey] ?? 0) + recordingTextCount(item.text)
  }
  countSpeakers(first)
  const cursors = new Set<string>()
  while (page.nextCursor !== '') {
    signal.throwIfAborted()
    if (cursors.has(page.nextCursor)) throw new Error('录音分页未前进')
    cursors.add(page.nextCursor)
    const next = await read(page.nextCursor)
    // Retain just the last item to verify fragment continuity at each boundary.
    appendRecordingTranscriptPage({ ...page, items: page.items.slice(-1) }, next)
    if (next.dailyMetrics === undefined) return undefined
    count += next.dailyMetrics.textCount
    countSpeakers(next)
    page = next
  }
  signal.throwIfAborted()
  return page.dailyMetrics === undefined ? undefined : { ...page.dailyMetrics, textCount: count, speakerTextCounts }
}

export function useRecordingDailyMetrics(page: ArkmeRecordingTranscriptPage | undefined, scope: string, active: boolean) {
  const latest = useRef(page)
  latest.current = page
  const key = `${scope}:${page?.viewRef ?? ''}:${JSON.stringify(page?.dailyMetrics)}`
  const [result, setResult] = useState<{ key: string; metrics?: RecordingDailyMetricsProjection }>()
  useEffect(() => {
    const first = latest.current
    if (!active || first === undefined || first.state === 'error') return
    const controller = new AbortController()
    const read = (cursor: string) => callArkme<ArkmeRecordingTranscriptPage>('recordings.transcript.page', {
      dateStamp: first.dateStamp, source: first.transcriptSource, cursor,
    }, controller.signal)
    void (async () => {
      try {
        const metrics = await readRecordingDailyMetrics(first, read, controller.signal)
        if (!controller.signal.aborted) setResult({ key, ...(metrics === undefined ? {} : { metrics }) })
      } catch {
        if (!controller.signal.aborted) setResult({ key })
      }
    })()
    return () => { controller.abort() }
  }, [key, active])
  return active && result?.key === key ? result.metrics : undefined
}
