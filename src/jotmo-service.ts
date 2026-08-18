import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import OSS from 'ali-oss'
import type { JotmoSessionCredentials } from './keychain-store.js'
import { JOTMO_PROVIDER_CONTRACT_VERSION } from './types.js'
import { projectRecordingTranscripts, projectRecordingVersions } from './recording-presentation.js'
import type {
  JotmoAuthSnapshot,
  JotmoCachedSnapshot,
  JotmoCachedQueryResult,
  JotmoCaptchaResult,
  JotmoClientConfig,
  JotmoConversationWriteResult,
  JotmoCreateTextResult,
  JotmoEnvironment,
  JotmoImageMediaType,
  JotmoPendingWrite,
  JotmoRecordCursor,
  JotmoRelatedRecordingEligibility,
  JotmoRelatedRecordingItem,
  JotmoRelatedRecordingMonthBucket,
  JotmoRelatedRecordingPage,
  JotmoRelatedRecordingPageOptions,
  JotmoRelatedRecordingPageState,
  JotmoRecordingCalendarMonth,
  JotmoRecordingCursorPayload,
  JotmoRecordingDay,
  JotmoRecordingProjectionKind,
  JotmoRecordingSection,
  JotmoRecordingTranscriptSection,
  JotmoRecordingVersion,
  JotmoRecordingVersionSection,
  JotmoSelfRecordItem,
  JotmoSelfRecordList,
  JotmoSelfSummary,
  JotmoProviderCapabilities,
  JotmoProviderState,
  JotmoSourceDirectory,
  JotmoSourceItem,
  JotmoSourceKind,
  JotmoSourceList,
  JotmoSourceSendResult,
  JotmoTimelineCursor,
  JotmoTimelineItem,
  JotmoTimelinePage,
  JotmoUserProfile,
  JotmoUserProfileSnapshot,
} from './types.js'

interface SessionStore {
  read(): Promise<JotmoSessionCredentials | undefined>
  write(session: JotmoSessionCredentials): Promise<void>
  delete(): Promise<void>
}

interface StateStore {
  uniqueCode(): Promise<string>
  cachedSnapshot(userId: number): Promise<JotmoCachedSnapshot>
  cacheSummary(userId: number, summary: JotmoSelfSummary): Promise<void>
  cachePage(userId: number, page: JotmoSelfRecordList, requestCursor?: JotmoRecordCursor): Promise<void>
  queryCached(
    userId: number,
    options: { query?: string; limit: number; beforeMillis?: number },
  ): Promise<JotmoCachedQueryResult>
  revision(userId: number): Promise<number>
  cachedProfile(userId: number): Promise<JotmoUserProfileSnapshot>
  cacheProfile(userId: number, profile: JotmoUserProfile): Promise<JotmoUserProfileSnapshot>
  listPending(userId: number): Promise<JotmoPendingWrite[]>
  putPending(userId: number, pending: JotmoPendingWrite): Promise<void>
  markAttempt(userId: number, recordUid: string, error: string): Promise<void>
  markSynced(userId: number, recordUid: string, status: number): Promise<void>
}

export interface JotmoServiceConfig {
  environment: JotmoEnvironment
  authBaseUrl: string
  recordBaseUrl: string
  chatBaseUrl: string
  audioBaseUrl: string
  requestTimeoutMs: number
  maxTextLength: number
  geetestCaptchaId: string
  relatedRecordingsEnabled?: boolean
}

export interface JotmoServiceEvent {
  operation: 'related-recordings-eligibility' | 'related-recordings-page' | 'related-recordings-tool'
  result: 'allowed' | 'denied' | 'success' | 'error' | 'legacy-fallback'
  durationMs: number
  itemCount?: number
  cursorPresent?: boolean
  partial?: boolean
  consumer?: 'ui' | 'tool'
  transcriptRequested?: boolean
  transcriptTruncated?: boolean
  errorCode?: string
}

interface LoginAttempt {
  attemptId: string
  sceneStr: string
  qrContent: string
  expiresAtMillis: number
}

interface JotmoEnvelope<T> {
  code: number
  message?: string
  data?: T
}

interface QrResponse {
  url?: unknown
  scene_str?: unknown
  expire_seconds?: unknown
}

interface JotmoOssCredentials {
  accessKeyId: string
  accessKeySecret: string
  stsToken: string
  expiration: string
}

interface JotmoSourceRefPayload {
  version: 1
  userId: number
  kind: JotmoSourceKind
  ownerRef: string
  displayName: string
}

interface JotmoProfileImageRefPayload {
  version: 1
  viewerUserId: number
  targetUserId: number
}

interface JotmoPublicProfile {
  userId: number
  displayName: string
  avatarUrl: string
}

interface ScanResponse {
  access_token?: unknown
  refresh_token?: unknown
  user_id?: unknown
}

interface PhoneLoginResponse extends ScanResponse {
  ok?: unknown
}

type FetchLike = typeof fetch

export const MAX_JOTMO_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_JOTMO_RELATED_RECORDING_PAGE_SIZE = 20
export const MAX_JOTMO_RELATED_RECORDING_CURSOR_LENGTH = 1024
const MAX_JOTMO_TIMEZONE_OFFSET_MILLIS = 14 * 60 * 60 * 1000
const RELATED_RECORDINGS_FUNC_TYPE = 17

export interface JotmoImageBytes {
  mediaType: JotmoImageMediaType
  bytes: number
  data: Uint8Array
}

export class JotmoPluginError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus = 400,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'JotmoPluginError'
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function maskedPhone(value: string): string | undefined {
  const phone = value.trim()
  if (phone === '') return undefined
  if (phone.length <= 7) return `${phone.slice(0, 1)}***${phone.slice(-1)}`
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function maskedEmail(value: string): string | undefined {
  const email = value.trim()
  if (email === '') return undefined
  const at = email.indexOf('@')
  if (at <= 0) return `${email.slice(0, 1)}***`
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof JotmoPluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '即我请求失败'
}

function md5Text(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
}

function isSourceKind(value: unknown): value is JotmoSourceKind {
  return value === 'default_category' || value === 'topic' || value === 'private_chat' || value === 'group_chat'
}

function textPreview(raw: Record<string, unknown>): string {
  const content = objectValue(raw.content_payload)
  const direct = stringValue(raw.text_content ?? raw.title).trim()
  if (direct !== '') return direct.slice(0, 300)
  const nested = stringValue(content.text_content ?? content.title ?? content.summary).trim()
  if (nested !== '') return nested.slice(0, 300)
  if (objectValue(content.voice).duration !== undefined) return '[语音]'
  if (listValue(content.media_refs).length > 0 || listValue(raw.media_display_items).length > 0) return '[图片]'
  if (Object.keys(objectValue(content.structured_anchor)).length > 0) return '[卡片]'
  return ''
}

function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function trustedSignedImageUrl(environment: JotmoEnvironment, raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch (error) {
    throw new JotmoPluginError('image-ref-invalid', '即我头像授权地址无效', false, 400, { cause: error })
  }
  const signature = parsed.searchParams.get('x-oss-signature')?.trim() ?? ''
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
    || !allowedSignedImageHost(environment, parsed.hostname) || parsed.pathname.replace(/^\/+/, '') === ''
    || signature === '') {
    throw new JotmoPluginError('image-sign-target-rejected', '即我头像授权目标不受信任', false, 502)
  }
  return parsed
}

function imageFileIdFromRef(imageRef: string, userId: number): string {
  const normalized = imageRef.trim()
  if (normalized === '' || normalized.startsWith('phone_avatar://')) {
    throw new JotmoPluginError('image-ref-invalid', '即我头像引用无效', false)
  }
  let candidate = normalized
  if (/^https?:\/\//i.test(candidate)) {
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch (error) {
      throw new JotmoPluginError('image-ref-invalid', '即我头像引用无效', false, 400, { cause: error })
    }
    if (parsed.protocol !== 'https:') {
      throw new JotmoPluginError('image-ref-invalid', '即我头像引用必须使用安全连接', false)
    }
    candidate = parsed.pathname
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(candidate)
  } catch (error) {
    throw new JotmoPluginError('image-ref-invalid', '即我头像引用无效', false, 400, { cause: error })
  }
  const pathMatch = decoded.match(/(?:^|\/)([a-f0-9]{32})\/(\d+)\/([^/]+)$/i)
  const fileId = (pathMatch?.[3] ?? decoded).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(fileId) || fileId.includes('..')) {
    throw new JotmoPluginError('image-ref-invalid', '即我头像引用无效', false)
  }
  const ownerMatch = /^(\d+)(?:_|$)/.exec(fileId)
  const ownerId = ownerMatch === null ? 0 : Number(ownerMatch[1])
  if (!Number.isSafeInteger(ownerId) || ownerId !== userId) {
    throw new JotmoPluginError('image-owner-mismatch', '头像不属于当前登录的即我账号', false, 403)
  }
  if (pathMatch !== null && (Number(pathMatch[2]) !== userId || pathMatch[1]?.toLowerCase() !== md5Text(String(userId)))) {
    throw new JotmoPluginError('image-owner-mismatch', '头像路径与当前即我账号不匹配', false, 403)
  }
  return fileId
}

