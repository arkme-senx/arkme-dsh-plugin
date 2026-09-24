import type {
  ArkmeCalendarRecordLocation,
  ArkmeCalendarScopeKind,
  ArkmeSourceItem,
  ArkmeCalendarBucketDay,
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordItem,
} from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { SourceService } from './source-service.js'
import type { MediaService } from './media-service.js'
import type { RecordService } from './record-service.js'
import { arkmeEmojiClippedText } from '../arkme-emoji-text.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord } from './privacy-visibility.js'
import { readTopicMetadata } from './topic-metadata.js'
import { isDshAgentInputRawRecord } from '../dsh-agent-input-source.js'
import { ARKME_DSH_INPUT_TOPIC_KIND } from '../topic-policy.js'
import { SharedReadGroup } from '../shared-read-group.js'
import { recordOwnerId } from '../record-owner-id.js'
import { randomUUID } from 'node:crypto'
import { recordLocationObservation } from '../record-location-observation.js'
import { arkmeChatConversationPreview } from './source-service.js'
import type { CallHistoryService } from './call-history-service.js'

const MAX_CALENDAR_RANGE_DAYS = 62
const MAX_DAY_RECORD_LIMIT = 50
const CALENDAR_CACHE_TTL_MS = 60_000
const MAX_CACHED_DAYS = 512

interface CachedCalendarValue<T> { revision: string; expires: number; value: T }

interface CalendarScope {
  kind: ArkmeCalendarScopeKind
  buckets: Array<{ kind: 1 | 2; uid: string }>
  view?: Record<string, unknown>
}

async function mapBounded<T, R>(items: T[], project: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (index < items.length) {
      const current = index++
      result[current] = await project(items[current]!)
    }
  }))
  return result
}

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

/** Chat statistics use compact dates in production; older servers also supply a day timestamp. */
function readChatStatisticsDate(item: Record<string, unknown>, timezoneOffsetMillis: number): string {
  const raw = stringValue(item.bucket_date).trim()
  const normalized = raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  try { return readCalendarDate(normalized, 'bucket_date') } catch (error) {
    if (!(error instanceof ArkmePluginError) || error.code !== 'calendar-date-invalid') throw error
  }
  // Use the requesting client's offset, not the server process's local timezone.
  const timestamp = item.day_milli_stamp
  if (typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp > 0) {
    const localDay = new Date(timestamp + timezoneOffsetMillis)
    if (Number.isFinite(localDay.getTime()) && localDay.getUTCFullYear() >= 1 && localDay.getUTCFullYear() <= 9999) {
      return localDay.toISOString().slice(0, 10)
    }
  }
  throw new ArkmePluginError('calendar-statistics-invalid', '会话日期数据无法识别，请重试', true, 502)
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
  const core = objectValue(raw.record_core)
  if (stringValue(topic.topic_uid).trim() !== '') return 'topic'
  if (stringValue(chat.chat_session_uid).trim() !== '' || [3, 4].includes(numberValue(core.origin_kind))) return 'chat'
  if (booleanValue(raw.is_uncategorized) === true) return 'self'
  return 'unknown'
}

