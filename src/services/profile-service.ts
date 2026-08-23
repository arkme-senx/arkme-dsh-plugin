import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeEnvironment,
  ArkmeGroupAvatarFallback,
  ArkmeIdAvailabilityReason,
  ArkmeIdAvailabilitySnapshot,
  ArkmeIdMutationResult,
  ArkmeUserCardSnapshot,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export interface ArkmePublicProfile {
  userId: number
  displayName: string
  nickname: string
  accountName?: string
  avatarUrl?: string
  avatarFallback?: ArkmeGroupAvatarFallback
  arkmeId?: string
}

export interface ArkmeProfileImageRefPayload {
  version: 1
  viewerUserId: number
  targetUserId: number
}

interface CacheEntry<T> {
  value: T
  expiresAtMillis: number
}

const PROFILE_CACHE_TTL_MS = 60_000
const PUBLIC_PROFILE_CACHE_TTL_MS = 60_000
const PUBLIC_PROFILE_NEGATIVE_CACHE_TTL_MS = 30_000
const PUBLIC_PROFILE_CACHE_MAX_ENTRIES = 4_096
const PUBLIC_PROFILE_AVATAR_CACHE_TTL_MS = 10 * 60 * 1000
const ARKME_ID_MIN_LENGTH_DEFAULT = 6
const ARKME_ID_MIN_LENGTH_STAFF = 5
const ARKME_ID_MAX_LENGTH = 20
const ARKME_STAFF_ACCOUNT_TYPE = 2

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function optionalBooleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function arkmeIdAvailabilityReason(value: unknown): ArkmeIdAvailabilityReason {
  switch (stringValue(value).trim()) {
    case 'invalid': return 'invalid'
    case 'taken': return 'taken'
    case 'modify_limited': return 'modify_limited'
    default: return 'server_busy'
  }
}

function normalizedArkmeId(value: string, accountType: number): string {
  const normalized = value.trim()
  const minLength = accountType === ARKME_STAFF_ACCOUNT_TYPE
    ? ARKME_ID_MIN_LENGTH_STAFF
    : ARKME_ID_MIN_LENGTH_DEFAULT
  if (normalized === '') throw new ArkmePluginError('arkme-id-empty', '请输入要设置的 Arkme ID', false)
  if (!/^[A-Za-z]/.test(normalized)) {
    throw new ArkmePluginError('arkme-id-leading-character-invalid', 'Arkme ID 必须以英文字母开头', false)
  }
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new ArkmePluginError('arkme-id-characters-invalid', 'Arkme ID 仅支持字母、数字、下划线或减号', false)
  }
  const length = [...normalized].length
  if (length < minLength || length > ARKME_ID_MAX_LENGTH) {
    throw new ArkmePluginError(
      'arkme-id-length-invalid',
      `Arkme ID 需要 ${String(minLength)}-${String(ARKME_ID_MAX_LENGTH)} 个字符`,
      false,
    )
  }
  return normalized
}

function unavailableArkmeIdError(availability: ArkmeIdAvailabilitySnapshot): ArkmePluginError {
  switch (availability.reason) {
    case 'taken': return new ArkmePluginError('arkme-id-taken', '这个 Arkme ID 已被占用，请换一个再试', false, 409)
    case 'modify_limited': return new ArkmePluginError('arkme-id-modify-limited', '每个账号通常只能修改一次 Arkme ID，你当前已无法再次修改', false, 409)
    case 'invalid': return new ArkmePluginError('arkme-id-invalid', '这个 Arkme ID 不符合设置规则，请检查后重试', false)
    default: return new ArkmePluginError('arkme-id-availability-unavailable', '暂时无法确认这个 Arkme ID 是否可用，请稍后重试', true, 503)
  }
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

function phoneDefaultAvatarFallback(raw: string): ArkmeGroupAvatarFallback | undefined {
  const prefix = 'phone_avatar://v1/'
  const normalized = raw.trim()
  if (!normalized.startsWith(prefix)) return undefined
  const parts = normalized.slice(prefix.length).split('/')
  const parsedColorIndex = Number(parts[0] ?? '')
  const label = [...(parts[1]?.trim() || '--')].slice(0, 4).join('')
  return {
    kind: 'phone_default',
    colorIndex: Number.isFinite(parsedColorIndex) ? Math.abs(Math.trunc(parsedColorIndex)) % 12 : 0,
    label,
  }
}

function allowedSignedImageHost(environment: ArkmeEnvironment, hostname: string): boolean {
  const allowed = environment === 'prod'
    ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc']
    : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me']
  return allowed.includes(hostname.toLowerCase())
}

function trustedSignedImageUrl(environment: ArkmeEnvironment, raw: string): URL {
  let parsed: URL
  try { parsed = new URL(raw.trim()) }
  catch (error) {
    throw new ArkmePluginError('image-ref-invalid', 'Arkme头像授权地址无效', false, 400, { cause: error })
  }
  const signature = parsed.searchParams.get('x-oss-signature')?.trim() ?? ''
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
    || !allowedSignedImageHost(environment, parsed.hostname) || parsed.pathname.replace(/^\/+/, '') === ''
    || signature === '') {
    throw new ArkmePluginError('image-sign-target-rejected', 'Arkme头像授权目标不受信任', false, 502)
  }
  return parsed
}

