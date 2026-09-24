import { createHmac } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeRelatedRecordingEligibility,
  ArkmeRelatedRecordingItem,
  ArkmeRelatedRecordingMonthBucket,
  ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageOptions,
  ArkmeRelatedRecordingPageState,
} from '../types.js'
import { SourceService, type ArkmeSourceRefPayload } from './source-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export const MAX_ARKME_RELATED_RECORDING_PAGE_SIZE = 20
export const MAX_ARKME_RELATED_RECORDING_CURSOR_LENGTH = 1024
const MAX_ARKME_TIMEZONE_OFFSET_MILLIS = 14 * 60 * 60 * 1000
const RELATED_RECORDINGS_FUNC_TYPE = 17

interface ArkmeSharedRecordingDetailRefPayload {
  version: 1
  viewerUserId: number
  chatSessionUid: string
  relationUid: string
  recordOwnerUserId: number
  recordUid: string
  sequence: number
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
}
function booleanValue(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') return ['1', 'true'].includes(value.trim().toLowerCase())
  return false
}
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function optionalPositiveNumber(value: unknown): number | undefined {
  const number = numberValue(value)
  return number > 0 ? number : undefined
}
function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim()
  return text === '' ? undefined : text
}
function firstOptionalString(source: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = optionalString(source[key])
    if (value !== undefined) return value
  }
  return undefined
}
function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function participantRoleName(role: number): string {
  if (role === 2) return '我'
  if (role === 1) return '对方'
  if (role === 4) return '其他说话人'
  return ''
}