function imageMediaType(data: Uint8Array): JotmoImageMediaType | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const prefix = Buffer.from(data.subarray(0, 6)).toString('ascii')
  if (prefix === 'GIF87a' || prefix === 'GIF89a') return 'image/gif'
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

function allowedSignedImageHost(environment: JotmoEnvironment, hostname: string): boolean {
  const allowed = environment === 'prod'
    ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc']
    : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me']
  return allowed.includes(hostname.toLowerCase())
}

export class JotmoService {
  private readonly attempts = new Map<string, LoginAttempt>()
  private refreshInFlight: Promise<JotmoSessionCredentials> | undefined

  constructor(
    private readonly config: JotmoServiceConfig,
    private readonly sessionStore: SessionStore,
    private readonly stateStore: StateStore,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async authStatus(): Promise<JotmoAuthSnapshot> {
    const session = await this.sessionStore.read()
    return session === undefined
      ? { status: 'logged-out', environment: this.config.environment }
      : {
          status: 'authenticated',
          environment: this.config.environment,
          userId: session.userId,
        }
  }

  clientConfig(): JotmoClientConfig {
    return { captchaId: this.config.geetestCaptchaId }
  }

  providerCapabilities(): JotmoProviderCapabilities {
    return {
      contractVersion: JOTMO_PROVIDER_CONTRACT_VERSION,
      provider: '@senguoyun/dsh-arkme',
      sdk: '@senguoyun/dsh-arkme/sdk',
      environment: this.config.environment,
      features: {
        authStatus: true,
        cachedSnapshot: true,
        remoteRefresh: true,
        search: true,
        createText: true,
        retryOutbox: true,
        revisionPolling: true,
        userProfile: true,
        imageRead: true,
        sourceDirectory: true,
        sourceTimeline: true,
        sourceTextSend: true,
        ...(this.relatedRecordingsEnabled() ? { relatedRecordings: true as const } : {}),
      },
      limits: {
        maxTextLength: this.config.maxTextLength,
        maxSearchResults: 30,
        maxSyncPages: 20,
        maxImageBytes: MAX_JOTMO_IMAGE_BYTES,
        ...(this.relatedRecordingsEnabled() ? {
          maxRelatedRecordingPageSize: MAX_JOTMO_RELATED_RECORDING_PAGE_SIZE,
          maxRelatedRecordingCursorLength: MAX_JOTMO_RELATED_RECORDING_CURSOR_LENGTH,
        } : {}),
      },
    }
  }

  async providerState(): Promise<JotmoProviderState> {
    const auth = await this.authStatus()
    return {
      contractVersion: JOTMO_PROVIDER_CONTRACT_VERSION,
      environment: this.config.environment,
      authStatus: auth.status,
      ...(auth.userId === undefined ? {} : { userId: auth.userId }),
      revision: auth.userId === undefined ? 0 : await this.stateStore.revision(auth.userId),
    }
  }

  async cachedProfile(): Promise<JotmoUserProfileSnapshot> {
    const session = await this.requireSession()
    return await this.stateStore.cachedProfile(session.userId)
  }

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async recordingCalendar(
    fromStamp: number,
    toStamp: number,
    signal?: AbortSignal,
  ): Promise<JotmoRecordingCalendarMonth> {
    const from = Math.trunc(fromStamp)
    const to = Math.trunc(toStamp)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from
      || to - from > 33 * 24 * 60 * 60 * 1000) {
      throw new JotmoPluginError('recording-range-invalid', '录音日历范围无效', false)
    }
    const session = await this.requireSession()
    const data = await this.authenticatedAudioPost<Record<string, unknown>>(
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

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async recordingTranscript(
    dateStamp: number,
    signal?: AbortSignal,
  ): Promise<JotmoRecordingTranscriptSection> {
    const dayStart = this.recordingDayStart(dateStamp)
    const date = dayStart.getTime()
    const session = await this.requireSession()
    const [transcriptResult, speakerResult] = await Promise.allSettled([
      this.authenticatedAudioPost<Record<string, unknown>>(
        '/api/v1/audio/one-day-trans-v2',
        { start_at: date, tz_offset: -dayStart.getTimezoneOffset() * 60_000 },
        session,
        signal,
      ),
      this.authenticatedAudioPost<Record<string, unknown>>(
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
    const items = projectRecordingTranscripts(transcriptResult.value, speakerData)
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
    kind: JotmoRecordingProjectionKind,
    signal?: AbortSignal,
  ): Promise<JotmoRecordingVersionSection> {
    const dayStart = this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const session = await this.requireSession()
    const data = await this.authenticatedAudioPost<Record<string, unknown>>(
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

  async sealRecordingCursor(payload: JotmoRecordingCursorPayload): Promise<string> {
    const session = await this.requireSession()
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', await this.recordingCursorKey(session.userId))
      .update(encoded)
      .digest('base64url')
    return `jotmo-recording-cursor-v1.${encoded}.${signature}`
  }

  async openRecordingCursor(cursor: string): Promise<JotmoRecordingCursorPayload> {
    const session = await this.requireSession()
    const [prefix, encoded, suppliedText, ...extra] = cursor.trim().split('.')
    if (prefix !== 'jotmo-recording-cursor-v1' || encoded === undefined
      || suppliedText === undefined || extra.length > 0) {
      throw new JotmoPluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    const supplied = Buffer.from(suppliedText, 'base64url')
    const expected = createHmac('sha256', await this.recordingCursorKey(session.userId))
      .update(encoded)
      .digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new JotmoPluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    let raw: Record<string, unknown>
    try {
      raw = objectValue(decodeOpaqueJson(encoded))
    } catch (error) {
      throw new JotmoPluginError(
        'recording-cursor-invalid',
        '录音分页游标无效',
        false,
        400,
        { cause: error },
      )
    }
    const content = raw.content
    const payload: JotmoRecordingCursorPayload = {
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
      throw new JotmoPluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    return payload
  }

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async recordingDay(dateStamp: number): Promise<JotmoRecordingDay> {
    const date = this.recordingDayStart(dateStamp).getTime()
    const [transcriptResult, summaryResult, timelineResult] = await Promise.allSettled([
      this.recordingTranscript(date),
      this.recordingProjection(date, 'summary'),
      this.recordingProjection(date, 'timeline'),
    ])
    const transcript: JotmoRecordingDay['transcript'] = transcriptResult.status === 'fulfilled'
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

  async refreshProfile(): Promise<JotmoUserProfileSnapshot> {
    const session = await this.requireSession()
    const data = await this.authenticatedAuthGet<Record<string, unknown>>('/api/v1/auth/get-user-info', session)
    const userId = numberValue(data.user_id)
    if (userId <= 0 || userId !== session.userId) {
      throw new JotmoPluginError('profile-contract-invalid', '即我个人资料响应缺少有效用户标识', false, 502)
    }
    const nickname = stringValue(data.nick_name).trim()
    const displayName = nickname
      || stringValue(data.apple_nick_name).trim()
      || stringValue(data.wechat_nick_name).trim()
      || stringValue(data.google_given_name).trim()
      || stringValue(data.name_slug).trim()
      || '即我用户'
    const avatarRef = stringValue(data.head_img).trim()
    const phone = maskedPhone(stringValue(data.phone))
    const email = maskedEmail(stringValue(data.email))
    const profile: JotmoUserProfile = {
      userId,
      displayName,
      nickname,
      avatarRef,
      ...(/^https?:\/\//i.test(avatarRef) ? { avatarUrl: avatarRef } : {}),
      jotmoId: stringValue(data.name_slug).trim(),
      accountType: numberValue(data.type),
      createdAt: numberValue(data.create_at),
      bindings: {
        apple: booleanValue(data.has_bind_apple),
        wechat: booleanValue(data.has_bind_wechat),
        google: booleanValue(data.has_bind_google),
      },
      contact: {
        ...(phone === undefined ? {} : { phoneMasked: phone }),
        ...(email === undefined ? {} : { emailMasked: email }),
      },
    }
    return await this.stateStore.cacheProfile(userId, profile)
  }

  async listSources(
    directory: JotmoSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<JotmoSourceList> {
    const session = await this.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    if (directory === 'send_to_self') {
      if (options.cursor !== undefined && options.cursor.trim() !== '') {
        throw new JotmoPluginError('source-cursor-invalid', '发给自己的主题目录不支持该分页游标', false)
      }
      const data = await this.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/display/list',
        { limit: Math.min(100, Math.max(1, limit)) },
        session,
      )
      const defaultCategory: JotmoSourceItem = {
        sourceRef: await this.sealSourceRef(session.userId, 'default_category', 'uncategorized', '默认分类'),
        kind: 'default_category',
        displayName: '默认分类',
        activeAtMillis: 0,
        unreadCount: 0,
      }
      const topics: JotmoSourceItem[] = []
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const core = objectValue(item.topic_core)
        const summary = objectValue(item.summary)
        const latest = objectValue(item.latest_record_core)
        const topicUid = stringValue(core.topic_uid).trim()
        const title = stringValue(core.title).trim()
        if (topicUid === '' || title === '') continue
        topics.push({
          sourceRef: await this.sealSourceRef(session.userId, 'topic', topicUid, title),
          kind: 'topic',
          displayName: title,
          ...(textPreview(latest) === '' ? {} : { latestPreview: textPreview(latest) }),
          activeAtMillis: numberValue(latest.send_at ?? summary.latest_send_at ?? core.update_at),
          unreadCount: 0,
          recordCount: numberValue(summary.record_count),
        })
      }
      return { directory, items: [defaultCategory, ...topics], hasMore: false }
    }
    if (directory !== 'root') throw new JotmoPluginError('source-directory-invalid', '即我数据源目录无效', false)
    const pageCursor = options.cursor === undefined || options.cursor.trim() === ''
      ? undefined
      : this.decodeCursor(options.cursor)
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/list',
      { limit, ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }) },
      session,
    )
    const items: JotmoSourceItem[] = []
    const privateUserIdByIndex = new Map<number, number>()
    const groupSessionUidByIndex = new Map<number, string>()
    for (const raw of listValue(data.items)) {
      const bundle = objectValue(raw)
      const chatSession = objectValue(bundle.session)
      const counterpart = objectValue(bundle.private_counterpart)
      const supplement = objectValue(bundle.private_supplement)
      const latestPreview = objectValue(bundle.latest_preview)
      const latestRecord = objectValue(latestPreview.record)
      const latestPayload = objectValue(latestRecord.payload)
      const unread = objectValue(bundle.unread_snapshot)
      const uid = stringValue(chatSession.chat_session_uid).trim()
      const sessionKind = numberValue(chatSession.session_kind)
      const kind: JotmoSourceKind | undefined = sessionKind === 2
        ? 'group_chat'
        : sessionKind === 1 || sessionKind === 3 ? 'private_chat' : undefined
      if (uid === '' || kind === undefined) continue
      const displayName = (kind === 'private_chat'
        ? stringValue(
          supplement.remark ?? supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot
          ?? supplement.pending_name ?? counterpart.visible_phone,
        )
        : stringValue(chatSession.title)).trim() || '未命名会话'
      const preview = textPreview(latestPayload)
      const item: JotmoSourceItem = {
        sourceRef: await this.sealSourceRef(session.userId, kind, uid, displayName),
        kind,
        displayName,
        ...(preview === '' ? {} : { latestPreview: preview }),
        activeAtMillis: numberValue(bundle.sort_active_at ?? chatSession.last_active_at),
        unreadCount: numberValue(unread.unread_count),
      }
      const itemIndex = items.push(item) - 1
      if (kind === 'private_chat') {
        const counterpartUserId = numberValue(counterpart.user_id)
        if (Number.isSafeInteger(counterpartUserId) && counterpartUserId > 0) {
          privateUserIdByIndex.set(itemIndex, counterpartUserId)
        }
      } else {
        groupSessionUidByIndex.set(itemIndex, uid)
      }
    }
    try {
      await this.hydrateSourceAvatars(
        items, privateUserIdByIndex, groupSessionUidByIndex, session, options.signal,
      )
    } catch {
      // Avatar decoration is best-effort; chat source identity and navigation remain usable.
    }
    const hasMore = data.has_more === true
    const nextPageCursor = objectValue(data.next_page_cursor)
    return {
      directory,
      items,
      hasMore,
      ...(hasMore && Object.keys(nextPageCursor).length > 0
        ? { nextCursor: this.encodeCursor(nextPageCursor) }
        : {}),
    }
  }

  async readSource(
    sourceRef: string,
    options: { limit?: number; cursor?: JotmoTimelineCursor; signal?: AbortSignal } = {},
  ): Promise<JotmoTimelinePage> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 30)))
    if (source.kind === 'default_category') {
      const page = await this.list(limit, options.cursor?.sendAtMillis !== undefined && options.cursor.itemUid !== undefined
        ? { sendAtMillis: options.cursor.sendAtMillis, recordUid: options.cursor.itemUid }
        : undefined)
      return {
        source: await this.sourceItem(source),
        items: page.items.map(item => this.recordTimelineItem(item)),
        hasMore: page.hasMore,
        ...(page.nextCursor === undefined ? {} : {
          nextCursor: { sendAtMillis: page.nextCursor.sendAtMillis, itemUid: page.nextCursor.recordUid },
        }),
      }
    }
    if (source.kind === 'topic') {
      const data = await this.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/display/detail',
        {
          topic_uid: source.ownerRef,
          limit,
          ...(options.cursor?.sendAtMillis === undefined ? {} : { cursor_send_at: options.cursor.sendAtMillis }),
          ...(options.cursor?.itemUid === undefined ? {} : { cursor_record_uid: options.cursor.itemUid }),
        },
        session,
      )
      const records = listValue(data.records).map(raw => this.recordTimelineItemFromRaw(raw, session.userId))
      const nextSendAt = numberValue(data.next_cursor_send_at)
      const nextUid = stringValue(data.next_cursor_record_uid).trim()
      return {
        source: await this.sourceItem(source),
        items: records,
        hasMore: data.has_more === true,
        ...(nextSendAt > 0 && nextUid !== '' ? { nextCursor: { sendAtMillis: nextSendAt, itemUid: nextUid } } : {}),
      }
    }
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chat/timeline/page',
      {
        chat_session_uid: source.ownerRef,
        before_seq: Math.max(0, Math.trunc(options.cursor?.beforeSequence ?? 0)),
        limit,
      },
      session,
      options.signal,
    )
    const items: JotmoTimelineItem[] = []
    const senderUserIdByIndex = new Map<number, number>()
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const relation = objectValue(item.relation)
      const record = objectValue(item.record)
      const payload = objectValue(record.payload)
      const uid = stringValue(relation.record_uid ?? payload.record_uid).trim()
      if (uid === '') continue
      const senderUserId = numberValue(relation.sender_user_id)
      const itemIndex = items.push({
        itemUid: uid,
        senderName: stringValue(relation.display_name_snapshot).trim() || '即我用户',
        isMe: senderUserId === session.userId,
        sendAtMillis: numberValue(relation.attach_at ?? payload.send_at),
        title: stringValue(payload.title),
        textContent: stringValue(payload.text_content),
        status: numberValue(record.status),
        sequence: numberValue(relation.seq),
      }) - 1
      if (Number.isSafeInteger(senderUserId) && senderUserId > 0) senderUserIdByIndex.set(itemIndex, senderUserId)
    }
    try {
      const profiles = await this.publicProfilesByUserIds(
        [...new Set(senderUserIdByIndex.values())], session, options.signal,
      )
      for (const [index, senderUserId] of senderUserIdByIndex) {
        if (!profiles.has(senderUserId) || items[index] === undefined) continue
        items[index].avatarRef = await this.sealProfileImageRef(session.userId, senderUserId)
      }
    } catch {
      // Sender avatars are presentation decoration; timeline content remains readable without them.
    }
    const beforeSequence = numberValue(data.next_before_seq)
    return {
      source: await this.sourceItem(source),
      items,
      hasMore: data.has_more === true,
      ...(beforeSequence > 0 ? { nextCursor: { beforeSequence } } : {}),
    }
  }

