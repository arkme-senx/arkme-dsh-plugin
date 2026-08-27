import type {
  ArkmeCalendarBucketDay,
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordItem,
} from '../types.js'
import { ArkmePluginError, ServiceRuntime, clippedText, objectValue, stringValue } from './service.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord } from './privacy-visibility.js'

const MAX_CALENDAR_RANGE_DAYS = 62
const MAX_DAY_RECORD_LIMIT = 50

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return undefined
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readCalendarDate(value: string, field: string): string {
  const normalized = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (match === null) throw new ArkmePluginError('calendar-date-invalid', `${field} 必须是 YYYY-MM-DD`, false)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ArkmePluginError('calendar-date-invalid', `${field} 必须是真实日期`, false)
  }
  return normalized
}

function calendarDayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (match === null) throw new ArkmePluginError('calendar-date-invalid', '日期格式无效', false)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return Math.trunc(Date.UTC(year, month - 1, day) / 86_400_000)
}

function readTimezone(value: string | undefined): string {
  const normalized = value?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  if (normalized.length > 80) throw new ArkmePluginError('calendar-timezone-invalid', 'timezone 无效', false)
  return normalized
}

function boundedLimit(value: number | undefined): number {
  const limit = Math.trunc(value ?? 20)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DAY_RECORD_LIMIT) {
    throw new ArkmePluginError('calendar-limit-invalid', `limit 必须是 1-${MAX_DAY_RECORD_LIMIT} 的整数`, false)
  }
  return limit
}

function contentAccessState(value: unknown): ArkmeCalendarRecordItem['accessState'] {
  const code = Math.trunc(numberValue(value))
  if (code === 1) return 'available'
  if (code === 2) return 'protected'
  return 'unknown'
}

function sourceKind(raw: Record<string, unknown>): ArkmeCalendarRecordItem['sourceKind'] {
  const topic = objectValue(raw.topic_core)
  const chat = objectValue(raw.chat_core)
  if (stringValue(topic.topic_uid).trim() !== '') return 'topic'
  if (stringValue(chat.chat_session_uid).trim() !== '') return 'chat'
  if (booleanValue(raw.is_uncategorized) === true) return 'self'
  return 'unknown'
}