export class RelatedRecordingService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly source: SourceService,
  ) {}

  isEnabled(): boolean {
    return this.runtime.config.relatedRecordingsEnabled !== false
  }

  async relatedRecordingEligibility(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeRelatedRecordingEligibility> {
    const session = await this.runtime.requireSession()
    await this.requirePrivateSource(sourceRef, session.userId)
    const allowed = this.relatedRecordingsEnabled()
      && await this.loadRelatedRecordingEligibility(session, signal)
    return { allowed }
  }

  async relatedRecordings(
    sourceRef: string,
    options: ArkmeRelatedRecordingPageOptions = {},
  ): Promise<ArkmeRelatedRecordingPage> {
    const limit = options.limit ?? 10
    const cursor = options.cursor?.trim() ?? ''
    const monthKey = options.monthKey?.trim() ?? ''
    const timezoneOffsetMillis = options.timezoneOffsetMillis ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ARKME_RELATED_RECORDING_PAGE_SIZE) {
      throw new ArkmePluginError('related-recordings-limit-invalid', '相关录音每页条数必须在 1 到 20 之间', false)
    }
    if (cursor.length > MAX_ARKME_RELATED_RECORDING_CURSOR_LENGTH) {
      throw new ArkmePluginError('related-recordings-cursor-invalid', '相关录音分页游标无效', false)
    }
    if (monthKey !== '' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      throw new ArkmePluginError('related-recordings-month-invalid', '相关录音月份参数无效', false)
    }
    if (!Number.isInteger(timezoneOffsetMillis)
      || Math.abs(timezoneOffsetMillis) > MAX_ARKME_TIMEZONE_OFFSET_MILLIS) {
      throw new ArkmePluginError('related-recordings-timezone-invalid', '相关录音时区参数无效', false)
    }
    const session = await this.runtime.requireSession()
    const source = await this.requirePrivateSource(sourceRef, session.userId)
    if (!this.relatedRecordingsEnabled() || !await this.loadRelatedRecordingEligibility(session, options.signal)) {
      throw new ArkmePluginError('related-recordings-not-allowed', '当前账号暂未开放相关录音能力', false, 403)
    }
    const legacyBody: Record<string, unknown> = {
      chat_session_uid: source.ownerRef,
      page_size: limit,
      ...(cursor === '' ? {} : { cursor }),
    }
    const shouldUseModernContract = options.includeTimeIndex === true || monthKey !== ''
    let raw: Record<string, unknown>
    let legacyTimeIndexFallback = false
    if (shouldUseModernContract) {
      try {
        raw = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/records/related-recordings/page',
          {
            ...legacyBody,
            ...(monthKey === '' ? {} : { month_key: monthKey }),
            timezone_offset: timezoneOffsetMillis,
            include_time_index: options.includeTimeIndex === true,
          },
          session,
          options.signal,
        )
      } catch (error) {
        const safeLegacyProbe = error instanceof ArkmePluginError
          && error.code === 'arkme-code-1001'
          && cursor === ''
          && monthKey === ''
          && options.includeTimeIndex === true
        if (!safeLegacyProbe) throw error
        raw = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/records/related-recordings/page', legacyBody, session, options.signal,
        )
        legacyTimeIndexFallback = true
      }
    } else {
      raw = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/records/related-recordings/page', legacyBody, session, options.signal,
      )
    }
    return await this.relatedRecordingPage(raw, legacyTimeIndexFallback, session.userId, source.ownerRef)
  }

  recordRelatedRecordingsToolEvent(_event: {
    result: 'success' | 'error'
    durationMs: number
    itemCount?: number
    cursorPresent?: boolean
    transcriptRequested?: boolean
    transcriptTruncated?: boolean
  }): void {
    // Best-effort diagnostic sink. Recording content is deliberately excluded.
  }

  private relatedRecordingsEnabled(): boolean {
    return this.isEnabled()
  }

  private async requirePrivateSource(sourceRef: string, userId: number): Promise<ArkmeSourceRefPayload> {
    const source = await this.source.openSourceRef(sourceRef, userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('related-recordings-private-source-required', '相关录音仅支持一对一私聊', false)
    }
    return source
  }

  private async loadRelatedRecordingEligibility(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/able-func', { func_type: RELATED_RECORDINGS_FUNC_TYPE }, session, signal,
    )
    return booleanValue(data.able)
  }

  private async relatedRecordingPage(
    raw: Record<string, unknown>,
    legacyTimeIndexFallback: boolean,
    userId: number,
    chatSessionUid: string,
  ): Promise<ArkmeRelatedRecordingPage> {
    const items: ArkmeRelatedRecordingItem[] = []
    const signingKey = await this.runtime.stateStore.uniqueCode()
    for (const rawItem of listValue(raw.moment_ls ?? raw.momentLs ?? raw.items)) {
      const item = this.relatedRecordingItem(rawItem, userId, chatSessionUid, signingKey)
      if (item !== undefined) items.push(item)
    }
    const partial = booleanValue(raw.partial)
    const stateCode = numberValue(raw.state)
    const state: ArkmeRelatedRecordingPageState = partial
      ? items.length > 0 ? 'partial' : 'error'
      : items.length > 0 ? 'success'
        : stateCode === 2 ? 'generating'
          : stateCode === 4 ? 'error'
            : 'empty'
    const nextCursor = stringValue(raw.next_cursor ?? raw.nextCursor).trim()
    const timeIndexComplete = booleanValue(raw.time_index_complete ?? raw.timeIndexComplete) && !legacyTimeIndexFallback
    const monthBuckets: ArkmeRelatedRecordingMonthBucket[] = timeIndexComplete
      ? listValue(raw.month_bucket_ls ?? raw.monthBucketLs ?? raw.monthBuckets).flatMap(value => {
          const bucket = objectValue(value)
          const monthKey = stringValue(bucket.month_key ?? bucket.monthKey).trim()
          const itemCount = numberValue(bucket.item_count ?? bucket.itemCount)
          return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) && Number.isInteger(itemCount) && itemCount >= 0
            ? [{ monthKey, itemCount }]
            : []
        })
      : []
    return {
      state,
      stateCode,
      stateMessage: stringValue(raw.state_msg ?? raw.stateMessage).trim(),
      hasEntry: booleanValue(raw.has_entry ?? raw.hasEntry),
      items,
      hasMore: booleanValue(raw.has_more ?? raw.hasMore) && nextCursor !== '',
      ...(booleanValue(raw.has_more ?? raw.hasMore) && nextCursor !== '' ? { nextCursor } : {}),
      partial,
      ...(timeIndexComplete ? { monthBuckets } : {}),
      timeIndexComplete,
      legacyTimeIndexFallback,
    }
  }

  private relatedRecordingItem(
    raw: unknown,
    userId: number,
    chatSessionUid: string,
    signingKey: string,
  ): ArkmeRelatedRecordingItem | undefined {
    const item = objectValue(raw)
    const momentId = stringValue(item.moment_id ?? item.momentId).trim()
    const startAtMillis = numberValue(item.start_at ?? item.startAt ?? item.startAtMillis)
    if (momentId === '' || !Number.isSafeInteger(startAtMillis) || startAtMillis <= 0) return undefined
    const transcript = stringValue(item.transcript ?? item.transcript_text ?? item.transcriptText)
    const speakers = listValue(item.speaker_ls ?? item.speakerLs ?? item.speakers).flatMap((value, index) => {
      if (typeof value === 'string') {
        const nickname = value.trim()
        return nickname === '' ? [] : [{ speakerId: `speaker:${index}`, nickname }]
      }
      const speaker = objectValue(value)
      const speakerId = firstOptionalString(speaker, ['speaker_id', 'speakerId', 'id']) ?? ''
      const refUserId = optionalPositiveNumber(speaker.ref_usr_id ?? speaker.refUsrId ?? speaker.ref_user_id ?? speaker.refUserId)
      const nickname = firstOptionalString(speaker, [
        'nick_name', 'nickName', 'nickname', 'speaker_name', 'speakerName', 'display_name', 'displayName', 'name',
      ])
      if (speakerId === '' && nickname === undefined && refUserId === undefined) return []
      return [{ speakerId, ...(refUserId === undefined ? {} : { refUserId }), ...(nickname === undefined ? {} : { nickname }) }]
    })
    const participantValues = listValue(item.participant_ls ?? item.participantLs ?? item.participants)
    const participants = (participantValues.length > 0 ? participantValues : listValue(item.speaker_ls ?? item.speakerLs ?? item.speakers))
      .flatMap((value, index) => {
      if (typeof value === 'string') {
        const displayName = value.trim()
        return displayName === '' ? [] : [{ speakerId: `participant:${index}`, displayName, role: 0 }]
      }
      const participant = objectValue(value)
      const role = Math.max(0, numberValue(participant.role))
      const speakerId = firstOptionalString(participant, ['speaker_id', 'speakerId', 'id']) ?? ''
      const nickname = firstOptionalString(participant, ['nick_name', 'nickName', 'nickname', 'speaker_name', 'speakerName', 'name'])
      const displayName = firstOptionalString(participant, ['display_name', 'displayName', 'display_name_snapshot', 'displayNameSnapshot'])
        ?? nickname
        ?? participantRoleName(role)
      const refUserId = optionalPositiveNumber(participant.ref_usr_id ?? participant.refUsrId ?? participant.ref_user_id ?? participant.refUserId ?? participant.user_id ?? participant.userId)
      if (displayName === '' && speakerId === '' && refUserId === undefined) return []
      return [{
        speakerId: speakerId === '' ? `participant:${index}` : speakerId,
        ...(refUserId === undefined ? {} : { refUserId }),
        ...(nickname === undefined ? {} : { nickname }),
        displayName,
        role,
      }]
    })
    const dateStamp = optionalPositiveNumber(item.date_stamp ?? item.dateStamp)
    const timezoneOffsetMillis = numberValue(item.tz_offset ?? item.tzOffset ?? item.timezone_offset ?? item.timezoneOffset ?? item.timezoneOffsetMillis)
    const isSharedByOther = booleanValue(item.is_shared_by_other ?? item.isSharedByOther)
    const sharedByUserId = optionalPositiveNumber(item.shared_by_user_id ?? item.sharedByUserId)
    const itemChatSessionUid = firstOptionalString(item, [
      'chat_session_uid', 'chatSessionUid', 'source_chat_session_uid', 'sourceChatSessionUid',
    ]) ?? chatSessionUid
    const recordUid = firstOptionalString(item, ['record_uid', 'recordUid', 'shared_record_uid', 'sharedRecordUid']) ?? ''
    const recordOwnerUserId = optionalPositiveNumber(
      item.record_owner_user_id ?? item.recordOwnerUserId ?? item.owner_user_id ?? item.ownerUserId,
    ) ?? sharedByUserId
    const sourceRelationUid = firstOptionalString(item, [
      'source_relation_uid', 'sourceRelationUid', 'rel_uid', 'relUid', 'relation_uid', 'relationUid',
    ]) ?? ''
    const sharedSequence = numberValue(item.shared_sequence ?? item.sharedSequence ?? item.seq ?? item.sequence)
    const sharedRecordingDetailRef = isSharedByOther && itemChatSessionUid.trim() !== '' && recordUid.trim() !== ''
      && recordOwnerUserId !== undefined && recordOwnerUserId > 0
      ? this.sharedRecordingDetailRef({
          version: 1,
          viewerUserId: userId,
          chatSessionUid: itemChatSessionUid.trim(),
          relationUid: sourceRelationUid.trim(),
          recordOwnerUserId,
          recordUid: recordUid.trim(),
          sequence: Math.max(0, sharedSequence),
        }, signingKey)
      : undefined
    return {
      recordingRef: this.relatedRecordingRef(userId, chatSessionUid, momentId, signingKey),
      ...(sharedRecordingDetailRef === undefined ? {} : { sharedRecordingDetailRef }),
      startAtMillis,
      endAtMillis: numberValue(item.end_at ?? item.endAt ?? item.endAtMillis),
      ...(dateStamp === undefined ? {} : { dateStamp }),
      ...(Number.isSafeInteger(timezoneOffsetMillis) ? { timezoneOffsetMillis } : {}),
      timeRangeText: stringValue(item.time_range_text ?? item.timeRangeText).trim(),
      title: stringValue(item.title ?? item.orig_name ?? item.origName).trim(),
      summary: stringValue(item.summary ?? item.summary_text ?? item.summaryText).trim(),
      summaryStatus: numberValue(item.summary_status ?? item.summaryStatus),
      ...(transcript === '' ? {} : { transcript }),
      transcriptAvailable: booleanValue(item.transcript_available ?? item.transcriptAvailable) && transcript !== '',
      speakers,
      participants,
      isSharedByOther,
      ...(sharedByUserId === undefined ? {} : { sharedByUserId }),
    }
  }

  private relatedRecordingRef(userId: number, chatSessionUid: string, momentId: string, signingKey: string): string {
    const signature = createHmac('sha256', signingKey)
      .update(`related-recording:${userId}:${chatSessionUid}:${momentId}`)
      .digest('base64url')
    return `arkme-related-recording-v1.${signature}`
  }

  private sharedRecordingDetailRef(payload: ArkmeSharedRecordingDetailRefPayload, signingKey: string): string {
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', signingKey).update(encoded).digest('base64url')
    return `arkme-shared-recording-detail-v1.${encoded}.${signature}`
  }
}
