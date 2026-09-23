import { createHash } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeAuthSnapshot, ArkmeCancellationSnapshot, ArkmeCaptchaResult, ArkmeUserProfileSnapshot } from '../types.js'
import { ProfileService } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, stringValue } from './service.js'

interface WechatLoginAttempt {
  kind: 'wechat'
  attemptId: string
  sceneStr: string
  pollToken: string
  qrContent: string
  expiresAtMillis: number
}

interface JiwoLoginAttempt {
  kind: 'jiwo'
  attemptId: string
  ticket: string
  pollSecret: string
  qrContent: string
  expiresAtMillis: number
}

type LoginAttempt = WechatLoginAttempt | JiwoLoginAttempt

interface QrResponse { url?: unknown; scene_str?: unknown; poll_token?: unknown; expire_seconds?: unknown }
interface ScanResponse { rest_days_cancel?: unknown; access_token?: unknown; refresh_token?: unknown; user_id?: unknown }
interface TestLoginResponse { rest_days_cancel?: unknown; access_token?: unknown; refresh_token?: unknown }
interface BindPhoneResponse { result?: unknown }
// Unlink result 2 means success; bind result 2 means the number is already bound.
interface PhoneUnbindResponse { result?: unknown }
interface PhoneLoginResponse extends ScanResponse { ok?: unknown }
interface JiwoStartResponse { ticket?: unknown; poll_secret?: unknown; expires_at?: unknown }
interface JiwoPollResponse extends ScanResponse { status?: unknown }

export interface ArkmeAuthLifecycle {
  reconnectChatRealtime(): void
  clearAccountState(userIds: readonly number[]): void
}

const ARKME_PHONE_BIND_SUCCESS = 1
const ARKME_PHONE_BIND_REPEAT = 2
const ARKME_PHONE_BIND_CODE_ERR = 3

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function jiwoScanLoginAvailable(config: ServiceRuntime['config']): boolean {
  try {
    const authUrl = new URL(config.authBaseUrl)
    const shareUrl = new URL(config.shareWebsite ?? '')
    if ([authUrl, shareUrl].some(url => url.protocol !== 'https:'
      || url.port !== ''
      || url.username !== ''
      || url.password !== '')) return false
    const authHost = authUrl.hostname.toLowerCase()
    const shareHost = shareUrl.hostname.toLowerCase()
    return config.environment === 'prod'
      ? authHost === 'api.jotmo.cc' && shareHost === 'jiwo.cc'
      : authHost === 'jotmo.senguo.me' && shareHost === 'jotmo-app.senguo.me'
  } catch {
    return false
  }
}

export class AuthService {
  private cancellationNotice: 'done' | 'waiting' | undefined
  private pendingCancellationLogin: { session: ArkmeSessionCredentials; days: number } | undefined
  private pendingCancellationCleanup: { session: ArkmeSessionCredentials; result: ArkmeCancellationSnapshot } | undefined
  private cancellationTask: Promise<ArkmeCancellationSnapshot> | undefined
  private pendingPhoneUnbindSession: ArkmeSessionCredentials | undefined

