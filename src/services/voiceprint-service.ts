import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeMyVoiceprint,
  ArkmeRecognizedPersonDetail,
  ArkmeRecognizedPersonIdentityKind,
  ArkmeRecognizedPersonItem,
  ArkmeRecognizedPersonPage,
  ArkmeRecognizedVoiceprintItem,
  ArkmeRecognizedVoiceprintLibrary,
  ArkmeVoiceprintGrantItem,
  ArkmeVoiceprintGrantPage,
  ArkmeVoiceprintGrantRevocation,
  ArkmeVoiceprintInvitation,
  ArkmeVoiceprintPlaybackRestore,
  ArkmeVoiceprintEnrollmentResult,
} from '../types.js'
import {
  ARKME_VOICEPRINT_ENROLLMENT_MAX_AUDIO_BYTES,
  ARKME_VOICEPRINT_ENROLLMENT_MAX_DURATION_MS,
  ARKME_VOICEPRINT_ENROLLMENT_MIN_DURATION_MS,
} from '../types.js'
import type { ArkmePublicProfile } from './profile-service.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { validateVoiceprintPcm16Wav } from '../voiceprint-wav.js'

export interface ArkmeVoiceprintProfileReader {
  publicProfileSummariesByUserIds(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, ArkmePublicProfile>>
  sealProfileImageRef(viewerUserId: number, targetUserId: number): Promise<string>
}

export interface ArkmeVoiceprintInviteTargetResolver {
  resolveRegisteredContactUserId(
    contactRef: string,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<number>
}

export interface ArkmeBoundVoiceprintEnrollment {
  enrollVoiceprintWav(
    input: { wav: Uint8Array; durationMs: number },
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeVoiceprintEnrollmentResult>
}

interface VoiceprintGrantRefPayload {
  version: 1
  viewerUserId: number
  granteeUserId: number
}

type VoiceprintPersonRefPayload = {
  version: 1
  viewerUserId: number
  identityKind: 'speaker'
  speakerId: string
} | {
  version: 1
  viewerUserId: number
  identityKind: 'authorized_user'
  targetUserId: number
}

interface RecognizedPersonProjection {
  speakerId: string
  targetUserId: number
  displayName: string
  playGranted: boolean
  previewAvailable: boolean
  canInvite: boolean
}

const GRANT_REF_PREFIX = 'arkme-voiceprint-grant-v1'
const PERSON_REF_PREFIX = 'arkme-voiceprint-person-v1'
const SPEAKER_ID_PATTERN = /^[0-9a-f]{24}$/
const SHORT_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

function encodeOpaqueJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeOpaqueJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function integerValue(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN
}

function requiredBoolean(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw contractError(code)
  return value
}

function requiredInteger(value: unknown, code: string, minimum = 0): number {
  const parsed = integerValue(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw contractError(code)
  return parsed
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== 'string') throw contractError(code)
  return value
}

function contractError(code: string): ArkmePluginError {
  return new ArkmePluginError(code, '声纹服务返回的数据不完整，请稍后重试', true, 502)
}

function validOpaqueText(value: string, maxBytes: number): boolean {
  return value === value.trim() && Buffer.byteLength(value, 'utf8') <= maxBytes && !/[\u0000-\u001f\u007f]/u.test(value)
}

function validSpeakerId(value: string): boolean {
  return SPEAKER_ID_PATTERN.test(value) && value !== '000000000000000000000000'
}

export class VoiceprintService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ArkmeVoiceprintProfileReader,
    private readonly inviteTarget?: ArkmeVoiceprintInviteTargetResolver,
  ) {}

