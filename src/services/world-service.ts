import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeImageBytes,
  ArkmeConversationWriteResult,
  ArkmeCreateFileAssetRecordResult,
  ArkmeUploadedAsset,
  ArkmeUserProfile,
  ArkmeWorldAvatarFallback,
  ArkmeWorldFeedItem,
  ArkmeWorldFeedPage,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintPlaybackChunk,
  ArkmeWorldVoiceprintSocialContext,
  ArkmeWorldVoiceprintSocialRelation,
  ArkmeWorldVoiceprintSocialRelationType,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionItem,
  ArkmeWorldInteractionPage,
  ArkmeWorldPublishResult,
  ArkmeWorldPublishFileAssetsInput,
  ArkmeWorldPublishTextInput,
  ArkmeWorldRecordItem,
  ArkmeWorldRecordList,
  ArkmeWorldVisibility,
} from '../types.js'
import type { ArkmeWorldImageEntry } from './media-service.js'
import type { ArkmeUserProfileSnapshot } from '../types.js'
import { ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES, ARKME_WORLD_PUBLISH_MAX_IMAGES } from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'

export interface ArkmeWorldProfileReader {
  refreshProfile(): Promise<ArkmeUserProfileSnapshot>
}

export interface ArkmeWorldMediaReader {
  issueWorldVoiceprintMediaRef(viewerUserId: number, input: { remoteUrl: string; mimeType: string }): string
  downloadSignedImage(signedUrl: URL, byteLimit: number, signal?: AbortSignal): Promise<ArkmeImageBytes>
}

export interface ArkmeWorldRecordWriter {
  createTextForConversation(recordUid: string, textContent: string): Promise<ArkmeConversationWriteResult>
  createFileAssetsForConversation(
    recordUid: string,
    textContent: string,
    assets: readonly ArkmeUploadedAsset[],
  ): Promise<ArkmeCreateFileAssetRecordResult>
}

interface ArkmeWorldRecordRefEntry {
  viewerUserId: number
  recordUid: string
  ownerUserId?: number
  authorName?: string
  textPreview?: string
  expiresAtMillis: number
}

interface ArkmeWorldAvatarResolutionCacheEntry {
  sourceUrl: string
  expiresAtMillis: number
}

const ARKME_WORLD_IMAGE_REF_TTL_MILLIS = 15 * 60 * 1000
const MAX_ARKME_WORLD_IMAGE_REFS = 2048
const ARKME_WORLD_AVATAR_RESOLUTION_CACHE_TTL_MILLIS = 5 * 60 * 1000
const MAX_ARKME_WORLD_AVATAR_RESOLUTION_CACHE_ENTRIES = 2048
const ARKME_WORLD_RECORD_REF_TTL_MILLIS = 15 * 60 * 1000
const MAX_ARKME_WORLD_RECORD_REFS = 4096
const ARKME_VOICEPRINT_PLAY_SCOPE = 2
const ARKME_VOICEPRINT_INVITE_TOKEN_MAX_LENGTH = 2048
const ARKME_VOICEPRINT_SOCIAL_CACHE_MILLIS = 5 * 60 * 1000
const ARKME_VOICEPRINT_SOCIAL_STALE_MILLIS = 24 * 60 * 60 * 1000
const ARKME_VOICEPRINT_SOCIAL_SOURCE_TIMEOUT_MILLIS = 4_000

interface ArkmeWorldVoiceprintDirectChat {
  sessionUid: string
  sharedTopicId: number
  hasPrivateMessageEvidence: boolean
}

interface ArkmeWorldVoiceprintSocialSourceResult {
  succeeded: boolean
  relations: ArkmeWorldVoiceprintSocialRelation[]
}

interface ArkmeWorldVoiceprintSocialLoadResult {
  context: ArkmeWorldVoiceprintSocialContext
  allSourcesSucceeded: boolean
}

interface ArkmeWorldVoiceprintSocialCacheEntry {
  context: ArkmeWorldVoiceprintSocialContext
  savedAtMillis: number
}

const WORLD_VOICEPRINT_SOCIAL_RELATIONS: Record<ArkmeWorldVoiceprintSocialRelationType, ArkmeWorldVoiceprintSocialRelation> = {
  reciprocal_expectation: {
    type: 'reciprocal_expectation', displayLine: 'TA也曾期待过你的声音',
    reasonCode: 'relationship_reciprocal_expectation', reasonLabel: '因为TA也曾期待过我的声音',
  },
  call: {
    type: 'call', displayLine: '你们曾经通过话',
    reasonCode: 'relationship_call', reasonLabel: '因为我们曾经通过话',
  },
  world_interaction: {
    type: 'world_interaction', displayLine: '你们曾在世界回应过彼此',
    reasonCode: 'relationship_world', reasonLabel: '因为我们在世界里回应过彼此',
  },
  group_interaction: {
    type: 'group_interaction', displayLine: '你们曾在同一个群里互动过',
    reasonCode: 'relationship_group', reasonLabel: '因为我们在群里有过互动',
  },
  private_chat: {
    type: 'private_chat', displayLine: '你们曾经聊过',
    reasonCode: 'relationship_chat', reasonLabel: '因为我们以前聊过',
  },
}

export interface ArkmeWorldVoiceprintInviteIntent {
  peerUserId: number
  peerDisplayName: string
  inviteUrl: string
  expiresAtMillis: number
  textPreview?: string
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function integerValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return 0
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) ? parsed : 0
}

