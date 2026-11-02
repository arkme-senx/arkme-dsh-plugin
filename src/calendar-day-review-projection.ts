import { arrangementDateTimeMillis } from './client/arrangement-date.js'
import type { DayReviewResult, DayReviewSource, DayReviewQuery, DayReviewCoverage } from './calendar-day-review.js'
import type { ArkmeRecordingSection, ArkmeRecordingVersion } from './types.js'

/** Presentation only. It never reads material or creates a generation job. */
export function projectDayReviewRecordingSection(result: DayReviewResult, query: Pick<DayReviewQuery, 'bucketDate' | 'timezone'>): ArkmeRecordingSection<ArkmeRecordingVersion> & { sourceScope: DayReviewSource[]; timeZoneOffsetMillis: number; coverage: DayReviewCoverage[] } {
  const timeZoneOffsetMillis = Date.parse(`${query.bucketDate}T00:00:00Z`) - arrangementDateTimeMillis(query.bucketDate, '00:00', query.timezone)
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: query.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return { state: 'ready', message: '', timeZoneOffsetMillis, coverage: result.coverage, sourceScope: result.coverage.filter(x => x.count > 0).map(x => x.kind), items: [{
    id: result.id, status: 'done', selectable: true, generationStage: 100, generatedAtMillis: result.generatedAtMillis,
    modelDisplayName: result.modelName, content: result.summary.map(x => x.text).join('\n\n'), error: '',
    timelineEvents: result.timeline.map((event, i) => {
      const d = event.details, startAt = event.startAtMillis === null ? '' : clock.format(event.startAtMillis), endAt = event.endAtMillis === null ? '' : clock.format(event.endAtMillis)
      return { eventId: `${result.id}:${i}`, startAt, endAt, timeRange: startAt ? `${startAt}–${endAt}` : '', title: event.title,
        description: [event.text, ...(d?.events ?? [])].join('\n'), scene: d?.scene ?? '', emotion: d?.mood ?? '', todo: d?.todos.join('\n') ?? '',
        tags: [], participants: d?.roles ?? [], rawText: d?.quotes.join('\n') ?? '',
        dialoguePoints: (d?.quotes ?? []).map(quote => ({ speakerName: '', summary: '', quote, roleDescription: '', isSelf: false })), otherInfo: d?.otherInfo ?? [] }
    }),
  }] }
}
