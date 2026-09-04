import {
  ArkmeRequestQueueOverflowError,
  ArkmeRequestCoordinator,
  type ArkmeRequestLane,
  type ArkmeRequestService,
  type ArkmeRequestStats,
} from '../request-coordinator.js'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../keychain-store.js'
import { ArkmeAccountSessionOwner } from '../account-session-owner.js'
import type {
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeEnvironment,
  ArkmeLongArticleDraft,
  ArkmePendingWrite,
  ArkmeRecordReeditDraft,
  ArkmeRecordCursor,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import type { ArkmeExtensionReviewOperation } from '../extensions/types.js'
import type { RecordingImportAdmission, RecordingImportJob } from '../recording-import-contract.js'

export interface StateStore {
  uniqueCode(): Promise<string>
  cachedSnapshot(userId: number): Promise<ArkmeCachedSnapshot>
  cacheSummary(userId: number, summary: ArkmeSelfSummary): Promise<void>
  cachePage(userId: number, page: ArkmeSelfRecordList, requestCursor?: ArkmeRecordCursor): Promise<void>
  queryCached(
    userId: number,
    options: { query?: string; limit: number; beforeMillis?: number },
  ): Promise<ArkmeCachedQueryResult>
  revision(userId: number): Promise<number>
  cachedProfile(userId: number): Promise<ArkmeUserProfileSnapshot>
  cacheProfile(userId: number, profile: ArkmeUserProfile): Promise<ArkmeUserProfileSnapshot>
  listPending(userId: number): Promise<ArkmePendingWrite[]>
  putPending(userId: number, pending: ArkmePendingWrite): Promise<void>
  markAttempt(userId: number, recordUid: string, error: string): Promise<void>
  markSynced(userId: number, recordUid: string, status: number): Promise<void>
  listExtensionReviewOperations(userId: number): Promise<ArkmeExtensionReviewOperation[]>
  putExtensionReviewOperation(userId: number, operation: ArkmeExtensionReviewOperation): Promise<void>
  markExtensionReviewOperation(
    userId: number,
    clientMutationId: string,
    state: ArkmeExtensionReviewOperation['state'],
    error?: string,
  ): Promise<void>
  removeExtensionReviewOperation(userId: number, clientMutationId: string): Promise<void>
  getLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined>
  putLongArticleDraft(userId: number, draft: ArkmeLongArticleDraft): Promise<void>
  removeLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<void>
  getRecordReeditDraft(
    userId: number,
    sourceIdentityKey: string,
    itemUid: string,
  ): Promise<ArkmeRecordReeditDraft | undefined>
  putRecordReeditDraft(
    userId: number,
    draft: Omit<ArkmeRecordReeditDraft, 'draftRevision'>,
  ): Promise<ArkmeRecordReeditDraft>
  removeRecordReeditDraft(
    userId: number,
    sourceIdentityKey: string,
    itemUid: string,
    expectedRevision: number,
  ): Promise<boolean>
  listRecordingImportJobs(userId: number): Promise<RecordingImportJob[]>
  listAllRecordingImportJobs(): Promise<RecordingImportJob[]>
  getRecordingImportJob(userId: number, jobId: string): Promise<RecordingImportJob | undefined>
  putRecordingImportJob(userId: number, job: RecordingImportJob): Promise<void>
  admitRecordingImportJob(
    userId: number,
    job: RecordingImportJob,
    unresolvedLimit: number,
    signal?: AbortSignal,
  ): Promise<RecordingImportAdmission>
  replaceRecordingImportJob(userId: number, job: RecordingImportJob, expectedRevision: number, signal?: AbortSignal): Promise<boolean>
  removeRecordingImportJob(userId: number, jobId: string): Promise<void>
}

export interface ArkmeServiceConfig {
  environment: ArkmeEnvironment
  authBaseUrl: string
  subjectBaseUrl: string
  recordBaseUrl: string
  dataBaseUrl?: string
  chatBaseUrl: string
  botBaseUrl: string
  imBaseUrl: string
  webrtcBaseUrl: string
  worldBaseUrl: string
  relationBaseUrl: string
  intelligentBaseUrl: string
  routePath: string
  audioBaseUrl: string
  extensionPublishBaseUrl?: string
  requestTimeoutMs: number
  maxTextLength: number
  geetestCaptchaId: string
  relatedRecordingsEnabled?: boolean
  interwovenMomentsEnabled: boolean
  recordingWorkbenchEnabled?: boolean
  chatMemberJoinEventsEnabled?: boolean
  shareWebsite?: string
  richMediaRenderEnabled?: boolean
  richMediaSendEnabled?: boolean
  maxUploadBytes?: number
  recordingImportDirectory?: string
  fileStateDirectory?: string
}

export type FetchLike = typeof fetch

interface ArkmeEnvelope<T> {
  code: number
  message?: string
  data?: T
}

type ArkmePostBody = Record<string, unknown> | FormData

export interface ArkmeRemoteRequestOptions {
  lane?: ArkmeRequestLane
  service?: ArkmeRequestService
  scope?: string
  key?: string
  cacheMs?: number
  failureCooldownMs?: number
  bypassCache?: boolean
  /** Mark only transport outcomes where a mutation may have reached its owner without a usable acknowledgement. */
  trackWriteOutcome?: boolean
}

export class ArkmePluginError extends Error {
  readonly upstreamStatus?: number
  readonly retryAfterMillis?: number
  /** The owner mutation may have completed, but the caller did not receive a usable acknowledgement. */
  readonly writeOutcomeUnknown?: true

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus = 400,
    options?: ErrorOptions & { upstreamStatus?: number; retryAfterMillis?: number; writeOutcomeUnknown?: boolean },
  ) {
    super(message, options)
    this.name = 'ArkmePluginError'
    if (options?.upstreamStatus !== undefined) this.upstreamStatus = options.upstreamStatus
    if (options?.retryAfterMillis !== undefined) this.retryAfterMillis = options.retryAfterMillis
    if (options?.writeOutcomeUnknown === true) this.writeOutcomeUnknown = true
  }
}