function booleanValue(value: unknown): boolean { return value === true }
function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function isTopLevelWorldRecord(raw: unknown): boolean {
  return stringValue(objectValue(raw).parent_record_uid).trim() === ''
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

function optionalTrimmedText(value: string | undefined, limit: number): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (normalized === undefined || normalized === '') return undefined
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit).trimEnd()}...`
}

function buildVoiceprintInviteShareUrl(environment: 'test' | 'prod', token: string): string {
  const base = environment === 'prod' ? 'https://jiwo.cc' : 'https://jotmo-app.senguo.me'
  const url = new URL('/app/voiceprint/invite', base)
  url.hash = `t=${encodeURIComponent(token)}`
  return url.toString()
}

function validVoiceprintInviteToken(token: string): boolean {
  if (token === '' || token.length > ARKME_VOICEPRINT_INVITE_TOKEN_MAX_LENGTH) return false
  let byteLength = 0
  for (const char of token) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || codePoint === 0x7f) return false
    byteLength += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    if (byteLength > ARKME_VOICEPRINT_INVITE_TOKEN_MAX_LENGTH) return false
  }
  return true
}

function worldVisibility(checkStatus: number): ArkmeWorldVisibility {
  if (checkStatus === 1) return 'pending_review'
  if (checkStatus === 4) return 'rejected'
  if (checkStatus === 0 || checkStatus === 2 || checkStatus === 3) return 'visible'
  return 'unknown'
}

function worldPublicationResult(checkStatus: number): ArkmeWorldPublishResult {
  const visibility = worldVisibility(checkStatus)
  if (visibility === 'rejected') {
    return {
      recordSaved: true,
      recordState: 'synced',
      worldPublished: false,
      visibility,
      checkStatus,
      retryable: false,
      error: '内容未通过审核，请调整后重试',
    }
  }
  return {
    recordSaved: true,
    recordState: 'synced',
    worldPublished: true,
    visibility,
    checkStatus,
    retryable: false,
  }
}

function worldTags(text: string): string[] {
  return [...text.matchAll(/#(\S+)/gu)].map(match => match[1] ?? '').filter(tag => tag !== '')
}

function stableWorldInteractionRecordUid(userId: number, targetRecordUid: string, clientMutationId: string): string {
  const hex = createHash('sha256')
    .update(`dsh-arkme:world-interaction:${String(userId)}:${targetRecordUid}:${clientMutationId}`)
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function stableWorldPublishRecordUid(userId: number, clientMutationId: string): string {
  const hex = createHash('sha256')
    .update(`dsh-arkme:world-publish:${String(userId)}:${clientMutationId}`)
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function allowedSignedImageHost(environment: 'test' | 'prod', hostname: string): boolean {
  const allowed = environment === 'prod'
    ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc']
    : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me']
  return allowed.includes(hostname.toLowerCase())
}

function trustedWorldImageUrl(environment: 'test' | 'prod', raw: string): URL {
  let parsed: URL
  try { parsed = new URL(raw.trim()) }
  catch (error) { throw new ArkmePluginError('world-image-ref-invalid', '世界图片地址无效', false, 400, { cause: error }) }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
    || !allowedSignedImageHost(environment, parsed.hostname) || parsed.pathname.replace(/^\/+/, '') === '') {
    throw new ArkmePluginError('world-image-target-rejected', '世界图片目标不受信任', false, 502)
  }
  return parsed
}

function worldPhoneDefaultAvatar(raw: string): ArkmeWorldAvatarFallback | undefined {
  const prefix = 'phone_avatar://v1/'
  const normalized = raw.trim()
  if (!normalized.startsWith(prefix)) return undefined
  const [rawColorIndex = '', rawLabel = ''] = normalized.slice(prefix.length).split('/')
  const colorIndex = Number(rawColorIndex)
  const label = rawLabel.trim().slice(0, 8)
  if (!Number.isSafeInteger(colorIndex) || label === '') return undefined
  return { kind: 'phone_default', colorIndex, label }
}

function worldAvatarResolutionKey(ownerUserId: number, avatarRef: string): string {
  const normalized = avatarRef.trim()
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0 || !normalized.startsWith('file_asset://')) return ''
  return `${String(ownerUserId)}|${normalized}`
}

function worldImageAssetIdentity(raw: string): string {
  try {
    const parsed = new URL(raw.trim())
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`
  } catch {
    return raw.trim()
  }
}