export class CalendarService {
  // Capabilities contain no coordinates; bounded and never persisted across runtime restarts.
  private readonly locationRefs = new Map<string, { userId: number; origin: string; recordUid: string; expires: number }>()
  private readonly months = new Map<string, CachedCalendarValue<ArkmeCalendarBucketPage>>()
  private readonly monthReads = new SharedReadGroup<ArkmeCalendarBucketPage>()
  // Keep only finished daily counts/anchors, never record bodies. This lets a
  // date-scoped change or interrupted month reuse unaffected completed days.
  private readonly days = new Map<string, CachedCalendarValue<ArkmeCalendarBucketDay>>()
  private readonly dayReads = new SharedReadGroup<CachedCalendarValue<ArkmeCalendarBucketDay>>()
  dispose(): void { this.months.clear(); this.monthReads.clear(); this.days.clear(); this.dayReads.clear(); this.locationRefs.clear() }
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly privacy: ArkmePrivacyVisibilityService,
    private readonly media: MediaService,
    private readonly record: RecordService,
    private readonly source: SourceService,
    private readonly callHistory?: CallHistoryService,
  ) {}

  /**
   * Read one of the documented multi-source "My day" projections.  Keeping
   * this transport in the calendar domain service avoids expanding the
   * compatibility facade for every new calendar source.
   */
  async activity(options: {
    source: 'record' | 'chat' | 'call' | 'audio' | 'arko' | 'bot'
    mode: 'buckets' | 'details' | 'coverage' | 'transcripts'
    body: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<unknown> {
    options.signal?.throwIfAborted()
    const request = (path: string) => ({
      path,
      body: options.body,
      signal: options.signal,
    })
    switch (options.source) {
      case 'record': {
        if (options.mode === 'details') {
          const page = await this.dayRecords({ bucketDate: stringValue(options.body.bucket_date),
            timezone: stringValue(options.body.timezone), limit: numberValue(options.body.limit) || 50,
            ...(options.body.cursor_send_at !== undefined ? { cursor: { sendAtMillis: numberValue(options.body.cursor_send_at), recordUid: stringValue(options.body.cursor_record_uid) } } : {}),
            ...(options.signal ? { signal: options.signal } : {}) })
          return { items: page.items.map(record_projection => ({ record_projection, occurred_at: record_projection.sendAtMillis })),
            has_more: page.hasMore, ...(page.nextCursor ? { next_cursor: { cursor_send_at: page.nextCursor.sendAtMillis, cursor_record_uid: page.nextCursor.recordUid } } : {}) }
        }
        const route = options.mode === 'buckets' ? '/api/v1/calendar/buckets/query' : '/api/v1/calendar/records/query'
        const { path, body, signal } = request(route)
        return await this.runtime.authenticatedCalendarPost(path, body, undefined, signal, { lane: 'interactive-read', bypassCache: true })
      }
      case 'chat': {
        const route = options.mode === 'buckets' ? '/api/v1/chats/activities/buckets/query' : '/api/v1/chats/activities/query'
        const { path, body, signal } = request(route)
        const session = await this.runtime.requireSession()
        const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(path, body, session, signal, { lane: 'interactive-read', bypassCache: true })
        return options.mode === 'details' ? await this.projectChatActivity(data, session, signal) : data
      }
      case 'call': {
        if (options.mode === 'details' && this.callHistory) {
          const page = await this.callHistory.listCallHistory({ limit: numberValue(options.body.limit) || 50, includeRecentContacts: false,
            startAtMillis: numberValue(options.body.start_at), endAtMillis: numberValue(options.body.end_at),
            ...(stringValue(options.body.cursor) ? { cursor: stringValue(options.body.cursor) } : {}) }, options.signal)
          return { items: page.items.map(call_projection => ({ call_projection, occurred_at: call_projection.startedAtMillis })), has_more: page.hasMore,
            ...(page.nextCursor ? { next_cursor: page.nextCursor } : {}) }
        }
        const route = options.mode === 'buckets' ? '/api/v1/call/history-buckets/query' : '/api/v1/call/history-aggregate'
        const { path, body, signal } = request(route)
        return await this.runtime.authenticatedDataPost(path, body, undefined, signal, { lane: 'interactive-read', bypassCache: true })
      }
      case 'audio': {
        const route = options.mode === 'buckets'
          ? '/api/v1/audio/get-calender-summary'
          : options.mode === 'coverage' ? '/api/v1/audio/coverage/query' : '/api/v1/audio/transcripts/query'
        const { path, body, signal } = request(route)
        return await this.runtime.authenticatedAudioPost(path, body, undefined, signal, { lane: 'interactive-read', bypassCache: true })
      }
      case 'arko': {
        const route = options.mode === 'buckets' ? '/api/v1/arko/activities/buckets/query' : '/api/v1/arko/activities/query'
        const { path, body, signal } = request(route)
        return await this.runtime.authenticatedIntelligentPost(path, body, undefined, signal, { lane: 'interactive-read', bypassCache: true })
      }
      case 'bot': {
        const route = options.mode === 'buckets' ? '/api/v1/bots/activities/buckets/query' : '/api/v1/bots/activities/query'
        const { path, body, signal } = request(route)
        const session = await this.runtime.requireSession()
        const data = await this.runtime.authenticatedBotPost<Record<string, unknown>>(path, body, session, signal, { lane: 'interactive-read', bypassCache: true })
        return options.mode === 'details' ? await this.projectChatActivity(data, session, signal) : data
      }
    }
  }

  private async projectChatActivity(data: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal) {
    const rows = listValue(data.items).map(objectValue)
    const uid = (row: Record<string, unknown>) => stringValue(objectValue(row.source_ref).chat_session_uid)
    const sources = await this.source.chatSourcesBySessionUids([...new Set(rows.map(uid).filter(Boolean))], signal)
    // A first-paint directory cache may intentionally omit avatars. Hydrate only
    // this page's resolved sources, reusing the existing bounded profile reader.
    const missingAvatars = [...sources].filter(([, item]) => !item.avatarRef && !item.avatarRefs?.length && !item.groupAvatar)
    if (missingAvatars.length) {
      try {
        const hydrated = await this.source.hydrateDirectoryPage(missingAvatars.map(([, item]) => item), signal ?? new AbortController().signal)
        for (const [index, [key]] of missingAvatars.entries()) if (hydrated[index]) sources.set(key, hydrated[index]!)
      } catch {
        // Decoration is optional. A failed avatar read must not hide real activity.
        signal?.throwIfAborted()
      }
    }
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('account-changed', '账号已变化，请重新打开日历', false)
    return { ...data, items: rows.map(row => ({ ...row,
      ...(sources.has(uid(row)) ? { source_item: sources.get(uid(row)) } : {}),
      preview: arkmeChatConversationPreview(objectValue(row.record), session.userId),
    })) }
  }

  private issueLocationRef(recordUid: string, session: ArkmeSessionCredentials): string {
    const now = Date.now()
    for (const [key, ref] of this.locationRefs) if (ref.expires <= now) this.locationRefs.delete(key)
    while (this.locationRefs.size >= 1000) this.locationRefs.delete(this.locationRefs.keys().next().value!)
    const ref = randomUUID()
    this.locationRefs.set(ref, { userId: session.userId, origin: this.runtime.config?.recordBaseUrl ?? '',
      recordUid, expires: now + 15 * 60_000 })
    return ref
  }

  /** Local Host adapter over existing owner APIs, not a new backend endpoint. */
  async recordLocation(locationRef: string, signal?: AbortSignal): Promise<ArkmeCalendarRecordLocation> {
    signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    const ref = this.locationRefs.get(locationRef)
    if (!ref || ref.userId !== session.userId || ref.origin !== (this.runtime.config?.recordBaseUrl ?? '') || ref.expires <= Date.now()) {
      throw new ArkmePluginError('calendar-location-ref-invalid', '地点入口已过期，请刷新当天活动', false, 400)
    }
    const restricted = (): ArkmeCalendarRecordLocation => ({ recordUid: ref.recordUid, access: 'restricted' })
    if ((await this.privacy.lockedRecordUids(session, signal)).has(ref.recordUid)) return restricted()
    const raw = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/detail',
      { record_uid: ref.recordUid }, session, signal, { lane: 'interactive-read' })
    const core = objectValue(raw.record_core ?? raw.recordCore ?? raw.record ?? raw)
    if (stringValue(core.record_uid ?? raw.record_uid ?? core.uid) !== ref.recordUid) {
      throw new ArkmePluginError('calendar-location-mismatch', '地点与当前记录不一致，请刷新', true, 502)
    }
    // Revalidate live owner/access. A calendar reference is not permission to read somebody else's location.
    const owner = recordOwnerId(core.owner_user_id ?? raw.owner_user_id ?? core.creator_user_id ?? raw.creator_user_id)
    if (owner !== session.userId || contentAccessState(core.content_access_state ?? raw.content_access_state) !== 'available'
      || arkmePrivacyLockedRecord(raw)) return restricted()
    const context = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/location/context/get',
      { record_uid: ref.recordUid }, session, signal, { lane: 'interactive-read' })
    signal?.throwIfAborted()
    const data = objectValue(context.data ?? context)
    for (const value of [context.record_uid, context.recordUid, data.record_uid, data.recordUid]) {
      if (value !== undefined && value !== ref.recordUid) throw new ArkmePluginError('calendar-location-mismatch', '地点与当前记录不一致，请刷新', true, 502)
    }
    if (arkmePrivacyLockedRecord(context) || arkmePrivacyLockedRecord(data)
      || (await this.privacy.lockedRecordUids(session, signal)).has(ref.recordUid)) return restricted()
    // Account/environment may change while either upstream request is in flight.
    const latest = await this.runtime.requireSession()
    signal?.throwIfAborted()
    if (latest.userId !== ref.userId || (this.runtime.config?.recordBaseUrl ?? '') !== ref.origin || !this.locationRefs.has(locationRef)) {
      throw new ArkmePluginError('calendar-location-ref-invalid', '账号已变化，请重新打开日历', false, 400)
    }
    const location = recordLocationObservation(raw, context)
    return { recordUid: ref.recordUid, access: 'available', ...(location ? { location } : {}) }
  }

  /** Same service-owned daily index used by Flutter private/group chat calendars. */
  async chatStatistics(options: {
    sourceRef: string; timezone: string; timezoneOffsetMillis: number; signal?: AbortSignal
  }): Promise<ArkmeCalendarBucketPage> {
    options.signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(options.sourceRef, session.userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('calendar-source-invalid', '会话日历仅支持私聊和群聊', false, 400)
    }
    const timezone = readTimezone(options.timezone)
    const offset = options.timezoneOffsetMillis
    if (!Number.isSafeInteger(offset) || Math.abs(offset) > 14 * 60 * 60 * 1000) {
      throw new ArkmePluginError('calendar-timezone-invalid', '时区偏移无效', false, 400)
    }
    // Preserve Flutter's fixed timezone-offset contract, including historical buckets.
    const key = JSON.stringify(['chat-calendar', session.userId, source.ownerRef, timezone, offset])
    const revision = () => String(this.runtime.readRevision?.(`user:${session.userId}`) ?? 0)
    const version = revision()
    const cached = this.months.get(key)
    if (cached?.revision === version && cached.expires > Date.now()) return structuredClone(cached.value)
    return structuredClone(await this.monthReads.run(`${key}:${version}`, async (signal, isCurrent) => {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/session/statistics',
        { chat_session_uid: source.ownerRef, tz_offset_millis: offset }, session, signal,
        { lane: 'interactive-read', key: `calendar:chat:${source.ownerRef}:${offset}`, cancelWhenUnobserved: true },
      )
      if (!Array.isArray(data.daily_data)) {
        throw new ArkmePluginError('calendar-statistics-invalid', '会话日历数据不完整，请重试', true, 502)
      }
      const seen = new Set<string>()
      const days: ArkmeCalendarBucketDay[] = data.daily_data.map(raw => {
        const item = objectValue(raw)
        const date = readChatStatisticsDate(item, offset)
        const count = numberValue(item.count)
        if (!Number.isSafeInteger(count) || count < 0 || seen.has(date)) {
          throw new ArkmePluginError('calendar-statistics-invalid', '会话日期统计无效，请重试', true, 502)
        }
        seen.add(date)
        const owner = recordOwnerId(item.first_record_owner_user_id)
        const recordUid = stringValue(item.first_record_uid).trim()
        const sendAtMillis = numberValue(item.first_attach_at)
        return { bucketDate: date, count, protectedCount: 0, hasRecords: count > 0,
          ...(recordUid && owner !== 0 ? { anchor: { recordUid, recordOwnerUserId: owner, sendAtMillis } } : {}) }
      }).filter(day => day.hasRecords).sort((a, b) => a.bucketDate.localeCompare(b.bucketDate))
      const value: ArkmeCalendarBucketPage = { scope: source.kind as 'private_chat' | 'group_chat',
        startDate: '0001-01-01', endDate: '9999-12-31', timezone, refreshedAtMillis: Date.now(),
        days, totalDayCount: days.length }
      signal.throwIfAborted()
      if (isCurrent() && revision() === version) {
        this.months.delete(key)
        this.months.set(key, { value, revision: version, expires: Date.now() + CALENDAR_CACHE_TTL_MS })
        while (this.months.size > 48) this.months.delete(this.months.keys().next().value!)
      }
      return value
    }, options.signal))
  }

  async bucketPage(options: {
    startDate: string
    endDate: string
    sourceRef?: string
    timezone?: string
    background?: boolean
    signal?: AbortSignal
  }): Promise<ArkmeCalendarBucketPage> {
    options.signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    const timezone = readTimezone(options.timezone)
    const key = JSON.stringify([session.userId, options.sourceRef ?? 'global', options.startDate, options.endDate, timezone,
      this.runtime.config?.selfCalendarViewsEnabled !== false ? 'views-v1:natural' : 'legacy'])
    const revision = () => this.runtime.calendarReadRevision?.(`user:${session.userId}`, options.startDate, options.endDate, timezone) ?? '0'
    const version = revision()
    const cached = this.months.get(key)
    if (cached && cached.revision === version && cached.expires > Date.now()) {
      this.months.delete(key); this.months.set(key, cached)
      return structuredClone(cached.value)
    }
    return structuredClone(await this.monthReads.run(`${key}:${version}`, async (signal, isCurrent) => {
      const { value, expires } = await this.bucketPageUncached({ ...options, timezone, signal })
      signal.throwIfAborted()
      if (isCurrent() && revision() === version) {
        this.months.delete(key)
        this.months.set(key, { revision: version, expires, value })
        while (this.months.size > 48) this.months.delete(this.months.keys().next().value!)
      }
      return value
    }, options.signal))
  }

  private async bucketPageUncached(options: {
    startDate: string; endDate: string; sourceRef?: string; timezone?: string; background?: boolean; signal?: AbortSignal
  }): Promise<{ value: ArkmeCalendarBucketPage; expires: number }> {
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
    const scope = await this.resolveScope(options.sourceRef, session, options.signal)
    if (scope.view) {
      const data = await this.runtime.authenticatedCalendarPost<Record<string, unknown>>(
        '/api/v1/calendar/buckets/query',
        { ...scope.view, start_date: startDate, end_date: endDate, timezone, belong_date_policy: { kind: 1 } },
        session, options.signal, {
          key: `calendar:view:buckets:${JSON.stringify(scope.view)}:${startDate}:${endDate}:${timezone}:natural`,
          lane: options.background ? 'background-read' : 'interactive-read',
          // The service owns the bounded, revision-aware summary cache. Do not
          // add a second transport cache that survives a failed revalidation.
          cacheMs: 0, failureCooldownMs: 0,
        },
      )
      this.validateViewContext(data, timezone)
      if (!Array.isArray(data.daily_data)) this.invalidViewResponse()
      const seen = new Set<string>()
      const days = (data.daily_data as unknown[]).map(raw => {
        const item = objectValue(raw)
        let date: string
        try { date = readCalendarDate(stringValue(item.bucket_date), 'bucket_date') }
        catch { this.invalidViewResponse() }
        if (date < startDate || date > endDate || seen.has(date)
          || !Number.isSafeInteger(item.count) || (item.count as number) < 0
          || item.has_records !== ((item.count as number) > 0)
          || item.protected_count !== 0) this.invalidViewResponse()
        seen.add(date)
        // These are already filtered/deduplicated server counts. first_* is
        // newest, NOT an anchor for navigating to the beginning of the day.
        return { bucketDate: date, count: item.count as number, hasRecords: item.has_records as boolean, protectedCount: 0 }
      }).sort((a, b) => a.bucketDate.localeCompare(b.bucketDate))
      return { expires: Date.now() + CALENDAR_CACHE_TTL_MS, value: {
        scope: scope.kind, startDate, endDate, timezone, refreshedAtMillis: Date.now(), days,
      } }
    }
    const locked = await this.privacy.lockedRecordUids(session, options.signal)
    const pages = await mapBounded(scope.buckets, async bucket => {
      const data = await this.runtime.authenticatedCalendarPost<Record<string, unknown>>(
        '/api/v1/calendar/buckets/query',
        {
          bucket_scope_kind: bucket.kind,
          bucket_scope_uid: bucket.uid,
          start_date: startDate,
          end_date: endDate,
          timezone,
        },
        session,
        options.signal,
        {
          key: `calendar:buckets:${bucket.kind === 1 ? 'self' : `topic:${bucket.uid}`}:${startDate}:${endDate}:${timezone}`,
          cacheMs: 30_000,
          lane: options.background ? 'background-read' : 'interactive-read',
          failureCooldownMs: 2_000,
        },
      )
      return { bucket, days: listValue(data.daily_data).map(raw => this.bucketDay(raw)).filter(
        (day): day is ArkmeCalendarBucketDay => day !== undefined,
      ) }
    })
    const dates = [...new Set(pages.flatMap(page => page.days.map(day => day.bucketDate)))].sort()
    let expires = Date.now() + CALENDAR_CACHE_TTL_MS
    const days = await mapBounded(dates, async bucketDate => {
      const contributors = pages.flatMap(page => {
        const day = page.days.find(day => day.bucketDate === bucketDate)
        return day?.hasRecords ? [{ bucket: page.bucket, day }] : []
      })
      // Only the account-wide calendar can use the unfiltered server count.
      // Personal calendars exclude DSH; count the same visible records as the
      // day query, deduplicating subtree memberships without loading media.
      if (scope.kind === 'self') {
        return contributors[0]?.day ?? { bucketDate, count: 0, protectedCount: 0, hasRecords: false }
      }
      const key = JSON.stringify([session.userId, options.sourceRef, timezone, bucketDate,
        // Upstream changes are another invalidation signal, even before a
        // realtime event arrives. Never use an old count for a changed subtree.
        contributors.map(({ bucket, day }) => [bucket.kind, bucket.uid, day.count, day.firstSendAtMillis]).sort(),
      ])
      const revision = () => this.runtime.calendarReadRevision?.(`user:${session.userId}`, bucketDate, bucketDate, timezone) ?? '0'
      const cached = await this.readScopedBucketDay(key, revision, async signal => {
        const records = new Map<string, ArkmeCalendarRecordItem>()
        for (const { bucket } of contributors) {
          const rows = await this.scopedDayRows(bucket, scope.kind, bucketDate, timezone, Infinity, undefined, session, locked, signal, options.background)
          for (const { item } of rows) records.set(item.recordUid, item)
        }
        let first = Infinity
        for (const item of records.values()) first = Math.min(first, item.sendAtMillis)
        return { bucketDate, count: records.size, protectedCount: 0, hasRecords: records.size > 0,
          ...(Number.isFinite(first) ? { firstSendAtMillis: first } : {}) }
      }, options.signal)
      // Reusing a day must not extend its freshness by another month-cache TTL.
      expires = Math.min(expires, cached.expires)
      return { ...cached.value }
    })
    return { expires, value: {
      scope: scope.kind,
      startDate,
      endDate,
      timezone,
      refreshedAtMillis: Date.now(),
      days,
    } }
  }

  private async readScopedBucketDay(
    key: string, revision: () => string,
    read: (signal: AbortSignal) => Promise<ArkmeCalendarBucketDay>, signal?: AbortSignal,
  ): Promise<CachedCalendarValue<ArkmeCalendarBucketDay>> {
    signal?.throwIfAborted()
    const version = revision()
    const cached = this.days.get(key)
    if (cached && cached.revision === version && cached.expires > Date.now()) {
      this.days.delete(key); this.days.set(key, cached)
      return cached
    }
    return this.dayReads.run(JSON.stringify([key, version]), async (readSignal, isCurrent) => {
      const value = await read(readSignal)
      readSignal.throwIfAborted()
      const result = { revision: version, expires: Date.now() + CALENDAR_CACHE_TTL_MS, value }
      if (isCurrent() && revision() === version) {
        this.days.delete(key); this.days.set(key, result)
        while (this.days.size > MAX_CACHED_DAYS) this.days.delete(this.days.keys().next().value!)
      }
      return result
    }, signal)
  }

  async dayRecords(options: {
    bucketDate: string
    sourceRef?: string
    timezone?: string
    limit?: number
    oldestFirst?: boolean
    cursor?: { sendAtMillis: number; recordUid: string }
    signal?: AbortSignal
  }): Promise<ArkmeCalendarDayRecordPage> {
    const bucketDate = readCalendarDate(options.bucketDate, 'bucket_date')
    const timezone = readTimezone(options.timezone)
    const limit = boundedLimit(options.limit)
    const cursorSendAt = Math.trunc(options.cursor?.sendAtMillis ?? 0)
    const cursorRecordUid = options.cursor?.recordUid.trim() ?? ''
    if (options.cursor && (!Number.isSafeInteger(options.cursor.sendAtMillis) || cursorSendAt <= 0 || cursorRecordUid === '')) {
      throw new ArkmePluginError('calendar-cursor-invalid', '日历分页游标必须同时包含时间和记录 ID', false, 400)
    }
    const session = await this.runtime.requireSession()
    const scope = await this.resolveScope(options.sourceRef, session, options.signal)
    if (scope.kind === 'self' && options.oldestFirst) {
      throw new ArkmePluginError('calendar-order-unsupported', '正序定位需要指定发给自己或主题范围', false, 400)
    }
    // New views enforce current visibility on the server. Reapplying legacy
    // origin filtering would hide chat-origin records legitimately in home.
    const lockedRecordUids = scope.view ? new Set<string>() : await this.privacy.lockedRecordUids(session, options.signal)
    let data: Record<string, unknown>
    if (scope.view) {
      const body = { ...scope.view, bucket_date: bucketDate, timezone, belong_date_policy: { kind: 1 },
        limit, oldest_first: options.oldestFirst === true,
        ...(options.cursor ? { cursor_send_at: cursorSendAt, cursor_record_uid: cursorRecordUid } : {}) }
      data = await this.runtime.authenticatedCalendarPost<Record<string, unknown>>(
        '/api/v1/calendar/records/query', body, session, options.signal,
        { key: `calendar:view:records:${JSON.stringify(body)}`, cacheMs: 0, failureCooldownMs: 0 },
      )
      this.validateViewContext(data, timezone)
      this.validateViewRecords(data, limit, options.oldestFirst === true, options.cursor)
    }
    else if (scope.kind !== 'self') {
      const streams = await mapBounded(scope.buckets, bucket => this.scopedDayRows(
        bucket, scope.kind, bucketDate, timezone, options.oldestFirst ? Infinity : limit + 1,
        options.oldestFirst ? undefined : options.cursor, session, lockedRecordUids, options.signal,
      ))
      const unique = new Map(streams.flat().map(row => [row.item.recordUid, row]))
      const sorted = [...unique.values()].filter(({ item }) => !options.oldestFirst || !options.cursor
        || item.sendAtMillis > cursorSendAt || item.sendAtMillis === cursorSendAt && item.recordUid > cursorRecordUid)
        .sort((a, b) => (options.oldestFirst ? -1 : 1) * (b.item.sendAtMillis - a.item.sendAtMillis
          || (a.item.recordUid === b.item.recordUid ? 0 : a.item.recordUid < b.item.recordUid ? 1 : -1)))
      const last = sorted[Math.min(limit, sorted.length) - 1]?.item
      data = { items: sorted.slice(0, limit).map(row => row.raw), has_more: sorted.length > limit,
        ...(sorted.length > limit && last ? { next_cursor_send_at: last.sendAtMillis, next_cursor_record_uid: last.recordUid } : {}) }
    }
    else data = await this.runtime.authenticatedCalendarPost<Record<string, unknown>>(
      '/api/v1/calendar/records/query',
      {
        bucket_scope_kind: 1,
        bucket_scope_uid: '',
        bucket_date: bucketDate,
        include_location_summary: true,
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
    const rows = listValue(data.items).slice(0, limit).flatMap(raw => {
      const item = this.dayRecord(raw)
      return item === undefined || lockedRecordUids.has(item.recordUid) ? [] : [{ raw, item }]
    })
    const chatUid = (raw: unknown): string => {
      const row = objectValue(raw)
      return stringValue(objectValue(row.chat_core).chat_session_uid).trim()
        || stringValue(objectValue(row.record_core).origin_container_ref).trim()
    }
    const chatUids = [...new Set(rows.filter(row => row.item.sourceKind === 'chat' && row.item.accessState === 'available').map(row => chatUid(row.raw)))]
    let sources = new Map<string, ArkmeSourceItem>()
    if (chatUids.length > 0) {
      try {
        sources = await this.source.chatSourcesBySessionUids(chatUids, options.signal)
        const entries = [...sources.entries()]
        const hydrated = await this.source.hydrateDirectoryPage(entries.map(([, source]) => source), options.signal ?? new AbortController().signal)
        sources = new Map(entries.map(([uid, source], index) => [uid, hydrated[index] ?? source]))
      }
      catch (error) { if (options.signal?.aborted) throw error }
    }
    for (const { raw, item } of rows) {
      const topic = objectValue(objectValue(raw).topic_core)
      const uid = stringValue(topic.topic_uid).trim()
      if (item.accessState !== 'available' || uid === '' || !item.topicTitle || sources.has(`topic:${uid}`)) continue
      const source = await this.source.searchTargetSource(2, uid, item.topicTitle, options.signal)
      if (source !== undefined) sources.set(`topic:${uid}`, source)
    }
    const media = await this.media.hydrateRecordMediaPage(
      rows.filter(row => row.item.accessState === 'available').map(row => row.raw), session, options.signal,
    )
    return {
      scope: scope.kind,
      bucketDate,
      timezone: stringValue(data.timezone).trim() || timezone,
      refreshedAtMillis: Date.now(),
      items: rows.map(({ raw, item }) => {
        if (item.accessState !== 'available') return item
        const content = this.record.recordTimelineItemFromRaw(raw, session.userId, {
          displayItems: media.displayItemsByRecordUid.get(item.recordUid) ?? [],
          mediaUnavailable: media.unavailableRecordUids.has(item.recordUid),
        })
        const topicUid = stringValue(objectValue(objectValue(raw).topic_core).topic_uid).trim()
        const source = item.topicTitle ? sources.get(`topic:${topicUid}`) : sources.get(chatUid(raw))
        const rawItem = objectValue(raw), core = objectValue(rawItem.record_core)
        const owner = recordOwnerId(core.owner_user_id ?? rawItem.owner_user_id ?? core.creator_user_id ?? rawItem.creator_user_id)
        const ownCalendar = options.sourceRef === undefined && scope.kind === 'self' && (owner === 0 || owner === session.userId)
        const location = ownCalendar ? recordLocationObservation(raw) : undefined
        const summary = ownCalendar ? objectValue(rawItem.location_summary) : {}
        const label = stringValue(summary.label).trim()
        const capturedAtMillis = numberValue(summary.captured_at)
        return { ...item, ...(ownCalendar ? { locationRef: this.issueLocationRef(item.recordUid, session) } : {}),
          ...(ownCalendar && (label || capturedAtMillis > 0) ? { locationSummary: {
            ...(label ? { label } : {}), ...(capturedAtMillis > 0 ? { capturedAtMillis } : {}),
          } } : {}),
          ...(location ? { locationObservation: location } : {}),
          ...(source === undefined ? {} : { source }), textFormat: content.textFormat ?? 'plain', content: {
          ...content, title: item.title, textContent: arkmeEmojiClippedText(content.textContent, 40_000),
        } }
      }),
      hasMore: data.has_more === true,
      ...(nextSendAt > 0 && nextUid !== '' ? { nextCursor: { sendAtMillis: nextSendAt, recordUid: nextUid } } : {}),
    }
  }

  private async resolveScope(sourceRef: string | undefined, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<CalendarScope> {
    if (sourceRef === undefined) return { kind: 'self', buckets: [{ kind: 1, uid: '' }] }
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    if (this.runtime.config?.selfCalendarViewsEnabled !== false) {
      if (source.kind === 'send_to_self' || source.kind === 'default_category') return {
        kind: source.kind === 'send_to_self' ? 'send_to_self' : 'uncategorized', buckets: [],
        view: { bucket_scope_kind: 1, view_scope_kind: source.kind === 'send_to_self' ? 1 : 2 },
      }
      if (source.kind !== 'topic') throw new ArkmePluginError('calendar-source-invalid', '此日历仅支持发给自己和主题', false, 400)
      // Authenticated signed root only; backend owns subtree membership,
      // deduplication and live root/descendant permission checks.
      return { kind: 'topic', buckets: [], view: {
        bucket_scope_kind: 2, bucket_scope_uid: source.ownerRef, view_scope_kind: 3, include_descendants: true,
      } }
    }
    if (source.kind === 'send_to_self') return { kind: 'send_to_self', buckets: [{ kind: 1, uid: '' }] }
    if (source.kind === 'default_category') return { kind: 'uncategorized', buckets: [{ kind: 1, uid: '' }] }
    if (source.kind !== 'topic') throw new ArkmePluginError('calendar-source-invalid', '此日历仅支持发给自己和主题', false, 400)
    const metadata = await readTopicMetadata(this.runtime, session, source.ownerRef, signal)
    if (metadata.privacyState === 2) throw new ArkmePluginError('topic-privacy-locked', '隐私锁主题不能在 Arkme 插件中查看', false, 403)
    if (metadata.topicKind === ARKME_DSH_INPUT_TOPIC_KIND) return { kind: 'topic', buckets: [] }
    const topics = await this.source.topicSubtreeSources(sourceRef, signal)
    const buckets = await mapBounded(topics, async topic => {
      const opened = await this.source.openSourceRef(topic.sourceRef, session.userId)
      const meta = opened.ownerRef === source.ownerRef ? metadata : await readTopicMetadata(this.runtime, session, opened.ownerRef, signal)
      return meta.privacyState === 2 || meta.topicKind === ARKME_DSH_INPUT_TOPIC_KIND ? [] : [{ kind: 2 as const, uid: opened.ownerRef }]
    })
    return { kind: 'topic', buckets: buckets.flat() }
  }

  /** Read only one calendar day; backfill filtered rows and reject stalled cursors. */
  private async scopedDayRows(
    bucket: CalendarScope['buckets'][number], scope: ArkmeCalendarScopeKind,
    bucketDate: string, timezone: string, count: number,
    cursor: { sendAtMillis: number; recordUid: string } | undefined,
    session: ArkmeSessionCredentials, locked: ReadonlySet<string>, signal?: AbortSignal, background = false,
  ): Promise<Array<{ raw: unknown; item: ArkmeCalendarRecordItem }>> {
    const rows = new Map<string, { raw: unknown; item: ArkmeCalendarRecordItem }>()
    const visited = new Set<string>()
    for (let page = 0; page < 1000; page++) {
      signal?.throwIfAborted()
      const key = `${cursor?.sendAtMillis ?? 0}:${cursor?.recordUid ?? ''}`
      if (visited.has(key)) throw new ArkmePluginError('calendar-cursor-invalid', '日历分页未推进，请重试', true, 502)
      visited.add(key)
      const data = await this.runtime.authenticatedCalendarPost<Record<string, unknown>>('/api/v1/calendar/records/query', {
        bucket_scope_kind: bucket.kind, bucket_scope_uid: bucket.uid, bucket_date: bucketDate, timezone,
        limit: MAX_DAY_RECORD_LIMIT,
        ...(cursor ? { cursor_send_at: cursor.sendAtMillis, cursor_record_uid: cursor.recordUid } : {}),
      }, session, signal, {
        key: `calendar:records:${bucket.kind === 1 ? 'self' : `topic:${bucket.uid}`}:${bucketDate}:${timezone}:50:${key}`,
        cacheMs: 10_000, failureCooldownMs: 2_000,
        lane: background ? 'background-read' : 'interactive-read',
      })
      for (const raw of listValue(data.items)) {
        const item = this.dayRecord(raw)
        if (!item || locked.has(item.recordUid)) continue
        if (isDshAgentInputRawRecord(raw)) continue
        if (scope === 'uncategorized' && item.isUncategorized !== true) continue
        if (scope === 'send_to_self' && item.sourceKind !== 'self' && item.sourceKind !== 'topic') continue
        rows.set(item.recordUid, { raw, item })
        if (rows.size >= count) return [...rows.values()]
      }
      if (data.has_more !== true) return [...rows.values()]
      const sendAtMillis = Math.trunc(numberValue(data.next_cursor_send_at))
      const recordUid = stringValue(data.next_cursor_record_uid).trim()
      if (sendAtMillis <= 0 || recordUid === '') throw new ArkmePluginError('calendar-cursor-invalid', '日历分页信息缺失，请重试', true, 502)
      cursor = { sendAtMillis, recordUid }
    }
    throw new ArkmePluginError('calendar-pagination-limit', '日历当日记录尚未加载完整，请重试', true, 502)
  }

  private invalidViewResponse(): never {
    throw new ArkmePluginError('calendar-view-invalid', '日历数据尚未就绪或范围已变化，请重新加载；持续失败请确认服务端版本', true, 502)
  }

  private validateViewContext(data: Record<string, unknown>, timezone: string): void {
    // Existing UI uses natural days. Reject a server-side policy mismatch
    // instead of displaying counts and navigating under different calendars.
    if (data.timezone !== timezone || objectValue(data.belong_date_policy).kind !== 1) this.invalidViewResponse()
  }

  private validateViewRecords(data: Record<string, unknown>, limit: number, oldestFirst: boolean,
    cursor?: { sendAtMillis: number; recordUid: string }): void {
    if (!Array.isArray(data.items) || data.items.length > limit || typeof data.has_more !== 'boolean') this.invalidViewResponse()
    const seen = new Set<string>()
    let previous = cursor
    for (const raw of data.items as unknown[]) {
      const wire = objectValue(raw)
      const timestamp = wire.send_at ?? objectValue(wire.record_core).send_at
      const item = this.dayRecord(raw)
      if (!item || item.accessState !== 'available' || !Number.isSafeInteger(timestamp) || seen.has(item.recordUid)) this.invalidViewResponse()
      if (previous) {
        const order = item.sendAtMillis - previous.sendAtMillis
          || (item.recordUid === previous.recordUid ? 0 : item.recordUid > previous.recordUid ? 1 : -1)
        if (oldestFirst ? order <= 0 : order >= 0) this.invalidViewResponse()
      }
      seen.add(item.recordUid)
      previous = item
    }
    const nextAt = data.next_cursor_send_at
    const nextUid = data.next_cursor_record_uid
    if (data.has_more === true && ((data.items as unknown[]).length === 0
      || nextAt !== previous?.sendAtMillis || nextUid !== previous?.recordUid)) this.invalidViewResponse()
    if ((nextAt === undefined) !== (nextUid === undefined)) this.invalidViewResponse()
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
    const title = available ? arkmeEmojiClippedText(core.title, 500) : ''
    const textContent = available ? arkmeEmojiClippedText(core.text_content, 4_000) : ''
    const preview = title || arkmeEmojiClippedText(textContent, 160) || '无文字内容'
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
      creationSource: isDshAgentInputRawRecord(raw) ? 3 : Math.trunc(numberValue(core.creation_source)),
      templateKind: Math.trunc(numberValue(core.template_kind)),
      displayKind: Math.trunc(numberValue(core.display_kind)),
      protected: false,
      ...(isUncategorized === undefined ? {} : { isUncategorized }),
      ...(hasManualEdit === undefined ? {} : { hasManualEdit }),
      ...(hasPolish === undefined ? {} : { hasPolish }),
    }
  }
}
