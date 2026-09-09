import { createHash } from 'node:crypto'
import { retryAfterMillis } from '../http-retry-after.js'
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
  ArkmePluginErrorBody,
} from '../types.js'
import type { ArkmeExtensionReviewOperation } from '../extensions/types.js'
import type { RecordingImportAdmission, RecordingImportJob } from '../recording-import-contract.js'

export interface StateStore {
  readDirectoryCache?(userId: number): Promise<import('../types.js').ArkmeSourceList | undefined>
  writeDirectoryCache?(userId: number, page: import('../types.js').ArkmeSourceList): Promise<void>
  readAvatarCache?(userId: number, imageRef: string): Promise<import('../types.js').ArkmeImageBytes | undefined>
  writeAvatarCache?(userId: number, imageRef: string, image: import('../types.js').ArkmeImageBytes): Promise<void>
  forgetCachedMembers?(userId: number, group: string, refs: readonly string[]): Promise<void>
  cachedConversationMembers?(userId: number, group: string): Promise<import('../types.js').ArkmeConversationMemberCache | undefined>
  mergeConversationMembers?(userId: number, group: string, page: import('../types.js').ArkmeConversationMemberUpdate): Promise<void>
  clearConversationMembers?(userId: number, group: string): Promise<void>
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
    expectedRevision?: number,
  ): Promise<ArkmeRecordReeditDraft>
  recordReeditFileRefs(userId: number): Promise<string[]>
  listRecordReeditSubmissions(userId: number): Promise<import('../record-reedit-contract.js').ArkmeRecordReeditSubmission[]>
  acknowledgeRecordReeditSubmission(userId: number, identity: string, submissionId: string, version: number): Promise<void>
  discardRecordReeditCandidate(userId: number, sourceIdentityKey: string, itemUid: string, expectedRevision: number): Promise<boolean>
  putRecordReeditSubmission(userId: number, job: import('../record-reedit-contract.js').ArkmeRecordReeditSubmission, expectedId?: string): Promise<void>
  removeRecordReeditDraft(
    userId: number,
    sourceIdentityKey: string,
    itemUid: string,
    expectedRevision: number,
    expectedCandidate?: ArkmeRecordReeditDraft,
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
  markdownQuickNotesEnabled?: boolean
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
  error?: unknown
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
  /** Optional writes may avoid publishing service-wide cooldowns; existing admission limits still apply. */
  publishServiceCooldown?: boolean
  /** Mark only transport outcomes where a mutation may have reached its owner without a usable acknowledgement. */
  trackWriteOutcome?: boolean
}

export class ArkmePluginError extends Error {
  readonly upstreamStatus?: number
  readonly retryAfterMillis?: number
  readonly failureKind?: ArkmePluginErrorBody['failureKind']
  readonly retryScope?: ArkmePluginErrorBody['retryScope']
  readonly recovery?: ArkmePluginErrorBody['recovery']
  /** The owner mutation may have completed, but the caller did not receive a usable acknowledgement. */
  readonly writeOutcomeUnknown?: true

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus = 400,
    options?: ErrorOptions & { upstreamStatus?: number; retryAfterMillis?: number; writeOutcomeUnknown?: boolean;
      failureKind?: ArkmePluginErrorBody['failureKind']; retryScope?: ArkmePluginErrorBody['retryScope']; recovery?: ArkmePluginErrorBody['recovery'] },
  ) {
    super(message, options)
    this.name = 'ArkmePluginError'
    if (options?.upstreamStatus !== undefined) this.upstreamStatus = options.upstreamStatus
    if (options?.retryAfterMillis !== undefined) this.retryAfterMillis = options.retryAfterMillis
    if (options?.failureKind !== undefined) this.failureKind = options.failureKind
    if (options?.retryScope !== undefined) this.retryScope = options.retryScope
    if (options?.recovery !== undefined) this.recovery = options.recovery
    if (options?.writeOutcomeUnknown === true) this.writeOutcomeUnknown = true
  }
}

/** Opaque upstream body, for the owning business adapter only. Never serialize this error wholesale. */
export class ArkmeUpstreamResponseError extends ArkmePluginError {
  constructor(code: string, message: string, retryable: boolean, httpStatus: number, readonly responseData: unknown, options?: ConstructorParameters<typeof ArkmePluginError>[4]) {
    super(code, message, retryable, httpStatus, options)
  }
}