  async myVoiceprint(options: { signal?: AbortSignal } = {}): Promise<ArkmeMyVoiceprint> {
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/my', {}, undefined, options.signal,
      { key: 'voiceprint:self', cacheMs: 3_000, failureCooldownMs: 2_000 },
    )
    const hasVoiceprint = requiredBoolean(data.has_voiceprint, 'voiceprint-self-contract-invalid')
    const canIdentify = requiredBoolean(data.can_identify, 'voiceprint-self-contract-invalid')
    const canPlay = requiredBoolean(data.can_play, 'voiceprint-self-contract-invalid')
    const canRestorePlayback = requiredBoolean(data.can_restore_playback, 'voiceprint-self-contract-invalid')
    const rawStatus = requiredString(data.enrollment_status ?? 'none', 'voiceprint-self-contract-invalid').trim()
    if (!['none', 'processing', 'ready'].includes(rawStatus)) {
      throw contractError('voiceprint-self-contract-invalid')
    }
    const enrollmentStatus = rawStatus as ArkmeMyVoiceprint['enrollmentStatus']
    const pendingSessionId = requiredString(data.pending_session_id ?? '', 'voiceprint-self-contract-invalid').trim()
    const nickname = requiredString(data.nick_name ?? '', 'voiceprint-self-contract-invalid').trim()
    const updatedAtMillis = requiredInteger(data.updated_at ?? 0, 'voiceprint-self-contract-invalid')
    if (!validOpaqueText(pendingSessionId, 2_048)
      || (!hasVoiceprint && (canIdentify || canPlay || canRestorePlayback)) || (canPlay && !hasVoiceprint)) {
      throw contractError('voiceprint-self-contract-invalid')
    }
    return {
      hasVoiceprint, nickname, updatedAtMillis, canIdentify, canPlay, canRestorePlayback, enrollmentStatus,
      enrollmentPending: enrollmentStatus === 'processing' || pendingSessionId !== '',
    }
  }