export class ProfileService {
  private readonly profileCache = new Map<number, CacheEntry<ArkmeUserProfileSnapshot>>()
  private readonly profileInFlight = new Map<number, Promise<ArkmeUserProfileSnapshot>>()
  private readonly publicProfileCache = new Map<string, CacheEntry<ArkmePublicProfile | null>>()
  private readonly publicProfileAvatarCache = new Map<string, { avatarUrl: string; expiresAtMillis: number }>()

  constructor(private readonly runtime: ServiceRuntime) {}

  invalidate(userId?: number): void {
    if (userId === undefined) {
      this.profileCache.clear()
      this.profileInFlight.clear()
      this.publicProfileCache.clear()
      this.publicProfileAvatarCache.clear()
      return
    }
    this.profileCache.delete(userId)
    this.profileInFlight.delete(userId)
    const prefix = `${String(userId)}:`
    for (const key of this.publicProfileCache.keys()) if (key.startsWith(prefix)) this.publicProfileCache.delete(key)
    for (const key of this.publicProfileAvatarCache.keys()) if (key.startsWith(prefix)) this.publicProfileAvatarCache.delete(key)
  }

  cachedPublicProfileAvatar(viewerUserId: number, targetUserId: number): string | undefined {
    const key = `${String(viewerUserId)}:${String(targetUserId)}`
    const cached = this.publicProfileAvatarCache.get(key)
    if (cached === undefined) return undefined
    if (cached.expiresAtMillis > Date.now()) return cached.avatarUrl
    this.publicProfileAvatarCache.delete(key)
    return undefined
  }

  invalidatePublicProfile(viewerUserId: number, targetUserId: number): void {
    const key = `${String(viewerUserId)}:${String(targetUserId)}`
    this.publicProfileAvatarCache.delete(key)
    this.publicProfileCache.delete(key)
  }

  async cachedProfile(): Promise<ArkmeUserProfileSnapshot> {
    const session = await this.runtime.requireAuthFlowSession()
    return await this.runtime.stateStore.cachedProfile(session.userId)
  }

  async refreshProfile(): Promise<ArkmeUserProfileSnapshot> {
    const session = await this.runtime.requireAuthFlowSession()
    return await this.refreshProfileForSession(session)
  }

  async checkArkmeIdAvailability(name: string): Promise<ArkmeIdAvailabilitySnapshot> {
    const snapshot = await this.refreshProfile()
    if (snapshot.profile === null) {
      throw new ArkmePluginError('profile-contract-invalid', 'Arkme 个人资料当前不可用', true, 502)
    }
    const target = normalizedArkmeId(name, snapshot.profile.accountType)
    return await this.remoteArkmeIdAvailability(target)
  }