export class WorldService {
  private readonly worldImageRefs = new Map<string, ArkmeWorldImageEntry>()
  private readonly worldAvatarResolutionCache = new Map<string, ArkmeWorldAvatarResolutionCacheEntry>()
  private readonly worldRecordRefs = new Map<string, ArkmeWorldRecordRefEntry>()
  private readonly voiceprintSocialCache = new Map<string, ArkmeWorldVoiceprintSocialCacheEntry>()
  private readonly voiceprintSocialInFlight = new Map<string, Promise<ArkmeWorldVoiceprintSocialContext>>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ArkmeWorldProfileReader,
    private readonly media: ArkmeWorldMediaReader,
    private readonly record: ArkmeWorldRecordWriter,
  ) {}

  dispose(): void {
    this.worldImageRefs.clear()
    this.worldAvatarResolutionCache.clear()
    this.worldRecordRefs.clear()
    this.voiceprintSocialCache.clear()
    this.voiceprintSocialInFlight.clear()
  }

  async listWorldRecords(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldRecordList> {
    const limit = Math.min(20, Math.max(1, Math.trunc(options.limit ?? 10)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    const data = await this.runtime.post<Record<string, unknown>>(
      this.runtime.config.worldBaseUrl, '/api/public/v1/public-record/world-list',
      { limit, offset }, undefined, [200], options.signal,
    )
    const rawItems = listValue(data.list)
    const items = rawItems.map(raw => this.worldRecordItem(raw)).filter(
      (item): item is ArkmeWorldRecordItem => item !== undefined,
    )
    const total = Math.max(0, Math.trunc(numberValue(data.total)))
    const nextOffset = offset + rawItems.length
    const hasMore = rawItems.length > 0 && nextOffset < total
    return { items, total, hasMore, ...(hasMore ? { nextOffset } : {}) }
  }

  async listWorldFeed(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    const session = await this.runtime.requireSession()
    const limit = Math.min(20, Math.max(1, Math.trunc(options.limit ?? 20)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    const data = await this.runtime.post<Record<string, unknown>>(
      this.runtime.config.worldBaseUrl, '/api/public/v1/public-record/world-list',
      { limit, offset }, undefined, [200], options.signal,
    )
    const rawItems = listValue(data.list)
    const resolvedAvatars = await this.resolveWorldAvatarUrls(rawItems, session, options.signal)
    const projected = await Promise.all(rawItems.map(raw => this.worldFeedItem(raw, session.userId, resolvedAvatars)))
    const items = projected.filter((item): item is ArkmeWorldFeedItem => item !== undefined)
    const total = Math.max(0, Math.trunc(numberValue(data.total)))
    const nextOffset = offset + rawItems.length
    const hasMore = rawItems.length > 0 && nextOffset < total
    return { items, total, hasMore, ...(hasMore ? { nextOffset } : {}) }
  }

  async listMyWorldFeed(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    const session = await this.runtime.requireSession()
    const limit = Math.min(20, Math.max(1, Math.trunc(options.limit ?? 20)))
    let offset = Math.max(0, Math.trunc(options.offset ?? 0))
    let total = 0
    let items: ArkmeWorldFeedItem[] = []
    let hasMore = false
    let attempts = 0

    do {
      const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
        '/api/v1/public-record/my-list', { limit, offset }, session, options.signal,
      )
      const rawItems = listValue(data.list)
      const rootItems = rawItems.filter(isTopLevelWorldRecord)
      const resolvedAvatars = await this.resolveWorldAvatarUrls(rootItems, session, options.signal)
      const projected = await Promise.all(rootItems.map(raw => this.worldFeedItem(raw, session.userId, resolvedAvatars)))
      items = projected.filter((item): item is ArkmeWorldFeedItem => item !== undefined)
      total = Math.max(0, Math.trunc(numberValue(data.total)))
      offset += rawItems.length
      hasMore = rawItems.length > 0 && offset < total
      attempts += 1
    } while (items.length === 0 && hasMore && attempts < 4)

    return { items, total, hasMore, ...(hasMore ? { nextOffset: offset } : {}) }
  }

  async listUserWorldFeed(
    userId: number,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ArkmePluginError('world-user-id-invalid', '世界用户 ID 无效，请刷新后重试', false, 400)
    }
    const session = await this.runtime.requireSession()
    const limit = Math.min(20, Math.max(1, Math.trunc(options.limit ?? 20)))
    let offset = Math.max(0, Math.trunc(options.offset ?? 0))
    let total = 0
    let items: ArkmeWorldFeedItem[] = []
    let hasMore = false
    let attempts = 0

    do {
      const data = await this.runtime.post<Record<string, unknown>>(
        this.runtime.config.worldBaseUrl, '/api/public/v1/public-record/user-list',
        { user_id: userId, limit, offset }, undefined, [200], options.signal,
      )
      const rawItems = listValue(data.list)
      total = Math.max(0, Math.trunc(numberValue(data.total)))
      const rootItems = rawItems.filter(isTopLevelWorldRecord)
      const resolvedAvatars = await this.resolveWorldAvatarUrls(rootItems, session, options.signal)
      const projected = await Promise.all(rootItems.map(raw => this.worldFeedItem(raw, session.userId, resolvedAvatars)))
      items = projected.filter((item): item is ArkmeWorldFeedItem => item !== undefined)
      offset += rawItems.length
      hasMore = rawItems.length > 0 && offset < total
      attempts += 1
    } while (items.length === 0 && hasMore && attempts < 4)

    return { items, total, hasMore, ...(hasMore ? { nextOffset: offset } : {}) }
  }

  async worldVoiceprintPlaybackAvailability(
    recordRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintAvailability> {
    const session = await this.runtime.requireSession()
    const normalizedRefs = [...new Set(recordRefs.map(value => value.trim()).filter(value => value !== ''))].slice(0, 20)
    if (normalizedRefs.length === 0) return { items: [] }
    const entries = normalizedRefs.map(recordRef => ({
      recordRef,
      entry: this.openWorldRecordRef(recordRef, session.userId),
    }))
    const ownerUserIds = [...new Set(entries
      .map(value => value.entry.ownerUserId ?? 0)
      .filter(userId => Number.isSafeInteger(userId) && userId > 0))]
      .sort((left, right) => left - right)
    if (ownerUserIds.length === 0) {
      return { items: entries.map(({ recordRef }) => ({ recordRef, playable: false })) }
    }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/world-playback-availability',
      { user_ids: ownerUserIds },
      session,
      signal,
      { key: ownerUserIds.join(','), cacheMs: 5_000 },
    )
    const playableByOwner = new Map<number, boolean>()
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const userId = Math.trunc(numberValue(item.user_id))
      if (userId > 0) playableByOwner.set(userId, item.playable === true)
    }
    return {
      items: entries.map(({ recordRef, entry }) => ({
        recordRef,
        playable: playableByOwner.get(entry.ownerUserId ?? 0) === true,
      })),
    }
  }

  async generateWorldVoiceprintPlayback(input: {
    recordRef: string
    chunkIndex?: number
    signal?: AbortSignal
  }): Promise<ArkmeWorldVoiceprintPlaybackChunk> {
    const session = await this.runtime.requireSession()
    const entry = this.openWorldRecordRef(input.recordRef, session.userId)
    const chunkIndex = Math.trunc(input.chunkIndex ?? 0)
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= 334) {
      throw new ArkmePluginError('world-voiceprint-playback-input-invalid', '世界声纹播放参数无效，请刷新后重试', false)
    }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/generate-playback',
      {
        source_scene: 4,
        source_id: entry.recordUid,
        source_chunk_index: chunkIndex,
        source_chunk_max_runes: 120,
      },
      session,
      input.signal,
      { lane: 'write', bypassCache: true },
    )
    const mimeType = stringValue(data.mime_type).trim() || 'audio/wav'
    const responseChunkIndex = Math.trunc(numberValue(data.source_chunk_index))
    const chunkCount = Math.trunc(numberValue(data.source_chunk_count))
    const chunkStartRune = Math.trunc(numberValue(data.source_chunk_start_rune))
    const chunkEndRune = Math.trunc(numberValue(data.source_chunk_end_rune))
    if (responseChunkIndex !== chunkIndex || chunkCount <= 0 || chunkCount > 334 || chunkIndex >= chunkCount
      || chunkStartRune < 0 || chunkEndRune <= chunkStartRune) {
      throw new ArkmePluginError('world-voiceprint-playback-response-invalid', '世界声纹播放响应无效，请重试', true, 502)
    }
    return {
      mediaRef: this.media.issueWorldVoiceprintMediaRef(session.userId, {
        remoteUrl: stringValue(data.audio_url),
        mimeType,
      }),
      mimeType,
      durationMillis: Math.max(0, Math.trunc(numberValue(data.duration_ms))),
      cacheHit: data.cache_hit === true,
      chunkIndex: responseChunkIndex,
      chunkCount,
      chunkStartRune,
      chunkEndRune,
    }
  }

  async worldVoiceprintSocialContext(
    recordRef: string,
    options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldVoiceprintSocialContext> {
    const session = await this.runtime.requireSession()
    const entry = this.openWorldRecordRef(recordRef, session.userId)
    const authorUserId = entry.ownerUserId ?? 0
    if (!Number.isSafeInteger(authorUserId) || authorUserId <= 0 || authorUserId === session.userId) {
      return { relations: [] }
    }
    const cacheKey = `${String(session.userId)}:${String(authorUserId)}`
    const cached = this.voiceprintSocialCache.get(cacheKey)
    const age = cached === undefined ? Number.POSITIVE_INFINITY : Date.now() - cached.savedAtMillis
    if (options.forceRefresh !== true && cached !== undefined
      && cached.context.relations.length > 0 && age < ARKME_VOICEPRINT_SOCIAL_CACHE_MILLIS) {
      return cached.context
    }
    if (options.forceRefresh !== true && cached !== undefined
      && cached.context.relations.length > 0 && age < ARKME_VOICEPRINT_SOCIAL_STALE_MILLIS) {
      void this.refreshWorldVoiceprintSocialContext({
        cacheKey, flightKey: `${cacheKey}:${entry.recordUid}`, viewerUserId: session.userId,
        authorUserId, recordUid: entry.recordUid, fallback: cached,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      return cached.context
    }
    return await this.refreshWorldVoiceprintSocialContext({
      cacheKey, flightKey: `${cacheKey}:${entry.recordUid}`, viewerUserId: session.userId,
      authorUserId, recordUid: entry.recordUid,
      ...(cached === undefined ? {} : { fallback: cached }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  async createWorldVoiceprintInviteIntent(
    recordRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintInviteIntent> {
    const session = await this.runtime.requireSession()
    const entry = this.openWorldRecordRef(recordRef, session.userId)
    const peerUserId = entry.ownerUserId ?? 0
    if (!Number.isSafeInteger(peerUserId) || peerUserId <= 0) {
      throw new ArkmePluginError('world-voiceprint-invite-target-missing', '无法确认这条世界动态的作者，请刷新后重试', false)
    }
    if (peerUserId === session.userId) {
      throw new ArkmePluginError('world-voiceprint-invite-self-invalid', '这是你自己的动态，不需要提醒自己开启声纹', false, 409)
    }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/invites/create',
      { scope: ARKME_VOICEPRINT_PLAY_SCOPE },
      session,
      signal,
      { lane: 'write', bypassCache: true },
    )
    const token = stringValue(data.invite_token).trim()
    const expiresAtMillis = Math.trunc(numberValue(data.expires_at))
    const scope = Math.trunc(numberValue(data.scope))
    if (!validVoiceprintInviteToken(token) || expiresAtMillis <= 0 || scope !== ARKME_VOICEPRINT_PLAY_SCOPE) {
      throw new ArkmePluginError('world-voiceprint-invite-contract-invalid', '声纹邀请响应不完整，请稍后重试', true, 502)
    }
    return {
      peerUserId,
      peerDisplayName: optionalTrimmedText(entry.authorName, 64) ?? '这位用户',
      inviteUrl: buildVoiceprintInviteShareUrl(this.runtime.config.environment, token),
      expiresAtMillis,
      ...(entry.textPreview === undefined ? {} : { textPreview: entry.textPreview }),
    }
  }

  private refreshWorldVoiceprintSocialContext(input: {
    cacheKey: string
    flightKey: string
    viewerUserId: number
    authorUserId: number
    recordUid: string
    fallback?: ArkmeWorldVoiceprintSocialCacheEntry
    signal?: AbortSignal
  }): Promise<ArkmeWorldVoiceprintSocialContext> {
    const existing = this.voiceprintSocialInFlight.get(input.flightKey)
    if (existing !== undefined) return existing
    const refresh = this.loadWorldVoiceprintSocialContext(input)
      .then(result => {
        const context = this.mergeWorldVoiceprintSocialContexts(input.fallback?.context, result.context)
        if (context.relations.length > 0 || result.allSourcesSucceeded) {
          this.voiceprintSocialCache.set(input.cacheKey, { context, savedAtMillis: Date.now() })
        }
        return context
      })
      .catch(() => input.fallback?.context.relations.length
        ? input.fallback.context
        : { relations: [] })
      .finally(() => { this.voiceprintSocialInFlight.delete(input.flightKey) })
    this.voiceprintSocialInFlight.set(input.flightKey, refresh)
    return refresh
  }

  private async loadWorldVoiceprintSocialContext(input: {
    viewerUserId: number
    authorUserId: number
    recordUid: string
    signal?: AbortSignal
  }): Promise<ArkmeWorldVoiceprintSocialLoadResult> {
    const session = await this.runtime.requireSession()
    const directChat = this.loadWorldVoiceprintDirectChat(input.authorUserId, session, input.signal)
    const results = await Promise.all([
      this.guardWorldVoiceprintSocialSource(
        async () => await this.loadWorldVoiceprintReciprocalExpectation(input.authorUserId, session, input.signal),
      ),
      this.guardWorldVoiceprintSocialSource(
        async () => await this.loadWorldVoiceprintInterwovenRelations(input.authorUserId, directChat, session, input.signal),
      ),
      this.guardWorldVoiceprintSocialSource(
        async () => await this.loadWorldVoiceprintPrivateChatRelation(input.authorUserId, directChat),
      ),
      this.guardWorldVoiceprintSocialSource(
        async () => await this.loadWorldVoiceprintCommentRelation(input.viewerUserId, input.recordUid, session, input.signal),
      ),
    ])
    return {
      context: { relations: this.dedupeWorldVoiceprintRelations(results.flatMap(result => result.relations)) },
      allSourcesSucceeded: results.every(result => result.succeeded),
    }
  }

  private async guardWorldVoiceprintSocialSource(
    loader: () => Promise<ArkmeWorldVoiceprintSocialSourceResult>,
  ): Promise<ArkmeWorldVoiceprintSocialSourceResult> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        loader(),
        new Promise<ArkmeWorldVoiceprintSocialSourceResult>(resolve => {
          timeout = setTimeout(() => { resolve({ succeeded: false, relations: [] }) }, ARKME_VOICEPRINT_SOCIAL_SOURCE_TIMEOUT_MILLIS)
        }),
      ])
    } catch {
      return { succeeded: false, relations: [] }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  private async loadWorldVoiceprintReciprocalExpectation(
    authorUserId: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintSocialSourceResult> {
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/voiceprint/world-enrollment-interactions', {}, session, signal,
      { lane: 'interactive-read', key: 'world-enrollment-interactions', cacheMs: 5_000 },
    )
    const received = objectValue(data.received)
    const requestedByAuthor = listValue(received.requesters).some(raw => {
      const requester = objectValue(raw)
      return integerValue(requester.user_id ?? requester.userId) === authorUserId
    })
    return {
      succeeded: true,
      relations: requestedByAuthor ? [WORLD_VOICEPRINT_SOCIAL_RELATIONS.reciprocal_expectation] : [],
    }
  }

  private async loadWorldVoiceprintDirectChat(
    authorUserId: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintDirectChat | undefined> {
    let pageCursor: Record<string, unknown> | undefined
    const visited = new Set<string>()
    for (;;) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/list', { limit: 100, session_kind: 1, ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }) },
        session, signal, { lane: 'interactive-read', bypassCache: true },
      )
      for (const raw of listValue(data.items)) {
        const bundle = objectValue(raw)
        const chatSession = objectValue(bundle.session)
        const counterpart = objectValue(bundle.private_counterpart)
        const sessionKind = integerValue(chatSession.session_kind)
        if ((sessionKind !== 1 && sessionKind !== 3)
          || integerValue(counterpart.user_id ?? counterpart.userId) !== authorUserId) continue
        const latestPreview = objectValue(bundle.latest_preview)
        const latestRecord = objectValue(latestPreview.record)
        const latestRelation = objectValue(latestPreview.relation)
        const unread = objectValue(bundle.unread_snapshot)
        const sessionUid = stringValue(chatSession.chat_session_uid).trim()
        if (sessionUid === '') continue
        const sessionExtra = objectValue(chatSession.extra)
        const sessionPolicy = objectValue(chatSession.policy_snapshot)
        const sharedTopicId = [chatSession, sessionExtra, sessionPolicy]
          .map(source => integerValue(
            source.subject_id ?? source.subjectId ?? source.shared_topic_id ?? source.sharedTopicId,
          ))
          .find(value => value > 0) ?? 0
        const hasPrivateMessageEvidence = Object.keys(latestRecord).length > 0
          || Object.keys(objectValue(latestRecord.payload)).length > 0
          || stringValue(latestRecord.record_uid).trim() !== ''
          || stringValue(latestRelation.record_uid).trim() !== ''
          || integerValue(unread.session_last_seq ?? chatSession.last_seq) > 0
        return { sessionUid, sharedTopicId: Math.max(0, sharedTopicId), hasPrivateMessageEvidence }
      }
      if (data.has_more !== true) return undefined
      const nextCursor = objectValue(data.next_page_cursor)
      if (Object.keys(nextCursor).length === 0) throw new Error('voiceprint direct-chat pagination cursor missing')
      const identity = JSON.stringify(nextCursor)
      if (visited.has(identity)) throw new Error('voiceprint direct-chat pagination cursor repeated')
      visited.add(identity)
      pageCursor = nextCursor
    }
  }

  private async loadWorldVoiceprintInterwovenRelations(
    authorUserId: number,
    directChatFuture: Promise<ArkmeWorldVoiceprintDirectChat | undefined>,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintSocialSourceResult> {
    const directChat = await directChatFuture
    if (directChat === undefined || authorUserId <= 0) return { succeeded: true, relations: [] }
    const data = directChat.sharedTopicId > 0
      ? await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
        '/api/v1/interwoven-moments/summary', { subject_id: directChat.sharedTopicId }, session, signal,
        { lane: 'interactive-read', bypassCache: true },
      )
      : await this.runtime.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/interwoven/summary', { subject_id: 0, chat_session_uid: directChat.sessionUid },
        session, signal, { lane: 'interactive-read', bypassCache: true },
      )
    const recentCard = objectValue(data.recent_card)
    const stats = listValue(recentCard.total_stats)
    const countFor = (momentType: number): number => {
      const raw = stats.find(value => integerValue(objectValue(value).moment_type) === momentType)
      return integerValue(objectValue(raw).count)
    }
    const relations: ArkmeWorldVoiceprintSocialRelation[] = []
    const callSummary = data.call_summary
    const callCount = callSummary !== null && typeof callSummary === 'object' && !Array.isArray(callSummary)
      ? integerValue(objectValue(callSummary).total_call_count)
      : countFor(3)
    if (callCount > 0) {
      relations.push(WORLD_VOICEPRINT_SOCIAL_RELATIONS.call)
    }
    if (countFor(2) > 0) relations.push(WORLD_VOICEPRINT_SOCIAL_RELATIONS.world_interaction)
    const groupFromStatus = listValue(data.source_status).some(raw => {
      const status = objectValue(raw)
      return integerValue(status.moment_type) === 1 && integerValue(status.item_count) > 0
    })
    if (countFor(1) > 0 || groupFromStatus) relations.push(WORLD_VOICEPRINT_SOCIAL_RELATIONS.group_interaction)
    return { succeeded: true, relations }
  }

  private async loadWorldVoiceprintPrivateChatRelation(
    authorUserId: number,
    directChatFuture: Promise<ArkmeWorldVoiceprintDirectChat | undefined>,
  ): Promise<ArkmeWorldVoiceprintSocialSourceResult> {
    const directChat = await directChatFuture
    return {
      succeeded: true,
      relations: directChat !== undefined && authorUserId > 0 && directChat.hasPrivateMessageEvidence
        ? [WORLD_VOICEPRINT_SOCIAL_RELATIONS.private_chat]
        : [],
    }
  }

  private async loadWorldVoiceprintCommentRelation(
    viewerUserId: number,
    recordUid: string,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintSocialSourceResult> {
    if (recordUid.trim() === '') return { succeeded: true, relations: [] }
    const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
      '/api/v1/public-record/extend-list', { record_uid: recordUid, limit: 100, offset: 0 },
      session, signal, { lane: 'interactive-read', bypassCache: true },
    )
    const interacted = listValue(data.list).some(raw => {
      const item = objectValue(raw)
      return integerValue(item.user_id ?? item.userId) === viewerUserId
    })
    return {
      succeeded: true,
      relations: interacted ? [WORLD_VOICEPRINT_SOCIAL_RELATIONS.world_interaction] : [],
    }
  }

  private dedupeWorldVoiceprintRelations(
    relations: readonly ArkmeWorldVoiceprintSocialRelation[],
  ): ArkmeWorldVoiceprintSocialRelation[] {
    const seen = new Set<ArkmeWorldVoiceprintSocialRelationType>()
    return relations.filter(relation => !seen.has(relation.type) && seen.add(relation.type))
  }

  private mergeWorldVoiceprintSocialContexts(
    previous: ArkmeWorldVoiceprintSocialContext | undefined,
    current: ArkmeWorldVoiceprintSocialContext,
  ): ArkmeWorldVoiceprintSocialContext {
    if (previous === undefined || previous.relations.length === 0) return current
    return { relations: this.dedupeWorldVoiceprintRelations([...previous.relations, ...current.relations]) }
  }

  async listWorldInteractions(
    recordRef: string,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldInteractionPage> {
    const session = await this.runtime.requireSession()
    const root = this.openWorldRecordRef(recordRef, session.userId)
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 50)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
      '/api/v1/public-record/extend-list',
      { record_uid: root.recordUid, limit, offset },
      session,
      options.signal,
    )
    const rawItems = listValue(data.list)
    const resolvedAvatars = await this.resolveWorldAvatarUrls(rawItems, session, options.signal)
    const projected = await Promise.all(rawItems.map(raw => this.worldInteractionItem(raw, session.userId, resolvedAvatars)))
    const items = projected.filter((item): item is ArkmeWorldInteractionItem => item !== undefined)
    const total = Math.max(0, Math.trunc(numberValue(data.total)))
    const directCount = rawItems.filter(
      raw => stringValue(objectValue(raw).parent_record_uid).trim() === root.recordUid,
    ).length
    const nextOffset = offset + directCount
    const hasMore = data.has_more === true || (directCount > 0 && nextOffset < total)
    return { items, total, hasMore, ...(hasMore ? { nextOffset } : {}) }
  }

  async createWorldTextInteraction(input: {
    targetRef: string
    textContent: string
    clientMutationId: string
    signal?: AbortSignal
  }): Promise<ArkmeWorldInteractionCreateResult> {
    const session = await this.runtime.requireSession()
    const target = this.openWorldRecordRef(input.targetRef, session.userId)
    const textContent = input.textContent.trim()
    const clientMutationId = input.clientMutationId.trim()
    if (textContent === '') throw new ArkmePluginError('world-interaction-text-empty', '请输入评论内容', false)
    if (textContent.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError('world-interaction-text-too-long', `评论不能超过 ${this.runtime.config.maxTextLength} 个字符`, false)
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(clientMutationId)) {
      throw new ArkmePluginError('world-interaction-mutation-invalid', '评论请求标识无效，请重试', false)
    }
    const snapshot = await this.profile.refreshProfile()
    if (snapshot.profile === null) throw new ArkmePluginError('profile-unavailable', '无法读取当前 Arkme 账号资料', true)
    const profile = snapshot.profile
    if (profile.contact.phoneMasked === undefined) {
      throw new ArkmePluginError('world-phone-binding-required', '请先在 Arkme 客户端绑定手机号，再参与互动', false)
    }
    const recordUid = stableWorldInteractionRecordUid(session.userId, target.recordUid, clientMutationId)
    const recordResult = await this.record.createTextForConversation(recordUid, textContent)
    if (recordResult.localState !== 'synced') {
      throw new ArkmePluginError(
        'world-interaction-record-pending',
        recordResult.error ?? '评论已保存到待重试队列，请稍后重试',
        true,
      )
    }
    const createdAtMillis = Date.now()
    let published: Record<string, unknown> = {}
    try {
      published = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
        '/api/v1/public-record/publish',
        {
          record_uid: recordUid,
          parent_record_uid: target.recordUid,
          content: textContent,
          text_content: textContent,
          tags: worldTags(textContent),
          original_topic_id: 0,
          created_at: createdAtMillis,
          nick_name: profile.nickname || profile.displayName,
          avatar: profile.avatarRef,
          template_kind: 1,
        },
        session,
        input.signal,
      )
    } catch (error) {
      if (input.signal?.aborted === true) throw error
      let alreadyPublished = false
      try { alreadyPublished = await this.worldRecordIsPublic(recordUid, input.signal) }
      catch { /* Preserve the original publication failure. */ }
      if (!alreadyPublished) throw error
    }
    const publishedItem = objectValue(published)
    const interaction = await this.worldInteractionItem({
      ...publishedItem,
      record_uid: stringValue(publishedItem.record_uid).trim() || recordUid,
      parent_record_uid: stringValue(publishedItem.parent_record_uid).trim() || target.recordUid,
      user_id: Math.trunc(numberValue(publishedItem.user_id)) || session.userId,
      nick_name: stringValue(publishedItem.nick_name ?? publishedItem.nickname).trim()
        || profile.nickname || profile.displayName,
      avatar: stringValue(publishedItem.avatar).trim() || profile.avatarRef,
      content: stringValue(publishedItem.content).trim() || textContent,
      text_content: stringValue(publishedItem.text_content).trim() || textContent,
      created_at: Math.trunc(numberValue(publishedItem.created_at)) || createdAtMillis,
      published_at: Math.trunc(numberValue(publishedItem.published_at)) || createdAtMillis,
      images: listValue(publishedItem.images),
      videos: listValue(publishedItem.videos),
      voices: listValue(publishedItem.voices),
    }, session.userId, new Map())
    if (interaction === undefined) {
      throw new ArkmePluginError('world-interaction-contract-invalid', '世界互动响应不完整，请刷新后确认', true, 502)
    }
    return { interaction }
  }

  async readWorldImage(
    imageRef: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeImageBytes> {
    const session = await this.runtime.requireSession()
    const entry = await this.openWorldImageRef(imageRef, session.userId)
    const byteLimit = Math.min(
      ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES,
      Math.max(1, Math.trunc(options.maxBytes ?? ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES)),
    )
    return await this.media.downloadSignedImage(
      trustedWorldImageUrl(this.runtime.config.environment, entry.sourceUrl),
      byteLimit,
      options.signal,
    )
  }

  async publishWorldTextForConversation(
    recordUid: string,
    textContent: string,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldPublishResult> {
    const normalizedUid = recordUid.trim()
    const normalizedText = textContent.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUid)) {
      throw new ArkmePluginError('record-uid-invalid', '写入标识无效，请重试', false)
    }
    if (normalizedText === '') throw new ArkmePluginError('world-text-empty', '请输入要发到世界的内容', false)
    if (normalizedText.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError('world-text-too-long', `内容不能超过 ${this.runtime.config.maxTextLength} 个字符`, false)
    }
    let profile: ArkmeUserProfile
    try {
      const snapshot = await this.profile.refreshProfile()
      if (snapshot.profile === null) throw new ArkmePluginError('profile-unavailable', '无法读取当前 Arkme 账号资料', true)
      profile = snapshot.profile
    } catch (error) { return this.worldPublishFailure(false, error) }
    if (profile.contact.phoneMasked === undefined) {
      return {
        recordSaved: false, recordState: 'not_saved', worldPublished: false,
        visibility: 'not_published', checkStatus: 0, retryable: false,
        error: '请先在 Arkme 客户端绑定手机号，再发到世界',
      }
    }
    try {
      if (await this.worldRecordIsPublic(normalizedUid, signal)) {
        return { recordSaved: true, recordState: 'synced', worldPublished: true, visibility: 'unknown', checkStatus: 0, retryable: false }
      }
    } catch (error) { if (signal?.aborted === true) throw error }
    const createdAtMillis = Date.now()
    const recordResult = await this.record.createTextForConversation(normalizedUid, normalizedText)
    if (recordResult.localState !== 'synced') {
      return {
        recordSaved: true, recordState: 'pending', worldPublished: false,
        visibility: 'not_published', checkStatus: 0, retryable: true,
        ...(recordResult.error === undefined ? {} : { error: recordResult.error }),
      }
    }
    try {
      const published = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
        '/api/v1/public-record/publish',
        {
          record_uid: normalizedUid, content: normalizedText, text_content: normalizedText,
          tags: worldTags(normalizedText), original_topic_id: 0, created_at: createdAtMillis,
          nick_name: profile.nickname || profile.displayName, avatar: profile.avatarRef, template_kind: 1,
        },
        undefined,
        signal,
      )
      const checkStatus = Math.trunc(numberValue(published.check_status))
      return worldPublicationResult(checkStatus)
    } catch (error) {
      try {
        if (await this.worldRecordIsPublic(normalizedUid, signal)) {
          return { recordSaved: true, recordState: 'synced', worldPublished: true, visibility: 'unknown', checkStatus: 0, retryable: false }
        }
      } catch { /* Preserve the original publication failure. */ }
      return this.worldPublishFailure(true, error, 'synced')
    }
  }

  async publishWorldText(input: ArkmeWorldPublishTextInput): Promise<ArkmeWorldPublishResult> {
    const session = await this.runtime.requireSession()
    const clientMutationId = input.clientMutationId.trim()
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(clientMutationId)) {
      throw new ArkmePluginError('world-publish-mutation-invalid', '发布请求标识无效，请重试', false)
    }
    return await this.publishWorldTextForConversation(
      stableWorldPublishRecordUid(session.userId, clientMutationId),
      input.textContent,
    )
  }

  async publishWorldFileAssets(input: ArkmeWorldPublishFileAssetsInput): Promise<ArkmeWorldPublishResult> {
    const session = await this.runtime.requireSession()
    const clientMutationId = input.clientMutationId.trim()
    const textContent = input.textContent.trim()
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(clientMutationId)) {
      throw new ArkmePluginError('world-publish-mutation-invalid', '发布请求标识无效，请重试', false)
    }
    if (textContent === '' || textContent.length > this.runtime.config.maxTextLength) {
      throw new ArkmePluginError('world-text-invalid', '世界内容为空或过长', false)
    }
    if (input.fileAssets.length === 0 || input.fileAssets.length > ARKME_WORLD_PUBLISH_MAX_IMAGES || input.fileAssets.some(asset =>
      !/^[A-Za-z0-9._:-]{8,256}$/.test(asset.fileAssetUid) || asset.fileName.trim() === ''
      || !asset.mimeType.toLowerCase().startsWith('image/') || !Number.isSafeInteger(asset.size)
      || asset.size <= 0 || asset.size > ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES || asset.fileKind !== 1)) {
      throw new ArkmePluginError('world-publish-assets-invalid', '世界图片参数无效', false)
    }
    let profile: ArkmeUserProfile
    try {
      const snapshot = await this.profile.refreshProfile()
      if (snapshot.profile === null) throw new ArkmePluginError('profile-unavailable', '无法读取当前 Arkme 账号资料', true)
      profile = snapshot.profile
    } catch (error) { return this.worldPublishFailure(false, error) }
    if (profile.contact.phoneMasked === undefined) {
      return {
        recordSaved: false, recordState: 'not_saved', worldPublished: false,
        visibility: 'not_published', checkStatus: 0, retryable: false,
        error: '请先在 Arkme 客户端绑定手机号，再发到世界',
      }
    }
    const recordUid = stableWorldPublishRecordUid(session.userId, clientMutationId)
    try {
      if (await this.worldRecordIsPublic(recordUid)) {
        return { recordSaved: true, recordState: 'synced', worldPublished: true, visibility: 'unknown', checkStatus: 0, retryable: false }
      }
    } catch { /* Continue with the stable write identity when preflight status is unavailable. */ }
    try { await this.record.createFileAssetsForConversation(recordUid, textContent, input.fileAssets) }
    catch (error) { return this.worldPublishFailure(false, error) }
    try {
      const published = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
        '/api/v1/public-record/publish-with-file-assets',
        {
          record_uid: recordUid,
          content: textContent,
          text_content: textContent,
          file_assets: input.fileAssets.map((asset, index) => ({
            file_asset_uid: asset.fileAssetUid,
            media_type: 'image',
            file_kind: 1,
            sort_order: index,
          })),
          tags: worldTags(textContent),
          original_topic_id: 0,
          created_at: Date.now(),
          nick_name: profile.nickname || profile.displayName,
          avatar: profile.avatarRef,
        },
        session,
      )
      const checkStatus = Math.trunc(numberValue(published.check_status))
      return worldPublicationResult(checkStatus)
    } catch (error) {
      try {
        if (await this.worldRecordIsPublic(recordUid)) {
          return { recordSaved: true, recordState: 'synced', worldPublished: true, visibility: 'unknown', checkStatus: 0, retryable: false }
        }
      } catch { /* Preserve the original publication failure. */ }
      return this.worldPublishFailure(true, error, 'synced')
    }
  }

  private worldRecordItem(raw: unknown): ArkmeWorldRecordItem | undefined {
    const item = objectValue(raw)
    const textContent = stringValue(item.text_content ?? item.content).trim()
    const headline = stringValue(item.headline).trim()
    const imageCount = listValue(item.images).length
    const videoCount = listValue(item.videos).length
    const voiceCount = listValue(item.voices).length
    if (textContent === '' && headline === '' && imageCount + videoCount + voiceCount === 0) return undefined
    return {
      authorName: stringValue(item.nick_name).trim() || 'Arkme用户', headline, textContent,
      tags: listValue(item.tags).map(stringValue).map(tag => tag.trim()).filter(tag => tag !== ''),
      templateKind: Math.trunc(numberValue(item.template_kind)),
      createdAtMillis: Math.trunc(numberValue(item.created_at)),
      publishedAtMillis: Math.trunc(numberValue(item.published_at)),
      imageCount, videoCount, voiceCount,
      extendCount: Math.max(0, Math.trunc(numberValue(item.extend_count))),
    }
  }

  private async worldFeedItem(
    raw: unknown,
    viewerUserId: number,
    resolvedAvatars: ReadonlyMap<string, string>,
  ): Promise<ArkmeWorldFeedItem | undefined> {
    const item = objectValue(raw)
    const recordUid = stringValue(item.record_uid).trim()
    const textContent = stringValue(item.text_content ?? item.content).trim()
    const headline = stringValue(item.headline).trim()
    const rawImages = listValue(item.images).map(stringValue).map(value => value.trim()).filter(value => value !== '')
    const videoCount = listValue(item.videos).length
    const voiceCount = listValue(item.voices).length
    if (recordUid === '' || (textContent === '' && headline === '' && rawImages.length + videoCount + voiceCount === 0)) {
      return undefined
    }
    const ownerUserId = Math.trunc(numberValue(item.user_id))
    const rawAvatar = stringValue(item.avatar ?? item.head_img).trim()
    const avatarUrl = rawAvatar.startsWith('file_asset://')
      ? resolvedAvatars.get(worldAvatarResolutionKey(ownerUserId, rawAvatar)) ?? ''
      : rawAvatar
    const avatarFallback = worldPhoneDefaultAvatar(rawAvatar)
    const imageRefs: string[] = []
    for (const [index, signedUrl] of rawImages.slice(0, 9).entries()) {
      if (!this.isTrustedWorldImageUrl(signedUrl)) continue
      imageRefs.push(await this.sealWorldImageRef(
        viewerUserId,
        signedUrl,
        `record:${recordUid}:image:${String(index)}:${worldImageAssetIdentity(signedUrl)}`,
      ))
    }
    const avatarRef = this.isTrustedWorldImageUrl(avatarUrl)
      ? await this.sealWorldImageRef(
        viewerUserId,
        avatarUrl,
        `avatar:${String(ownerUserId)}:${rawAvatar.startsWith('file_asset://') ? rawAvatar : worldImageAssetIdentity(avatarUrl)}`,
      )
      : undefined
    return {
      recordRef: await this.worldRecordRef(viewerUserId, recordUid, {
        ownerUserId,
        authorName: stringValue(item.nick_name ?? item.nickname).trim() || 'Arkme用户',
        ...(() => {
          const textPreview = optionalTrimmedText(headline || textContent, 80)
          return textPreview === undefined ? {} : { textPreview }
        })(),
      }),
      authorName: stringValue(item.nick_name ?? item.nickname).trim() || 'Arkme用户',
      ...(avatarRef === undefined ? {} : { avatarRef }),
      ...(avatarRef === undefined && avatarFallback !== undefined ? { avatarFallback } : {}),
      headline,
      textContent,
      tags: listValue(item.tags).map(stringValue).map(tag => tag.trim()).filter(tag => tag !== ''),
      templateKind: Math.trunc(numberValue(item.template_kind)),
      createdAtMillis: Math.trunc(numberValue(item.created_at)),
      publishedAtMillis: Math.trunc(numberValue(item.published_at)),
      imageRefs,
      imageCount: rawImages.length,
      videoCount,
      voiceCount,
      extendCount: Math.max(0, Math.trunc(numberValue(item.extend_count))),
    }
  }

  private isTrustedWorldImageUrl(raw: string): boolean {
    if (raw.length > 4096) return false
    try {
      trustedWorldImageUrl(this.runtime.config.environment, raw)
      return true
    } catch {
      return false
    }
  }

  private async resolveWorldAvatarUrls(
    rawItems: readonly unknown[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const requested = new Map<string, { owner_user_id: number; avatar_ref: string }>()
    for (const raw of rawItems) {
      const item = objectValue(raw)
      const ownerUserId = Math.trunc(numberValue(item.user_id))
      const avatarRef = stringValue(item.avatar ?? item.head_img).trim()
      const key = worldAvatarResolutionKey(ownerUserId, avatarRef)
      if (key !== '') requested.set(key, { owner_user_id: ownerUserId, avatar_ref: avatarRef })
    }
    if (requested.size === 0) return new Map()
    const now = Date.now()
    for (const [key, entry] of this.worldAvatarResolutionCache) {
      if (entry.expiresAtMillis <= now) this.worldAvatarResolutionCache.delete(key)
    }
    const resolved = new Map<string, string>()
    for (const [key] of requested) {
      const cached = this.worldAvatarResolutionCache.get(key)
      if (cached === undefined) continue
      this.worldAvatarResolutionCache.delete(key)
      this.worldAvatarResolutionCache.set(key, cached)
      resolved.set(key, cached.sourceUrl)
    }
    const unresolved = [...requested].filter(([key]) => !resolved.has(key)).map(([, value]) => value)
    if (unresolved.length === 0) return resolved
    let data: Record<string, unknown>
    try {
      data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
        '/api/v1/auth/resolve-avatar-refs',
        { items: unresolved },
        session,
        signal,
      )
    } catch {
      // Avatar decoration is best-effort; the World feed remains usable with its fallback avatar.
      return resolved
    }
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const ownerUserId = Math.trunc(numberValue(item.owner_user_id))
      const avatarRef = stringValue(item.avatar_ref).trim()
      const key = worldAvatarResolutionKey(ownerUserId, avatarRef)
      const url = stringValue(item.url).trim()
      if (!requested.has(key) || !this.isTrustedWorldImageUrl(url)) continue
      resolved.set(key, url)
      this.worldAvatarResolutionCache.delete(key)
      this.worldAvatarResolutionCache.set(key, {
        sourceUrl: url,
        expiresAtMillis: Date.now() + ARKME_WORLD_AVATAR_RESOLUTION_CACHE_TTL_MILLIS,
      })
    }
    while (this.worldAvatarResolutionCache.size > MAX_ARKME_WORLD_AVATAR_RESOLUTION_CACHE_ENTRIES) {
      const oldest = this.worldAvatarResolutionCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.worldAvatarResolutionCache.delete(oldest)
    }
    return resolved
  }

  private async worldInteractionItem(
    raw: unknown,
    viewerUserId: number,
    resolvedAvatars: ReadonlyMap<string, string>,
  ): Promise<ArkmeWorldInteractionItem | undefined> {
    const item = objectValue(raw)
    const recordUid = stringValue(item.record_uid).trim()
    const parentRecordUid = stringValue(item.parent_record_uid).trim()
    const textContent = stringValue(item.text_content ?? item.content).trim()
    const imageCount = listValue(item.images).length
    const videoCount = listValue(item.videos).length
    const voiceCount = listValue(item.voices).length
    if (recordUid === '' || parentRecordUid === '' || (textContent === '' && imageCount + videoCount + voiceCount === 0)) {
      return undefined
    }
    const ownerUserId = Math.trunc(numberValue(item.user_id))
    const rawAvatar = stringValue(item.avatar ?? item.head_img).trim()
    const avatarUrl = rawAvatar.startsWith('file_asset://')
      ? resolvedAvatars.get(worldAvatarResolutionKey(ownerUserId, rawAvatar)) ?? ''
      : rawAvatar
    const avatarFallback = worldPhoneDefaultAvatar(rawAvatar)
    const avatarRef = this.isTrustedWorldImageUrl(avatarUrl)
      ? await this.sealWorldImageRef(
        viewerUserId,
        avatarUrl,
        `avatar:${String(ownerUserId)}:${rawAvatar.startsWith('file_asset://') ? rawAvatar : worldImageAssetIdentity(avatarUrl)}`,
      )
      : undefined
    return {
      interactionRef: await this.worldRecordRef(viewerUserId, recordUid, {
        ownerUserId,
        authorName: stringValue(item.nick_name ?? item.nickname).trim() || 'Arkme用户',
        ...(() => {
          const textPreview = optionalTrimmedText(textContent, 80)
          return textPreview === undefined ? {} : { textPreview }
        })(),
      }),
      parentRef: await this.worldRecordRef(viewerUserId, parentRecordUid),
      authorName: stringValue(item.nick_name ?? item.nickname).trim() || 'Arkme用户',
      ...(avatarRef === undefined ? {} : { avatarRef }),
      ...(avatarRef === undefined && avatarFallback !== undefined ? { avatarFallback } : {}),
      textContent,
      createdAtMillis: Math.trunc(numberValue(item.created_at)),
      publishedAtMillis: Math.trunc(numberValue(item.published_at)),
      imageCount,
      videoCount,
      voiceCount,
    }
  }

  private async worldRecordRef(
    viewerUserId: number,
    recordUid: string,
    metadata: { ownerUserId?: number; authorName?: string; textPreview?: string } = {},
  ): Promise<string> {
    const digest = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`world-record-v1:${String(viewerUserId)}:${recordUid}`)
      .digest('base64url')
    const recordRef = `arkme-world-record-v1.${digest}`
    const now = Date.now()
    this.pruneWorldRecordRefs(now)
    const previous = this.worldRecordRefs.get(recordRef)
    const resolvedOwnerUserId = metadata.ownerUserId ?? previous?.ownerUserId
    const authorName = optionalTrimmedText(metadata.authorName, 64) ?? previous?.authorName
    const textPreview = optionalTrimmedText(metadata.textPreview, 80) ?? previous?.textPreview
    this.worldRecordRefs.set(recordRef, {
      viewerUserId,
      recordUid,
      ...(resolvedOwnerUserId === undefined || resolvedOwnerUserId <= 0 ? {} : { ownerUserId: resolvedOwnerUserId }),
      ...(authorName === undefined ? {} : { authorName }),
      ...(textPreview === undefined ? {} : { textPreview }),
      expiresAtMillis: now + ARKME_WORLD_RECORD_REF_TTL_MILLIS,
    })
    return recordRef
  }

  private pruneWorldRecordRefs(now: number): void {
    for (const [recordRef, entry] of this.worldRecordRefs) {
      if (entry.expiresAtMillis <= now) this.worldRecordRefs.delete(recordRef)
    }
    while (this.worldRecordRefs.size >= MAX_ARKME_WORLD_RECORD_REFS) {
      const oldest = this.worldRecordRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.worldRecordRefs.delete(oldest)
    }
  }

  private openWorldRecordRef(recordRef: string, viewerUserId: number): ArkmeWorldRecordRefEntry {
    const normalized = recordRef.trim()
    const entry = normalized.startsWith('arkme-world-record-v1.')
      ? this.worldRecordRefs.get(normalized)
      : undefined
    if (entry === undefined || entry.viewerUserId !== viewerUserId || entry.expiresAtMillis <= Date.now()) {
      this.worldRecordRefs.delete(normalized)
      throw new ArkmePluginError('world-record-ref-invalid', '世界内容引用无效或已过期，请刷新世界', false, 403)
    }
    return entry
  }

  private pruneWorldImageRefs(now: number): void {
    for (const [token, entry] of this.worldImageRefs) {
      if (entry.expiresAtMillis <= now) this.worldImageRefs.delete(token)
    }
    while (this.worldImageRefs.size >= MAX_ARKME_WORLD_IMAGE_REFS) {
      const oldest = this.worldImageRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.worldImageRefs.delete(oldest)
    }
  }

  private async sealWorldImageRef(viewerUserId: number, sourceUrl: string, stableIdentity: string): Promise<string> {
    const now = Date.now()
    this.pruneWorldImageRefs(now)
    const uniqueCode = await this.runtime.stateStore.uniqueCode()
    const token = createHmac('sha256', uniqueCode)
      .update(`world-image-token-v1:${String(viewerUserId)}:${stableIdentity}`)
      .digest('base64url')
    const signature = createHmac('sha256', uniqueCode)
      .update(`world-image-v1:${String(viewerUserId)}:${token}`)
      .digest('base64url')
    this.worldImageRefs.set(token, {
      viewerUserId,
      sourceUrl,
      expiresAtMillis: now + ARKME_WORLD_IMAGE_REF_TTL_MILLIS,
    })
    return `arkme-world-image-v1.${token}.${signature}`
  }

  async openWorldImageRef(imageRef: string, viewerUserId: number): Promise<ArkmeWorldImageEntry> {
    const parts = imageRef.trim().split('.')
    const token = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(`world-image-v1:${String(viewerUserId)}:${token}`)
      .digest()
    if (parts.length !== 3 || parts[0] !== 'arkme-world-image-v1' || token === ''
      || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('world-image-ref-invalid', '世界图片引用无效或已过期', false, 403)
    }
    const entry = this.worldImageRefs.get(token)
    if (entry === undefined || entry.viewerUserId !== viewerUserId || entry.expiresAtMillis <= Date.now()) {
      this.worldImageRefs.delete(token)
      throw new ArkmePluginError('world-image-ref-invalid', '世界图片引用无效或已过期', false, 403)
    }
    return entry
  }

  private worldPublishFailure(
    recordSaved: boolean,
    error: unknown,
    recordState: ArkmeWorldPublishResult['recordState'] = recordSaved ? 'synced' : 'not_saved',
  ): ArkmeWorldPublishResult {
    const code = error instanceof ArkmePluginError ? error.code : ''
    const retryable = error instanceof ArkmePluginError
      ? error.retryable || ['arkme-code-10005', 'arkme-http-error', 'arkme-network-error', 'arkme-timeout'].includes(code)
      : true
    return {
      recordSaved, recordState, worldPublished: false, visibility: 'not_published',
      checkStatus: 0, retryable, error: safeFailureMessage(error),
    }
  }

  private async worldRecordIsPublic(recordUid: string, signal?: AbortSignal): Promise<boolean> {
    const data = await this.runtime.post<Record<string, unknown>>(
      this.runtime.config.worldBaseUrl, '/api/public/v1/public-record/status-batch',
      { record_uids: [recordUid] }, undefined, [200], signal,
    )
    return listValue(data.items).some(raw => {
      const item = objectValue(raw)
      return stringValue(item.record_uid).trim() === recordUid && item.is_public === true
    })
  }
}