  async outboundGrants(
    input: { cursor: string; limit: number },
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeVoiceprintGrantPage> {
    if (!validOpaqueText(input.cursor, 512) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ArkmePluginError('voiceprint-grant-page-invalid', '声纹授权分页参数无效', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/grants', { direction: 'outbound', cursor: input.cursor, limit: input.limit },
      session, options.signal, { key: `voiceprint:grants:${input.cursor}:${String(input.limit)}`, failureCooldownMs: 2_000 },
    )
    const rawItems = data.grant_ls
    if (!Array.isArray(rawItems)) throw contractError('voiceprint-grant-contract-invalid')
    const grants = rawItems.map(raw => this.parseOutboundGrant(objectValue(raw), session.userId))
    const granteeUserIds = [...new Set(grants.map(item => item.granteeUserId))]
    const profiles = await this.loadPublicProfiles(granteeUserIds, session, options.signal)
    const items: ArkmeVoiceprintGrantItem[] = []
    for (const grant of grants) {
      const publicProfile = profiles.get(grant.granteeUserId)
      const avatarRef = publicProfile?.avatarUrl === undefined
        ? undefined
        : await this.optionalAvatarRef(session.userId, grant.granteeUserId)
      items.push({
        grantRef: await this.sealRef(GRANT_REF_PREFIX, {
          version: 1, viewerUserId: session.userId, granteeUserId: grant.granteeUserId,
        } satisfies VoiceprintGrantRefPayload),
        displayName: publicProfile?.displayName.trim() || '用户资料不可用',
        ...(avatarRef === undefined ? {} : { avatarRef }),
        identifyEnabled: grant.identifyEnabled,
        playEnabled: grant.playEnabled,
        grantedAtMillis: grant.grantedAtMillis,
        updatedAtMillis: grant.updatedAtMillis,
      })
    }
    const nextCursor = requiredString(data.next_cursor, 'voiceprint-grant-contract-invalid')
    const hasMore = requiredBoolean(data.has_more, 'voiceprint-grant-contract-invalid')
    if (!validOpaqueText(nextCursor, 512) || hasMore !== (nextCursor !== '')) {
      throw contractError('voiceprint-grant-contract-invalid')
    }
    return { items, nextCursor, hasMore }
  }

  async recognizedPeople(
    input: { cursor: string; limit: number },
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeRecognizedPersonPage> {
    if (!validOpaqueText(input.cursor, 2_048) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new ArkmePluginError('voiceprint-person-page-invalid', '已识别人分页参数无效', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/recognized-speakers/list', { cursor: input.cursor, limit: input.limit },
      session, options.signal, { key: `voiceprint:people:${input.cursor}:${String(input.limit)}`, failureCooldownMs: 2_000 },
    )
    requiredBoolean(data.capability_enabled, 'voiceprint-person-contract-invalid')
    const rawItems = data.items
    if (!Array.isArray(rawItems)) throw contractError('voiceprint-person-contract-invalid')
    const projections = rawItems.map(raw => this.parseRecognizedPerson(objectValue(raw)))
    if (projections.some(item => item.targetUserId === session.userId)) {
      throw contractError('voiceprint-person-contract-invalid')
    }
    const targetUserIds = [...new Set(projections.map(item => item.targetUserId).filter(userId => userId > 0))]
    const profiles = await this.loadPublicProfiles(targetUserIds, session, options.signal)
    const items = await Promise.all(projections.map(async item => await this.projectRecognizedPerson(item, session, profiles)))
    const identities = new Set(items.map(item => item.personRef))
    if (identities.size !== items.length) throw contractError('voiceprint-person-contract-invalid')
    let reachedUnauthorized = false
    for (const item of items) {
      if (!item.playGranted) reachedUnauthorized = true
      else if (reachedUnauthorized) throw contractError('voiceprint-person-contract-invalid')
    }
    const nextCursor = requiredString(data.next_cursor, 'voiceprint-person-contract-invalid')
    const hasMore = requiredBoolean(data.has_more, 'voiceprint-person-contract-invalid')
    if (!validOpaqueText(nextCursor, 2_048) || hasMore !== (nextCursor !== '')) {
      throw contractError('voiceprint-person-contract-invalid')
    }
    return { items, nextCursor, hasMore }
  }

  async recognizedPerson(
    personRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeRecognizedPersonDetail> {
    const session = await this.runtime.requireSession()
    const reference = await this.openPersonRef(personRef, session.userId)
    return (await this.loadRecognizedPerson(reference, personRef, session, options)).detail
  }

  private async loadRecognizedPerson(
    reference: VoiceprintPersonRefPayload,
    personRef: string,
    session: ArkmeSessionCredentials,
    options: { signal?: AbortSignal },
  ): Promise<{ detail: ArkmeRecognizedPersonDetail; targetUserId: number }> {
    const selector = reference.identityKind === 'speaker'
      ? { speaker_id: reference.speakerId }
      : { target_user_id: reference.targetUserId }
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
        '/api/v1/audio/voiceprint/recognized-speakers/detail', selector,
        session, options.signal, { key: `voiceprint:person:${personRef}`, failureCooldownMs: 2_000 },
      )
    } catch (error) {
      if (error instanceof ArkmePluginError && error.code === 'arkme-code-1003') {
        throw new ArkmePluginError(
          'voiceprint-person-unavailable',
          '这条已识别人已不可访问，请刷新列表',
          false,
          410,
          { cause: error },
        )
      }
      throw error
    }
    const projection = this.parseRecognizedPerson(data)
    if ((reference.identityKind === 'speaker' && projection.speakerId !== reference.speakerId)
      || (reference.identityKind === 'authorized_user' && projection.targetUserId !== reference.targetUserId)
      || projection.targetUserId === session.userId) {
      throw contractError('voiceprint-person-contract-invalid')
    }
    const profiles = await this.loadPublicProfiles(
      projection.targetUserId > 0 ? [projection.targetUserId] : [], session, options.signal,
    )
    const claimRequired = requiredBoolean(data.claim_required, 'voiceprint-person-contract-invalid')
    if (claimRequired !== (projection.speakerId !== '' && projection.targetUserId === 0)) {
      throw contractError('voiceprint-person-contract-invalid')
    }
    return {
      detail: await this.projectRecognizedPerson(projection, session, profiles),
      targetUserId: projection.targetUserId,
    }
  }

  async recognizedPersonVoiceprints(
    personRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeRecognizedVoiceprintLibrary> {
    const session = await this.runtime.requireSession()
    const reference = await this.openPersonRef(personRef, session.userId)
    if (reference.identityKind !== 'speaker') {
      throw new ArkmePluginError(
        'voiceprint-library-unavailable',
        '只有录音中识别到的声音可以查看声纹记录',
        false,
        409,
      )
    }
    const selector = { speaker_id: reference.speakerId }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/recognized-speakers/voiceprints/list', selector,
      session, options.signal, { key: `voiceprint:library:${personRef}`, failureCooldownMs: 2_000 },
    )
    if (!Array.isArray(data.items)) throw contractError('voiceprint-library-contract-invalid')
    const items: ArkmeRecognizedVoiceprintItem[] = []
    const refs = new Set<string>()
    let reachedLocal = false
    let previousHitCount: number | undefined
    let previousAuthorized: boolean | undefined
    for (const raw of data.items) {
      const item = objectValue(raw)
      const voiceprintRef = requiredString(item.voiceprint_id, 'voiceprint-library-contract-invalid')
      const kindCode = requiredInteger(item.kind, 'voiceprint-library-contract-invalid', 1)
      const authorized = requiredBoolean(item.is_authorized, 'voiceprint-library-contract-invalid')
      const hitCount = requiredInteger(item.hit_count, 'voiceprint-library-contract-invalid')
      const createdAtMillis = item.created_at === undefined
        ? undefined
        : requiredInteger(item.created_at, 'voiceprint-library-contract-invalid', 1)
      if (!validOpaqueText(voiceprintRef, 2_048) || voiceprintRef === '' || refs.has(voiceprintRef)
        || ![1, 2, 3].includes(kindCode)
        || authorized !== (kindCode === 3) || (authorized && hitCount !== 0)) {
        throw contractError('voiceprint-library-contract-invalid')
      }
      if (!authorized) reachedLocal = true
      else if (reachedLocal) throw contractError('voiceprint-library-contract-invalid')
      if (previousAuthorized === authorized && previousHitCount !== undefined && hitCount > previousHitCount) {
        throw contractError('voiceprint-library-contract-invalid')
      }
      refs.add(voiceprintRef)
      previousAuthorized = authorized
      previousHitCount = hitCount
      items.push({
        kind: kindCode === 3 ? 'authorized' : kindCode === 2 ? 'legacy' : 'local',
        hitCount,
        ...(createdAtMillis === undefined ? {} : { createdAtMillis }),
      })
    }
    return { items }
  }

  async createInvitation(options: { signal?: AbortSignal } = {}): Promise<ArkmeVoiceprintInvitation> {
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/invites/create', { scope: 2 }, undefined, options.signal,
      { lane: 'write', key: `voiceprint:invite:${Date.now().toString(36)}`, bypassCache: true },
    )
    const inviteToken = requiredString(data.invite_token, 'voiceprint-invite-contract-invalid').trim()
    const previewToken = requiredString(data.preview_token, 'voiceprint-invite-contract-invalid').trim()
    const shortInviteToken = stringValue(data.short_invite_token).trim()
    const shortPreviewToken = stringValue(data.short_preview_token).trim()
    const expiresAtMillis = requiredInteger(data.expires_at, 'voiceprint-invite-contract-invalid', 1)
    const scope = requiredInteger(data.scope, 'voiceprint-invite-contract-invalid', 1)
    if (scope !== 2 || !validOpaqueText(inviteToken, 2_048) || inviteToken === ''
      || !validOpaqueText(previewToken, 2_048) || previewToken === '') {
      throw contractError('voiceprint-invite-contract-invalid')
    }
    const useShortPair = SHORT_INVITE_TOKEN_PATTERN.test(shortInviteToken)
      && SHORT_INVITE_TOKEN_PATTERN.test(shortPreviewToken)
    const token = useShortPair ? shortInviteToken : inviteToken
    const preview = useShortPair ? shortPreviewToken : previewToken
    return {
      inviteUrl: this.invitationUrl(token, preview, useShortPair),
      expiresAtMillis,
    }
  }

  async createRecognizedPersonInvitation(
    personRef: string,
    targetContactRef: string | undefined,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeVoiceprintInvitation> {
    const session = await this.runtime.requireSession()
    const reference = await this.openPersonRef(personRef, session.userId)
    if (reference.identityKind !== 'speaker') {
      throw new ArkmePluginError('voiceprint-person-invite-unavailable', '授权用户投影不能作为待认领声纹邀请', false, 409)
    }
    const current = await this.loadRecognizedPerson(reference, personRef, session, options)
    if (!current.detail.canInvite || current.detail.playGranted) {
      throw new ArkmePluginError('voiceprint-person-invite-unavailable', '这条已识别人当前不能生成邀请', false, 409)
    }
    const normalizedContactRef = targetContactRef?.trim() ?? ''
    const targetSelectionRequired = current.targetUserId === 0
    if (!targetSelectionRequired && normalizedContactRef !== '') {
      throw new ArkmePluginError('voiceprint-invite-target-unexpected', '这条已识别人已绑定用户，无需重新选择邀请对象', false)
    }
    let targetUserId = current.targetUserId
    if (targetSelectionRequired) {
      if (this.inviteTarget === undefined) {
        throw new ArkmePluginError('voiceprint-invite-target-unavailable', '当前运行时无法选择邀请对象', false, 503)
      }
      if (!validOpaqueText(normalizedContactRef, 256) || normalizedContactRef === '') {
        throw new ArkmePluginError('voiceprint-invite-target-invalid', '邀请对象引用无效，请重新搜索', false)
      }
      targetUserId = await this.inviteTarget.resolveRegisteredContactUserId(
        normalizedContactRef, session, options.signal,
      )
      if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || targetUserId === session.userId) {
        throw new ArkmePluginError('voiceprint-invite-target-invalid', '请选择其他已注册的 Arkme 用户', false)
      }
    }
    const request = targetSelectionRequired
      ? { speaker_id: reference.speakerId, target_user_id: targetUserId }
      : { speaker_id: reference.speakerId }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/recognized-speakers/invites/create',
      request,
      session, options.signal,
      { lane: 'write', key: `voiceprint:person-invite:${personRef}:${normalizedContactRef || 'bound'}`, bypassCache: true },
    )
    const inviteToken = requiredString(data.invite_token, 'voiceprint-person-invite-contract-invalid').trim()
    const previewToken = requiredString(data.preview_token, 'voiceprint-person-invite-contract-invalid').trim()
    const shortInviteToken = stringValue(data.short_invite_token).trim()
    const shortPreviewToken = stringValue(data.short_preview_token).trim()
    const expiresAtMillis = requiredInteger(data.expires_at, 'voiceprint-person-invite-contract-invalid', 1)
    if (requiredInteger(data.token_version, 'voiceprint-person-invite-contract-invalid', 1) !== 2
      || requiredString(data.speaker_id, 'voiceprint-person-invite-contract-invalid').trim().toLowerCase() !== reference.speakerId
      || requiredInteger(data.target_user_id, 'voiceprint-person-invite-contract-invalid', 1) !== targetUserId
      || requiredBoolean(data.claim_required, 'voiceprint-person-invite-contract-invalid') !== targetSelectionRequired
      || requiredInteger(data.scope, 'voiceprint-person-invite-contract-invalid', 1) !== 2
      || !validOpaqueText(inviteToken, 2_048) || inviteToken === ''
      || !validOpaqueText(previewToken, 2_048) || previewToken === '') {
      throw contractError('voiceprint-person-invite-contract-invalid')
    }
    const useShortPair = SHORT_INVITE_TOKEN_PATTERN.test(shortInviteToken)
      && SHORT_INVITE_TOKEN_PATTERN.test(shortPreviewToken)
    return {
      inviteUrl: this.invitationUrl(
        useShortPair ? shortInviteToken : inviteToken,
        useShortPair ? shortPreviewToken : previewToken,
        useShortPair,
      ),
      expiresAtMillis,
    }
  }

  async revokePlaybackGrant(
    grantRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeVoiceprintGrantRevocation> {
    const session = await this.runtime.requireSession()
    const reference = await this.openGrantRef(grantRef, session.userId)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/grants/set-scope',
      { grantee_user_id: reference.granteeUserId, scope: 2, enabled: false },
      session, options.signal, { lane: 'write', key: `voiceprint:revoke:${grantRef}`, bypassCache: true },
    )
    if (requiredBoolean(data.revoked, 'voiceprint-revoke-contract-invalid') !== true) {
      throw contractError('voiceprint-revoke-contract-invalid')
    }
    return { revoked: true }
  }

  async restorePlayback(options: { signal?: AbortSignal } = {}): Promise<ArkmeVoiceprintPlaybackRestore> {
    const session = await this.runtime.requireSession()
    this.runtime.invalidateKey(this.runtime.requestScope(session.userId), 'voiceprint:self')
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/restore-playback', {}, session, options.signal,
      { lane: 'write', key: `voiceprint:restore:${Date.now().toString(36)}`, bypassCache: true },
    )
    const result = {
      canPlay: requiredBoolean(data.can_play, 'voiceprint-restore-contract-invalid'),
      restored: requiredBoolean(data.restored, 'voiceprint-restore-contract-invalid'),
      updatedAtMillis: requiredInteger(data.updated_at ?? 0, 'voiceprint-restore-contract-invalid'),
    }
    if (result.restored && !result.canPlay) throw contractError('voiceprint-restore-contract-invalid')
    return result
  }