  async setArkmeIdOnce(name: string): Promise<ArkmeIdMutationResult> {
    const before = await this.refreshProfile()
    const profile = before.profile
    if (profile === null) {
      throw new ArkmePluginError('profile-contract-invalid', 'Arkme 个人资料当前不可用', true, 502)
    }
    const session = await this.runtime.requireSession()
    if (session.userId !== profile.userId) {
      throw new ArkmePluginError('account-changed', 'Arkme 账号已发生切换，请重新查询资料后再确认修改', false, 409)
    }
    const target = normalizedArkmeId(name, profile.accountType)
    if (profile.arkmeId === target) {
      return {
        arkmeId: target,
        changed: false,
        canUpdate: profile.canUpdateArkmeId ?? false,
        revision: before.revision,
      }
    }
    if (profile.canUpdateArkmeId === false) {
      throw unavailableArkmeIdError({
        available: false,
        reason: 'modify_limited',
        arkmeId: target,
      })
    }

    const availability = await this.remoteArkmeIdAvailability(target, session)
    if (!availability.available) throw unavailableArkmeIdError(availability)

    try {
      const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
        '/api/v1/auth/update-jotmo-id',
        { name: target },
        session,
      )
      const returnedName = stringValue(data.name).trim() || target
      if (returnedName !== target) {
        throw new ArkmePluginError('arkme-id-update-contract-invalid', 'Arkme ID 设置结果与请求不一致，请刷新后确认', true, 502)
      }
    } catch (error) {
      const reconciled = await this.tryRefreshProfile()
      if (reconciled?.profile?.arkmeId === target) {
        return this.arkmeIdMutationResult(reconciled, profile.arkmeId)
      }
      if (error instanceof ArkmePluginError && error.code === 'arkme-code-1001') {
        try {
          const latestAvailability = await this.remoteArkmeIdAvailability(target)
          if (!latestAvailability.available) throw unavailableArkmeIdError(latestAvailability)
        } catch (availabilityError) {
          if (availabilityError instanceof ArkmePluginError
            && ['arkme-id-taken', 'arkme-id-modify-limited', 'arkme-id-invalid'].includes(availabilityError.code)) {
            throw availabilityError
          }
        }
        throw new ArkmePluginError(
          'arkme-id-update-rejected',
          'Arkme ID 设置未完成，请刷新资料确认修改资格，或换一个 ID 后重试',
          false,
          409,
          { cause: error },
        )
      }
      throw error
    }

