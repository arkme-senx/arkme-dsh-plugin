import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { projectRecordingTranscripts, projectRecordingVersions } from '../recording-presentation.js'
import type {
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingCursorPayload,
  ArkmeRecordingDay,
  ArkmeRecordingProjectionKind,
  ArkmeRecordingSection,
  ArkmeRecordingTranscriptSection,
  ArkmeRecordingVersion,
} from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import type { ArkmePublicProfile } from './profile-service.js'

export interface ArkmeRecordingProfileReader {
  publicProfileSummariesByUserIds(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, ArkmePublicProfile>>
  sealProfileImageRef(viewerUserId: number, targetUserId: number): Promise<string>
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function positiveUserId(value: unknown): number | undefined {
  const numeric = numberValue(value)
  const userId = Math.trunc(numeric)
  return Number.isSafeInteger(userId) && userId > 0 ? userId : undefined
}

function speakerUserIds(speakerData: readonly unknown[]): number[] {
  return [...new Set(speakerData.flatMap(raw => {
    const speaker = objectValue(raw)
    const userId = positiveUserId(speaker.ref_usr_id ?? speaker.ref_user_id ?? speaker.user_id)
    return userId === undefined ? [] : [userId]
  }))]
}

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

export class RecordingService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile?: ArkmeRecordingProfileReader,
  ) {}

