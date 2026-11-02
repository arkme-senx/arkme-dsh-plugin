import type { ArkmeRecordingDailyMetrics, ArkmeRecordingTranscriptPage, ArkmeRecordingOverviewItem } from '../../types.js'
import { appendRecordingTranscriptPage } from '../../recording-transcript-page.js'
import { recordingTextCount } from '../../recording-daily-metrics.js'

/** Navigation metadata only. A day overview must never retain all transcript bodies. */
export type RecordingTimelineItem = ArkmeRecordingOverviewItem & { text?: string }
export type RecordingDailyMetricsProjection = ArkmeRecordingDailyMetrics & { speakerTextCounts: Readonly<Record<string, number>> }
export interface RecordingDayOverview { items: RecordingTimelineItem[]; metrics?: RecordingDailyMetricsProjection }

/** Read a complete snapshot independently of the visible transcript prefix.
 * Only one bounded page and compact navigation facts survive each iteration. */
export async function readRecordingDayOverview(first: ArkmeRecordingTranscriptPage,
  read: (cursor: string) => Promise<ArkmeRecordingTranscriptPage>, signal: AbortSignal): Promise<RecordingDayOverview> {
  const items = new Map<string, RecordingTimelineItem>()
  const speakerTextCounts: Record<string, number> = Object.create(null) as Record<string, number>
  let textCount = 0
  let lastItemId: string | undefined
  const collect = (page: ArkmeRecordingTranscriptPage) => {
    for (const item of page.items) {
      const count = recordingTextCount(item.text)
      textCount += count
      if (!item.isBackground && item.recordingBelongsToViewer !== false) speakerTextCounts[item.speakerKey] = (speakerTextCounts[item.speakerKey] ?? 0) + count
      const previous = items.get(item.itemId)
      if (previous && (page.items[0] !== item || lastItemId !== item.itemId)) throw new Error('录音概览片段重复，请刷新重试')
      items.set(item.itemId, {
        itemId: item.itemId, itemRef: item.itemRef, startAtMillis: item.startAtMillis, endAtMillis: item.endAtMillis,
        speakerKey: item.speakerKey, speakerLabel: item.speakerLabel, speakerColorIndex: item.speakerColorIndex,
        ...(item.speakerAvatarRef === undefined ? {} : { speakerAvatarRef: item.speakerAvatarRef }),
        ...(item.recordingBelongsToViewer === undefined ? {} : { recordingBelongsToViewer: item.recordingBelongsToViewer }),
        isBackground: item.isBackground, textCount: (previous?.textCount ?? 0) + count,
        textPreview: Array.from((previous?.textPreview ?? '') + item.text).slice(0, 80).join(''),
      })
      lastItemId = item.itemId
    }
  }
  signal.throwIfAborted()
  if (first.state === 'error') throw new Error(first.message || '读取全天录音概览失败')
  collect(first)
  let page = first
  const cursors = new Set<string>()
  while (page.nextCursor) {
    signal.throwIfAborted()
    if (cursors.has(page.nextCursor)) throw new Error('录音分页未前进')
    cursors.add(page.nextCursor)
    const next = await read(page.nextCursor)
    signal.throwIfAborted()
    appendRecordingTranscriptPage({ ...page, items: page.items.slice(-1) }, next)
    collect(next)
    page = next
  }
  signal.throwIfAborted()
  return { items: [...items.values()], ...(page.dailyMetrics === undefined ? {} : {
    metrics: { ...page.dailyMetrics, textCount, speakerTextCounts },
  }) }
}

/** A visible-prefix text count is not a change to the underlying day snapshot. */
export function recordingDayOverviewKey(page: ArkmeRecordingTranscriptPage | undefined, scope: string, refreshVersion: string | number = 0): string {
  return JSON.stringify([scope, refreshVersion, page?.viewRef, page?.dateStamp, page?.transcriptSource, page?.window,
    page?.state === 'error'])
}
