import type {
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordCursor,
} from '../../types.js'

export interface ArkmeCalendarToolPort {
  dayDigestAccountScope(): Promise<string>
  dayReviewState(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewState>
  prepareDayReview(input: unknown, signal?: AbortSignal): ReturnType<import('../../arkme-service.js').ArkmeService['prepareDayReview']>
  createDayReview(input: unknown, signal?: AbortSignal): Promise<import('../../calendar-day-review.js').DayReviewState>
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