  async bindEnrollment(): Promise<ArkmeBoundVoiceprintEnrollment> {
    const viewerUserId = (await this.runtime.requireSession()).userId
    return {
      enrollVoiceprintWav: async (input, options = {}) => await this.enrollWav(input, {
        ...options,
        expectedViewerUserId: viewerUserId,
      }),
    }
  }

  async enrollWav(
    input: { wav: Uint8Array; durationMs: number },
    options: { signal?: AbortSignal; expectedViewerUserId?: number } = {},
  ): Promise<ArkmeVoiceprintEnrollmentResult> {
    const { wav, durationMs } = input
    if (!Number.isSafeInteger(durationMs)
      || durationMs < ARKME_VOICEPRINT_ENROLLMENT_MIN_DURATION_MS
      || durationMs > ARKME_VOICEPRINT_ENROLLMENT_MAX_DURATION_MS
      || wav.byteLength > ARKME_VOICEPRINT_ENROLLMENT_MAX_AUDIO_BYTES
      || wav.byteLength < 46) {
      throw new ArkmePluginError('voiceprint-enrollment-input-invalid', '声纹录音需为 3 至 60 秒的 WAV 音频', false)
    }
    try { validateVoiceprintPcm16Wav(wav, durationMs) }
    catch (error) {
      throw new ArkmePluginError('voiceprint-enrollment-input-invalid', '声纹录音需为 3 至 60 秒的单声道 PCM16 WAV 音频', false, 400, { cause: error })
    }
    const session = await this.runtime.requireSession()
    if (options.expectedViewerUserId !== undefined && session.userId !== options.expectedViewerUserId) {
      throw new ArkmePluginError('account-changed', '登录账号已切换，请在当前账号下重新录入', false, 409)
    }
    const form = new FormData()
    const wavBuffer = new Uint8Array(wav).buffer
    form.set('audio_file', new Blob([wavBuffer], { type: 'audio/wav' }), 'voiceprint.wav')
    form.set('duration_ms', String(durationMs))
    this.runtime.invalidateKey(this.runtime.requestScope(session.userId), 'voiceprint:self')
    const data = await this.runtime.authenticatedAudioMultipartPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/enroll-from-audio', form, session, options.signal,
      { key: `voiceprint:enroll:${Date.now().toString(36)}`, bypassCache: true },
    )
    const status = requiredString(data.status, 'voiceprint-enrollment-contract-invalid').trim()
    if (status !== 'processing') throw contractError('voiceprint-enrollment-contract-invalid')
    const result: ArkmeVoiceprintEnrollmentResult = {
      status,
      cloneReady: requiredBoolean(data.clone_ok, 'voiceprint-enrollment-contract-invalid'),
      updatedAtMillis: requiredInteger(data.updated_at, 'voiceprint-enrollment-contract-invalid', 1),
    }
    return result
  }

  private parseOutboundGrant(raw: Record<string, unknown>, viewerUserId: number): {
    granteeUserId: number
    identifyEnabled: boolean
    playEnabled: boolean
    grantedAtMillis: number
    updatedAtMillis: number
  } {
    const ownerUserId = requiredInteger(raw.owner_user_id, 'voiceprint-grant-contract-invalid', 1)
    const granteeUserId = requiredInteger(raw.grantee_user_id, 'voiceprint-grant-contract-invalid', 1)
    const status = requiredInteger(raw.status, 'voiceprint-grant-contract-invalid')
    if (ownerUserId !== viewerUserId || granteeUserId === viewerUserId || status !== 1) {
      throw contractError('voiceprint-grant-contract-invalid')
    }
    return {
      granteeUserId,
      identifyEnabled: requiredBoolean(raw.identify_enabled, 'voiceprint-grant-contract-invalid'),
      playEnabled: requiredBoolean(raw.play_enabled, 'voiceprint-grant-contract-invalid'),
      grantedAtMillis: requiredInteger(raw.play_granted_at ?? 0, 'voiceprint-grant-contract-invalid'),
      updatedAtMillis: requiredInteger(raw.update_at, 'voiceprint-grant-contract-invalid'),
    }
  }

  private parseRecognizedPerson(raw: Record<string, unknown>): RecognizedPersonProjection {
    const speakerId = requiredString(raw.speaker_id, 'voiceprint-person-contract-invalid').trim().toLowerCase()
    const targetUserId = requiredInteger(raw.target_user_id, 'voiceprint-person-contract-invalid')
    const displayName = requiredString(raw.display_name, 'voiceprint-person-contract-invalid').trim()
    const playGranted = requiredBoolean(raw.play_granted, 'voiceprint-person-contract-invalid')
    const previewAvailable = requiredBoolean(raw.preview_available, 'voiceprint-person-contract-invalid')
    const canInvite = requiredBoolean(raw.can_invite, 'voiceprint-person-contract-invalid')
    const hasSpeaker = validSpeakerId(speakerId)
    if ((speakerId !== '' && !hasSpeaker) || (!hasSpeaker && targetUserId <= 0)
      || canInvite === playGranted || (previewAvailable && !playGranted) || (playGranted && targetUserId <= 0)
      || (!hasSpeaker && canInvite)) {
      throw contractError('voiceprint-person-contract-invalid')
    }
    return { speakerId, targetUserId, displayName, playGranted, previewAvailable, canInvite }
  }

  private async projectRecognizedPerson(
    item: RecognizedPersonProjection,
    session: ArkmeSessionCredentials,
    profiles: ReadonlyMap<number, ArkmePublicProfile>,
  ): Promise<ArkmeRecognizedPersonItem> {
    const identityKind: ArkmeRecognizedPersonIdentityKind = item.speakerId === '' ? 'authorized_user' : 'speaker'
    const payload: VoiceprintPersonRefPayload = identityKind === 'speaker'
      ? { version: 1, viewerUserId: session.userId, identityKind, speakerId: item.speakerId }
      : { version: 1, viewerUserId: session.userId, identityKind, targetUserId: item.targetUserId }
    const publicProfile = item.targetUserId > 0 ? profiles.get(item.targetUserId) : undefined
    const avatarRef = publicProfile?.avatarUrl === undefined
      ? undefined
      : await this.optionalAvatarRef(session.userId, item.targetUserId)
    return {
      personRef: await this.sealRef(PERSON_REF_PREFIX, payload),
      identityKind,
      displayName: item.displayName || '未命名声纹',
      ...(avatarRef === undefined ? {} : { avatarRef }),
      playGranted: item.playGranted,
      previewAvailable: item.previewAvailable,
      canInvite: item.canInvite,
      inviteTargetSelectionRequired: item.canInvite && item.targetUserId === 0,
    }
  }

  private async loadPublicProfiles(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, ArkmePublicProfile>> {
    try { return await this.profile.publicProfileSummariesByUserIds(userIds, session, signal) }
    catch (error) {
      if (signal?.aborted === true) throw error
      return new Map()
    }
  }

  private async optionalAvatarRef(viewerUserId: number, targetUserId: number): Promise<string | undefined> {
    try { return await this.profile.sealProfileImageRef(viewerUserId, targetUserId) }
    catch { return undefined }
  }

  private async sealRef(prefix: string, payload: VoiceprintGrantRefPayload | VoiceprintPersonRefPayload): Promise<string> {
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest('base64url')
    return `${prefix}.${encoded}.${signature}`
  }

  private async openPersonRef(personRef: string, expectedViewerUserId: number): Promise<VoiceprintPersonRefPayload> {
    const normalized = personRef.trim()
    if (!validOpaqueText(normalized, 2_048)) throw this.invalidPersonRef()
    const parts = normalized.split('.')
    if (parts.length !== 3 || parts[0] !== PERSON_REF_PREFIX) throw this.invalidPersonRef()
    const encoded = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw this.invalidPersonRef()
    let raw: Record<string, unknown>
    try { raw = objectValue(decodeOpaqueJson(encoded)) }
    catch (error) { throw new ArkmePluginError('voiceprint-person-ref-invalid', '已识别人引用无效', false, 400, { cause: error }) }
    const viewerUserId = integerValue(raw.viewerUserId)
    if (raw.version !== 1 || viewerUserId !== expectedViewerUserId) throw this.invalidPersonRef(true)
    if (raw.identityKind === 'speaker') {
      const speakerId = stringValue(raw.speakerId).trim().toLowerCase()
      if (!validSpeakerId(speakerId)) throw this.invalidPersonRef()
      return { version: 1, viewerUserId, identityKind: 'speaker', speakerId }
    }
    if (raw.identityKind === 'authorized_user') {
      const targetUserId = integerValue(raw.targetUserId)
      if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) throw this.invalidPersonRef()
      return { version: 1, viewerUserId, identityKind: 'authorized_user', targetUserId }
    }
    throw this.invalidPersonRef()
  }

  private async openGrantRef(grantRef: string, expectedViewerUserId: number): Promise<VoiceprintGrantRefPayload> {
    const normalized = grantRef.trim()
    if (!validOpaqueText(normalized, 2_048)) throw this.invalidGrantRef()
    const parts = normalized.split('.')
    if (parts.length !== 3 || parts[0] !== GRANT_REF_PREFIX) throw this.invalidGrantRef()
    const encoded = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode()).update(encoded).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw this.invalidGrantRef()
    let raw: Record<string, unknown>
    try { raw = objectValue(decodeOpaqueJson(encoded)) }
    catch (error) { throw new ArkmePluginError('voiceprint-grant-ref-invalid', '声纹授权引用无效', false, 400, { cause: error }) }
    const viewerUserId = integerValue(raw.viewerUserId)
    const granteeUserId = integerValue(raw.granteeUserId)
    if (raw.version !== 1 || viewerUserId !== expectedViewerUserId || !Number.isSafeInteger(granteeUserId)
      || granteeUserId <= 0 || granteeUserId === expectedViewerUserId) {
      throw this.invalidGrantRef(viewerUserId !== expectedViewerUserId)
    }
    return { version: 1, viewerUserId, granteeUserId }
  }

  private invitationUrl(token: string, previewToken: string, compact: boolean): string {
    const base = this.runtime.config.environment === 'prod' ? 'https://jiwo.cc' : 'https://jotmo-app.senguo.me'
    const url = new URL(compact ? '/v' : '/app/voiceprint/invite', base)
    url.searchParams.set('p', previewToken)
    url.hash = `t=${token}`
    return url.toString()
  }

  private invalidPersonRef(accountMismatch = false): ArkmePluginError {
    return new ArkmePluginError(
      'voiceprint-person-ref-invalid',
      accountMismatch ? '已识别人引用与当前账号不匹配' : '已识别人引用无效',
      false,
      accountMismatch ? 403 : 400,
    )
  }

  private invalidGrantRef(accountMismatch = false): ArkmePluginError {
    return new ArkmePluginError(
      'voiceprint-grant-ref-invalid',
      accountMismatch ? '声纹授权引用与当前账号不匹配' : '声纹授权引用无效',
      false,
      accountMismatch ? 403 : 400,
    )
  }
}