function remoteWriteOutcomeUnknown(error: ArkmePluginError): boolean {
  if (['arkme-network-error', 'arkme-timeout', 'arkme-response-invalid'].includes(error.code)) return true
  return error.upstreamStatus === 408
    || (error.upstreamStatus !== undefined && error.upstreamStatus >= 500)
}

function withUnknownWriteOutcome(error: ArkmePluginError): ArkmePluginError {
  if (error.writeOutcomeUnknown === true) return error
  return new ArkmePluginError(error.code, error.message, error.retryable, error.httpStatus, {
    cause: error,
    writeOutcomeUnknown: true,
    ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
    ...(error.retryAfterMillis === undefined ? {} : { retryAfterMillis: error.retryAfterMillis }),
  })
}

function retryAfterMillis(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.round(seconds * 1000))
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.min(60_000, Math.max(0, date - Date.now()))
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function knownStringValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | undefined {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : undefined
}

export function clippedText(value: unknown, limit = 4_000): string {
  const text = stringValue(value).trim()
  return text.length > limit ? `${text.slice(0, limit)}…[已截断]` : text
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

export class ServiceRuntime {
  readonly requestCoordinator = new ArkmeRequestCoordinator()
  private readonly refreshInFlightByUserId = new Map<number, Promise<ArkmeSessionCredentials>>()
  private readonly accountSessions: ArkmeAccountSessionOwner
  private pendingBindingSession: ArkmeSessionCredentials | undefined

  constructor(
    readonly config: ArkmeServiceConfig,
    readonly sessionStore: ArkmeSessionStore,
    readonly stateStore: StateStore,
    readonly fetchImpl: FetchLike = fetch,
    readonly pendingSessionStore?: ArkmeSessionStore,
    accountSessions?: ArkmeAccountSessionOwner,
  ) {
    this.accountSessions = accountSessions ?? new ArkmeAccountSessionOwner(sessionStore)
  }

  async startAccountScope(): Promise<void> { await this.accountSessions.start() }
  attachGuestConversationProbe(probe: () => Promise<boolean>): void { this.accountSessions.attachGuestConversationProbe(probe) }
  accountScopeReady(): boolean { return this.accountSessions.ready() }
  subscribeAccountScope(listener: () => void): () => void { return this.accountSessions.subscribe(listener) }
  async accountScopedSession(): Promise<ArkmeSessionCredentials | undefined> {
    await this.accountSessions.start()
    return await this.accountSessions.scopedSession()
  }
  async writeSession(session: ArkmeSessionCredentials): Promise<void> { await this.accountSessions.write(session) }
  async deleteSession(): Promise<void> { await this.accountSessions.delete() }

  requestStats(): Record<string, ArkmeRequestStats> {
    return this.requestCoordinator.snapshotStats()
  }

  requestScope(userId: number | undefined): string {
    return userId !== undefined && Number.isSafeInteger(userId) && userId > 0 ? `user:${String(userId)}` : 'public'
  }

  invalidateScope(scope: string): void {
    this.requestCoordinator.invalidateScope(scope)
  }

  invalidateKey(scope: string, key: string): void {
    this.requestCoordinator.invalidateKey(scope, key)
  }

  dispose(): void {
    this.refreshInFlightByUserId.clear()
    this.requestCoordinator.dispose()
  }

  async requireSession(): Promise<ArkmeSessionCredentials> {
    const session = await this.accountScopedSession()
    if (session === undefined) {
      throw new ArkmePluginError('login-required', '请先登录 Arkme', false, 401)
    }
    return session
  }

  async requireAuthFlowSession(): Promise<ArkmeSessionCredentials> {
    const session = await this.sessionStore.read() ?? await this.readPendingBindingSession()
    if (session === undefined) {
      throw new ArkmePluginError('login-required', '请先登录 Arkme', false, 401)
    }
    return session
  }

  isPendingBindingSession(session: ArkmeSessionCredentials): boolean {
    return this.pendingBindingSession?.userId === session.userId
      && this.pendingBindingSession.refreshToken === session.refreshToken
  }

  async readPendingBindingSession(): Promise<ArkmeSessionCredentials | undefined> {
    if (this.pendingBindingSession !== undefined) return this.pendingBindingSession
    const session = await this.pendingSessionStore?.read()
    this.pendingBindingSession = session
    return session
  }

  async writePendingBindingSession(session: ArkmeSessionCredentials): Promise<void> {
    this.pendingBindingSession = session
    await this.pendingSessionStore?.write(session)
  }

  async clearPendingBindingSession(): Promise<void> {
    this.pendingBindingSession = undefined
    await this.pendingSessionStore?.delete()
  }

  clearRefreshForUser(userId: number): void {
    this.refreshInFlightByUserId.delete(userId)
  }

  async refreshAccessToken(session: ArkmeSessionCredentials): Promise<ArkmeSessionCredentials> {
    const existing = this.refreshInFlightByUserId.get(session.userId)
    if (existing !== undefined) return await existing
    const refresh = (async () => {
      try {
        const data = await this.post<Record<string, unknown>>(
          this.config.authBaseUrl,
          '/api/public/v1/auth/new-short',
          {},
          session.refreshToken,
          [200],
          undefined,
          false,
          {
            scope: this.requestScope(session.userId),
            lane: 'auth',
            service: 'auth',
            key: 'token-refresh',
            failureCooldownMs: 2_000,
          },
        )
        const accessToken = stringValue(data.access_token)
        if (accessToken === '') {
          throw new ArkmePluginError('refresh-contract-invalid', 'Arkme 登录刷新响应不完整', true, 502)
        }
        const updated = { ...session, accessToken }
        if (this.isPendingBindingSession(session)) await this.writePendingBindingSession(updated)
        else await this.writeSession(updated)
        return updated
      } catch (error) {
        if (error instanceof ArkmePluginError && error.code === 'arkme-code-1004') {
          if (this.isPendingBindingSession(session)) await this.clearPendingBindingSession()
          else await this.sessionStore.delete()
          // 1004 是通用“账号不可用”，也覆盖注销等既有状态，不能在客户端臆断为封禁。
          throw new ArkmePluginError('account-unavailable', '当前即我账号暂不可用', false, 403)
        }
        if (error instanceof ArkmePluginError && ['auth-http-401', 'auth-http-403'].includes(error.code)) {
          if (this.isPendingBindingSession(session)) await this.clearPendingBindingSession()
          else await this.deleteSession()
          throw new ArkmePluginError('login-expired', 'Arkme 登录已过期，请重新扫码', false, 401)
        }
        throw error
      }
    })()
    this.refreshInFlightByUserId.set(session.userId, refresh)
    try {
      return await refresh
    } finally {
      if (this.refreshInFlightByUserId.get(session.userId) === refresh) {
        this.refreshInFlightByUserId.delete(session.userId)
      }
    }
  }

  private requestService(baseUrl: string): ArkmeRequestService {
    const normalized = baseUrl.replace(/\/+$/, '')
    const services: Array<[string, ArkmeRequestService]> = [
      [this.config.authBaseUrl, 'auth'],
      ...(this.config.dataBaseUrl === undefined || this.config.dataBaseUrl.trim() === ''
        ? []
        : [[this.config.dataBaseUrl, 'data'] as [string, ArkmeRequestService]]),
      [this.config.chatBaseUrl, 'chat'],
      [this.config.recordBaseUrl, 'record'],
      [this.config.audioBaseUrl, 'audio'],
      [this.config.worldBaseUrl, 'world'],
      [this.config.relationBaseUrl, 'relation'],
      [this.config.intelligentBaseUrl, 'intelligent'],
      [this.config.webrtcBaseUrl, 'webrtc'],
    ]
    return services.find(([candidate]) => candidate.replace(/\/+$/, '') === normalized)?.[1] ?? 'other'
  }

  private remoteServiceCooldownMs(error: unknown): number {
    if (!(error instanceof ArkmePluginError)
      || ['auth-http-401', 'auth-http-403', 'login-expired'].includes(error.code)) return 0
    if (error.upstreamStatus === 429 || error.upstreamStatus === 503) {
      return Math.max(1_000, error.retryAfterMillis ?? 5_000)
    }
    return 0
  }

  async post<T>(
    baseUrl: string,
    path: string,
    body: ArkmePostBody,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal?: AbortSignal,
    preferDataError = false,
    options: ArkmeRemoteRequestOptions = {},
    preserveHttpError = false,
    preserveForbiddenError = false,
  ): Promise<T> {
    return await this.requestCoordinator.run<T>({
      scope: options.scope ?? 'public',
      lane: options.lane ?? 'write',
      service: options.service ?? this.requestService(baseUrl),
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(options.cacheMs === undefined ? {} : { cacheMs: options.cacheMs }),
      ...(options.failureCooldownMs === undefined ? {} : { failureCooldownMs: options.failureCooldownMs }),
      ...(options.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      ...(signal === undefined ? {} : { signal }),
      shouldCooldown: error => !(error instanceof ArkmePluginError)
        || !['auth-http-401', 'auth-http-403', 'login-expired'].includes(error.code),
      serviceCooldownMs: error => this.remoteServiceCooldownMs(error),
      operation: async coordinatedSignal => await this.postDirect<T>(
        baseUrl, path, body, bearer, successCodes, coordinatedSignal, preferDataError,
        preserveHttpError, preserveForbiddenError,
      ),
    }).catch((error): never => {
      if (options.trackWriteOutcome === true && error instanceof ArkmeRequestQueueOverflowError) {
        throw new ArkmePluginError('arkme-request-queue-full', '发送请求较多，请稍后重试', true, 503, { cause: error })
      }
      if (options.trackWriteOutcome === true && error instanceof Error && error.name === 'AbortError') {
        throw new ArkmePluginError('arkme-request-aborted', '发送请求已取消', true, 409, { cause: error })
      }
      if (options.trackWriteOutcome === true && error instanceof ArkmePluginError
        && remoteWriteOutcomeUnknown(error)) throw withUnknownWriteOutcome(error)
      throw error
    })
  }

  async postDirect<T>(
    baseUrl: string,
    path: string,
    body: ArkmePostBody,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal: AbortSignal = new AbortController().signal,
    preferDataError = false,
    preserveHttpError = false,
    preserveForbiddenError = false,
  ): Promise<T> {
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)
    try {
      const multipart = body instanceof FormData
      const response = await this.fetchImpl(joinUrl(baseUrl, path), {
        method: 'POST',
        headers: {
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
          'Accept-Language': 'zh-CN',
          Usersource: '3',
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        body: multipart ? body : JSON.stringify(body),
        signal: controller.signal,
      })
      if (response.status === 401 || (response.status === 403 && !preserveForbiddenError)) {
        throw new ArkmePluginError(`auth-http-${response.status}`, 'Arkme 登录凭据已失效', false, response.status)
      }
      if (!response.ok) {
        const retryAfter = retryAfterMillis(response.headers.get('retry-after'))
        if (preserveHttpError) {
          let errorEnvelope: ArkmeEnvelope<unknown> | undefined
          try { errorEnvelope = await response.json() as ArkmeEnvelope<unknown> }
          catch { /* Non-JSON upstream failures retain the HTTP fallback below. */ }
          const serviceCode = typeof errorEnvelope?.code === 'number' && Number.isFinite(errorEnvelope.code)
            ? errorEnvelope.code
            : undefined
          const serviceMessage = clippedText(errorEnvelope?.message, 1_000)
          throw new ArkmePluginError(
            serviceCode === undefined ? 'arkme-http-error' : `arkme-code-${serviceCode}`,
            serviceMessage === ''
              ? `Arkme 服务返回 HTTP ${response.status}`
              : `${serviceMessage}（服务错误码 ${serviceCode ?? response.status}）`,
            response.status === 408 || response.status === 429 || response.status >= 500,
            response.status,
            {
              upstreamStatus: response.status,
              ...(retryAfter === undefined ? {} : { retryAfterMillis: retryAfter }),
            },
          )
        }
        throw new ArkmePluginError(
          'arkme-http-error',
          `Arkme 服务返回 HTTP ${response.status}`,
          true,
          502,
          {
            upstreamStatus: response.status,
            ...(retryAfter === undefined ? {} : { retryAfterMillis: retryAfter }),
          },
        )
      }
      let envelope: ArkmeEnvelope<T>
      try { envelope = await response.json() as ArkmeEnvelope<T> }
      catch (error) {
        throw new ArkmePluginError('arkme-response-invalid', 'Arkme 服务返回了无效响应', true, 502, { cause: error })
      }
      if (!successCodes.includes(envelope.code)) {
        const errorData = objectValue(envelope.data)
        const serviceErrorCode = preferDataError ? stringValue(errorData.error_code).trim() : ''
        const serviceMessage = preferDataError ? stringValue(errorData.message).trim() : ''
        throw new ArkmePluginError(
          serviceErrorCode || `arkme-code-${envelope.code}`,
          serviceMessage || envelope.message?.trim() || 'Arkme 服务请求失败',
          serviceErrorCode === '' ? envelope.code >= 500 : serviceErrorCode === 'ai_comic_video_rate_limited',
          502,
        )
      }
      return (envelope.data ?? {}) as T
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('arkme-timeout', 'Arkme 服务请求超时', true, 504, { cause: error })
      }
      throw new ArkmePluginError('arkme-network-error', '无法连接Arkme 服务', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }

  async get<T>(
    baseUrl: string,
    path: string,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
    preferDataError = false,
  ): Promise<T> {
    return await this.requestCoordinator.run({
      scope: options.scope ?? 'public',
      lane: options.lane ?? 'interactive-read',
      service: options.service ?? this.requestService(baseUrl),
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(options.cacheMs === undefined ? {} : { cacheMs: options.cacheMs }),
      ...(options.failureCooldownMs === undefined ? {} : { failureCooldownMs: options.failureCooldownMs }),
      ...(options.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      ...(signal === undefined ? {} : { signal }),
      shouldCooldown: error => !(error instanceof ArkmePluginError)
        || !['auth-http-401', 'auth-http-403', 'login-expired'].includes(error.code),
      serviceCooldownMs: error => this.remoteServiceCooldownMs(error),
      operation: async coordinatedSignal => await this.getDirect(
        baseUrl, path, bearer, successCodes, coordinatedSignal, preferDataError,
      ),
    })
  }

  async getDirect<T>(
    baseUrl: string,
    path: string,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal: AbortSignal = new AbortController().signal,
    preferDataError = false,
  ): Promise<T> {
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
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
        throw new ArkmePluginError(`auth-http-${response.status}`, 'Arkme 登录凭据已失效', false, response.status)
      }
      if (!response.ok) {
        const retryAfter = retryAfterMillis(response.headers.get('retry-after'))
        throw new ArkmePluginError(
          'arkme-http-error',
          `Arkme 服务返回 HTTP ${response.status}`,
          true,
          502,
          {
            upstreamStatus: response.status,
            ...(retryAfter === undefined ? {} : { retryAfterMillis: retryAfter }),
          },
        )
      }
      let envelope: ArkmeEnvelope<T>
      try { envelope = await response.json() as ArkmeEnvelope<T> }
      catch (error) {
        throw new ArkmePluginError('arkme-response-invalid', 'Arkme 服务返回了无效响应', true, 502, { cause: error })
      }
      if (!successCodes.includes(envelope.code)) {
        const errorData = objectValue(envelope.data)
        const serviceErrorCode = preferDataError ? stringValue(errorData.error_code).trim() : ''
        const serviceMessage = preferDataError ? stringValue(errorData.message).trim() : ''
        throw new ArkmePluginError(
          serviceErrorCode || `arkme-code-${envelope.code}`,
          serviceMessage || envelope.message?.trim() || 'Arkme 服务请求失败',
          serviceErrorCode === '' ? envelope.code >= 500 : serviceErrorCode === 'PAIRING_RATE_LIMITED',
          502,
        )
      }
      return (envelope.data ?? {}) as T
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('arkme-timeout', 'Arkme请求超时', true, 504, { cause: error })
      }
      throw new ArkmePluginError('arkme-network-error', '无法连接Arkme 服务', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }

  authenticatedRequestOptions(
    session: ArkmeSessionCredentials,
    service: ArkmeRequestService,
    defaultLane: ArkmeRequestLane,
    options: ArkmeRemoteRequestOptions,
  ): ArkmeRemoteRequestOptions {
    return {
      ...options,
      scope: this.requestScope(session.userId),
      service,
      lane: options.lane ?? defaultLane,
    }
  }

  async authenticatedAuthGet<T>(
    path: string,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'auth', 'interactive-read', options)
    try {
      return await this.get<T>(this.config.authBaseUrl, path, session.accessToken, [200], signal, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.get<T>(this.config.authBaseUrl, path, session.accessToken, [200], signal, requestOptions())
    }
  }

  async authenticatedDshRemoteGet<T>(path: string, signal?: AbortSignal): Promise<T> {
    let session = await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'auth', 'interactive-read', { bypassCache: true })
    try {
      return await this.get<T>(this.config.authBaseUrl, path, session.accessToken, [200], signal, requestOptions(), true)
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) throw error
      session = await this.refreshAccessToken(session)
      return await this.get<T>(this.config.authBaseUrl, path, session.accessToken, [200], signal, requestOptions(), true)
    }
  }

  async authenticatedPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'record', 'write', options)
    try {
      return await this.post<T>(this.config.recordBaseUrl, path, body, session.accessToken, [0], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.recordBaseUrl, path, body, session.accessToken, [0], signal, false, requestOptions())
    }
  }

  async authenticatedCalendarPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'record', 'interactive-read', options)
    try {
      return await this.post<T>(this.config.recordBaseUrl, path, body, session.accessToken, [0, 200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.recordBaseUrl, path, body, session.accessToken, [0, 200], signal, false, requestOptions())
    }
  }

  async authenticatedDataPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    const baseUrl = this.config.dataBaseUrl?.trim() ?? ''
    if (baseUrl === '') {
      throw new ArkmePluginError('data-service-disabled', '通话记录服务尚未配置', false, 503)
    }
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'data', 'interactive-read', options)
    try {
      return await this.post<T>(baseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(baseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  async authenticatedAuthPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'auth', 'write', options)
    try {
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  /** Read a legacy private owner hosted by the main authenticated API. */
  async authenticatedAuthReadPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'auth', 'interactive-read', options)
    try {
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  /** Read a public auth endpoint while isolating coordination and caching to the active account. */
  async accountScopedPublicAuthReadPost<T>(
    path: string,
    body: Record<string, unknown>,
    viewerUserId: number,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    return await this.post<T>(
      this.config.authBaseUrl,
      path,
      body,
      undefined,
      [200],
      signal,
      false,
      {
        ...options,
        scope: this.requestScope(viewerUserId),
        service: 'auth',
        lane: options.lane ?? 'background-read',
      },
    )
  }

  async authenticatedDshRemotePost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'auth', 'write', { bypassCache: true })
    try {
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal, true, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) throw error
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.authBaseUrl, path, body, session.accessToken, [200], signal, true, requestOptions())
    }
  }

  async authenticatedSubjectPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.post<T>(this.config.subjectBaseUrl, path, body, session.accessToken, [200], signal)
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.subjectBaseUrl, path, body, session.accessToken, [200], signal)
    }
  }

  async authenticatedChatPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'chat', 'write', options)
    try {
      return await this.post<T>(this.config.chatBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.chatBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  async authenticatedBotPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.post<T>(this.config.botBaseUrl, path, body, session.accessToken, [200], signal)
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.botBaseUrl, path, body, session.accessToken, [200], signal)
    }
  }

  async authenticatedWebrtcPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'webrtc', 'write', options)
    try {
      return await this.post<T>(this.config.webrtcBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.webrtcBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  async authenticatedAudioPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'audio', 'interactive-read', options)
    try {
      return await this.post<T>(this.config.audioBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.audioBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  async authenticatedAudioMultipartPost<T>(
    path: string,
    body: FormData,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'audio', 'write', options)
    try {
      return await this.post<T>(this.config.audioBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.audioBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  async authenticatedRelationPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'relation', 'interactive-read', options)
    try {
      return await this.post<T>(this.config.relationBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.relationBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  async authenticatedWorldPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'world', 'write', options)
    try {
      return await this.post<T>(this.config.worldBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError)
        || !['auth-http-401', 'auth-http-403', 'arkme-code-10002'].includes(error.code)) throw error
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.worldBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    }
  }

  async authenticatedIntelligentPost<T>(
    path: string,
    body: Record<string, unknown>,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'intelligent', 'write', options)
    try {
      return await this.post<T>(this.config.intelligentBaseUrl, path, body, session.accessToken, [200], signal, true, requestOptions())
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.post<T>(this.config.intelligentBaseUrl, path, body, session.accessToken, [200], signal, true, requestOptions())
    }
  }

  async extensionPost<T>(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    const baseUrl = this.config.extensionPublishBaseUrl?.trim() ?? ''
    if (baseUrl === '') {
      throw new ArkmePluginError('extension-service-disabled', '市集服务尚未配置', false, 503)
    }
    let session = await this.requireSession()
    const requestOptions = (): ArkmeRemoteRequestOptions => ({
      ...options,
      scope: this.requestScope(session.userId),
      service: 'extension',
      lane: options.lane ?? 'write',
    })
    try {
      return await this.post<T>(baseUrl, path, body, session.accessToken, [0], signal, false, requestOptions(), true, true)
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || error.code !== 'auth-http-401') throw error
      session = await this.refreshAccessToken(session)
      return await this.post<T>(baseUrl, path, body, session.accessToken, [0], signal, false, requestOptions(), true, true)
    }
  }
}
