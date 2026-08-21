import type {
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordCursor,
} from '../../types.js'

export interface ArkmeCalendarToolPort {
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
