import type {
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordCursor,
} from '../../types.js'

export interface ArkmeCalendarToolPort {
  dayReviewState(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewState>
  createDayReview(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewState>
  reconcileDayReview(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewState>
  resumeDayReview(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewState>
  dayReviewResult(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewResult>
  dayReviewPrompts(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review-prompts.js').ReviewPromptSupport>
  dayReviewEvidence(input: import('../../calendar-day-review.js').DayReviewEvidenceQuery, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewOriginalEvidence>
  calendarBuckets(options: {
    startDate: string
    endDate: string
    timezone?: string
    signal?: AbortSignal
  }): Promise<ArkmeCalendarBucketPage>
  calendarRecords(options: {
    bucketDate: string
    timezone?: string
    limit?: number
    cursor?: ArkmeCalendarRecordCursor
    signal?: AbortSignal
  }): Promise<ArkmeCalendarDayRecordPage>
}