function stableReadParameters(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableReadParameters).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableReadParameters(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function readRecoveryDelay(error: unknown, attempt: number): number | undefined {
  if (!(error instanceof ArkmePluginError) || !error.retryable) return undefined
  // 明确的技术失败才重放；未知业务码不能按数值大小猜测。
  if (!['arkme-code-1002', 'arkme-timeout', 'arkme-network-error', 'arkme-http-error', 'team-openapi-unavailable'].includes(error.code)) return undefined
  return (error.retryAfterMillis ?? Math.min(2_000, 250 * 2 ** Math.max(0, attempt - 1))) + Math.floor(Math.random() * 75)
}

function readFailureCoolsRoute(error: unknown): boolean {
  return error instanceof ArkmePluginError && (error.retryScope === 'route' || error.upstreamStatus === 429)
}

export interface ArkmeOwnerReadPort {
  runOwnerRead<T>(route: string, parameters: Record<string, unknown>, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>
  withOwnerReadInvalidation<T>(route: string, operation: () => Promise<T>): Promise<T>
}

function exhaustedRead(error: unknown, attempts: number): ArkmePluginError {
  const known = error instanceof ArkmePluginError ? error : new ArkmePluginError('arkme-timeout', '读取超时，请稍后重试', true, 504)
  return new ArkmePluginError(known.code, known.message, known.retryable, known.httpStatus, {
    cause: known, ...known, recovery: { owner: 'host', attempts, exhausted: true },
  })
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
  private memberCacheRevision = 0
  memberCacheEpoch(): number { return this.memberCacheRevision }
  // A conservative runtime-wide fence drops old cache fills after confirmed member mutations.
  invalidateMemberCache(): void { this.memberCacheRevision += 1 }
  readonly requestCoordinator = new ArkmeRequestCoordinator()
  private readonly refreshInFlightByUserId = new Map<number, { refreshToken: string; promise: Promise<ArkmeSessionCredentials> }>()
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

  private readonly readRevisions = new Map<string, number>()
  readRevision(scope: string): number { return this.readRevisions.get(scope) ?? 0 }

  async withOwnerReadInvalidation<T>(route: string, operation: () => Promise<T>): Promise<T> {
    const session = await this.requireSession()
    try {
      // 只执行一次写入；未知写结果也需让后续查询回到 owner，不加入写前的 flight。
      return await operation()
    } finally {
      this.requestCoordinator.invalidateKey(this.requestScope(session.userId), `owner-read:${route}:`)
    }
  }

  async runOwnerRead<T>(route: string, parameters: Record<string, unknown>, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const session = await this.requireSession()
    const assertCurrentAccount = async (operationSignal: AbortSignal): Promise<void> => {
      operationSignal.throwIfAborted()
      const current = await this.accountScopedSession()
      operationSignal.throwIfAborted()
      // 独立凭据 owner 也必须绑定本次读取的登录身份；短 token 刷新不改变该身份。
      if (current?.userId !== session.userId || current.refreshToken !== session.refreshToken) {
        throw new ArkmePluginError('read-account-changed', '登录账号或凭据已变化，请重新读取', false, 409)
      }
    }
    return await this.requestCoordinator.run({
      scope: this.requestScope(session.userId), lane: 'interactive-read', service: 'extension',
      route, key: `owner-read:${route}:${stableReadParameters(parameters)}`, cancelWhenUnobserved: true,
      ...(signal === undefined ? {} : { signal }),
      operation: async operationSignal => {
        await assertCurrentAccount(operationSignal)
        const result = await operation(operationSignal)
        await assertCurrentAccount(operationSignal)
        return result
      },
      recovery: { maxAttempts: 3, deadlineMs: this.config.requestTimeoutMs, delay: readRecoveryDelay, coolsRoute: readFailureCoolsRoute, exhausted: exhaustedRead,
        timeout: () => new ArkmePluginError('arkme-timeout', '读取超时，请稍后重试', true, 504) },
    })
  }

  invalidateScope(scope: string): void {
    this.readRevisions.set(scope, this.readRevision(scope) + 1)
    this.requestCoordinator.invalidateScope(scope)
  }

  invalidateKey(scope: string, key: string): void {
    this.readRevisions.set(scope, this.readRevision(scope) + 1)
    this.requestCoordinator.invalidateKey(scope, key)
    // 既有业务 owner 的写后失效同样作用于统一原始读取；旧调用者仍可结束，新读不加入旧 flight。
    this.requestCoordinator.invalidateKey(scope, 'owner-read:')
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
    if (existing?.refreshToken === session.refreshToken) return await existing.promise
    const pendingBinding = this.isPendingBindingSession(session)
    const contextChanged = () => new ArkmePluginError('login-context-changed', '登录账号或凭据已变化，请重试当前操作', false, 409)
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
            key: `token-refresh:${createHash('sha256').update(session.refreshToken).digest('hex')}`,
            failureCooldownMs: 2_000,
          },
        )
        const accessToken = stringValue(data.access_token)
        if (accessToken === '') {
          throw new ArkmePluginError('refresh-contract-invalid', 'Arkme 登录刷新响应不完整', true, 502)
        }
        const updated = { ...session, accessToken }
        if (pendingBinding) {
          if (!this.isPendingBindingSession(session)) throw contextChanged()
          await this.writePendingBindingSession(updated)
        } else if (!await this.accountSessions.updateAccessToken(session, accessToken)) throw contextChanged()
        return updated
      } catch (error) {
        if (error instanceof ArkmePluginError
          && ['arkme-code-1004', 'auth-http-401', 'auth-http-403'].includes(error.code)) {
          if (pendingBinding) {
            if (!this.isPendingBindingSession(session)) throw contextChanged()
            await this.clearPendingBindingSession()
          } else if (!await this.accountSessions.deleteIfCurrent(session)) throw contextChanged()
          // 1004 是通用“账号不可用”，也覆盖注销等既有状态，不能在客户端臆断为封禁。
          if (error.code === 'arkme-code-1004') throw new ArkmePluginError('account-unavailable', '当前即我账号暂不可用', false, 403)
          throw new ArkmePluginError('login-expired', 'Arkme 登录已过期，请重新扫码', false, 401)
        }
        throw error
      }
    })()
    this.refreshInFlightByUserId.set(session.userId, { refreshToken: session.refreshToken, promise: refresh })
    try {
      return await refresh
    } finally {
      if (this.refreshInFlightByUserId.get(session.userId)?.promise === refresh) {
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

  private registeredRead(baseUrl: string, path: string): boolean {
    if (baseUrl === this.config.authBaseUrl && path === '/api/v1/auth/get-public-users-by-ids') return true
    if (baseUrl === this.config.chatBaseUrl && new Set([
      '/api/v1/chats/list', '/api/v1/chats/display-snapshots', '/api/v1/chats/unread-snapshot', '/api/v1/chats/contacts/list',
    ]).has(path)) return true
    if (baseUrl === this.config.botBaseUrl && path === '/api/v1/bot/list') return true
    if (baseUrl === this.config.audioBaseUrl && path === '/api/v1/audio/unmarked-speakers/list') return true
    return false
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
    const read = this.registeredRead(baseUrl, path) && !(body instanceof FormData)
    const route = `${baseUrl.replace(/\/+$/, '')}${path}`
    return await this.requestCoordinator.run<T>({
      scope: options.scope ?? 'public',
      lane: options.lane ?? 'write',
      service: options.service ?? this.requestService(baseUrl),
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(options.cacheMs === undefined ? {} : { cacheMs: options.cacheMs }),
      ...(options.failureCooldownMs === undefined ? {} : { failureCooldownMs: options.failureCooldownMs }),
      ...(options.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      ...(signal === undefined ? {} : { signal }),
      ...(read ? {
        lane: options.lane === 'background-read' ? 'background-read' as const : 'interactive-read' as const,
        route,
        key: `owner-read:${route}:${stableReadParameters(body)}`,
        cacheMs: 0,
        failureCooldownMs: 0,
        cancelWhenUnobserved: true,
        recovery: { maxAttempts: 3, deadlineMs: this.config.requestTimeoutMs, delay: readRecoveryDelay, coolsRoute: readFailureCoolsRoute, exhausted: exhaustedRead,
          timeout: () => new ArkmePluginError('arkme-timeout', '读取超时，请稍后重试', true, 504) },
      } : {}),
      shouldCooldown: error => !(error instanceof ArkmePluginError)
        || !['auth-http-401', 'auth-http-403', 'login-expired'].includes(error.code),
      serviceCooldownMs: error => read || options.publishServiceCooldown === false ? 0 : this.remoteServiceCooldownMs(error),
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
          response.status === 408 || response.status === 429 || response.status >= 500,
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
        const metadata = baseUrl === this.config.chatBaseUrl && envelope.code === 1002 ? objectValue(envelope.error) : {}
        const failureKind = knownStringValue(metadata.code, new Set(['rate_limited', 'concurrency_limited', 'service_unavailable'] as const))
        const delay = typeof metadata.retry_after_ms === 'number' && Number.isFinite(metadata.retry_after_ms) && metadata.retry_after_ms >= 0 ? metadata.retry_after_ms : undefined
        throw new ArkmeUpstreamResponseError(
          serviceErrorCode || `arkme-code-${envelope.code}`,
          failureKind === 'rate_limited' ? '请求较频繁，请稍后重试' : failureKind === 'concurrency_limited' ? '请求处理中，请稍后重试' : serviceMessage || envelope.message?.trim() || 'Arkme 服务请求失败',
          serviceErrorCode === '' ? (baseUrl === this.config.chatBaseUrl ? envelope.code === 1002 : envelope.code !== 1004 && envelope.code >= 500) : serviceErrorCode === 'ai_comic_video_rate_limited',
          502,
          envelope.data,
          { ...(failureKind === undefined ? {} : { failureKind }), ...(delay === undefined ? {} : { retryAfterMillis: delay }),
            ...(metadata.retry_scope === 'route' || metadata.retry_scope === 'request' ? { retryScope: metadata.retry_scope } : {}) },
        )
      }
      return (envelope.data ?? {}) as T
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
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
    options: ArkmeRemoteRequestOptions & { refreshOnUnauthorized?: boolean } = {},
  ): Promise<T> {
    const { refreshOnUnauthorized = true, ...remoteOptions } = options
    let session = initialSession ?? await this.requireSession()
    const requestOptions = () => this.authenticatedRequestOptions(session, 'chat', 'write', remoteOptions)
    try {
      return await this.post<T>(this.config.chatBaseUrl, path, body, session.accessToken, [200], signal, false, requestOptions())
    } catch (error) {
      if (!refreshOnUnauthorized || !(error instanceof ArkmePluginError)
        || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
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