  async recordingCalendar(
    fromStamp: number,
    toStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingCalendarMonth> {
    const from = Math.trunc(fromStamp)
    const to = Math.trunc(toStamp)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from
      || to - from > 33 * 24 * 60 * 60 * 1000) {
      throw new ArkmePluginError('recording-range-invalid', '录音日历范围无效', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-calender-summary',
      { from_stamp: from, to_stamp: to },
      session,
      signal,
    )
    const durations = listValue(data.duration_ls)
    const unreviewed = listValue(data.un_click_session_ids_per_day)
    const count = Math.max(durations.length, unreviewed.length)
    const cursor = new Date(from)
    const days = []
    for (let index = 0; index < count; index += 1) {
      const durationMillis = Math.max(0, numberValue(durations[index]))
      const unreviewedCount = listValue(unreviewed[index]).length
      days.push({
        dateStamp: cursor.getTime(),
        durationMillis,
        hasRecording: durationMillis > 0 || unreviewedCount > 0,
        unreviewedCount,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    return { fromStamp: from, toStamp: to, days }
  }

  async recordingTranscript(
    dateStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingTranscriptSection> {
    const dayStart = this.recordingDayStart(dateStamp)
    const date = dayStart.getTime()
    const session = await this.runtime.requireSession()
    const [transcriptResult, speakerResult] = await Promise.allSettled([
      this.runtime.authenticatedAudioPost<Record<string, unknown>>(
        // Keep the same transcript contract as the Flutter desktop client.
        // The v2 endpoint omits the session-to-speaker bindings needed to
        // resolve a labelled person from get-speaker-ls.
        '/api/v1/audio/one-day-trans',
        { start_at: date, tz_offset: -dayStart.getTimezoneOffset() * 60_000 },
        session,
        signal,
      ),
      this.runtime.authenticatedAudioPost<Record<string, unknown>>(
        '/api/v1/audio/get-speaker-ls', {}, session, signal,
      ),
    ])
    if (transcriptResult.status === 'rejected') throw transcriptResult.reason
    let totalDurationMillis = 0
    for (const rawSession of listValue(transcriptResult.value.session_ls)) {
      totalDurationMillis += Math.max(0, numberValue(objectValue(rawSession).duration))
    }
    const speakerData = speakerResult.status === 'fulfilled'
      ? listValue(speakerResult.value.spk_ls)
      : []
    const userIds = speakerUserIds(speakerData)
    const profilesByUserId = await this.recordingSpeakerProfiles(userIds, session, signal)
    const items = projectRecordingTranscripts(transcriptResult.value, speakerData, profilesByUserId)
    return {
      state: items.length > 0 ? 'ready' : 'empty',
      items,
      message: items.length > 0 ? '' : '当天无录音',
      identityCoverage: speakerResult.status === 'fulfilled' ? 'complete' : 'partial',
      totalDurationMillis,
    }
  }

  async recordingProjection(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> {
    const dayStart = this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/summary/list-timeline-by-range',
      {
        from_stamp: dayStart.getTime(),
        to_stamp: dayEnd.getTime(),
        date_stamp: dayStart.getTime(),
        kind: kind === 'timeline' ? 1 : 2,
      },
      session,
      signal,
    )
    return this.recordingVersionSection(projectRecordingVersions(data, kind))
  }

  async sealRecordingCursor(payload: ArkmeRecordingCursorPayload): Promise<string> {
    const session = await this.runtime.requireSession()
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', await this.recordingCursorKey(session.userId))
      .update(encoded)
      .digest('base64url')
    return `arkme-recording-cursor-v1.${encoded}.${signature}`
  }

  async openRecordingCursor(cursor: string): Promise<ArkmeRecordingCursorPayload> {
    const session = await this.runtime.requireSession()
    const [prefix, encoded, suppliedText, ...extra] = cursor.trim().split('.')
    if (prefix !== 'arkme-recording-cursor-v1' || encoded === undefined
      || suppliedText === undefined || extra.length > 0) {
      throw new ArkmePluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    const supplied = Buffer.from(suppliedText, 'base64url')
    const expected = createHmac('sha256', await this.recordingCursorKey(session.userId))
      .update(encoded)
      .digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    let raw: Record<string, unknown>
    try {
      raw = objectValue(decodeOpaqueJson(encoded))
    } catch (error) {
      throw new ArkmePluginError(
        'recording-cursor-invalid',
        '录音分页游标无效',
        false,
        400,
        { cause: error },
      )
    }
    const content = raw.content
    const payload: ArkmeRecordingCursorPayload = {
      version: 1,
      dateStamp: numberValue(raw.dateStamp),
      content: content === 'summary' || content === 'timeline' ? content : 'transcript',
      itemOffset: numberValue(raw.itemOffset),
      textOffset: numberValue(raw.textOffset),
      fingerprint: stringValue(raw.fingerprint),
      ...(stringValue(raw.versionId) === '' ? {} : { versionId: stringValue(raw.versionId) }),
    }
    if (raw.version !== 1 || !['transcript', 'summary', 'timeline'].includes(String(content))
      || !Number.isSafeInteger(payload.dateStamp) || payload.dateStamp <= 0
      || !Number.isSafeInteger(payload.itemOffset) || payload.itemOffset < 0
      || !Number.isSafeInteger(payload.textOffset) || payload.textOffset < 0
      || payload.fingerprint === '') {
      throw new ArkmePluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    return payload
  }

  async recordingDay(dateStamp: number): Promise<ArkmeRecordingDay> {
    const date = this.recordingDayStart(dateStamp).getTime()
    const [transcriptResult, summaryResult, timelineResult] = await Promise.allSettled([
      this.recordingTranscript(date),
      this.recordingProjection(date, 'summary'),
      this.recordingProjection(date, 'timeline'),
    ])
    const transcript: ArkmeRecordingDay['transcript'] = transcriptResult.status === 'fulfilled'
      ? transcriptResult.value
      : { state: 'error', items: [], message: safeFailureMessage(transcriptResult.reason) }
    return {
      dateStamp: date,
      totalDurationMillis: transcriptResult.status === 'fulfilled'
        ? transcriptResult.value.totalDurationMillis
        : 0,
      transcript,
      summary: summaryResult.status === 'fulfilled' ? summaryResult.value : {
        state: 'error', items: [], message: safeFailureMessage(summaryResult.reason),
      },
      timeline: timelineResult.status === 'fulfilled' ? timelineResult.value : {
        state: 'error', items: [], message: safeFailureMessage(timelineResult.reason),
      },
    }
  }

  private async recordingCursorKey(userId: number): Promise<Buffer> {
    return createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`arkme-recording-cursor:${String(userId)}`)
      .digest()
  }

  private async recordingSpeakerProfiles(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, { displayName: string; avatarRef?: string }>> {
    if (this.profile === undefined) return new Map()
    if (userIds.length === 0) return new Map()
    try {
      const publicProfiles = await this.profile.publicProfileSummariesByUserIds(userIds, session, signal)
      const entries = await Promise.all([...publicProfiles].map(async ([userId, profile]) => {
        const displayName = profile.displayName.trim() || profile.nickname.trim()
        const avatarRef = profile.avatarUrl === undefined
          ? undefined
          : await this.profile!.sealProfileImageRef(session.userId, userId)
        return [userId, {
          displayName,
          ...(avatarRef === undefined ? {} : { avatarRef }),
        }] as const
      }))
      return new Map(entries)
    } catch {
      // Optional identity enrichment must never hide a readable transcript.
      return new Map()
    }
  }


  private recordingDayStart(dateStamp: number): Date {
    const date = Math.trunc(dateStamp)
    const dayStart = new Date(date)
    if (!Number.isSafeInteger(date) || date <= 0 || dayStart.getTime() !== date
      || dayStart.getHours() !== 0 || dayStart.getMinutes() !== 0
      || dayStart.getSeconds() !== 0 || dayStart.getMilliseconds() !== 0) {
      throw new ArkmePluginError('recording-date-invalid', '录音日期必须是本地零点', false)
    }
    return dayStart
  }

  private recordingVersionSection(
    items: ArkmeRecordingVersion[],
  ): ArkmeRecordingSection<ArkmeRecordingVersion> {
    if (items[0]?.status === 'processing') {
      return { state: 'processing', items, message: '内容仍在生成' }
    }
    if (items[0]?.status === 'failed') {
      return { state: 'failed', items, message: '最近一次生成失败' }
    }
    if (items.some(item => item.selectable)) return { state: 'ready', items, message: '' }
    return { state: 'empty', items, message: '暂无已生成内容' }
  }
}