    let after: ArkmeUserProfileSnapshot
    try {
      after = await this.refreshProfile()
    } catch {
      after = await this.runtime.stateStore.cacheProfile(session.userId, {
        ...profile,
        arkmeId: target,
        canUpdateArkmeId: false,
      })
    }
    if (after.profile?.arkmeId !== target) {
      throw new ArkmePluginError('arkme-id-update-contract-invalid', 'Arkme ID 设置已受理，但刷新结果不一致，请重新查询确认', true, 502)
    }
    return this.arkmeIdMutationResult(after, profile.arkmeId)
  }

  async userCard(userId: number, signal?: AbortSignal): Promise<ArkmeUserCardSnapshot> {
    const session = await this.runtime.requireSession()
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ArkmePluginError('user-card-target-invalid', '用户信息参数无效', false)
    }
    const profile = (await this.publicProfileSummariesByUserIds([userId], session, signal)).get(userId)
    const displayName = profile?.displayName ?? '群成员'
    return {
      displayName,
      ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.sealProfileImageRef(session.userId, userId) }),
    }
  }

  async profileForSession(session: ArkmeSessionCredentials): Promise<ArkmeUserProfileSnapshot> {
    const memory = this.profileCache.get(session.userId)
    if (memory !== undefined && memory.expiresAtMillis > Date.now()) return memory.value
    const persisted = await this.runtime.stateStore.cachedProfile(session.userId).catch(() => undefined)
    if (persisted?.profile?.userId === session.userId
      && persisted.cachedAtMillis > 0 && Date.now() - persisted.cachedAtMillis < PROFILE_CACHE_TTL_MS) {
      this.profileCache.set(session.userId, {
        value: persisted,
        expiresAtMillis: persisted.cachedAtMillis + PROFILE_CACHE_TTL_MS,
      })
      return persisted
    }
    return await this.refreshProfileForSession(session)
  }

  async refreshProfileForSession(session: ArkmeSessionCredentials): Promise<ArkmeUserProfileSnapshot> {
    const existing = this.profileInFlight.get(session.userId)
    if (existing !== undefined) return await existing
    const pending = (async () => {
      const data = await this.runtime.authenticatedAuthGet<Record<string, unknown>>(
        '/api/v1/auth/get-user-info',
        session,
        undefined,
        { lane: 'auth', key: 'profile:self', failureCooldownMs: 2_000 },
      )
      const userId = numberValue(data.user_id)
      if (userId <= 0 || userId !== session.userId) {
        throw new ArkmePluginError('profile-contract-invalid', 'Arkme 个人资料响应缺少有效用户标识', false, 502)
      }
      const nickname = stringValue(data.nick_name).trim()
      const displayName = nickname
        || stringValue(data.apple_nick_name).trim()
        || stringValue(data.wechat_nick_name).trim()
        || stringValue(data.google_given_name).trim()
        || stringValue(data.name_slug).trim()
        || 'Arkme用户'
      const avatarRef = stringValue(data.head_img).trim()
      const phone = maskedPhone(stringValue(data.phone))
      const email = maskedEmail(stringValue(data.email))
      const canUpdateArkmeId = optionalBooleanValue(data.can_update_jotmo_id)
      const profile: ArkmeUserProfile = {
        userId,
        displayName,
        nickname,
        avatarRef,
        ...(/^https?:\/\//i.test(avatarRef) ? { avatarUrl: avatarRef } : {}),
        arkmeId: stringValue(data.jotmo_id).trim() || stringValue(data.name_slug).trim(),
        ...(canUpdateArkmeId === undefined ? {} : { canUpdateArkmeId }),
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
      const snapshot = await this.runtime.stateStore.cacheProfile(userId, profile)
      this.profileCache.set(userId, { value: snapshot, expiresAtMillis: Date.now() + PROFILE_CACHE_TTL_MS })
      return snapshot
    })()
    this.profileInFlight.set(session.userId, pending)
    try {
      return await pending
    } finally {
      if (this.profileInFlight.get(session.userId) === pending) this.profileInFlight.delete(session.userId)
    }
  }

  async publicProfileSummariesByUserIds(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, ArkmePublicProfile>> {
    const normalized = [...new Set(userIds.filter(userId => Number.isSafeInteger(userId) && userId > 0))]
      .sort((left, right) => left - right)
    const profiles = new Map<number, ArkmePublicProfile>()
    const missing: number[] = []
    const now = Date.now()
    for (const [key, cached] of this.publicProfileCache) {
      if (cached.expiresAtMillis <= now) this.publicProfileCache.delete(key)
    }
    for (const userId of normalized) {
      const cached = this.publicProfileCache.get(`${String(session.userId)}:${String(userId)}`)
      if (cached === undefined || cached.expiresAtMillis <= now) {
        missing.push(userId)
        continue
      }
      if (cached.value !== null) profiles.set(userId, cached.value)
    }
    for (const batch of chunksOf(missing, 50)) {
      if (batch.length === 0) continue
      const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
        '/api/v1/auth/get-public-users-by-ids',
        { user_ids: batch },
        session,
        signal,
        {
          lane: 'background-read',
          key: `public-profiles:${batch.join('|')}`,
          failureCooldownMs: 5_000,
        },
      )
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const userId = numberValue(item.user_id)
        if (!batch.includes(userId)) continue
        const displayName = stringValue(item.nick_name ?? item.display_name ?? item.name_slug).trim()
        const nickname = stringValue(item.nick_name ?? item.nickname).trim()
        const accountName = stringValue(item.jotmo_id).trim()
          || stringValue(item.display_name).trim()
          || stringValue(item.name_slug).trim()
          || stringValue(item.arkme_id).trim()
        const arkmeId = stringValue(item.name_slug ?? item.arkme_id).trim()
        const avatarUrl = stringValue(item.head_img).trim()
        let trustedAvatarUrl: string | undefined
        const avatarFallback = phoneDefaultAvatarFallback(avatarUrl)
        if (avatarUrl !== '') {
          try {
            trustedSignedImageUrl(this.runtime.config.environment, avatarUrl)
            trustedAvatarUrl = avatarUrl
          } catch {
            trustedAvatarUrl = undefined
          }
        }
        const avatarCacheKey = `${String(session.userId)}:${String(userId)}`
        if (trustedAvatarUrl === undefined) this.publicProfileAvatarCache.delete(avatarCacheKey)
        else this.publicProfileAvatarCache.set(avatarCacheKey, {
          avatarUrl: trustedAvatarUrl,
          expiresAtMillis: Date.now() + PUBLIC_PROFILE_AVATAR_CACHE_TTL_MS,
        })
        profiles.set(userId, {
          userId,
          displayName,
          nickname,
          ...(accountName === '' ? {} : { accountName }),
          ...(trustedAvatarUrl === undefined ? {} : { avatarUrl: trustedAvatarUrl }),
          ...(avatarFallback === undefined ? {} : { avatarFallback }),
          ...(arkmeId === '' ? {} : { arkmeId }),
        })
      }
      for (const userId of batch) {
        const value = profiles.get(userId) ?? null
        this.publicProfileCache.set(`${String(session.userId)}:${String(userId)}`, {
          value,
          expiresAtMillis: Date.now() + (value === null
            ? PUBLIC_PROFILE_NEGATIVE_CACHE_TTL_MS
            : PUBLIC_PROFILE_CACHE_TTL_MS),
        })
        while (this.publicProfileCache.size > PUBLIC_PROFILE_CACHE_MAX_ENTRIES) {
          const oldestKey = this.publicProfileCache.keys().next().value as string | undefined
          if (oldestKey === undefined) break
          this.publicProfileCache.delete(oldestKey)
        }
      }
    }
    return profiles
  }

  async publicProfilesByUserIds(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, ArkmePublicProfile>> {
    const profiles = new Map<number, ArkmePublicProfile>()
    const summaries = await this.publicProfileSummariesByUserIds(userIds, session, signal)
    for (const [userId, profile] of summaries) {
      if (profile.avatarUrl === undefined) continue
      profiles.set(userId, profile)
    }
    return profiles
  }

  async interwovenProfilesByUserIds(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, { displayName: string; hasAvatar: boolean }>> {
    const normalized = [...new Set(userIds.filter(userId => Number.isSafeInteger(userId) && userId > 0))]
    const profiles = new Map<number, { displayName: string; hasAvatar: boolean }>()
    for (const batch of chunksOf(normalized, 100)) {
      if (batch.length === 0) continue
      const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
        '/api/v1/auth/get-public-users-by-ids', { user_ids: batch }, session, signal,
      )
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const userId = Math.trunc(numberValue(item.user_id))
        if (!batch.includes(userId)) continue
        let hasAvatar = false
        const avatarUrl = stringValue(item.head_img).trim()
        if (avatarUrl !== '') {
          try {
            trustedSignedImageUrl(this.runtime.config.environment, avatarUrl)
            hasAvatar = true
          } catch {
            // An invalid optional avatar must not hide the sender name or the moment itself.
          }
        }
        profiles.set(userId, {
          displayName: stringValue(item.nick_name).trim(),
          hasAvatar,
        })
      }
    }
    return profiles
  }

  async sealProfileImageRef(viewerUserId: number, targetUserId: number): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, viewerUserId, targetUserId } satisfies ArkmeProfileImageRefPayload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-profile-image-v1.${payload}.${signature}`
  }

  async openProfileImageRef(
    imageRef: string,
    expectedViewerUserId: number,
  ): Promise<ArkmeProfileImageRefPayload> {
    const parts = imageRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-profile-image-v1') {
      throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false)
    }
    let parsed: Record<string, unknown>
    try { parsed = objectValue(decodeOpaqueJson(payload)) }
    catch (error) {
      throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false, 400, { cause: error })
    }
    const result: ArkmeProfileImageRefPayload = {
      version: 1,
      viewerUserId: numberValue(parsed.viewerUserId),
      targetUserId: numberValue(parsed.targetUserId),
    }
    if (parsed.version !== 1 || result.viewerUserId !== expectedViewerUserId
      || !Number.isSafeInteger(result.targetUserId) || result.targetUserId <= 0) {
      throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用与当前账号不匹配', false, 403)
    }
    return result
  }

  async remoteArkmeIdAvailability(
    name: string,
    initialSession?: ArkmeSessionCredentials,
  ): Promise<ArkmeIdAvailabilitySnapshot> {
    const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/check-jotmo-id-available',
      { name, scene: 'user_update' },
      initialSession,
    )
    const available = data.available === true
    return {
      available,
      reason: available ? '' : arkmeIdAvailabilityReason(data.reason),
      arkmeId: stringValue(data.name).trim() || name,
    }
  }

  async tryRefreshProfile(): Promise<ArkmeUserProfileSnapshot | undefined> {
    try {
      return await this.refreshProfile()
    } catch {
      return undefined
    }
  }

  arkmeIdMutationResult(
    snapshot: ArkmeUserProfileSnapshot,
    previousArkmeId: string,
  ): ArkmeIdMutationResult {
    if (snapshot.profile === null) {
      throw new ArkmePluginError('profile-contract-invalid', 'Arkme 个人资料当前不可用', true, 502)
    }
    return {
      arkmeId: snapshot.profile.arkmeId,
      changed: snapshot.profile.arkmeId !== previousArkmeId,
      canUpdate: snapshot.profile.canUpdateArkmeId ?? false,
      revision: snapshot.revision,
    }
  }
}
