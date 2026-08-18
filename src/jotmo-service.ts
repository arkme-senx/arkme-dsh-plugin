import { createHash } from 'node:crypto'
import OSS from 'ali-oss'
import type { JotmoSessionCredentials } from './keychain-store.js'
import { JOTMO_PROVIDER_CONTRACT_VERSION } from './types.js'
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
  JotmoSelfRecordItem,
  JotmoSelfRecordList,
  JotmoSelfSummary,
  JotmoProviderCapabilities,
  JotmoProviderState,
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
  requestTimeoutMs: number
  maxTextLength: number
  geetestCaptchaId: string
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
      provider: '@senqisi/dsh-jotmo',
      sdk: '@senqisi/dsh-jotmo/sdk',
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
      },
      limits: {
        maxTextLength: this.config.maxTextLength,
        maxSearchResults: 30,
        maxSyncPages: 20,
        maxImageBytes: MAX_JOTMO_IMAGE_BYTES,
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

  /** Resolve and download one current-user Jiwo profile image without exposing OSS credentials or signed URLs. */
  async readImage(
    imageRef: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<JotmoImageBytes> {
    const session = await this.requireSession()
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
    const byteLimit = Math.min(MAX_JOTMO_IMAGE_BYTES, Math.max(1, Math.trunc(options.maxBytes ?? MAX_JOTMO_IMAGE_BYTES)))
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
