import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeAuthSnapshot, ArkmeCaptchaResult, ArkmePhoneBindingConflict,
  ArkmePhoneBindingConflictAccount, ArkmePhoneBindingConflictAction,
  ArkmePhoneVerificationResult, ArkmeUserProfileSnapshot,
} from '../types.js'
import { ProfileService, type ArkmePublicProfile } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

interface LoginAttempt {
  attemptId: string
  sceneStr: string
  pollToken: string
  qrContent: string
  expiresAtMillis: number
}

interface QrResponse { url?: unknown; scene_str?: unknown; poll_token?: unknown; expire_seconds?: unknown }
interface ScanResponse { access_token?: unknown; refresh_token?: unknown; user_id?: unknown }
interface TestLoginResponse { access_token?: unknown; refresh_token?: unknown }
interface BindPhoneResponse {
  result?: unknown
  conflict_ticket?: unknown
  conflict_expires_at?: unknown
  current_account?: unknown
  phone_account?: unknown
}
interface PhoneLoginResponse extends ScanResponse { ok?: unknown }
interface ResolvePhoneConflictResponse extends ScanResponse {
  result?: unknown
  action?: unknown
  rest_days_cancel?: unknown
}

interface StoredPhoneBindingConflict {
  backendTicket: string
  currentUserId: number
  phoneUserId: number
  expiresAtMillis: number
}

interface BackendPhoneBindingConflictAccount {
  userId: number
  displayName: string
  arkmeId: string
  registeredAtMillis: number
}

export interface ArkmeAuthLifecycle {
  reconnectChatRealtime(): void
  clearAccountState(userIds: readonly number[]): void
}