  async sendSourceText(
    sourceRef: string,
    textContent: string,
    options: { recordUid?: string; relationUid?: string } = {},
  ): Promise<JotmoSourceSendResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    const text = textContent.trim()
    if (text === '' || text.length > this.config.maxTextLength) {
      throw new JotmoPluginError('source-text-invalid', '发送内容为空或超过长度限制', false)
    }
    const recordUid = options.recordUid?.trim() || crypto.randomUUID()
    if (source.kind === 'default_category') {
      const result = await this.createTextForConversation(recordUid, text)
      return {
        sourceRef,
        itemUid: result.recordUid,
        status: result.status,
        localState: result.localState,
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    }
    if (source.kind === 'topic') {
      const result = await this.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/records/create',
        { topic_uid: source.ownerRef, record_uid: recordUid, template_kind: 1, title: '', text_content: text, send_at: Date.now() },
        session,
      )
      return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
    }
    const relationUid = options.relationUid?.trim() || crypto.randomUUID()
    const result = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/send',
      {
        chat_session_uid: source.ownerRef,
        record_uid: recordUid,
        rel_uid: relationUid,
        template_kind: 1,
        text_content: text,
        send_at: Date.now(),
      },
      session,
    )
    return {
      sourceRef,
      itemUid: stringValue(result.record_uid).trim() || recordUid,
      status: numberValue(result.audit_status),
      sequence: numberValue(result.seq),
      localState: 'synced',
    }
  }

  async relatedRecordingEligibility(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<JotmoRelatedRecordingEligibility> {
    const startedAt = Date.now()
    try {
      const session = await this.requireSession()
      await this.requirePrivateSource(sourceRef, session.userId)
      const allowed = this.relatedRecordingsEnabled()
        && await this.loadRelatedRecordingEligibility(session, signal)
      this.emitRelatedRecordingEvent({
        operation: 'related-recordings-eligibility',
        result: allowed ? 'allowed' : 'denied',
        durationMs: Date.now() - startedAt,
      })
      return { allowed }
    } catch (error) {
      this.emitRelatedRecordingEvent({
        operation: 'related-recordings-eligibility',
        result: 'error',
        durationMs: Date.now() - startedAt,
        errorCode: error instanceof JotmoPluginError ? error.code : 'internal-error',
      })
      throw error
    }
  }

  async relatedRecordings(
    sourceRef: string,
    options: JotmoRelatedRecordingPageOptions = {},
  ): Promise<JotmoRelatedRecordingPage> {
    const startedAt = Date.now()
    const limit = options.limit ?? 10
    const cursor = options.cursor?.trim() ?? ''
    const monthKey = options.monthKey?.trim() ?? ''
    const timezoneOffsetMillis = options.timezoneOffsetMillis ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_JOTMO_RELATED_RECORDING_PAGE_SIZE) {
      throw new JotmoPluginError('related-recordings-limit-invalid', '相关录音每页条数必须在 1 到 20 之间', false)
    }
    if (cursor.length > MAX_JOTMO_RELATED_RECORDING_CURSOR_LENGTH) {
      throw new JotmoPluginError('related-recordings-cursor-invalid', '相关录音分页游标无效', false)
    }
    if (monthKey !== '' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      throw new JotmoPluginError('related-recordings-month-invalid', '相关录音月份参数无效', false)
    }
    if (!Number.isInteger(timezoneOffsetMillis)
      || Math.abs(timezoneOffsetMillis) > MAX_JOTMO_TIMEZONE_OFFSET_MILLIS) {
      throw new JotmoPluginError('related-recordings-timezone-invalid', '相关录音时区参数无效', false)
    }
    try {
      const session = await this.requireSession()
      const source = await this.requirePrivateSource(sourceRef, session.userId)
      if (!this.relatedRecordingsEnabled() || !await this.loadRelatedRecordingEligibility(session, options.signal)) {
        throw new JotmoPluginError('related-recordings-not-allowed', '当前账号暂未开放相关录音能力', false, 403)
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
          raw = await this.authenticatedChatPost<Record<string, unknown>>(
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
          const safeLegacyProbe = error instanceof JotmoPluginError
            && error.code === 'jotmo-code-1001'
            && cursor === ''
            && monthKey === ''
            && options.includeTimeIndex === true
          if (!safeLegacyProbe) throw error
          raw = await this.authenticatedChatPost<Record<string, unknown>>(
            '/api/v1/chats/records/related-recordings/page',
            legacyBody,
            session,
            options.signal,
          )
          legacyTimeIndexFallback = true
          this.emitRelatedRecordingEvent({
            operation: 'related-recordings-page',
            result: 'legacy-fallback',
            durationMs: Date.now() - startedAt,
            cursorPresent: false,
            consumer: options.consumer ?? 'ui',
          })
        }
      } else {
        raw = await this.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/records/related-recordings/page',
          legacyBody,
          session,
          options.signal,
        )
      }
      const page = this.relatedRecordingPage(raw, legacyTimeIndexFallback)
      this.emitRelatedRecordingEvent({
        operation: 'related-recordings-page',
        result: 'success',
        durationMs: Date.now() - startedAt,
        itemCount: page.items.length,
        cursorPresent: cursor !== '',
        partial: page.partial,
        consumer: options.consumer ?? 'ui',
      })
      return page
    } catch (error) {
      this.emitRelatedRecordingEvent({
        operation: 'related-recordings-page',
        result: 'error',
        durationMs: Date.now() - startedAt,
        cursorPresent: cursor !== '',
        consumer: options.consumer ?? 'ui',
        errorCode: error instanceof JotmoPluginError ? error.code : 'internal-error',
      })
      throw error
    }
  }

  private relatedRecordingsEnabled(): boolean {
    return this.config.relatedRecordingsEnabled !== false
  }

  private emitRelatedRecordingEvent(_event: JotmoServiceEvent): void {
    // Diagnostics remain best-effort; the current Jotmo service has no external event sink.
  }

  recordRelatedRecordingsToolEvent(event: {
    result: 'success' | 'error'
    durationMs: number
    itemCount?: number
    cursorPresent?: boolean
    transcriptRequested?: boolean
    transcriptTruncated?: boolean
  }): void {
    this.emitRelatedRecordingEvent({
      operation: 'related-recordings-tool',
      consumer: 'tool',
      ...event,
    })
  }

  private async requirePrivateSource(sourceRef: string, userId: number): Promise<JotmoSourceRefPayload> {
    const source = await this.openSourceRef(sourceRef, userId)
    if (source.kind !== 'private_chat') {
      throw new JotmoPluginError('related-recordings-private-source-required', '相关录音仅支持一对一私聊', false, 400)
    }
    return source
  }

  private async loadRelatedRecordingEligibility(
    session: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const data = await this.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/able-func',
      { func_type: RELATED_RECORDINGS_FUNC_TYPE },
      session,
      signal,
    )
    return data.able === true
  }

  private relatedRecordingPage(
    raw: Record<string, unknown>,
    legacyTimeIndexFallback: boolean,
  ): JotmoRelatedRecordingPage {
    const items = listValue(raw.moment_ls).flatMap(item => {
      const normalized = this.relatedRecordingItem(item)
      return normalized === undefined ? [] : [normalized]
    })
    const partial = raw.partial === true
    const stateCode = numberValue(raw.state)
    const state: JotmoRelatedRecordingPageState = partial
      ? items.length > 0 ? 'partial' : 'error'
      : items.length > 0 ? 'success'
        : stateCode === 2 ? 'generating'
          : stateCode === 4 ? 'error'
            : 'empty'
    const nextCursor = stringValue(raw.next_cursor).trim()
    const timeIndexComplete = raw.time_index_complete === true && !legacyTimeIndexFallback
    const monthBuckets: JotmoRelatedRecordingMonthBucket[] = timeIndexComplete
      ? listValue(raw.month_bucket_ls).flatMap(value => {
          const bucket = objectValue(value)
          const key = stringValue(bucket.month_key).trim()
          const itemCount = numberValue(bucket.item_count)
          return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) && Number.isInteger(itemCount) && itemCount >= 0
            ? [{ monthKey: key, itemCount }]
            : []
        })
      : []
    return {
      state,
      stateCode,
      stateMessage: stringValue(raw.state_msg).trim(),
      hasEntry: raw.has_entry === true,
      items,
      hasMore: raw.has_more === true && nextCursor !== '',
      ...(raw.has_more === true && nextCursor !== '' ? { nextCursor } : {}),
      partial,
      ...(timeIndexComplete ? { monthBuckets } : {}),
      timeIndexComplete,
      legacyTimeIndexFallback,
    }
  }

  private relatedRecordingItem(raw: unknown): JotmoRelatedRecordingItem | undefined {
    const item = objectValue(raw)
    const momentId = stringValue(item.moment_id).trim()
    const sessionId = stringValue(item.session_id).trim()
    const startAtMillis = numberValue(item.start_at)
    if (momentId === '' || sessionId === '' || !Number.isSafeInteger(startAtMillis) || startAtMillis <= 0) return undefined
    const summaryId = stringValue(item.summary_id).trim()
    const originalName = stringValue(item.orig_name).trim()
    const transcript = stringValue(item.transcript)
    const speakers = listValue(item.speaker_ls).flatMap(value => {
      const speaker = objectValue(value)
      const speakerId = stringValue(speaker.speaker_id).trim()
      if (speakerId === '') return []
      const refUserId = numberValue(speaker.ref_usr_id)
      const nickname = stringValue(speaker.nick_name).trim()
      return [{
        speakerId,
        ...(Number.isSafeInteger(refUserId) && refUserId > 0 ? { refUserId } : {}),
        ...(nickname === '' ? {} : { nickname }),
      }]
    })
    const participants = listValue(item.participant_ls).flatMap(value => {
      const participant = objectValue(value)
      const speakerId = stringValue(participant.speaker_id).trim()
      const nickname = stringValue(participant.nick_name).trim()
      const displayName = stringValue(participant.display_name).trim() || nickname
      if (speakerId === '' || displayName === '') return []
      const refUserId = numberValue(participant.ref_usr_id)
      return [{
        speakerId,
        ...(Number.isSafeInteger(refUserId) && refUserId > 0 ? { refUserId } : {}),
        ...(nickname === '' ? {} : { nickname }),
        displayName,
        role: numberValue(participant.role),
      }]
    })
    const dateStamp = numberValue(item.date_stamp)
    const timezoneOffsetMillis = numberValue(item.tz_offset)
    return {
      recordingRef: momentId,
      momentId,
      sessionId,
      ...(summaryId === '' ? {} : { summaryId }),
      ...(originalName === '' ? {} : { originalName }),
      startAtMillis,
      endAtMillis: numberValue(item.end_at),
      ...(Number.isSafeInteger(dateStamp) && dateStamp > 0 ? { dateStamp } : {}),
      ...(Number.isSafeInteger(timezoneOffsetMillis) ? { timezoneOffsetMillis } : {}),
      timeRangeText: stringValue(item.time_range_text).trim(),
      title: stringValue(item.title).trim(),
      summary: stringValue(item.summary).trim(),
      summaryStatus: numberValue(item.summary_status),
      ...(transcript === '' ? {} : { transcript }),
      transcriptAvailable: item.transcript_available === true && transcript !== '',
      speakers,
      participants,
      isSharedByOther: item.is_shared_by_other === true,
    }
  }


  private async hydrateSourceAvatars(
    items: JotmoSourceItem[],
    privateUserIdByIndex: ReadonlyMap<number, number>,
    groupSessionUidByIndex: ReadonlyMap<number, string>,
    session: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<void> {
    const groupMemberIdsByIndex = new Map<number, number[]>()
    const indexByGroupUid = new Map([...groupSessionUidByIndex].map(([index, uid]) => [uid, index]))
    for (const groupUids of chunksOf([...indexByGroupUid.keys()], 10)) {
      let data: Record<string, unknown>
      try {
        data = await this.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/group-avatar-snapshots',
          { chat_session_uids: groupUids },
          session,
          signal,
        )
      } catch {
        continue
      }
      for (const raw of listValue(data.items)) {
        const snapshot = objectValue(raw)
        const index = indexByGroupUid.get(stringValue(snapshot.chat_session_uid).trim())
        if (index === undefined) continue
        const memberIds = listValue(snapshot.members)
          .map(member => numberValue(objectValue(member).user_id))
          .filter(userId => Number.isSafeInteger(userId) && userId > 0)
          .slice(0, 4)
        if (memberIds.length > 0) groupMemberIdsByIndex.set(index, memberIds)
      }
    }

    const targetUserIds = new Set<number>(privateUserIdByIndex.values())
    for (const memberIds of groupMemberIdsByIndex.values()) {
      for (const userId of memberIds) targetUserIds.add(userId)
    }
    const profiles = await this.publicProfilesByUserIds([...targetUserIds], session, signal)
    for (const [index, targetUserId] of privateUserIdByIndex) {
      if (!profiles.has(targetUserId) || items[index] === undefined) continue
      items[index].avatarRef = await this.sealProfileImageRef(session.userId, targetUserId)
    }
    for (const [index, memberIds] of groupMemberIdsByIndex) {
      const visibleIds = memberIds.filter(userId => profiles.has(userId))
      if (visibleIds.length === 0 || items[index] === undefined) continue
      items[index].avatarRefs = await Promise.all(
        visibleIds.map(userId => this.sealProfileImageRef(session.userId, userId)),
      )
    }
  }

  private async publicProfilesByUserIds(
    userIds: readonly number[],
    session: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, JotmoPublicProfile>> {
    const normalized = [...new Set(userIds.filter(userId => Number.isSafeInteger(userId) && userId > 0))]
    const profiles = new Map<number, JotmoPublicProfile>()
    for (const batch of chunksOf(normalized, 100)) {
      if (batch.length === 0) continue
      const data = await this.authenticatedAuthPost<Record<string, unknown>>(
        '/api/v1/auth/get-public-users-by-ids',
        { user_ids: batch },
        session,
        signal,
      )
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const userId = numberValue(item.user_id)
        const avatarUrl = stringValue(item.head_img).trim()
        if (!batch.includes(userId) || avatarUrl === '') continue
        try { trustedSignedImageUrl(this.config.environment, avatarUrl) }
        catch { continue }
        profiles.set(userId, {
          userId,
          displayName: stringValue(item.nick_name).trim(),
          avatarUrl,
        })
      }
    }
    return profiles
  }

  private async sealProfileImageRef(viewerUserId: number, targetUserId: number): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, viewerUserId, targetUserId } satisfies JotmoProfileImageRefPayload)
    const signature = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `jotmo-profile-image-v1.${payload}.${signature}`
  }

  private async openProfileImageRef(
    imageRef: string,
    expectedViewerUserId: number,
  ): Promise<JotmoProfileImageRefPayload> {
    const parts = imageRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'jotmo-profile-image-v1') {
      throw new JotmoPluginError('image-ref-invalid', '即我头像引用无效', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new JotmoPluginError('image-ref-invalid', '即我头像引用无效', false)
    }
    let parsed: Record<string, unknown>
    try { parsed = objectValue(decodeOpaqueJson(payload)) }
    catch (error) {
      throw new JotmoPluginError('image-ref-invalid', '即我头像引用无效', false, 400, { cause: error })
    }
    const result: JotmoProfileImageRefPayload = {
      version: 1,
      viewerUserId: numberValue(parsed.viewerUserId),
      targetUserId: numberValue(parsed.targetUserId),
    }
    if (parsed.version !== 1 || result.viewerUserId !== expectedViewerUserId
      || !Number.isSafeInteger(result.targetUserId) || result.targetUserId <= 0) {
      throw new JotmoPluginError('image-ref-invalid', '即我头像引用与当前账号不匹配', false, 403)
    }
    return result
  }

  /** Resolve and download one Provider-authorized Jiwo image without exposing OSS credentials or signed URLs. */
  async readImage(
    imageRef: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<JotmoImageBytes> {
    const session = await this.requireSession()
    const byteLimit = Math.min(MAX_JOTMO_IMAGE_BYTES, Math.max(1, Math.trunc(options.maxBytes ?? MAX_JOTMO_IMAGE_BYTES)))
    if (imageRef.trim().startsWith('jotmo-profile-image-v1.')) {
      const reference = await this.openProfileImageRef(imageRef, session.userId)
      const profile = (await this.publicProfilesByUserIds([reference.targetUserId], session, options.signal))
        .get(reference.targetUserId)
      if (profile === undefined) {
        throw new JotmoPluginError('image-ref-unavailable', '即我头像当前不可用', true, 404)
      }
      return await this.downloadSignedImage(
        trustedSignedImageUrl(this.config.environment, profile.avatarUrl), byteLimit, options.signal,
      )
    }
    const fileId = imageFileIdFromRef(imageRef, session.userId)
    const objectPath = `${md5Text(String(session.userId))}/${String(session.userId)}/${fileId}`
    const credentials = await this.ossCredentials(session, options.signal)
    const bucket = this.config.environment === 'prod' ? 'jotmo-userfiles' : 'jotmo-userfiles-test'
    let signedUrlText: string
    try {
      const client = new OSS({
        region: 'oss-cn-hangzhou',
        bucket,
        secure: true,
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        stsToken: credentials.stsToken,
        refreshSTSTokenInterval: 10 * 60 * 1000,
        refreshSTSToken: async () => {
          const refreshed = await this.ossCredentials(await this.requireSession(), options.signal)
          return {
            accessKeyId: refreshed.accessKeyId,
            accessKeySecret: refreshed.accessKeySecret,
            stsToken: refreshed.stsToken,
          }
        },
      })
      signedUrlText = client.signatureUrl(objectPath, {
        method: 'GET',
        expires: 120,
        process: 'image/resize,w_512',
      })
    } catch (error) {
      throw new JotmoPluginError('image-sign-failed', '即我图片授权签名失败', true, 502, { cause: error })
    }
    let signedUrl: URL
    try {
      signedUrl = new URL(signedUrlText)
    } catch (error) {
      throw new JotmoPluginError('image-sign-contract-invalid', '即我图片授权响应无效', true, 502, { cause: error })
    }
    let signedPath: string
    try {
      signedPath = decodeURIComponent(signedUrl.pathname).replace(/^\/+/, '')
    } catch (error) {
      throw new JotmoPluginError('image-sign-contract-invalid', '即我图片授权路径无效', true, 502, { cause: error })
    }
    if (signedUrl.protocol !== 'https:' || signedUrl.username !== '' || signedUrl.password !== ''
      || !allowedSignedImageHost(this.config.environment, signedUrl.hostname) || signedPath !== objectPath) {
      throw new JotmoPluginError('image-sign-target-rejected', '即我图片授权目标不受信任', false, 502)
    }
    return await this.downloadSignedImage(signedUrl, byteLimit, options.signal)
  }

  async beginWechatLogin(): Promise<JotmoAuthSnapshot> {
    const data = await this.post<QrResponse>(
      this.config.authBaseUrl,
      '/api/public/v1/auth/wechat-login-qrcode',
      {},
      undefined,
      [200],
    )
    const sceneStr = stringValue(data.scene_str).trim()
    const qrContent = stringValue(data.url).trim()
    const expireSeconds = Math.max(30, numberValue(data.expire_seconds) || 300)
    if (qrContent === '' && sceneStr !== '') {
      throw new JotmoPluginError(
        'wechat-qr-unavailable',
        '测试环境当前未返回可用微信二维码，请使用手机号登录',
        true,
        503,
      )
    }
    if (sceneStr === '' || qrContent === '') {
      throw new JotmoPluginError('login-contract-invalid', '即我登录二维码响应不完整', true, 502)
    }
    const attemptId = crypto.randomUUID()
    const attempt: LoginAttempt = {
      attemptId,
      sceneStr,
      qrContent,
      expiresAtMillis: Date.now() + expireSeconds * 1000,
    }
    this.attempts.clear()
    this.attempts.set(attemptId, attempt)
    return {
      status: 'pending',
      environment: this.config.environment,
      attemptId,
      qrContent,
      expiresAtMillis: attempt.expiresAtMillis,
    }
  }

  async pollWechatLogin(attemptId: string): Promise<JotmoAuthSnapshot> {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) {
      throw new JotmoPluginError('login-attempt-not-found', '登录二维码已失效，请重新获取', false, 404)
    }
    if (Date.now() >= attempt.expiresAtMillis) {
      this.attempts.delete(attemptId)
      return { status: 'expired', environment: this.config.environment }
    }
    const data = await this.post<ScanResponse>(
      this.config.authBaseUrl,
      '/api/public/v1/auth/wechat-scan-login',
      {
        scene_str: attempt.sceneStr,
        unique_code: await this.stateStore.uniqueCode(),
        ref: 0,
        keep_cancel: true,
      },
      undefined,
      [200],
    )
    const userId = numberValue(data.user_id)
    if (userId <= 0) {
      return {
        status: 'pending',
        environment: this.config.environment,
        attemptId,
        qrContent: attempt.qrContent,
        expiresAtMillis: attempt.expiresAtMillis,
      }
    }
    const accessToken = stringValue(data.access_token)
    const refreshToken = stringValue(data.refresh_token)
    if (accessToken === '' || refreshToken === '') {
      throw new JotmoPluginError('login-contract-invalid', '即我登录成功响应缺少凭据', false, 502)
    }
    await this.sessionStore.write({ accessToken, refreshToken, userId })
    this.attempts.delete(attemptId)
    return {
      status: 'authenticated',
      environment: this.config.environment,
      userId,
    }
  }

  async sendPhoneCode(phone: string, captcha: JotmoCaptchaResult): Promise<{ sent: true }> {
    const normalizedPhone = this.normalizedPhone(phone)
    const normalizedCaptcha = this.normalizedCaptcha(captcha)
    await this.post<Record<string, unknown>>(
      this.config.authBaseUrl,
      '/api/public/v1/auth/phone-login-send-code',
      { phone: normalizedPhone, pre: '86', is_test: false, ...normalizedCaptcha },
      undefined,
      [200],
    )
    return { sent: true }
  }

  async verifyPhoneCode(phone: string, code: string): Promise<JotmoAuthSnapshot> {
    const normalizedPhone = this.normalizedPhone(phone)
    const normalizedCode = code.trim()
    if (!/^[0-9]{6}$/.test(normalizedCode)) {
      throw new JotmoPluginError('phone-code-invalid', '请输入有效的短信验证码', false)
    }
    const data = await this.post<PhoneLoginResponse>(
      this.config.authBaseUrl,
      '/api/public/v1/auth/verify-phone-code-login',
      {
        phone: normalizedPhone,
        pre: '86',
        code: normalizedCode,
        token: '',
        unique_code: await this.stateStore.uniqueCode(),
        ref: 0,
        keep_cancel: true,
      },
      undefined,
      [200],
    )
    if (data.ok === false) {
      throw new JotmoPluginError('phone-code-rejected', '手机号或验证码错误', false, 401)
    }
    const userId = numberValue(data.user_id)
    const accessToken = stringValue(data.access_token)
    const refreshToken = stringValue(data.refresh_token)
    if (userId <= 0 || accessToken === '' || refreshToken === '') {
      throw new JotmoPluginError('login-contract-invalid', '即我手机号登录响应不完整', false, 502)
    }
    await this.sessionStore.write({ accessToken, refreshToken, userId })
    this.attempts.clear()
    return {
      status: 'authenticated',
      environment: this.config.environment,
      userId,
    }
  }

  async logout(): Promise<JotmoAuthSnapshot> {
    await this.sessionStore.delete()
    this.attempts.clear()
    return { status: 'logged-out', environment: this.config.environment }
  }

  async cachedSnapshot(): Promise<JotmoCachedSnapshot> {
    const session = await this.requireSession()
    return await this.stateStore.cachedSnapshot(session.userId)
  }

  async queryCached(options: {
    query?: string
    limit: number
    beforeMillis?: number
  }): Promise<JotmoCachedQueryResult> {
    const session = await this.requireSession()
    return await this.stateStore.queryCached(session.userId, options)
  }

  async refreshLatest(): Promise<void> {
    await Promise.all([this.summary(), this.list(50)])
  }

  async refreshSnapshot(): Promise<JotmoCachedSnapshot> {
    await this.refreshLatest()
    return await this.cachedSnapshot()
  }

  async searchRecords(options: {
    query: string
    limit: number
    beforeMillis?: number
    syncAll?: boolean
    signal?: AbortSignal
  }): Promise<JotmoCachedQueryResult> {
    const query = options.query.trim()
    if (query === '') throw new JotmoPluginError('record-query-empty', '搜索关键词不能为空', false)
    if (options.syncAll === true) await this.syncHistory(20, options.signal)
    return await this.queryCached({
      query,
      limit: options.limit,
      ...(options.beforeMillis === undefined ? {} : { beforeMillis: options.beforeMillis }),
    })
  }

  async syncHistory(maxPages = 20, signal?: AbortSignal): Promise<{ pages: number; complete: boolean }> {
    const pageCap = Math.min(20, Math.max(1, Math.trunc(maxPages)))
    await this.refreshLatest()
    let snapshot = await this.cachedSnapshot()
    let pages = 0
    while (snapshot.hasMore && snapshot.nextCursor !== undefined && pages < pageCap) {
      if (signal?.aborted === true) throw new Error('即我历史同步已取消')
      await this.list(50, snapshot.nextCursor)
      pages += 1
      snapshot = await this.cachedSnapshot()
    }
    return { pages, complete: !snapshot.hasMore }
  }

  async summary(): Promise<JotmoSelfSummary> {
    const session = await this.requireSession()
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/uncategorized/summary',
      {},
      session,
    )
    const summary = {
      recordCount: numberValue(data.record_count),
      wordsCount: numberValue(data.words_count ?? data.available_text_rune_count),
      totalSec: numberValue(data.total_sec ?? data.available_voice_duration_sec),
    }
    await this.stateStore.cacheSummary(session.userId, summary)
    return summary
  }

  async list(limit: number, cursor?: JotmoRecordCursor): Promise<JotmoSelfRecordList> {
    const session = await this.requireSession()
    const normalizedLimit = Math.min(50, Math.max(1, Math.trunc(limit || 30)))
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/uncategorized/query',
      {
        limit: normalizedLimit,
        ...(cursor === undefined ? {} : {
          cursor_send_at: cursor.sendAtMillis,
          cursor_record_uid: cursor.recordUid,
        }),
      },
      session,
    )
    const items = listValue(data.items).map(raw => this.recordItem(raw)).filter(
      (item): item is JotmoSelfRecordItem => item !== undefined,
    )
    const nextSendAt = numberValue(data.next_cursor_send_at)
    const nextUid = stringValue(data.next_cursor_record_uid)
    const page: JotmoSelfRecordList = {
      items,
      hasMore: data.has_more === true,
      ...(nextSendAt > 0 && nextUid !== ''
        ? { nextCursor: { sendAtMillis: nextSendAt, recordUid: nextUid } }
        : {}),
    }
    await this.stateStore.cachePage(session.userId, page, cursor)
    return page
  }

  async createText(recordUid: string, textContent: string): Promise<JotmoCreateTextResult> {
    const session = await this.requireSession()
    const normalizedUid = recordUid.trim()
    const normalizedText = textContent.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUid)) {
      throw new JotmoPluginError('record-uid-invalid', '写入标识无效，请重试', false)
    }
    if (normalizedText === '') {
      throw new JotmoPluginError('record-text-empty', '请输入要发给自己的内容', false)
    }
    if (normalizedText.length > this.config.maxTextLength) {
      throw new JotmoPluginError(
        'record-text-too-long',
        `内容不能超过 ${this.config.maxTextLength} 个字符`,
        false,
      )
    }
    const now = Date.now()
    const pending: JotmoPendingWrite = {
      recordUid: normalizedUid,
      textContent: normalizedText,
      createdAtMillis: now,
      sendAtMillis: now,
      attempts: 0,
    }
    await this.stateStore.putPending(session.userId, pending)
    return await this.sendPending(session, pending)
  }

  async createTextForConversation(
    recordUid: string,
    textContent: string,
  ): Promise<JotmoConversationWriteResult> {
    try {
      const result = await this.createText(recordUid, textContent)
      return { ...result, localState: 'synced' }
    } catch (error) {
      const session = await this.requireSession()
      const pending = (await this.stateStore.listPending(session.userId))
        .find(item => item.recordUid === recordUid)
      if (pending === undefined) throw error
      return {
        recordUid,
        status: 0,
        localState: 'failed',
        error: pending.lastError ?? safeFailureMessage(error),
      }
    }
  }

  async pendingWrites(): Promise<JotmoPendingWrite[]> {
    const session = await this.requireSession()
    return await this.stateStore.listPending(session.userId)
  }

  async retryPending(recordUid: string): Promise<JotmoCreateTextResult> {
    const session = await this.requireSession()
    const pending = (await this.stateStore.listPending(session.userId))
      .find(item => item.recordUid === recordUid)
    if (pending === undefined) {
      throw new JotmoPluginError('outbox-entry-not-found', '待重试内容不存在', false, 404)
    }
    return await this.sendPending(session, pending)
  }

  private async sendPending(
    session: JotmoSessionCredentials,
    pending: JotmoPendingWrite,
  ): Promise<JotmoCreateTextResult> {
    try {
      const data = await this.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/create',
        {
          record_uid: pending.recordUid,
          template_kind: 1,
          title: '',
          text_content: pending.textContent,
          send_at: pending.sendAtMillis,
        },
        session,
      )
      const result = {
        recordUid: stringValue(data.record_uid) || pending.recordUid,
        status: numberValue(data.status),
      }
      await this.stateStore.markSynced(session.userId, pending.recordUid, result.status)
      return result
    } catch (error) {
      await this.stateStore.markAttempt(session.userId, pending.recordUid, safeFailureMessage(error))
      throw error
    }
  }

  private async sealSourceRef(
    userId: number,
    kind: JotmoSourceKind,
    ownerRef: string,
    displayName: string,
  ): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, userId, kind, ownerRef, displayName } satisfies JotmoSourceRefPayload)
    const signature = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `jotmo-source-v1.${payload}.${signature}`
  }

  private async openSourceRef(sourceRef: string, expectedUserId: number): Promise<JotmoSourceRefPayload> {
    const parts = sourceRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'jotmo-source-v1') {
      throw new JotmoPluginError('source-ref-invalid', '即我数据源引用无效', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new JotmoPluginError('source-ref-invalid', '即我数据源引用无效', false)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = objectValue(decodeOpaqueJson(payload))
    } catch (error) {
      throw new JotmoPluginError('source-ref-invalid', '即我数据源引用无效', false, 400, { cause: error })
    }
    const kind = parsed.kind
    const result: JotmoSourceRefPayload = {
      version: 1,
      userId: numberValue(parsed.userId),
      kind: isSourceKind(kind) ? kind : 'default_category',
      ownerRef: stringValue(parsed.ownerRef).trim(),
      displayName: stringValue(parsed.displayName).trim(),
    }
    if (parsed.version !== 1 || result.userId !== expectedUserId || !isSourceKind(kind)
      || result.ownerRef === '' || result.displayName === '') {
      throw new JotmoPluginError('source-ref-invalid', '即我数据源引用与当前账号不匹配', false, 403)
    }
    return result
  }

  private async sourceItem(source: JotmoSourceRefPayload): Promise<JotmoSourceItem> {
    return {
      sourceRef: await this.sealSourceRef(source.userId, source.kind, source.ownerRef, source.displayName),
      kind: source.kind,
      displayName: source.displayName,
      activeAtMillis: 0,
      unreadCount: 0,
    }
  }

  private encodeCursor(value: Record<string, unknown>): string {
    return `jotmo-cursor-v1.${encodeOpaqueJson(value)}`
  }

  private decodeCursor(cursor: string): Record<string, unknown> {
    const [prefix, payload, ...extra] = cursor.trim().split('.')
    if (prefix !== 'jotmo-cursor-v1' || payload === undefined || extra.length > 0) {
      throw new JotmoPluginError('source-cursor-invalid', '即我数据源分页游标无效', false)
    }
    try {
      const decoded = objectValue(decodeOpaqueJson(payload))
      if (Object.keys(decoded).length === 0) throw new Error('empty cursor')
      return decoded
    } catch (error) {
      throw new JotmoPluginError('source-cursor-invalid', '即我数据源分页游标无效', false, 400, { cause: error })
    }
  }

  private recordTimelineItem(item: JotmoSelfRecordItem): JotmoTimelineItem {
    return {
      itemUid: item.recordUid,
      senderName: '我',
      isMe: true,
      sendAtMillis: item.sendAtMillis,
      title: item.title,
      textContent: item.textContent,
      status: item.status,
    }
  }

  private recordTimelineItemFromRaw(raw: unknown, userId: number): JotmoTimelineItem {
    const item = objectValue(raw)
    return {
      itemUid: stringValue(item.record_uid).trim(),
      senderName: stringValue(item.nickname).trim() || '我',
      isMe: numberValue(item.creator_user_id ?? item.owner_user_id) === userId,
      sendAtMillis: numberValue(item.send_at),
      title: stringValue(item.title),
      textContent: stringValue(item.text_content),
      status: numberValue(item.status),
    }
  }

  private recordItem(raw: unknown): JotmoSelfRecordItem | undefined {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    const recordUid = stringValue(item.record_uid ?? core.record_uid).trim()
    if (recordUid === '') return undefined
    return {
      recordUid,
      sendAtMillis: numberValue(item.send_at ?? core.send_at),
      title: stringValue(core.title),
      textContent: stringValue(core.text_content),
      templateKind: numberValue(core.template_kind),
      status: numberValue(core.status),
      version: numberValue(core.version),
    }
  }

  private normalizedPhone(phone: string): string {
    const normalized = phone.replace(/[\s-]/g, '')
    if (!/^1[3-9][0-9]{9}$/.test(normalized)) {
      throw new JotmoPluginError('phone-invalid', '请输入有效的中国大陆手机号', false)
    }
    return normalized
  }

  private normalizedCaptcha(captcha: JotmoCaptchaResult): JotmoCaptchaResult {
    const normalized = {
      lot_number: stringValue(captcha.lot_number).trim(),
      captcha_output: stringValue(captcha.captcha_output).trim(),
      pass_token: stringValue(captcha.pass_token).trim(),
      gen_time: stringValue(captcha.gen_time).trim(),
    }
    if (Object.values(normalized).some(value => value === '')) {
      throw new JotmoPluginError('captcha-required', '请先完成安全验证', false)
    }
    return normalized
  }

  private async authenticatedAuthGet<T>(
    path: string,
    initialSession?: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.get<T>(this.config.authBaseUrl, path, session.accessToken, [200], signal)
    } catch (error) {
      if (!(error instanceof JotmoPluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.get<T>(this.config.authBaseUrl, path, session.accessToken, [200], signal)
    }
  }

  private async ossCredentials(
    session: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<JotmoOssCredentials> {
    const credentials = await this.authenticatedAuthGet<Record<string, unknown>>(
      `/api/v1/synch/get/sts-credentials?md_5_user_id=${encodeURIComponent(md5Text(String(session.userId)))}`,
      session,
      signal,
    )
    const normalized = {
      accessKeyId: stringValue(credentials.access_key_id).trim(),
      accessKeySecret: stringValue(credentials.access_key_secret).trim(),
      stsToken: stringValue(credentials.security_token).trim(),
      expiration: stringValue(credentials.expiration).trim(),
    }
    if (normalized.accessKeyId === '' || normalized.accessKeySecret === '' || normalized.stsToken === ''
      || normalized.expiration === '' || !Number.isFinite(Date.parse(normalized.expiration))
      || Date.parse(normalized.expiration) <= Date.now()) {
      throw new JotmoPluginError('image-sts-contract-invalid', '即我图片授权凭据无效或已过期', true, 502)
    }
    return normalized
  }

  private async authenticatedPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: JotmoSessionCredentials,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.post<T>(this.config.recordBaseUrl, path, body, session.accessToken, [0])
    } catch (error) {
      if (!(error instanceof JotmoPluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.recordBaseUrl, path, body, session.accessToken, [0])
    }
  }

  private async authenticatedAuthPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal)
    } catch (error) {
      if (!(error instanceof JotmoPluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal)
    }
  }

  private async authenticatedChatPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.post<T>(this.config.chatBaseUrl, path, body, session.accessToken, [200], signal)
    } catch (error) {
      if (!(error instanceof JotmoPluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.chatBaseUrl, path, body, session.accessToken, [200], signal)
    }
  }

  private async authenticatedAudioPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: JotmoSessionCredentials,
    signal?: AbortSignal,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.post<T>(this.config.audioBaseUrl, path, body, session.accessToken, [200], signal)
    } catch (error) {
      if (!(error instanceof JotmoPluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.audioBaseUrl, path, body, session.accessToken, [200], signal)
    }
  }

  private async recordingCursorKey(userId: number): Promise<Buffer> {
    return createHmac('sha256', await this.stateStore.uniqueCode())
      .update(`jotmo-recording-cursor:${String(userId)}`)
      .digest()
  }

  private recordingDayStart(dateStamp: number): Date {
    const date = Math.trunc(dateStamp)
    const dayStart = new Date(date)
    if (!Number.isSafeInteger(date) || date <= 0 || dayStart.getTime() !== date
      || dayStart.getHours() !== 0 || dayStart.getMinutes() !== 0
      || dayStart.getSeconds() !== 0 || dayStart.getMilliseconds() !== 0) {
      throw new JotmoPluginError('recording-date-invalid', '录音日期必须是本地零点', false)
    }
    return dayStart
  }

  private recordingVersionSection(
    items: JotmoRecordingVersion[],
  ): JotmoRecordingSection<JotmoRecordingVersion> {
    if (items[0]?.status === 'processing') {
      return { state: 'processing', items, message: '内容仍在生成' }
    }
    if (items[0]?.status === 'failed') {
      return { state: 'failed', items, message: '最近一次生成失败' }
    }
    if (items.some(item => item.selectable)) return { state: 'ready', items, message: '' }
    return { state: 'empty', items, message: '暂无已生成内容' }
  }

  private async downloadSignedImage(
    signedUrl: URL,
    byteLimit: number,
    signal?: AbortSignal,
  ): Promise<JotmoImageBytes> {
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(signedUrl, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new JotmoPluginError('image-download-failed', `即我图片读取返回 HTTP ${response.status}`, true, 502)
      }
      const declaredLength = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
        throw new JotmoPluginError('image-too-large', '即我图片超过读取大小限制', false, 413)
      }
      if (response.body === null) {
        throw new JotmoPluginError('image-response-empty', '即我图片响应为空', true, 502)
      }
      const chunks: Uint8Array[] = []
      let bytes = 0
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > byteLimit) {
          await reader.cancel()
          throw new JotmoPluginError('image-too-large', '即我图片超过读取大小限制', false, 413)
        }
        chunks.push(next.value)
      }
      if (bytes === 0) throw new JotmoPluginError('image-response-empty', '即我图片响应为空', true, 502)
      const data = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      const mediaType = imageMediaType(data)
      if (mediaType === undefined) {
        throw new JotmoPluginError('image-type-unsupported', '即我图片不是受支持的 PNG、JPEG、WebP 或 GIF', false, 415)
      }
      const declaredType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase()
      if (declaredType !== '' && declaredType !== 'application/octet-stream'
        && !(mediaType === 'image/jpeg' && declaredType === 'image/jpg') && declaredType !== mediaType) {
        throw new JotmoPluginError('image-type-mismatch', '即我图片类型与响应声明不一致', false, 502)
      }
      return { mediaType, bytes, data }
    } catch (error) {
      if (error instanceof JotmoPluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new JotmoPluginError('image-download-timeout', '即我图片读取超时或已取消', true, 504, { cause: error })
      }
      throw new JotmoPluginError('image-download-failed', '无法读取即我图片', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async refreshAccessToken(session: JotmoSessionCredentials): Promise<JotmoSessionCredentials> {
    if (this.refreshInFlight !== undefined) return await this.refreshInFlight
    const refresh = (async () => {
      try {
        const data = await this.post<Record<string, unknown>>(
          this.config.authBaseUrl,
          '/api/public/v1/auth/new-short',
          {},
          session.refreshToken,
          [200],
        )
        const accessToken = stringValue(data.access_token)
        if (accessToken === '') {
          throw new JotmoPluginError('refresh-contract-invalid', '即我登录刷新响应不完整', true, 502)
        }
        const updated = { ...session, accessToken }
        await this.sessionStore.write(updated)
        return updated
      } catch (error) {
        if (error instanceof JotmoPluginError && ['auth-http-401', 'auth-http-403'].includes(error.code)) {
          await this.sessionStore.delete()
          throw new JotmoPluginError('login-expired', '即我登录已过期，请重新扫码', false, 401)
        }
        throw error
      }
    })()
    this.refreshInFlight = refresh
    try {
      return await refresh
    } finally {
      if (this.refreshInFlight === refresh) this.refreshInFlight = undefined
    }
  }

  private async requireSession(): Promise<JotmoSessionCredentials> {
    const session = await this.sessionStore.read()
    if (session === undefined) {
      throw new JotmoPluginError('login-required', '请先登录即我', false, 401)
    }
    return session
  }

  private async post<T>(
    baseUrl: string,
    path: string,
    body: Record<string, unknown>,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(joinUrl(baseUrl, path), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'zh-CN',
          Usersource: '3',
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        throw new JotmoPluginError(
          `auth-http-${response.status}`,
          '即我登录凭据已失效',
          false,
          response.status,
        )
      }
      if (!response.ok) {
        throw new JotmoPluginError('jotmo-http-error', `即我服务返回 HTTP ${response.status}`, true, 502)
      }
      let envelope: JotmoEnvelope<T>
      try {
        envelope = await response.json() as JotmoEnvelope<T>
      } catch (error) {
        throw new JotmoPluginError('jotmo-response-invalid', '即我服务返回了无效响应', true, 502, { cause: error })
      }
      if (!successCodes.includes(envelope.code)) {
        throw new JotmoPluginError(
          `jotmo-code-${envelope.code}`,
          envelope.message?.trim() || '即我服务请求失败',
          envelope.code >= 500,
          502,
        )
      }
      return (envelope.data ?? {}) as T
    } catch (error) {
      if (error instanceof JotmoPluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new JotmoPluginError('jotmo-timeout', '即我服务请求超时', true, 504, { cause: error })
      }
      throw new JotmoPluginError('jotmo-network-error', '无法连接即我服务', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async get<T>(
    baseUrl: string,
    path: string,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(joinUrl(baseUrl, path), {
        method: 'GET',
        headers: {
          'Accept-Language': 'zh-CN',
          Usersource: '3',
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        throw new JotmoPluginError(
          `auth-http-${response.status}`,
          '即我登录凭据已失效',
          false,
          response.status,
        )
      }
      if (!response.ok) {
        throw new JotmoPluginError('jotmo-http-error', `即我服务返回 HTTP ${response.status}`, true, 502)
      }
      let envelope: JotmoEnvelope<T>
      try {
        envelope = await response.json() as JotmoEnvelope<T>
      } catch (error) {
        throw new JotmoPluginError('jotmo-response-invalid', '即我服务返回了无效响应', true, 502, { cause: error })
      }
      if (!successCodes.includes(envelope.code)) {
        throw new JotmoPluginError(
          `jotmo-code-${envelope.code}`,
          envelope.message?.trim() || '即我服务请求失败',
          envelope.code >= 500,
          502,
        )
      }
      return (envelope.data ?? {}) as T
    } catch (error) {
      if (error instanceof JotmoPluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new JotmoPluginError('jotmo-timeout', '即我请求超时', true, 504, { cause: error })
      }
      throw new JotmoPluginError('jotmo-network-error', '无法连接即我服务', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}