  private readonly attempts = new Map<string, LoginAttempt>()
  private jiwoAttemptGeneration = 0

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
    private readonly lifecycle: ArkmeAuthLifecycle,
  ) {}

  dispose(): void {
    this.jiwoAttemptGeneration += 1
    void this.cancelAllJiwoLoginAttempts()
    for (const [attemptId, attempt] of this.attempts) {
      if (attempt.kind === 'wechat') this.attempts.delete(attemptId)
    }
  }

  async logout(): Promise<ArkmeAuthSnapshot> {
    this.pendingCancellationLogin = undefined
    this.pendingPhoneUnbindSession = undefined
    const activeSession = await this.runtime.sessionStore.read()
    const pendingSession = await this.runtime.readPendingBindingSession()
    const userIds = [...new Set([activeSession?.userId, pendingSession?.userId]
      .filter((userId): userId is number => userId !== undefined))]
    for (const userId of userIds) {
      this.runtime.invalidateScope(this.runtime.requestScope(userId))
      this.runtime.clearRefreshForUser(userId)
    }
    await this.runtime.deleteSession()
    await this.runtime.clearPendingBindingSession()
    this.profile.invalidate()
    this.jiwoAttemptGeneration += 1
    await this.cancelAllJiwoLoginAttempts()
    this.attempts.clear()
    this.lifecycle.clearAccountState(userIds)
    this.lifecycle.reconnectChatRealtime()
    return { status: 'logged-out', environment: this.runtime.config.environment }
  }

  async authStatus(): Promise<ArkmeAuthSnapshot> {
    if (this.pendingCancellationLogin !== undefined) return this.cancellationLoginSnapshot()
    const activeSession = await this.runtime.sessionStore.read()
    const completion = await this.runtime.stateStore.readCancellationCompletion?.()
    if (completion !== undefined) {
      if (activeSession === undefined) this.cancellationNotice = completion.result.status === 'done' ? 'done' : 'waiting'
      else if (completion.userId === activeSession.userId && completion.sessionHash === this.cancellationSessionHash(activeSession)) {
        this.pendingCancellationCleanup = { session: activeSession, result: completion.result }
        await this.submitCancellation(activeSession.userId, completion.result.mode)
        return { status: 'logged-out', environment: this.runtime.config.environment, cancellationNotice: completion.result.status === 'done' ? 'done' : 'waiting' }
      }
    }
    if (activeSession !== undefined) {
      const cachedProfile = await this.runtime.stateStore.cachedProfile(activeSession.userId)
      const snapshot = cachedProfile.profile === null
        ? await this.authSnapshotForSession(activeSession)
        : {
            status: this.profileHasBoundPhone(cachedProfile) ? 'authenticated' : 'binding-required',
            environment: this.runtime.config.environment,
            userId: activeSession.userId,
          } satisfies ArkmeAuthSnapshot
      if (snapshot.status === 'binding-required') {
        await this.runtime.writePendingBindingSession(activeSession)
        await this.runtime.deleteSession()
        this.lifecycle.reconnectChatRealtime()
      }
      return snapshot
    }
    const pendingSession = await this.runtime.readPendingBindingSession()
    return pendingSession === undefined
      ? { status: 'logged-out', environment: this.runtime.config.environment, ...(this.cancellationNotice === undefined ? {} : { cancellationNotice: this.cancellationNotice }) }
      : {
          status: 'binding-required',
          environment: this.runtime.config.environment,
          userId: pendingSession.userId,
        }
  }

  async beginWechatLogin(): Promise<ArkmeAuthSnapshot> {
    this.pendingCancellationLogin = undefined
    this.jiwoAttemptGeneration += 1
    await this.cancelAllJiwoLoginAttempts()
    const data = await this.runtime.post<QrResponse>(
      this.runtime.config.authBaseUrl,
      '/api/public/v1/auth/wechat-oauth-login-qrcode',
      {},
      undefined,
      [200],
    )
    const sceneStr = stringValue(data.scene_str).trim()
    const pollToken = stringValue(data.poll_token).trim()
    const qrContent = stringValue(data.url).trim()
    const expireSeconds = Math.max(30, numberValue(data.expire_seconds) || 300)
    if (qrContent === '' && sceneStr !== '') {
      throw new ArkmePluginError(
        'wechat-qr-unavailable',
        '测试环境当前未返回可用微信二维码，请使用手机号登录',
        true,
        503,
      )
    }
    if (sceneStr === '' || pollToken === '' || qrContent === '') {
      throw new ArkmePluginError('login-contract-invalid', 'Arkme 登录二维码响应不完整', true, 502)
    }
    const attemptId = crypto.randomUUID()
    const attempt: LoginAttempt = {
      kind: 'wechat',
      attemptId,
      sceneStr,
      pollToken,
      qrContent,
      expiresAtMillis: Date.now() + expireSeconds * 1000,
    }
    this.attempts.clear()
    this.attempts.set(attemptId, attempt)
    return {
      status: 'pending',
      environment: this.runtime.config.environment,
      attemptId,
      qrContent,
      expiresAtMillis: attempt.expiresAtMillis,
    }
  }

  async pollWechatLogin(attemptId: string): Promise<ArkmeAuthSnapshot> {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined || attempt.kind !== 'wechat') {
      throw new ArkmePluginError('login-attempt-not-found', '登录二维码已失效，请重新获取', false, 404)
    }
    if (Date.now() >= attempt.expiresAtMillis) {
      this.attempts.delete(attemptId)
      return { status: 'expired', environment: this.runtime.config.environment }
    }
    const data = await this.runtime.post<ScanResponse>(
      this.runtime.config.authBaseUrl,
      '/api/public/v1/auth/wechat-oauth-login-poll',
      {
        scene_str: attempt.sceneStr,
        poll_token: attempt.pollToken,
        unique_code: await this.runtime.stateStore.uniqueCode(),
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
        environment: this.runtime.config.environment,
        attemptId,
        qrContent: attempt.qrContent,
        expiresAtMillis: attempt.expiresAtMillis,
      }
    }
    const accessToken = stringValue(data.access_token)
    const refreshToken = stringValue(data.refresh_token)
    if (accessToken === '' || refreshToken === '') {
      throw new ArkmePluginError('login-contract-invalid', 'Arkme 登录成功响应缺少凭据', false, 502)
    }
    const session = { accessToken, refreshToken, userId }
    this.attempts.delete(attemptId)
    return await this.acceptLoginSession(session, numberValue(data.rest_days_cancel))
  }

  async beginJiwoLogin(): Promise<ArkmeAuthSnapshot> {
    if (!jiwoScanLoginAvailable(this.runtime.config)) {
      throw new ArkmePluginError(
        'jiwo-scan-login-disabled',
        '即我扫码登录当前未启用',
        false,
        403,
      )
    }
    this.pendingCancellationLogin = undefined
    const attemptGeneration = ++this.jiwoAttemptGeneration
    await this.cancelAllJiwoLoginAttempts()
    const data = await this.runtime.post<JiwoStartResponse>(
      this.runtime.config.authBaseUrl,
      '/api/public/v1/auth/app-scan-login/start',
      {
        unique_code: await this.runtime.stateStore.uniqueCode(),
        ref: 0,
        keep_cancel: true,
      },
      undefined,
      [200],
    )
    const ticket = stringValue(data.ticket).trim()
    const pollSecret = stringValue(data.poll_secret).trim()
    const expiresAtMillis = numberValue(data.expires_at)
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)
      || !/^[A-Za-z0-9_-]{43}$/.test(pollSecret)
      || expiresAtMillis <= Date.now()) {
      throw new ArkmePluginError(
        'jiwo-login-contract-invalid',
        '即我登录二维码响应不完整',
        true,
        502,
      )
    }
    if (attemptGeneration !== this.jiwoAttemptGeneration) {
      await this.cancelJiwoCredentials(ticket, pollSecret)
      throw new ArkmePluginError(
        'login-attempt-canceled',
        '登录方式已切换',
        false,
        409,
      )
    }
    const shareWebsite = this.runtime.config.shareWebsite ?? ''
    const qrUrl = new URL('/login/desktop', shareWebsite)
    qrUrl.searchParams.set('ticket', ticket)
    const attemptId = crypto.randomUUID()
    const attempt: JiwoLoginAttempt = {
      kind: 'jiwo',
      attemptId,
      ticket,
      pollSecret,
      qrContent: qrUrl.toString(),
      expiresAtMillis,
    }
    this.attempts.clear()
    this.attempts.set(attemptId, attempt)
    return this.jiwoPendingSnapshot(attempt)
  }

  async pollJiwoLogin(attemptId: string): Promise<ArkmeAuthSnapshot> {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined || attempt.kind !== 'jiwo') {
      throw new ArkmePluginError(
        'login-attempt-not-found',
        '登录二维码已失效，请重新获取',
        false,
        404,
      )
    }
    if (Date.now() >= attempt.expiresAtMillis) {
      await this.cancelJiwoLogin(attemptId)
      return { status: 'expired', environment: this.runtime.config.environment }
    }
    const data = await this.runtime.post<JiwoPollResponse>(
      this.runtime.config.authBaseUrl,
      '/api/public/v1/auth/app-scan-login/poll',
      { ticket: attempt.ticket, poll_secret: attempt.pollSecret },
      undefined,
      [200],
    )
    if (this.attempts.get(attemptId) !== attempt) {
      return { status: 'expired', environment: this.runtime.config.environment }
    }
    const status = stringValue(data.status).trim()
    if (status === 'pending') return this.jiwoPendingSnapshot(attempt)
    if (status === 'expired') {
      this.attempts.delete(attemptId)
      return { status: 'expired', environment: this.runtime.config.environment }
    }
    if (status !== 'authenticated') {
      throw new ArkmePluginError(
        'jiwo-login-contract-invalid',
        '即我扫码登录状态无效',
        true,
        502,
      )
    }
    const userId = numberValue(data.user_id)
    const accessToken = stringValue(data.access_token)
    const refreshToken = stringValue(data.refresh_token)
    if (userId <= 0 || accessToken === '' || refreshToken === '') {
      throw new ArkmePluginError(
        'login-contract-invalid',
        'Arkme 登录成功响应缺少凭据',
        false,
        502,
      )
    }
    this.attempts.delete(attemptId)
    return await this.acceptLoginSession({ accessToken, refreshToken, userId }, numberValue(data.rest_days_cancel))
  }

  async cancelJiwoLogin(attemptId: string): Promise<{ canceled: true }> {
    if (attemptId.trim() === '') {
      return { canceled: true }
    }
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined || attempt.kind !== 'jiwo') return { canceled: true }
    this.jiwoAttemptGeneration += 1
    this.attempts.delete(attemptId)
    await this.cancelJiwoCredentials(attempt.ticket, attempt.pollSecret)
    return { canceled: true }
  }

  private async cancelJiwoCredentials(ticket: string, pollSecret: string): Promise<void> {
    try {
      await this.runtime.post<Record<string, unknown>>(
        this.runtime.config.authBaseUrl,
        '/api/public/v1/auth/app-scan-login/cancel',
        { ticket, poll_secret: pollSecret },
        undefined,
        [200],
      )
    } catch {
      // The local attempt is already invalidated; server TTL remains the fallback.
    }
  }

  private jiwoPendingSnapshot(attempt: JiwoLoginAttempt): ArkmeAuthSnapshot {
    return {
      status: 'pending',
      environment: this.runtime.config.environment,
      attemptId: attempt.attemptId,
      qrContent: attempt.qrContent,
      expiresAtMillis: attempt.expiresAtMillis,
    }
  }

  private async cancelAllJiwoLoginAttempts(): Promise<void> {
    const attempts = [...this.attempts.values()]
      .filter((attempt): attempt is JiwoLoginAttempt => attempt.kind === 'jiwo')
    for (const attempt of attempts) this.attempts.delete(attempt.attemptId)
    await Promise.all(attempts.map(async attempt => {
      await this.cancelJiwoCredentials(attempt.ticket, attempt.pollSecret)
    }))
  }

  async testLogin(userId: number): Promise<ArkmeAuthSnapshot> {
    if (this.runtime.config.environment !== 'test') {
      throw new ArkmePluginError('test-login-disabled', '测试账号登录仅允许测试环境使用', false, 403)
    }
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ArkmePluginError('test-user-id-invalid', '请输入有效的测试账号 user_id', false)
    }
    this.pendingCancellationLogin = undefined
    const data = await this.runtime.post<TestLoginResponse>(
      this.runtime.config.authBaseUrl,
      '/api/public/v1/auth/the-best-api-for-testing',
      {
        user_id: userId,
        unique_code: await this.runtime.stateStore.uniqueCode(),
        ref: 0,
        keep_cancel: true,
      },
      undefined,
      [200],
    )
    const accessToken = stringValue(data.access_token)
    const refreshToken = stringValue(data.refresh_token)
    if (accessToken === '' || refreshToken === '') {
      throw new ArkmePluginError('test-login-contract-invalid', '测试账号登录响应缺少凭据', false, 502)
    }
    const session = { accessToken, refreshToken, userId }
    this.attempts.clear()
    return await this.acceptLoginSession(session, numberValue(data.rest_days_cancel))
  }

  private async emailBindingRequest(expectedUserId: number, email: string, code?: string): Promise<void> {
    const session = await this.runtime.requireSession()
    if (session.userId !== expectedUserId) throw new ArkmePluginError('email-session-changed', '账号已切换，请重新打开账号设置', false)
    const normalizedEmail = email.trim()
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new ArkmePluginError('email-invalid', '请输入有效的邮箱地址', false)
    }
    if (code !== undefined && !/^[0-9]{4}$/.test(code.trim())) throw new ArkmePluginError('email-code-invalid', '请输入4位邮箱验证码', false)
    const data = await this.runtime.post<{ result?: unknown }>(this.runtime.config.authBaseUrl,
      code === undefined ? '/api/v1/auth/email-bind-send-code' : '/api/v1/auth/email-bind',
      { email: normalizedEmail, ...(code === undefined ? {} : { code: code.trim() }) }, session.accessToken, [200])
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) {
      throw new ArkmePluginError('email-session-changed', '账号已切换，请重新打开账号设置', false)
    }
    if (data.result !== 1) {
      const message = data.result === 2 ? '该邮箱已绑定其他账号' : data.result === 3 ? '当前账号已绑定邮箱，请刷新账号信息'
        : code !== undefined && data.result === 4 ? '邮箱或验证码错误' : '邮箱绑定响应异常，请重试'
      throw new ArkmePluginError('email-bind-rejected', message, false)
    }
    if (code !== undefined) this.profile.invalidate(session.userId)
  }

  async sendEmailBindCode(expectedUserId: number, email: string): Promise<{ sent: true }> {
    await this.emailBindingRequest(expectedUserId, email)
    return { sent: true }
  }

  async bindEmail(expectedUserId: number, email: string, code: string): Promise<{ bound: true }> {
    await this.emailBindingRequest(expectedUserId, email, code)
    return { bound: true }
  }

  async sendPhoneCode(phone: string, captcha: ArkmeCaptchaResult): Promise<{ sent: true }> {
    const normalizedPhone = this.normalizedPhone(phone)
    const normalizedCaptcha = this.normalizedCaptcha(captcha)
    const session = await this.runtime.sessionStore.read() ?? await this.runtime.readPendingBindingSession()
    if (session !== undefined) {
      const data = await this.runtime.post<BindPhoneResponse>(
        this.runtime.config.authBaseUrl,
        '/api/v1/auth/bind-phone-send-code',
        { phone: normalizedPhone, pre: '86', is_test: this.runtime.config.environment === 'test', ...normalizedCaptcha },
        session.accessToken,
        [200],
      )
      const result = numberValue(data.result)
      if (result === ARKME_PHONE_BIND_REPEAT) {
        throw new ArkmePluginError('phone-already-bound', '该手机号已绑定其他 Arkme 账号', false, 409)
      }
      return { sent: true }
    }
    await this.runtime.post<Record<string, unknown>>(
      this.runtime.config.authBaseUrl,
      '/api/public/v1/auth/phone-login-send-code',
      { phone: normalizedPhone, pre: '86', is_test: this.runtime.config.environment === 'test', ...normalizedCaptcha },
      undefined,
      [200],
    )
    return { sent: true }
  }

  async verifyPhoneCode(phone: string, code: string): Promise<ArkmeAuthSnapshot> {
    const normalizedPhone = this.normalizedPhone(phone)
    const normalizedCode = code.trim()
    if (!/^[0-9]{6}$/.test(normalizedCode)) {
      throw new ArkmePluginError('phone-code-invalid', '请输入有效的短信验证码', false)
    }
    this.pendingCancellationLogin = undefined
    const session = await this.runtime.sessionStore.read() ?? await this.runtime.readPendingBindingSession()
    if (session !== undefined) {
      const data = await this.runtime.post<BindPhoneResponse>(
        this.runtime.config.authBaseUrl,
        '/api/v1/auth/verify-bind-phone',
        {
          phone: normalizedPhone,
          pre: '86',
          code: normalizedCode,
          is_test: this.runtime.config.environment === 'test',
        },
        session.accessToken,
        [200],
      )
      const result = numberValue(data.result)
      if (result === ARKME_PHONE_BIND_REPEAT) {
        throw new ArkmePluginError('phone-already-bound', '该手机号已绑定其他 Arkme 账号', false, 409)
      }
      if (result === ARKME_PHONE_BIND_CODE_ERR) {
        throw new ArkmePluginError('phone-code-rejected', '手机号或验证码错误', false, 401)
      }
      if (result !== ARKME_PHONE_BIND_SUCCESS) {
        throw new ArkmePluginError('phone-bind-contract-invalid', 'Arkme 手机号绑定响应不完整', false, 502)
      }
      return await this.acceptLoginSession(session)
    }
    const data = await this.runtime.post<PhoneLoginResponse>(
      this.runtime.config.authBaseUrl,
      '/api/public/v1/auth/verify-phone-code-login',
      {
        phone: normalizedPhone,
        pre: '86',
        code: normalizedCode,
        token: '',
        unique_code: await this.runtime.stateStore.uniqueCode(),
        ref: 0,
        keep_cancel: true,
      },
      undefined,
      [200],
    )
    if (data.ok === false) {
      throw new ArkmePluginError('phone-code-rejected', '手机号或验证码错误', false, 401)
    }
    const userId = numberValue(data.user_id)
    const accessToken = stringValue(data.access_token)
    const refreshToken = stringValue(data.refresh_token)
    if (userId <= 0 || accessToken === '' || refreshToken === '') {
      throw new ArkmePluginError('login-contract-invalid', 'Arkme手机号登录响应不完整', false, 502)
    }
    const sessionAfterPhoneLogin = { accessToken, refreshToken, userId }
    this.attempts.clear()
    return await this.acceptLoginSession(sessionAfterPhoneLogin, numberValue(data.rest_days_cancel))
  }

  async checkPhoneUnbindEligibility(expectedUserId: number): Promise<{ allowed: boolean }> {
    const session = await this.runtime.requireSession()
    if (session.userId !== expectedUserId) {
      throw new ArkmePluginError('phone-unbind-session-changed', '账号已切换，请重新打开账号设置', false)
    }
    const data = await this.runtime.authenticatedAuthGet<{ user_id?: unknown; can_unbind_phone?: unknown }>(
      '/api/v1/auth/get-user-info?include_phone_unbind_eligibility=true', session, undefined,
      { lane: 'auth', bypassCache: true },
    )
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken
      || data.user_id !== session.userId || typeof data.can_unbind_phone !== 'boolean') {
      throw new ArkmePluginError('phone-unbind-eligibility-unknown', '账号状态未确认，请重新打开账号设置', true)
    }
    return { allowed: data.can_unbind_phone }
  }

  async sendPhoneUnbindCode(captcha: ArkmeCaptchaResult): Promise<{ sent: true }> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.post<PhoneUnbindResponse>(
      this.runtime.config.authBaseUrl, '/api/v1/auth/phone-unbind-send-code',
      { ...this.normalizedCaptcha(captcha) }, session.accessToken, [200],
    )
    this.checkPhoneUnbindResult(numberValue(data.result), true)
    return { sent: true }
  }

  async unbindPhone(code: string): Promise<ArkmeAuthSnapshot> {
    let session: ArkmeSessionCredentials
    try {
      session = await this.runtime.requireSession()
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || error.code !== 'login-required') throw error
      // Credential handoff can finish before desktop scope commit reports back.
      // Resume the persisted auth flow; never issue a second unlink from it.
      const pending = await this.runtime.readPendingBindingSession()
      if (pending === undefined || await this.runtime.sessionStore.read() !== undefined) throw error
      return { status: 'binding-required', environment: this.runtime.config.environment, userId: pending.userId }
    }
    if (!/^[0-9]{6}$/.test(code.trim())) {
      throw new ArkmePluginError('phone-code-invalid', '请输入有效的短信验证码', false)
    }
    if (this.pendingPhoneUnbindSession?.userId === session.userId
      && this.pendingPhoneUnbindSession.refreshToken === session.refreshToken) return await this.reconcilePhoneUnbind(session)
    try {
      const data = await this.runtime.post<PhoneUnbindResponse>(
        this.runtime.config.authBaseUrl, '/api/v1/auth/phone-unbind',
        { code: code.trim() }, session.accessToken, [200], undefined, false,
        this.runtime.authenticatedRequestOptions(session, 'auth', 'write', { trackWriteOutcome: true }),
      )
      // Result 1 confirms absence, not a second write; reconcile the owner fact.
      if (numberValue(data.result) !== 1) this.checkPhoneUnbindResult(numberValue(data.result), false)
      this.pendingPhoneUnbindSession = session
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !(error.writeOutcomeUnknown === true || ['arkme-network-error', 'arkme-timeout', 'arkme-response-invalid'].includes(error.code))) throw error
      this.pendingPhoneUnbindSession = session
    }
    return await this.reconcilePhoneUnbind(session)
  }

  private async reconcilePhoneUnbind(session: ArkmeSessionCredentials): Promise<ArkmeAuthSnapshot> {
    this.runtime.invalidateScope(this.runtime.requestScope(session.userId))
    this.profile.invalidate(session.userId)
    let phone: string
    try {
      // Absence of a display mask is not proof that the owner removed a binding.
      const data = await this.runtime.authenticatedAuthGet<{ user_id?: unknown; phone?: unknown }>(
        '/api/v1/auth/get-user-info', session, undefined, { lane: 'auth', bypassCache: true },
      )
      const current = await this.runtime.requireSession()
      if (data.user_id !== session.userId || typeof data.phone !== 'string'
        || current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new Error('binding fact unavailable')
      phone = data.phone
    } catch (error) {
      throw new ArkmePluginError('phone-unbind-outcome-unknown', '解绑状态尚未确认，请重试以刷新状态', true, 502, { cause: error })
    }
    if (phone.trim() !== '') {
      this.pendingPhoneUnbindSession = undefined
      throw new ArkmePluginError('phone-unbind-not-completed', '手机号仍处于绑定状态，请重新获取验证码', false)
    }
    // Use the account owner's atomic credential comparison: a late unlink
    // response must never delete a newly selected account's session.
    if (!await this.runtime.moveSessionToPendingBinding(session)) {
      this.pendingPhoneUnbindSession = undefined
      throw new ArkmePluginError('phone-unbind-session-changed', '账号已切换，请重新打开账号设置', false)
    }
    this.lifecycle.reconnectChatRealtime()
    this.pendingPhoneUnbindSession = undefined
    return { status: 'binding-required', environment: this.runtime.config.environment, userId: session.userId }
  }

  private checkPhoneUnbindResult(result: number, sending: boolean): void {
    if (result === 2) return
    const message = result === 1 ? '当前没有绑定手机号'
      : result === 3 ? '当前仅绑定了手机号，请先绑定其他登录方式'
      : result === 4 ? sending ? '当前号码暂不支持短信验证' : '验证码错误或已过期，请重新获取'
      : '手机号解绑失败，请稍后重试'
    throw new ArkmePluginError('phone-unbind-rejected', message, false)
  }

  private async authSnapshotForSession(
    session: ArkmeSessionCredentials,
    options: { forceProfile?: boolean } = {},
  ): Promise<ArkmeAuthSnapshot> {
    const profile = options.forceProfile === true
      ? await this.profile.refreshProfileForSession(session)
      : await this.profile.profileForSession(session)
    return {
      status: this.profileHasBoundPhone(profile) ? 'authenticated' : 'binding-required',
      environment: this.runtime.config.environment,
      userId: session.userId,
    }
  }

  private profileHasBoundPhone(snapshot: ArkmeUserProfileSnapshot): boolean {
    return (snapshot.profile?.contact.phoneMasked?.trim() ?? '') !== ''
  }

  private async acceptLoginSession(session: ArkmeSessionCredentials, restDaysCancel = 0, assertCurrent?: () => void): Promise<ArkmeAuthSnapshot> {
    // A fresh login supersedes any confirmation owned by another window or
    // account. Only the explicit pending-login resolver may retain its identity.
    if (assertCurrent === undefined) this.pendingCancellationLogin = undefined
    if (restDaysCancel > 0) {
      this.pendingCancellationLogin = { session, days: restDaysCancel }
      return this.cancellationLoginSnapshot()
    }
    await this.runtime.stateStore.writeCancellationCompletion?.(undefined)
    this.cancellationNotice = undefined
    this.runtime.invalidateScope(this.runtime.requestScope(session.userId))
    this.profile.invalidate(session.userId)
    const snapshot = await this.authSnapshotForSession(session, { forceProfile: true })
    assertCurrent?.()
    if (snapshot.status === 'authenticated') {
      await this.runtime.clearPendingBindingSession()
      assertCurrent?.()
      await this.runtime.writeSession(session)
      assertCurrent?.()
      this.lifecycle.reconnectChatRealtime()
      return snapshot
    }
    await this.runtime.writePendingBindingSession(session)
    assertCurrent?.()
    await this.runtime.deleteSession()
    assertCurrent?.()
    this.lifecycle.reconnectChatRealtime()
    return snapshot
  }

  private cancellationLoginSnapshot(): ArkmeAuthSnapshot {
    return { status: 'cancellation-pending', environment: this.runtime.config.environment,
      restDaysCancel: this.pendingCancellationLogin!.days }
  }

  async resolveCancellationLogin(continueLogin: boolean): Promise<ArkmeAuthSnapshot> {
    const pending = this.pendingCancellationLogin
    if (pending === undefined) throw new ArkmePluginError('cancellation-login-expired', '登录确认已失效，请重新登录', false)
    if (!continueLogin) {
      this.pendingCancellationLogin = undefined
      return { status: 'logged-out', environment: this.runtime.config.environment }
    }
    await this.runtime.post(this.runtime.config.authBaseUrl, '/api/v1/auth/abort-cancel', {}, pending.session.accessToken, [200])
    if (this.pendingCancellationLogin !== pending) throw new ArkmePluginError('cancellation-login-expired', '登录确认已失效，请重新登录', false)
    const snapshot = await this.acceptLoginSession(pending.session, 0, () => {
      if (this.pendingCancellationLogin !== pending) throw new ArkmePluginError('cancellation-login-expired', '登录确认已失效，请重新登录', false)
    })
    if (this.pendingCancellationLogin === pending) this.pendingCancellationLogin = undefined
    return snapshot
  }

  private async cancellationSession(expectedUserId: number): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (session.userId !== expectedUserId) throw new ArkmePluginError('cancellation-session-changed', '账号已切换，请重新打开账号设置', false)
    return session
  }

  private cancellationResult(data: ArkmeCancellationSnapshot): ArkmeCancellationSnapshot {
    if (!data || !['immediate', 'waiting'].includes(data.mode) || !['eligible', 'waiting', 'done'].includes(data.status)
      || !Number.isSafeInteger(data.cancel_at) || data.cancel_at < 0 || typeof data.has_phone !== 'boolean') {
      throw new ArkmePluginError('cancellation-contract-invalid', '注销状态未确认，请稍后重试', true, 502)
    }
    return data
  }

  async previewCancellation(expectedUserId: number): Promise<ArkmeCancellationSnapshot> {
    const session = await this.cancellationSession(expectedUserId)
    const data = await this.runtime.post<ArkmeCancellationSnapshot>(this.runtime.config.authBaseUrl,
      '/api/v1/auth/cancellation/preview', {}, session.accessToken, [200])
    const current = await this.cancellationSession(expectedUserId)
    if (current.refreshToken !== session.refreshToken) throw new ArkmePluginError('cancellation-session-changed', '登录状态已变化，请重试', false)
    return this.cancellationResult(data)
  }

  async submitCancellation(expectedUserId: number, expectedMode: string): Promise<ArkmeCancellationSnapshot> {
    if (expectedMode !== 'immediate' && expectedMode !== 'waiting') throw new ArkmePluginError('cancellation-mode-invalid', '请重新确认注销方式', false)
    if (this.cancellationTask !== undefined) throw new ArkmePluginError('cancellation-busy', '正在处理注销，请稍候', true)
    const task = this.performCancellation(expectedUserId, expectedMode)
    this.cancellationTask = task
    try { return await task } finally { if (this.cancellationTask === task) this.cancellationTask = undefined }
  }

  private async performCancellation(expectedUserId: number, expectedMode: string): Promise<ArkmeCancellationSnapshot> {
    let cleanup = this.pendingCancellationCleanup
    if (cleanup === undefined) {
      const completion = await this.runtime.stateStore.readCancellationCompletion?.()
      const active = await this.runtime.sessionStore.read()
      if (completion?.userId === expectedUserId && active === undefined) return completion.result
      if (completion?.userId === expectedUserId && active !== undefined
        && completion.sessionHash === this.cancellationSessionHash(active)) {
        cleanup = { session: active, result: completion.result }
        this.pendingCancellationCleanup = cleanup
      }
    }
    if (cleanup === undefined || cleanup.session.userId !== expectedUserId) {
      const session = await this.cancellationSession(expectedUserId)
      const result = this.cancellationResult(await this.runtime.post<ArkmeCancellationSnapshot>(this.runtime.config.authBaseUrl,
        '/api/v1/auth/cancellation/submit', { expected_mode: expectedMode }, session.accessToken, [200], undefined, false,
        this.runtime.authenticatedRequestOptions(session, 'auth', 'write', { trackWriteOutcome: true })))
      if (result.changed === true && result.status === 'eligible') return result
      if (result.status !== 'done' && result.status !== 'waiting') throw new ArkmePluginError('cancellation-contract-invalid', '注销状态未确认，请稍后重试', true)
      cleanup = { session, result }
      this.pendingCancellationCleanup = cleanup
    }
    // Atomic credential comparison prevents a late response from signing out another account.
    const current = await this.runtime.sessionStore.read()
    if (current !== undefined && (current.userId !== cleanup.session.userId || current.refreshToken !== cleanup.session.refreshToken)) {
      await this.runtime.stateStore.writeCancellationCompletion?.(undefined)
      this.pendingCancellationCleanup = undefined
      throw new ArkmePluginError('cancellation-session-changed', '账号已切换，原账号注销已处理', false)
    }
    await this.runtime.stateStore.writeCancellationCompletion?.({ userId: cleanup.session.userId,
      sessionHash: this.cancellationSessionHash(cleanup.session), result: cleanup.result })
    this.runtime.invalidateScope(this.runtime.requestScope(cleanup.session.userId))
    this.runtime.clearRefreshForUser(cleanup.session.userId)
    const deleted = await this.runtime.deleteSessionIfCurrent(cleanup.session)
    if (!deleted && await this.runtime.sessionStore.read() !== undefined) {
      await this.runtime.stateStore.writeCancellationCompletion?.(undefined)
      this.pendingCancellationCleanup = undefined
      throw new ArkmePluginError('cancellation-session-changed', '账号已切换，原账号注销已处理', false)
    }
    this.profile.invalidate(cleanup.session.userId)
    this.lifecycle.clearAccountState([cleanup.session.userId])
    this.lifecycle.reconnectChatRealtime()
    this.cancellationNotice = cleanup.result.status === 'done' ? 'done' : 'waiting'
    this.pendingCancellationCleanup = undefined
    return cleanup.result
  }

  private cancellationSessionHash(session: ArkmeSessionCredentials): string {
    return createHash('sha256').update(session.refreshToken).digest('hex')
  }

  private normalizedPhone(phone: string): string {
    const normalized = phone.replace(/[\s-]/g, '')
    if (!/^1[3-9][0-9]{9}$/.test(normalized)) {
      throw new ArkmePluginError('phone-invalid', '请输入有效的中国大陆手机号', false)
    }
    return normalized
  }

  private normalizedCaptcha(captcha: ArkmeCaptchaResult): ArkmeCaptchaResult {
    const normalized = {
      lot_number: stringValue(captcha.lot_number).trim(),
      captcha_output: stringValue(captcha.captcha_output).trim(),
      pass_token: stringValue(captcha.pass_token).trim(),
      gen_time: stringValue(captcha.gen_time).trim(),
    }
    if (Object.values(normalized).some(value => value === '')) {
      throw new ArkmePluginError('captcha-required', '请先完成安全验证', false)
    }
    return normalized
  }
}