const ARKME_PHONE_BIND_SUCCESS = 1
const ARKME_PHONE_BIND_REPEAT = 2
const ARKME_PHONE_BIND_CODE_ERR = 3
const ARKME_PHONE_BIND_CONFLICT = 4
const ARKME_PHONE_CONFLICT_RESOLVE_SUCCESS = 1
const ARKME_PHONE_CONFLICT_TICKET_INVALID = 2
const ARKME_PHONE_CONFLICT_STATE_CHANGED = 3

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export class AuthService {
  private readonly attempts = new Map<string, LoginAttempt>()
  private readonly phoneBindingConflicts = new Map<string, StoredPhoneBindingConflict>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
    private readonly lifecycle: ArkmeAuthLifecycle,
  ) {}

  dispose(): void {
    this.attempts.clear()
    this.phoneBindingConflicts.clear()
  }

  async logout(): Promise<ArkmeAuthSnapshot> {
    const activeSession = await this.runtime.sessionStore.read()
    const pendingSession = await this.runtime.readPendingBindingSession()
    const userIds = [...new Set([activeSession?.userId, pendingSession?.userId]
      .filter((userId): userId is number => userId !== undefined))]
    for (const userId of userIds) {
      this.runtime.invalidateScope(this.runtime.requestScope(userId))
      this.runtime.clearRefreshForUser(userId)
    }
    await this.runtime.sessionStore.delete()
    await this.runtime.clearPendingBindingSession()
    this.profile.invalidate()
    this.attempts.clear()
    this.phoneBindingConflicts.clear()
    this.lifecycle.clearAccountState(userIds)
    this.lifecycle.reconnectChatRealtime()
    return { status: 'logged-out', environment: this.runtime.config.environment }
  }

  async authStatus(): Promise<ArkmeAuthSnapshot> {
    const activeSession = await this.runtime.sessionStore.read()
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
        await this.runtime.sessionStore.delete()
        this.lifecycle.reconnectChatRealtime()
      }
      return snapshot
    }
    const pendingSession = await this.runtime.readPendingBindingSession()
    return pendingSession === undefined
      ? { status: 'logged-out', environment: this.runtime.config.environment }
      : {
          status: 'binding-required',
          environment: this.runtime.config.environment,
          userId: pendingSession.userId,
        }
  }

  async beginWechatLogin(): Promise<ArkmeAuthSnapshot> {
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
    if (attempt === undefined) {
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
    return await this.acceptLoginSession(session)
  }

  async testLogin(userId: number): Promise<ArkmeAuthSnapshot> {
    if (this.runtime.config.environment !== 'test') {
      throw new ArkmePluginError('test-login-disabled', '测试账号登录仅允许测试环境使用', false, 403)
    }
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ArkmePluginError('test-user-id-invalid', '请输入有效的测试账号 user_id', false)
    }
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
    return await this.acceptLoginSession(session)
  }

  async sendPhoneCode(
    phone: string,
    captcha: ArkmeCaptchaResult,
    options: { resolveConflict?: boolean } = {},
  ): Promise<{ sent: true }> {
    const normalizedPhone = this.normalizedPhone(phone)
    const normalizedCaptcha = this.normalizedCaptcha(captcha)
    const session = await this.runtime.sessionStore.read() ?? await this.runtime.readPendingBindingSession()
    if (session !== undefined) {
      const data = await this.runtime.post<BindPhoneResponse>(
        this.runtime.config.authBaseUrl,
        '/api/v1/auth/bind-phone-send-code',
        {
          phone: normalizedPhone,
          pre: '86',
          is_test: this.runtime.config.environment === 'test',
          ...(options.resolveConflict === true ? { resolve_conflict: true } : {}),
          ...normalizedCaptcha,
        },
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

  async verifyPhoneCode(
    phone: string,
    code: string,
    options: { resolveConflict?: boolean } = {},
  ): Promise<ArkmePhoneVerificationResult> {
    const normalizedPhone = this.normalizedPhone(phone)
    const normalizedCode = code.trim()
    if (!/^[0-9]{6}$/.test(normalizedCode)) {
      throw new ArkmePluginError('phone-code-invalid', '请输入有效的短信验证码', false)
    }
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
          ...(options.resolveConflict === true ? { resolve_conflict: true } : {}),
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
      if (result === ARKME_PHONE_BIND_CONFLICT && options.resolveConflict === true) {
        return await this.rememberPhoneBindingConflict(data, session, normalizedPhone)
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
    return await this.acceptLoginSession(sessionAfterPhoneLogin)
  }

  async resolvePhoneBindingConflict(
    conflictRef: string,
    action: ArkmePhoneBindingConflictAction,
  ): Promise<ArkmeAuthSnapshot> {
    this.prunePhoneBindingConflicts()
    const conflict = this.phoneBindingConflicts.get(conflictRef)
    if (conflict === undefined) {
      throw new ArkmePluginError('phone-binding-conflict-expired', '本次手机号验证已失效，请重新获取验证码', false, 409)
    }
    if (!['transfer_to_current', 'login_phone_account'].includes(action)) {
      throw new ArkmePluginError('phone-binding-conflict-action-invalid', '请选择有效的账号处理方式', false, 400)
    }
    const currentSession = await this.runtime.sessionStore.read() ?? await this.runtime.readPendingBindingSession()
    if (currentSession === undefined || currentSession.userId !== conflict.currentUserId) {
      this.phoneBindingConflicts.delete(conflictRef)
      throw new ArkmePluginError('phone-binding-conflict-expired', '当前登录状态已变化，请重新登录', false, 409)
    }
    const data = await this.runtime.post<ResolvePhoneConflictResponse>(
      this.runtime.config.authBaseUrl,
      '/api/v1/auth/resolve-phone-binding-conflict',
      {
        conflict_ticket: conflict.backendTicket,
        action,
        unique_code: await this.runtime.stateStore.uniqueCode(),
      },
      currentSession.accessToken,
      [200],
    )
    const result = numberValue(data.result)
    if (result === ARKME_PHONE_CONFLICT_TICKET_INVALID) {
      this.phoneBindingConflicts.delete(conflictRef)
      throw new ArkmePluginError('phone-binding-conflict-expired', '本次手机号验证已失效，请重新获取验证码', false, 409)
    }
    if (result === ARKME_PHONE_CONFLICT_STATE_CHANGED) {
      this.phoneBindingConflicts.delete(conflictRef)
      throw new ArkmePluginError('phone-binding-conflict-changed', '账号绑定状态已变化，请重新检查手机号', false, 409)
    }
    if (result !== ARKME_PHONE_CONFLICT_RESOLVE_SUCCESS || stringValue(data.action) !== action) {
      throw new ArkmePluginError('phone-binding-conflict-contract-invalid', 'Arkme 账号处理响应不完整', false, 502)
    }

    let resolvedSession: ArkmeSessionCredentials
    if (action === 'transfer_to_current') {
      if (numberValue(data.user_id) !== currentSession.userId) {
        throw new ArkmePluginError('phone-binding-conflict-contract-invalid', 'Arkme 手机号换绑响应不完整', false, 502)
      }
      resolvedSession = currentSession
    } else {
      const userId = numberValue(data.user_id)
      const accessToken = stringValue(data.access_token)
      const refreshToken = stringValue(data.refresh_token)
      if (userId !== conflict.phoneUserId || accessToken === '' || refreshToken === '') {
        throw new ArkmePluginError('phone-binding-conflict-contract-invalid', 'Arkme 手机号账号登录响应不完整', false, 502)
      }
      resolvedSession = { userId, accessToken, refreshToken }
    }

    this.phoneBindingConflicts.delete(conflictRef)
    return await this.acceptResolvedPhoneSession(resolvedSession, [conflict.currentUserId, conflict.phoneUserId])
  }

  private async rememberPhoneBindingConflict(
    data: BindPhoneResponse,
    session: ArkmeSessionCredentials,
    phone: string,
  ): Promise<ArkmePhoneBindingConflict> {
    const backendTicket = stringValue(data.conflict_ticket).trim()
    const currentAccount = this.backendPhoneConflictAccount(data.current_account)
    const phoneAccount = this.backendPhoneConflictAccount(data.phone_account)
    const currentUserId = currentAccount.userId
    const phoneUserId = phoneAccount.userId
    const expiresAtMillis = numberValue(data.conflict_expires_at) * 1000
    const maxExpiresAtMillis = Date.now() + 10 * 60 * 1000
    if (backendTicket === '' || currentUserId !== session.userId || phoneUserId <= 0 || phoneUserId === currentUserId
      || expiresAtMillis <= Date.now() || expiresAtMillis > maxExpiresAtMillis) {
      throw new ArkmePluginError('phone-binding-conflict-contract-invalid', 'Arkme 手机号冲突响应不完整', false, 502)
    }

    let publicProfiles: Map<number, ArkmePublicProfile> | undefined
    try {
      publicProfiles = await this.profile.publicProfileSummariesByUserIds([currentUserId, phoneUserId], session)
    } catch {
      // Account choice remains usable when optional avatar enrichment is unavailable.
    }
    const [currentAccountProjection, phoneAccountProjection] = await Promise.all([
      this.browserPhoneConflictAccount(currentAccount, publicProfiles?.get(currentUserId), session),
      this.browserPhoneConflictAccount(phoneAccount, publicProfiles?.get(phoneUserId), session),
    ])

    this.prunePhoneBindingConflicts()
    for (const [ref, value] of this.phoneBindingConflicts) {
      if (value.currentUserId === currentUserId) this.phoneBindingConflicts.delete(ref)
    }
    const conflictRef = crypto.randomUUID()
    this.phoneBindingConflicts.set(conflictRef, {
      backendTicket,
      currentUserId,
      phoneUserId,
      expiresAtMillis,
    })
    return {
      status: 'phone-binding-conflict',
      conflictRef,
      phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
      currentAccount: currentAccountProjection,
      phoneAccount: phoneAccountProjection,
      expiresAtMillis,
    }
  }

  private backendPhoneConflictAccount(value: unknown): BackendPhoneBindingConflictAccount {
    const account = objectValue(value)
    const summary = {
      userId: numberValue(account.user_id),
      displayName: stringValue(account.display_name).trim().slice(0, 80),
      arkmeId: stringValue(account.jotmo_id).trim().slice(0, 80),
      registeredAtMillis: numberValue(account.registered_at_millis),
    }
    if (!Number.isSafeInteger(summary.userId) || summary.userId <= 0 || summary.displayName === ''
      || summary.arkmeId === '' || !Number.isSafeInteger(summary.registeredAtMillis)
      || summary.registeredAtMillis <= 0) {
      throw new ArkmePluginError('phone-binding-conflict-contract-invalid', 'Arkme 手机号冲突响应不完整', false, 502)
    }
    return summary
  }

  private async browserPhoneConflictAccount(
    account: BackendPhoneBindingConflictAccount,
    publicProfile: ArkmePublicProfile | undefined,
    session: ArkmeSessionCredentials,
  ): Promise<ArkmePhoneBindingConflictAccount> {
    const displayName = publicProfile?.displayName.trim() || account.displayName
    const avatarRef = publicProfile?.avatarUrl === undefined
      ? undefined
      : await this.profile.sealProfileImageRef(session.userId, account.userId)
    return {
      displayName,
      arkmeId: account.arkmeId,
      registeredAtMillis: account.registeredAtMillis,
      ...(avatarRef === undefined ? {} : { avatarRef }),
      ...(publicProfile?.avatarFallback === undefined ? {} : { avatarFallback: publicProfile.avatarFallback }),
    }
  }

  private prunePhoneBindingConflicts(): void {
    const now = Date.now()
    for (const [ref, conflict] of this.phoneBindingConflicts) {
      if (conflict.expiresAtMillis <= now) this.phoneBindingConflicts.delete(ref)
    }
  }

  private async acceptResolvedPhoneSession(
    session: ArkmeSessionCredentials,
    affectedUserIds: readonly number[],
  ): Promise<ArkmeAuthSnapshot> {
    const userIds = [...new Set([...affectedUserIds, session.userId])]
    for (const userId of userIds) {
      this.runtime.invalidateScope(this.runtime.requestScope(userId))
      this.runtime.clearRefreshForUser(userId)
      this.profile.invalidate(userId)
    }
    await this.runtime.sessionStore.write(session)
    await this.runtime.clearPendingBindingSession()
    this.attempts.clear()
    this.lifecycle.clearAccountState(userIds)
    this.lifecycle.reconnectChatRealtime()
    return {
      status: 'authenticated',
      environment: this.runtime.config.environment,
      userId: session.userId,
    }
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

  private async acceptLoginSession(session: ArkmeSessionCredentials): Promise<ArkmeAuthSnapshot> {
    this.runtime.invalidateScope(this.runtime.requestScope(session.userId))
    this.profile.invalidate(session.userId)
    const snapshot = await this.authSnapshotForSession(session, { forceProfile: true })
    if (snapshot.status === 'authenticated') {
      await this.runtime.clearPendingBindingSession()
      await this.runtime.sessionStore.write(session)
      this.lifecycle.reconnectChatRealtime()
      return snapshot
    }
    await this.runtime.writePendingBindingSession(session)
    await this.runtime.sessionStore.delete()
    this.lifecycle.reconnectChatRealtime()
    return snapshot
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