export class CalendarService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly privacy = new ArkmePrivacyVisibilityService(runtime),
  ) {}

  async bucketPage(options: {
    startDate: string
    endDate: string
    timezone?: string
    signal?: AbortSignal
  }): Promise<ArkmeCalendarBucketPage> {
    const startDate = readCalendarDate(options.startDate, 'start_date')
    const endDate = readCalendarDate(options.endDate, 'end_date')
    const startDay = calendarDayNumber(startDate)
    const endDay = calendarDayNumber(endDate)
    if (startDay > endDay) {
      throw new ArkmePluginError('calendar-range-invalid', 'start_date 不能晚于 end_date', false)
    }
    if (endDay - startDay + 1 > MAX_CALENDAR_RANGE_DAYS) {
      throw new ArkmePluginError('calendar-range-too-wide', `日历范围最多查询 ${MAX_CALENDAR_RANGE_DAYS} 天`, false)
    }
    const timezone = readTimezone(options.timezone)
    const session = await this.runtime.requireSession()
    await this.privacy.lockedRecordUids(session, options.signal)
    const data = await this.runtime.authenticatedCalendarPost<Record<string, unknown>>(
      '/api/v1/calendar/buckets/query',
      {
        bucket_scope_kind: 1,
        bucket_scope_uid: '',
        start_date: startDate,
        end_date: endDate,
        timezone,
      },
      session,
      options.signal,
      {
        key: `calendar:buckets:self:${startDate}:${endDate}:${timezone}`,
        cacheMs: 30_000,
        failureCooldownMs: 2_000,
      },
    )
    return {
      scope: 'self',
      startDate,
      endDate,
      timezone: stringValue(data.timezone).trim() || timezone,
      refreshedAtMillis: Date.now(),
      days: listValue(data.daily_data).map(raw => this.bucketDay(raw)).filter(
        (day): day is ArkmeCalendarBucketDay => day !== undefined,
      ),
    }
  }

  async dayRecords(options: {
    bucketDate: string
    timezone?: string
    limit?: number
    cursor?: { sendAtMillis: number; recordUid: string }
    signal?: AbortSignal
  }): Promise<ArkmeCalendarDayRecordPage> {
    const bucketDate = readCalendarDate(options.bucketDate, 'bucket_date')
    const timezone = readTimezone(options.timezone)
    const limit = boundedLimit(options.limit)
    const cursorSendAt = Math.trunc(options.cursor?.sendAtMillis ?? 0)
    const cursorRecordUid = options.cursor?.recordUid.trim() ?? ''
    const session = await this.runtime.requireSession()
    const lockedRecordUids = await this.privacy.lockedRecordUids(session, options.signal)
    const data = await this.runtime.authenticatedCalendarPost<Record<string, unknown>>(
      '/api/v1/calendar/records/query',
      {
        bucket_scope_kind: 1,
        bucket_scope_uid: '',
        bucket_date: bucketDate,
        timezone,
        limit,
        ...(cursorSendAt > 0 && cursorRecordUid !== ''
          ? { cursor_send_at: cursorSendAt, cursor_record_uid: cursorRecordUid }
          : {}),
      },
      session,
      options.signal,
      {
        key: `calendar:records:self:${bucketDate}:${timezone}:${String(limit)}:${String(cursorSendAt)}:${cursorRecordUid}`,
        cacheMs: 10_000,
        failureCooldownMs: 2_000,
      },
    )
    const nextSendAt = Math.trunc(numberValue(data.next_cursor_send_at))
    const nextUid = stringValue(data.next_cursor_record_uid).trim()
    return {
      scope: 'self',
      bucketDate,
      timezone: stringValue(data.timezone).trim() || timezone,
      refreshedAtMillis: Date.now(),
      items: listValue(data.items).filter(raw => !arkmePrivacyLockedRecord(raw)
        && !lockedRecordUids.has(stringValue(objectValue(raw).record_uid ?? objectValue(objectValue(raw).record_core).record_uid).trim()))
        .map(raw => this.dayRecord(raw)).filter(
        (item): item is ArkmeCalendarRecordItem => item !== undefined,
      ),
      hasMore: data.has_more === true,
      ...(nextSendAt > 0 && nextUid !== '' ? { nextCursor: { sendAtMillis: nextSendAt, recordUid: nextUid } } : {}),
    }
  }

  private bucketDay(raw: unknown): ArkmeCalendarBucketDay | undefined {
    const item = objectValue(raw)
    const bucketDate = stringValue(item.bucket_date).trim()
    if (bucketDate === '') return undefined
    const protectedCount = Math.max(0, Math.trunc(numberValue(item.protected_count)))
    // Older backends may still report the protected count despite the request
    // flag. Do not let that count disclose private-record presence in Arkme.
    const count = Math.max(0, Math.trunc(numberValue(item.count)) - protectedCount)
    return {
      bucketDate,
      count,
      protectedCount: 0,
      hasRecords: count > 0,
      ...(numberValue(item.first_send_at) > 0
        ? { firstSendAtMillis: Math.trunc(numberValue(item.first_send_at)) }
        : {}),
    }
  }

  private dayRecord(raw: unknown): ArkmeCalendarRecordItem | undefined {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    const recordUid = stringValue(item.record_uid ?? core.record_uid).trim()
    const sendAtMillis = Math.trunc(numberValue(item.send_at ?? core.send_at))
    if (recordUid === '' || sendAtMillis <= 0) return undefined
    const accessState = contentAccessState(core.content_access_state)
    if (accessState === 'protected' || arkmePrivacyLockedRecord(item)) return undefined
    const available = accessState === 'available'
    const title = available ? clippedText(core.title, 500) : ''
    const textContent = available ? clippedText(core.text_content, 4_000) : ''
    const preview = title || clippedText(textContent, 160) || '无文字内容'
    const topic = objectValue(item.topic_core)
    const isUncategorized = booleanValue(item.is_uncategorized)
    const hasManualEdit = booleanValue(core.has_manual_edit)
    const hasPolish = booleanValue(core.has_polish)
    return {
      recordUid,
      sendAtMillis,
      accessState,
      title,
      textContent,
      preview,
      ...(stringValue(topic.title).trim() === '' ? {} : { topicTitle: stringValue(topic.title).trim() }),
      sourceKind: sourceKind(item),
      creationSource: Math.trunc(numberValue(core.creation_source)),
      templateKind: Math.trunc(numberValue(core.template_kind)),
      displayKind: Math.trunc(numberValue(core.display_kind)),
      protected: false,
      ...(isUncategorized === undefined ? {} : { isUncategorized }),
      ...(hasManualEdit === undefined ? {} : { hasManualEdit }),
      ...(hasPolish === undefined ? {} : { hasPolish }),
    }
  }
}
