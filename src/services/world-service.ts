import { recordOwnerId, type RecordOwnerId } from '../record-owner-id.js'
import {worldSoundProjection} from './world-sound-service.js'
import { TimelineTokenCodec } from './timeline-token.js'
import { localWorldReactionTarget } from './world-local-reaction-service.js'
import { arkmePeerMemberType } from '../peer-membership.js'
import { isPublicRecordUid, parseShareLink } from '../share-link-preview.js'
import { ARKME_DEFAULT_SHARE_WEBSITE, type ArkmeWorldShareResult } from '../types.js'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeImageBytes,
  ArkmeConversationWriteResult,
  ArkmeCreateFileAssetRecordResult,
  ArkmeUploadedAsset,
  ArkmeUserProfile,
  ArkmeWorldAvatarFallback,
  ArkmeWorldAuthorLabel,
  ArkmeWorldExtensionShare,
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
  ArkmeWorldInteractionSummary,
  ArkmeWorldNotificationSourcePage,
  ArkmeWorldNotificationTarget,
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

export interface ArkmeWorldViewerLabelReader {
  privateDisplayNamesByUserIds(
    userIds: readonly number[],
    options?: { signal?: AbortSignal },
  ): Promise<Map<number, string>>
}

export interface ArkmeWorldMediaReader {
  issueWorldSoundMediaRef?(viewerUserId:number,raw:string,expected:{recordUID:string;index:number}):string
  issueWorldVoiceprintMediaRef(viewerUserId: number, input: { remoteUrl: string; mimeType: string }): string
  downloadSignedImage(signedUrl: URL, byteLimit: number, signal?: AbortSignal, scope?: string): Promise<ArkmeImageBytes>
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
  imageCount?: number
  videoCount?: number
  voiceCount?: number
  expiresAtMillis: number
}

interface ArkmeWorldAvatarResolutionCacheEntry {
  sourceUrl: string
  expiresAtMillis: number
}

interface ArkmeWorldExtensionShareCacheEntry {
  share?: ArkmeWorldExtensionShare
  expiresAtMillis: number
}

const ARKME_WORLD_IMAGE_REF_TTL_MILLIS = 15 * 60 * 1000
const MAX_ARKME_WORLD_IMAGE_REFS = 2048
const ARKME_WORLD_AVATAR_RESOLUTION_CACHE_TTL_MILLIS = 5 * 60 * 1000
const MAX_ARKME_WORLD_AVATAR_RESOLUTION_CACHE_ENTRIES = 2048
const ARKME_WORLD_EXTENSION_SHARE_CACHE_TTL_MILLIS = 5 * 60 * 1000
const MAX_ARKME_WORLD_EXTENSION_SHARE_CACHE_ENTRIES = 512
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
  imageCount?: number
  videoCount?: number
  voiceCount?: number
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

function extensionShareRefFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return url.pathname.split('/').at(-1) ?? ''
  } catch {
    return ''
  }
}

function worldExtensionPublicationShare(
  rawPublication: Record<string, unknown>,
  rawItem: Record<string, unknown>,
): ArkmeWorldExtensionShare | undefined {
  const share = objectValue(rawPublication.share ?? rawItem.share)
  const url = stringValue(share.url ?? rawPublication.share_url ?? rawItem.share_url).trim()
  if (url === '' || url.length > 4096) return undefined
  const ref = stringValue(share.ref ?? rawPublication.share_ref ?? rawItem.share_ref).trim() || extensionShareRefFromUrl(url)
  if (!/^extshare_[0-9a-f]{32}$/.test(ref)) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || !parsed.pathname.endsWith(`/${ref}`)) {
    return undefined
  }
  return { ref, url: parsed.href }
}

function worldExtensionShareFromCatalogDetail(raw: unknown): ArkmeWorldExtensionShare | undefined {
  const response = objectValue(raw)
  const extension = objectValue(response.extension ?? response)
  return worldExtensionPublicationShare({ share: extension.share }, {})
}

function worldTextWithExtensionShare(textContent: string, share: ArkmeWorldExtensionShare | undefined): string {
  const content = textContent.trim()
  if (share === undefined) return content
  const shareUrl = share.url.trim()
  if (shareUrl === '') return content
  if (content.includes(shareUrl)) return content
  return content === '' ? shareUrl : `${content}\n${shareUrl}`
}

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

function trustedWorldImageUrl(environment: 'test' | 'prod', raw: string, worldBaseUrl?: string, publication = false): URL {
  let parsed: URL
  try { parsed = new URL(raw.trim()) }
  catch (error) { throw new ArkmePluginError('world-image-ref-invalid', '世界图片地址无效', false, 400, { cause: error }) }
  const controlled = worldBaseUrl !== undefined && parsed.origin === new URL(worldBaseUrl).origin
    && parsed.pathname === '/api/public/v1/public-record/media'
    && /^[a-f0-9]{64}$/.test(parsed.searchParams.get('version') ?? '')
    && (parsed.searchParams.get('record_uid')?.length ?? 0) > 0
    && ['image', 'preview', 'file', 'extension-icon', 'extension-preview'].includes(parsed.searchParams.get('kind') ?? '')
    && /^\d{1,4}$/.test(parsed.searchParams.get('index') ?? '')
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hash !== ''
    || !(controlled || !publication && allowedSignedImageHost(environment, parsed.hostname)) || parsed.pathname.replace(/^\/+/, '') === '') {
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
    if (parsed.pathname === '/api/public/v1/public-record/media') { parsed.searchParams.sort(); return parsed.toString() }
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`
  } catch {
    return raw.trim()
  }
}

export class WorldService {
  private epoch = 0
  /** Called only for a Record-owner-authorized received-reaction response. */
  async reactionReference(recordUid: string): Promise<string> {
    const session = await this.runtime.requireSession()
    return this.worldRecordRef(session.userId, recordUid, { ownerUserId: session.userId })
  }
  async reactionTarget(recordRef: string): Promise<import('./reaction-service.js').ReactionWireTarget> {
    const session = await this.runtime.requireSession()
    return { record_uid: this.openWorldRecordRef(recordRef, session.userId).recordUid }
  }
  private readonly worldImageRefs = new Map<string, ArkmeWorldImageEntry>()
  private readonly worldAvatarResolutionCache = new Map<string, ArkmeWorldAvatarResolutionCacheEntry>()
  private readonly extensionPublicationShareCache = new Map<string, ArkmeWorldExtensionShareCacheEntry>()
  private readonly extensionPublicationShareInFlight = new Map<string, Promise<ArkmeWorldExtensionShare | undefined>>()
  private readonly worldRecordRefs = new Map<string, ArkmeWorldRecordRefEntry>()
  private readonly authorMemberships = new Map<string, { memberType: ReturnType<typeof arkmePeerMemberType>; expiresAt: number }>()
  private readonly authorMembershipInFlight = new Map<string, Promise<void>>()
  private readonly authorMembershipRequests = new Set<AbortController>()
  private readonly voiceprintSocialCache = new Map<string, ArkmeWorldVoiceprintSocialCacheEntry>()
  private readonly voiceprintSocialInFlight = new Map<string, Promise<ArkmeWorldVoiceprintSocialContext>>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ArkmeWorldProfileReader,
    private readonly media: ArkmeWorldMediaReader,
    private readonly record: ArkmeWorldRecordWriter,
    private readonly viewerLabels?: ArkmeWorldViewerLabelReader,
  ) {}

  dispose(): void {
    this.epoch++
    for (const request of this.authorMembershipRequests) request.abort()
    this.authorMembershipRequests.clear()
    this.authorMemberships.clear()
    this.authorMembershipInFlight.clear()
    this.worldImageRefs.clear()
    this.worldAvatarResolutionCache.clear()
    this.extensionPublicationShareCache.clear()
    this.extensionPublicationShareInFlight.clear()
    this.worldRecordRefs.clear()
    this.voiceprintSocialCache.clear()
    this.voiceprintSocialInFlight.clear()
  }

  /** Recheck publication at open time; cached timeline references never grant access to private records. */
  async readPublicPreviews(refs: { recordUID: string; ancestorUID: string }[], signal?: AbortSignal): Promise<(ArkmeWorldFeedItem | undefined)[]> {
    if (refs.length > 50) throw new ArkmePluginError('world-preview-invalid', '预览数量过多', false, 400)
    if (!refs.length) return []
    const epoch = this.epoch, session = await this.runtime.requireSession()
    const data = await this.runtime.post<Record<string, unknown>>(this.runtime.config.worldBaseUrl, '/api/public/v1/world/previews', {
      items: refs.map(ref => ({ record_uid: ref.recordUID, ancestor_uid: ref.ancestorUID })),
    }, undefined, [200], signal)
    if (!Array.isArray(data.items) || data.items.length !== refs.length) throw new ArkmePluginError('world-preview-invalid', '预览返回异常', false, 502)
    const raw = data.items.map((value, i) => {
      if (value === null) return undefined
      const item = this.mixedItem(objectValue(value))
      if (stringValue(item.record_uid) !== refs[i]!.recordUID) throw new ArkmePluginError('world-preview-invalid', '预览内容不匹配', false, 502)
      return item
    })
    const avatars = await this.resolveWorldAvatarUrls(raw.filter((v): v is Record<string, unknown> => !!v), session, signal)
    const out = await Promise.all(raw.map(value => value ? this.worldFeedItem(value, session.userId, avatars, signal) : undefined))
    signal?.throwIfAborted()
    if (epoch !== this.epoch || (await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('world-account-changed', '账号状态已变化', false, 409)
    return out.map(item => item ?? undefined)
  }

  /** Project already visibility-checked public DTOs without duplicating identifiers. */
  async projectSubscriptionPublications(values: unknown[], signal?: AbortSignal): Promise<ArkmeWorldFeedItem[]> {
    if (values.length > 50) throw new ArkmePluginError('world-preview-invalid', '预览数量过多', false, 400)
    const epoch = this.epoch, session = await this.runtime.requireSession(), raw = values.map(v => this.mixedItem(v))
    const avatars = await this.resolveWorldAvatarUrls(raw, session, signal)
    const out = await Promise.all(raw.map(v => this.worldFeedItem(v, session.userId, avatars, signal)))
    signal?.throwIfAborted()
    if (epoch !== this.epoch || (await this.runtime.requireSession()).userId !== session.userId || out.some(v => !v)) throw new ArkmePluginError('world-preview-invalid', '预览内容已变化，请刷新', true, 409)
    return out as ArkmeWorldFeedItem[]
  }

  async readWorldRecord(recordRef: string, signal?: AbortSignal): Promise<ArkmeWorldFeedItem> {
    const epoch = this.epoch
    const session = await this.runtime.requireSession()
    const recordUid = recordRef.startsWith('atw1.')
      ? new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), JSON.stringify([this.runtime.config.environment, session.userId])).open(recordRef, 'world-record')
      : this.openWorldRecordRef(recordRef, session.userId).recordUid
    signal?.throwIfAborted()
    const raw = await this.runtime.post<Record<string, unknown>>(
      this.runtime.config.worldBaseUrl, '/api/public/v1/world/read',
      { record_uid: recordUid }, undefined, [200], signal,
    )
    const mixed = this.mixedItem(raw)
    const resolvedAvatars = await this.resolveWorldAvatarUrls([mixed], session, signal)
    if (epoch !== this.epoch) throw new ArkmePluginError('world-account-changed', '账号状态已变化', false, 409)
    const item = await this.worldFeedItem(mixed, session.userId, resolvedAvatars, signal)
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || epoch !== this.epoch) throw new ArkmePluginError('world-account-changed', '账号状态已变化', false, 409)
    if (!item) throw new ArkmePluginError('world-record-unavailable', '这条公开快记已不可用', false, 404)
    return item
  }

  async worldReport(input: import('../world-report-contract.js').WorldReportRequest, signal?: AbortSignal): Promise<import('../world-report-contract.js').WorldReportResult> {
    signal?.throwIfAborted()
    if (!input || typeof input.recordRef !== 'string' || !Number.isSafeInteger(input.expectedUserId) || !['pending','submit','acknowledge'].includes(input.action)) throw new ArkmePluginError('world-report-invalid','举报请求无效',false,400)
    const epoch = this.epoch, session = await this.runtime.requireSession()
    if (input.expectedUserId !== session.userId) throw new ArkmePluginError('world-account-changed', '账号已变化，请重新打开举报', false, 409)
    const current = async () => {
      signal?.throwIfAborted()
      if (epoch !== this.epoch || (await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('world-account-changed', '账号已变化，请重新打开举报', false, 409)
    }
    const uid = this.openWorldRecordRef(input.recordRef, session.userId).recordUid
    const scope = `${this.runtime.config.environment}:${session.userId}`
    const persist = this.runtime.stateStore.worldReportCommand?.bind(this.runtime.stateStore)
    if (!persist) throw new ArkmePluginError('world-report-unavailable', '举报恢复存储不可用', false, 503)
    let pending = await persist(scope, uid)
    await current()
    const publicPending = (v: import('../world-report-contract.js').WorldReportCommand) => ({requestUid:v.requestUid, reportType:v.reportType, reason:v.reason})
    if (input.action === 'pending') return pending ? {pending:publicPending(pending),...(pending.receipt ? {submitted:true as const}:{})} : {}
    if (input.action === 'acknowledge') {
      if (typeof input.requestUid!=='string') throw new ArkmePluginError('world-report-invalid','举报请求无效',false,400)
      if(pending?.requestUid===input.requestUid&&!pending.receipt)throw new ArkmePluginError('world-report-unconfirmed','举报提交结果尚未确认，请核对上次提交',true,409)
      await persist(scope,uid,{ack:input.requestUid})
      await current()
      return {}
    }
    if (input.action !== 'submit' || input.confirmed !== true || !Number.isInteger(input.reportType) || input.reportType < 1 || input.reportType > 6 || typeof input.reason !== 'string' || !input.reason.trim() || [...input.reason.trim()].length > 500 || typeof input.requestUid !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.requestUid)) throw new ArkmePluginError('world-report-invalid', '请选择举报类型并填写 1 至 500 字问题说明', false, 400)
    if (pending) {
      if (pending.requestUid !== input.requestUid || pending.reportType !== input.reportType || pending.reason !== input.reason.trim()) throw new ArkmePluginError('world-report-pending', '请先核对上次提交的举报', false, 409)
    } else {
      const response = await this.runtime.post<Record<string, unknown>>(this.runtime.config.worldBaseUrl, '/api/public/v1/world/read', {record_uid:uid}, undefined, [200], signal)
      const raw = this.mixedItem(response), owner = Number(raw.user_id), revision = stringValue(raw.content_revision)
      if (stringValue(raw.record_uid) !== uid || !/^[a-f0-9]{32}$/u.test(revision) || raw.is_public === false || [1,4].includes(Number(raw.check_status)) || !raw.team_author && (!Number.isSafeInteger(owner) || owner <= 0 || owner === session.userId)) throw new ArkmePluginError('world-report-unavailable', '这条公开内容已不可用，请刷新世界', false, 404)
      pending = {recordUid:uid, contentRevision:revision, requestUid:input.requestUid, reportType:input.reportType, reason:input.reason.trim()}
      await current()
      pending = (await persist(scope, uid, {put:pending}))!
    }
    await current()
    if(pending.receipt)return {submitted:true}
    try {
      const result = await this.runtime.authenticatedWorldPost<{submitted?:boolean;rejected?:string;report_id?:number}>('/api/v1/world/reports/create', {record_uid:pending.recordUid,content_revision:pending.contentRevision,request_uid:pending.requestUid,report_type:pending.reportType,reason:pending.reason},session,signal)
      if (result?.submitted === false && ['target_changed','request_conflict','invalid_request'].includes(result?.rejected ?? '')) {
        await persist(scope,uid,{reject:pending.requestUid})
        throw new ArkmePluginError('world-report-rejected','这次举报未被受理，公开版本或请求已变化，请刷新后重试',false,409)
      }
      if (result?.submitted !== true || result.rejected !== undefined || !Number.isSafeInteger(result.report_id) || result.report_id! <= 0) throw new Error('unconfirmed report')
      // Retain the original request and receipt until its caller has observed success.
      await persist(scope,uid,{accepted:pending.requestUid,reportId:result.report_id!})
    } catch (error) {
      if (error instanceof ArkmePluginError && (error.code === 'world-account-changed' || error.code === 'world-report-rejected' || error.code.startsWith('auth-'))) throw error
      throw new ArkmePluginError('world-report-unconfirmed', '举报提交结果尚未确认，请核对上次提交', true, 502)
    }
    await current()
    return {submitted:true}
  }

  /** Share the existing public URL, never a private Record or a copied media snapshot. */
  async shareWorldRecord(recordRef: string, expectedUserId: number, signal?: AbortSignal): Promise<ArkmeWorldShareResult> {
    const epoch = this.epoch, session = await this.runtime.requireSession()
    if (expectedUserId !== session.userId) throw new ArkmePluginError('world-account-changed', '账号已变化，请重新打开分享', false, 409)
    const recordUid = this.openWorldRecordRef(recordRef, session.userId).recordUid
    const response = await this.runtime.post<Record<string, unknown>>(
      this.runtime.config.worldBaseUrl, '/api/public/v1/world/read', { record_uid: recordUid }, undefined, [200], signal,
    ).catch(error => {
      if (error instanceof ArkmePluginError && (error.code === 'arkme-code-404' || error.upstreamStatus === 404)) throw new ArkmePluginError('world-share-unavailable', '这条内容已不可公开分享，请刷新世界', false, 404)
      throw error
    })
    const raw = this.mixedItem(response)
    if (stringValue(raw.record_uid) !== recordUid || stringValue(raw.parent_record_uid).trim() || !isPublicRecordUid(recordUid)) {
      throw new ArkmePluginError('world-share-unavailable', '这条内容已不可公开分享，请刷新世界', false, 404)
    }
    let arkmeId = stringValue(objectValue(raw.team_author).jotmoId)
    if (!raw.team_author) {
      const ownerUserId = numberValue(raw.user_id)
      const profiles = await this.runtime.authenticatedAuthPost<Record<string, unknown>>(
        '/api/v1/auth/get-public-users-by-ids', { user_ids: [ownerUserId] }, session, signal,
      )
      const author = listValue(profiles.items).map(objectValue).find(value => numberValue(value.user_id) === ownerUserId)
      arkmeId = [author?.jotmo_id, author?.name_slug, author?.arkme_id].map(stringValue).map(value => value.trim())
        .find(value => /^[A-Za-z][A-Za-z0-9_-]{4,31}$/.test(value)) ?? ''
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]{4,31}$/.test(arkmeId)) throw new ArkmePluginError('world-share-author-invalid', '暂时无法生成这条内容的公开链接，请重试', true, 502)
    let url: string
    try { url = new URL(`/shijie/${encodeURIComponent(arkmeId)}/record/${encodeURIComponent(recordUid)}`, this.runtime.config.shareWebsite ?? ARKME_DEFAULT_SHARE_WEBSITE).href }
    catch { throw new ArkmePluginError('world-share-url-invalid', '分享地址配置暂不可用', false, 503) }
    const target = parseShareLink(url)
    if (target?.kind !== 'public-record' || target.environment !== this.runtime.config.environment || target.id !== recordUid) {
      throw new ArkmePluginError('world-share-url-invalid', '分享地址配置暂不可用', false, 503)
    }
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (epoch !== this.epoch || current.userId !== session.userId || current.refreshToken !== session.refreshToken) {
      throw new ArkmePluginError('world-account-changed', '账号已变化，请重新打开分享', false, 409)
    }
    return { url, title: stringValue(raw.headline).trim() || `${stringValue(raw.nick_name).trim() || 'Arkme用户'}的世界`, previewText: stringValue(raw.text_content).trim().slice(0, 240) }
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

  async listWorldFeed(options: { limit?: number; cursor?: string; offset?: number; signal?: AbortSignal } = {}): Promise<ArkmeWorldFeedPage> {
    if (options.offset) throw new ArkmePluginError('world-cursor-required', '请刷新世界后使用新的分页引用', false, 400)
    return this.listMixedFeed(options)
  }
  async listMixedFeed(options: { teamID?: RecordOwnerId; parentUID?: string; limit?: number; cursor?: string; signal?: AbortSignal } = {}): Promise<ArkmeWorldFeedPage> {
    const session = await this.runtime.requireSession(), epoch = this.epoch
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), JSON.stringify([this.runtime.config.environment, session.userId]))
    const scope = [options.teamID ?? 0, options.parentUID ?? '']
    let cursor: Record<string, unknown> = {}
    if (options.cursor) {
      cursor = objectValue(JSON.parse(codec.open(options.cursor, 'world-feed-page')))
      if (JSON.stringify(cursor.scope) !== JSON.stringify(scope)) throw new ArkmePluginError('world-cursor-invalid', '世界分页已失效，请刷新', false, 409)
    }
    const data = await this.runtime.post<Record<string, unknown>>(this.runtime.config.worldBaseUrl, '/api/public/v1/world/query', {
      team_id: scope[0], parent_record_uid: scope[1], limit: Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20))), before_at: cursor.at ?? 0, after_uid: cursor.uid ?? '',
    }, undefined, [200], options.signal)
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw new ArkmePluginError('world-feed-invalid', '世界内容返回异常', true, 502)
    const raw = data.items.map(value => this.mixedItem(value))
    const avatars = await this.resolveWorldAvatarUrls(raw, session, options.signal)
    const projected = await Promise.all(raw.map(v => this.worldFeedItem(v, session.userId, avatars, options.signal)))
    const items = projected.filter((item): item is ArkmeWorldFeedItem => !!item)
    if (epoch !== this.epoch || (await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('world-account-changed', '账号已变化', false, 409)
    if (data.has_more && (!Number.isSafeInteger(data.before_at) || Number(data.before_at) < 0 || !stringValue(data.after_uid))) throw new ArkmePluginError('world-feed-invalid', '世界分页返回异常', true, 502)
    return { items, hasMore: data.has_more, ...(data.has_more ? { nextCursor: codec.seal(JSON.stringify({ scope, at: data.before_at, uid: data.after_uid }), 'world-feed-page') } : {}) }
  }
  private mixedItem(value: unknown): Record<string, unknown> {
    const v = objectValue(value), p = objectValue(v.principal)
    if (p.kind === 'person' && Number.isSafeInteger(p.user_id) && Number(p.user_id) > 0 && !p.team_id) return { ...v, user_id: p.user_id, nick_name: p.name, avatar: p.avatar }
    if (p.kind === 'team' && recordOwnerId(p.team_id) !== 0 && !p.user_id && stringValue(p.jotmo_id) && stringValue(p.name)) return { ...v, team_author: { jotmoId: p.jotmo_id, name: p.name }, nick_name: p.name, avatar: p.avatar }
    throw new ArkmePluginError('world-principal-invalid', '世界发布身份返回异常', true, 502)
  }
  async publicationReference(uid: string): Promise<string> {
    return this.worldRecordRef((await this.runtime.requireSession()).userId, uid)
  }

  /** Decode the viewer-bound handle; the target operation owns live authority.
   * Pending/withdrawn publications deliberately have no anonymous read grant. */
  async publicationUID(recordRef: string): Promise<string> {
    const session = await this.runtime.requireSession()
    return this.openWorldRecordRef(recordRef, session.userId).recordUid
  }

  async listWorldReplies(recordRef: string, options: { limit?: number; cursor?: string; signal?: AbortSignal } = {}): Promise<import('../types.js').ArkmeWorldRepliesPage> {
    const session = await this.runtime.requireSession()
    const parent = this.openWorldRecordRef(recordRef, session.userId)
    const page = await this.listMixedFeed({ ...options, parentUID: parent.recordUid })
    return { items: page.items.map(item => ({
      interactionRef: item.recordRef, parentRef: recordRef, authorName: item.authorName,
      ...(item.authorRef ? { authorRef: item.authorRef } : {}),
      ...(item.teamAuthor ? { teamAuthor: item.teamAuthor, publisher: item.publisher } : {}),
      ...(item.memberType === undefined ? {} : { memberType: item.memberType }),
      ...(item.avatarRef ? { avatarRef: item.avatarRef } : {}),
      ...(item.avatarFallback ? { avatarFallback: item.avatarFallback } : {}),
      isSelf: !item.teamAuthor && this.openWorldRecordRef(item.recordRef, session.userId).ownerUserId === session.userId,
      textContent: item.textContent, ...(item.textFormat ? { textFormat: item.textFormat } : {}),
      createdAtMillis: item.createdAtMillis, publishedAtMillis: item.publishedAtMillis,
      imageRefs: item.imageRefs, imageCount: item.imageCount, videoCount: item.videoCount, voiceCount: item.voiceCount,
    })), hasMore: page.hasMore, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
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
      const projected = await Promise.all(rootItems.map(raw => this.worldFeedItem(raw, session.userId, resolvedAvatars, options.signal)))
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
      const projected = await Promise.all(rootItems.map(raw => this.worldFeedItem(raw, session.userId, resolvedAvatars, options.signal)))
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
      ...(entry.imageCount === undefined ? {} : { imageCount: entry.imageCount }),
      ...(entry.videoCount === undefined ? {} : { videoCount: entry.videoCount }),
      ...(entry.voiceCount === undefined ? {} : { voiceCount: entry.voiceCount }),
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
      { lane: 'interactive-read' },
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

  /** my-list includes both original posts and comments; feed filtering must not be applied here. */
  async worldCommentNotifications(options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<import('../types.js').ArkmeWorldCommentNotificationPage> {
    const session = await this.runtime.requireSession(), epoch = this.epoch
    const codec = new TimelineTokenCodec(await this.runtime.stateStore.uniqueCode(), JSON.stringify([this.runtime.config.environment, session.userId]))
    const before = options.cursor ? Number(codec.open(options.cursor, 'world-comment-notifications')) : 0
    if (!Number.isSafeInteger(before) || before < 0) throw new ArkmePluginError('world-cursor-invalid', '通知分页引用无效', false, 400)
    const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>('/api/v1/world-interaction/notifications', { before_sequence: before, limit: Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20))) }, session, options.signal, { lane: 'interactive-read' })
    if (!Array.isArray(data.items) || data.items.length > 50 || typeof data.has_more !== 'boolean') throw new ArkmePluginError('world-notifications-invalid', '世界通知返回异常', true, 502)
    const rows = data.items.map(objectValue), projected = rows.filter(row => row.publication).map(row => this.mixedItem(row.publication))
    const avatars = await this.resolveWorldAvatarUrls(projected, session, options.signal)
    const visible = new Map<string, ArkmeWorldInteractionItem>()
    for (const row of projected) {
      const item = await this.worldInteractionItem(row, session.userId, avatars)
      if (!item) throw new ArkmePluginError('world-notifications-invalid', '世界通知返回异常', true, 502)
      visible.set(stringValue(row.record_uid), item)
    }
    const items = await Promise.all(rows.map(async row => {
      const uid = stringValue(row.comment_uid), sequence = Number(row.sequence)
      if (!uid || !Number.isSafeInteger(sequence) || sequence <= 0 || before > 0 && sequence >= before) throw new ArkmePluginError('world-notifications-invalid', '世界通知分页异常', true, 502)
      const item = visible.get(uid)
      return item ? { ...item, unavailable: false, replyToComment: row.reply_to_comment === true } : { interactionRef: await this.worldRecordRef(session.userId, uid), parentRef: '', authorName: '', textContent: '这条回复已不可访问', createdAtMillis: numberValue(row.at), publishedAtMillis: 0, imageCount: 0, videoCount: 0, voiceCount: 0, unavailable: true }
    }))
    const next = Number(data.before_sequence)
    if (data.has_more && (!items.length || !Number.isSafeInteger(next) || next <= 0 || next !== rows.at(-1)?.sequence || before > 0 && next >= before)) throw new ArkmePluginError('world-notifications-invalid', '世界通知分页未推进', true, 502)
    options.signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || epoch !== this.epoch) throw new ArkmePluginError('world-account-changed', '账号已变化', false, 409)
    return { items, hasMore: data.has_more, ...(data.has_more ? { nextCursor: codec.seal(String(next), 'world-comment-notifications') } : {}) }
  }

  /** Legacy owner listing remains available to existing consumers. */
  async worldNotificationSources(offset = 0, signal?: AbortSignal): Promise<ArkmeWorldNotificationSourcePage> {
    const epoch = this.epoch
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
      '/api/v1/public-record/my-list', { limit: 20, offset }, session, signal,
    )
    const raw = listValue(data.list)
    const items: ArkmeWorldNotificationSourcePage['items'] = []
    for (const value of raw) {
      const item = objectValue(value), uid = stringValue(item.record_uid).trim()
      if (!uid || integerValue(item.user_id) !== session.userId || item.is_public === false) continue
      const status = integerValue(item.check_status)
      if (status && status !== 2 && status !== 3) continue
      items.push({ recordRef: await this.worldRecordRef(session.userId, uid), isComment: !!stringValue(item.parent_record_uid).trim() })
    }
    const nextOffset = offset + raw.length
    const hasMore = raw.length > 0 && nextOffset < numberValue(data.total)
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || epoch !== this.epoch) throw new ArkmePluginError('world-account-changed', '账号状态已变化', false, 409)
    return { items, hasMore, ...(hasMore ? { nextOffset } : {}) }
  }

  /** Resolve the current public ancestor chain; an old notification never bypasses visibility. */
  async worldNotificationTarget(interactionRef: string, signal?: AbortSignal): Promise<ArkmeWorldNotificationTarget> {
    const epoch = this.epoch
    const session = await this.runtime.requireSession()
    const uid = this.openWorldRecordRef(interactionRef, session.userId).recordUid
    const data = await this.runtime.post<Record<string, unknown>>(
      this.runtime.config.worldBaseUrl, '/api/public/v1/world/thread', { record_uid: uid }, undefined, [200], signal,
    )
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || epoch !== this.epoch) throw new ArkmePluginError('world-account-changed', '账号状态已变化', false, 409)
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 33) throw new ArkmePluginError('world-notification-unavailable', '这条世界动态或评论已不可查看', false, 404)
    const raw = data.items.map(value => this.mixedItem(value))
    if (stringValue(raw.at(-1)?.record_uid) !== uid || stringValue(raw[0]?.parent_record_uid)) throw new ArkmePluginError('world-thread-invalid', '回复路径返回异常', true, 502)
    for (let index = 1; index < raw.length; index++) {
      if (raw[index]!.parent_record_uid !== raw[index - 1]!.record_uid) throw new ArkmePluginError('world-thread-invalid', '回复路径返回异常', true, 502)
    }
    const avatars = await this.resolveWorldAvatarUrls(raw, session, signal)
    const root = await this.worldFeedItem(raw[0], session.userId, avatars, signal)
    const replies = await Promise.all(raw.slice(1).map(item => this.worldInteractionItem(item, session.userId, avatars)))
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || epoch !== this.epoch) throw new ArkmePluginError('world-account-changed', '账号状态已变化', false, 409)
    if (!root || replies.some(item => !item)) throw new ArkmePluginError('world-notification-unavailable', '这条世界动态或评论已不可查看', false, 404)
    return { root, interactionRef, path: replies as ArkmeWorldInteractionItem[] }
  }

  async worldInteractionSummary(signal?: AbortSignal): Promise<ArkmeWorldInteractionSummary> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
      '/api/v1/world-interaction/summary', {}, session, signal,
    )
    const unreadCount = Math.max(0, Math.trunc(numberValue(data.unread_count ?? data.unreadCount)))
    const seenThroughSequence = Math.max(0, Math.trunc(numberValue(data.seen_through_sequence ?? data.seenThroughSequence)))
    return { unreadCount, seenThroughSequence, authoritative: true }
  }

  async markWorldInteractionsViewed(seenThroughSequence: number, signal?: AbortSignal): Promise<ArkmeWorldInteractionSummary> {
    const session = await this.runtime.requireSession()
    const sequence = Math.max(0, Math.trunc(seenThroughSequence))
    if (sequence <= 0) return { unreadCount: 0, seenThroughSequence: 0, authoritative: true }
    const data = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
      '/api/v1/world-interaction/mark-viewed', { seen_through_sequence: sequence }, session, signal,
    )
    return {
      unreadCount: Math.max(0, Math.trunc(numberValue(data.unread_count ?? data.unreadCount))),
      seenThroughSequence: Math.max(sequence, Math.trunc(numberValue(data.seen_through_sequence ?? data.seenThroughSequence))),
      authoritative: true,
    }
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
    const result = await this.media.downloadSignedImage(
      trustedWorldImageUrl(this.runtime.config.environment, entry.sourceUrl, this.runtime.config.worldBaseUrl),
      byteLimit,
      options.signal,
      this.runtime.requestScope(session.userId),
    )
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('world-image-ref-invalid', '账号已变化，请重新加载图片', false, 403)
    return result
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

  /** Existing owner-verified source: publish it without creating or overwriting a private Record. */
  async publishExistingSource(source: import('../world-publish-source.js').WorldPublishSourceDraft, expectedUserId: number, signal?: AbortSignal): Promise<ArkmeWorldPublishResult> {
    const session = await this.runtime.requireSession()
    if (session.userId !== expectedUserId) throw new ArkmePluginError('world-account-changed', '账号已变化', false, 409)
    const profile = (await this.profile.refreshProfile()).profile
    if (!profile?.contact.phoneMasked) throw new ArkmePluginError('world-phone-required', '请先绑定手机号', false, 403)
    const text = [source.title.trim(), source.textContent].filter(Boolean).join('\n\n').trim()
    const assets = source.attachments.map(value => value.asset)
    if ((!text && !assets.length) || text.length > 2000 || assets.length > ARKME_WORLD_PUBLISH_MAX_IMAGES
      || source.attachments.some(v => v.unavailable || !v.asset || v.asset.fileKind !== 1 || !v.asset.mimeType.startsWith('image/') || v.asset.size <= 0 || v.asset.size > ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES)) {
      throw new ArkmePluginError('world-source-unsupported', '原消息无法完整公开，请检查内容或附件', false, 400)
    }
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('world-account-changed', '账号已变化', false, 409)
    signal?.throwIfAborted()
    const published = await this.runtime.authenticatedWorldPost<Record<string, unknown>>(
      assets.length ? '/api/v1/public-record/publish-with-file-assets' : '/api/v1/public-record/publish', {
        record_uid: source.itemUid, content: text, text_content: text, tags: worldTags(text), original_topic_id: 0,
        created_at: source.sendAtMillis, nick_name: profile.nickname || profile.displayName, avatar: profile.avatarRef, template_kind: 1,
        ...(assets.length ? { file_assets: assets.map((asset, i) => ({ file_asset_uid: asset!.fileAssetUid, media_type: 'image', file_kind: 1, sort_order: i })) } : {}),
      }, session, signal)
    return worldPublicationResult(Math.trunc(numberValue(published.check_status)))
  }
  async publicationStatuses(uids: string[], signal?: AbortSignal): Promise<ReadonlyMap<string, boolean>> {
    if (uids.length > 50) throw new ArkmePluginError('world-status-invalid', '查询数量过多', false, 400)
    if (!uids.length) return new Map()
    const data = await this.runtime.post<Record<string, unknown>>(this.runtime.config.worldBaseUrl, '/api/public/v1/public-record/status-batch', { record_uids: uids }, undefined, [200], signal, false, { lane: 'background-read', service: 'world', bypassCache: true })
    const values = listValue(data.items).map(objectValue)
    if (values.length !== uids.length || values.some((v, i) => v.record_uid !== uids[i] || typeof v.is_public !== 'boolean')) throw new ArkmePluginError('world-status-invalid', '公开状态返回不完整，请重试', true, 502)
    return new Map(values.map(v => [String(v.record_uid), v.is_public === true]))
  }
  async publicationPrincipal(recordRef: string, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    const uid = (await this.reactionTarget(recordRef)).record_uid!
    const raw = await this.runtime.post<Record<string, unknown>>(this.runtime.config.worldBaseUrl, '/api/public/v1/world/read', { record_uid: uid }, undefined, [200], signal)
    if (raw.record_uid !== uid) throw new ArkmePluginError('world-status-invalid', '公开内容不匹配', false, 502)
    const principal = objectValue(raw.principal)
    if (principal.kind === 'team') {
      const team = recordOwnerId(principal.team_id)
      if (!team || principal.user_id) throw new ArkmePluginError('world-status-invalid', '团队公开身份无效', false, 502)
      return { uid, owner: 0 as RecordOwnerId, team, viewer: session.userId }
    }
    if (principal.kind !== undefined && principal.kind !== 'person') throw new ArkmePluginError('world-status-invalid', '公开身份无效', false, 502)
    return { uid, owner: recordOwnerId(principal.kind === 'person' ? principal.user_id : raw.user_id), team: 0 as RecordOwnerId, viewer: session.userId }
  }
  async unpublishExisting(uid: string, expectedUserId: number, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    if (session.userId !== expectedUserId) throw new ArkmePluginError('world-account-changed', '账号已变化', false, 409)
    await this.runtime.authenticatedWorldPost('/api/v1/public-record/unpublish', { record_uid: uid }, session, signal)
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
    signal?: AbortSignal,
  ): Promise<ArkmeWorldFeedItem | undefined> {
    const item = objectValue(raw)
    const recordUid = stringValue(item.record_uid).trim()
    const textContent = stringValue(item.text_content ?? item.content).trim()
    const headline = stringValue(item.headline).trim()
    const recordType = stringValue(item.record_type).trim()
    const rawExtensionPublication = objectValue(item.extension_publication)
    const extensionId = stringValue(rawExtensionPublication.extension_id).trim()
    const extensionVisibility = stringValue(rawExtensionPublication.visibility).trim()
    const isExtensionPublication = recordType === 'extension_publication'
      && extensionId !== ''
      && extensionVisibility === 'public'
    let extensionShare = isExtensionPublication
      ? worldExtensionPublicationShare(rawExtensionPublication, item)
      : undefined
    if (isExtensionPublication && extensionShare === undefined) {
      extensionShare = await this.extensionPublicationShare(extensionId, signal)
    }
    const rawImages = listValue(item.images).map(stringValue).map(value => value.trim()).filter(value => value !== '')
    const videoCount = listValue(item.videos).length
    const voiceCount = listValue(item.voices).length
    if (recordUid === '' || (!isExtensionPublication && textContent === '' && headline === '' && rawImages.length + videoCount + voiceCount === 0)) {
      return undefined
    }
    const ownerUserId = Math.trunc(numberValue(item.user_id))
    const rawAvatar = stringValue(item.avatar ?? item.head_img).trim()
    const avatarUrl = rawAvatar.startsWith('file_asset://')
      ? resolvedAvatars.get(worldAvatarResolutionKey(ownerUserId, rawAvatar)) ?? ''
      : rawAvatar
    const avatarFallback = worldPhoneDefaultAvatar(rawAvatar)
    const imageRefs = await this.publicImageRefs(rawImages, viewerUserId, recordUid)
    const avatarRef = this.isTrustedWorldImageUrl(avatarUrl)
      ? await this.sealWorldImageRef(
        viewerUserId,
        avatarUrl,
        `avatar:${String(ownerUserId)}:${rawAvatar.startsWith('file_asset://') ? rawAvatar : worldImageAssetIdentity(avatarUrl)}`,
      )
      : undefined
    const authorName = stringValue(item.nick_name ?? item.nickname).trim() || 'Arkme用户'
    const recordRef = await this.worldRecordRef(viewerUserId, recordUid, {
        ownerUserId,
        authorName,
        imageCount: rawImages.length,
        videoCount,
        voiceCount,
        ...(() => {
          const textPreview = optionalTrimmedText(headline || textContent, 80)
          return textPreview === undefined ? {} : { textPreview }
        })(),
      })
    return {
      recordRef,
      ...(recordType==='sound_excerpt'?{recordType:'sound_excerpt' as const,soundExcerpt:this.soundExcerpt(item.sound_excerpt,viewerUserId,recordUid),soundStatus:item.is_public===false?'withdrawn' as const:[2,3].includes(Number(item.check_status))?'published' as const:Number(item.check_status)===4?'rejected' as const:'pending' as const}:{}),
      ...(item.team_author ? { publisher: await this.publicPublisher(item, viewerUserId, resolvedAvatars) } : {}),
      ...(item.team_author ? { teamAuthor: objectValue(item.team_author) as { jotmoId: string; name: string } } : {}),
      localReactionTarget: await localWorldReactionTarget(this.runtime, viewerUserId, recordUid, createHash('sha256').update(JSON.stringify({ headline, textContent, templateKind: item.template_kind,
        images: rawImages.map(worldImageAssetIdentity), videos: listValue(item.videos).map(value => typeof value === 'string' ? worldImageAssetIdentity(value) : value), voices: listValue(item.voices).map(value => typeof value === 'string' ? worldImageAssetIdentity(value) : value),
        files: listValue(item.file_assets).map(value => { const asset = objectValue(value); return [asset.file_asset_uid, asset.storage_key, asset.sort_order] }),
      })).digest('hex')),
      ...(ownerUserId > 0 && ownerUserId !== viewerUserId ? { authorRef: recordRef } : {}),
      authorName,
      ...(this.cachedAuthorMembership(viewerUserId, ownerUserId) === undefined ? {} : { memberType: this.cachedAuthorMembership(viewerUserId, ownerUserId) }),
      ...(avatarRef === undefined ? {} : { avatarRef }),
      ...(avatarRef === undefined && avatarFallback !== undefined ? { avatarFallback } : {}),
      headline,
      textContent: isExtensionPublication
        ? worldTextWithExtensionShare(textContent, extensionShare)
        : textContent,
      tags: listValue(item.tags).map(stringValue).map(tag => tag.trim()).filter(tag => tag !== ''),
      templateKind: Math.trunc(numberValue(item.template_kind)),
      createdAtMillis: Math.trunc(numberValue(item.created_at)),
      publishedAtMillis: Math.trunc(numberValue(item.published_at)),
      imageRefs,
      imageCount: rawImages.length,
      videoCount,
      voiceCount,
      extendCount: Math.max(0, Math.trunc(numberValue(item.extend_count))),
      ...(isExtensionPublication ? {
        recordType: 'extension_publication' as const,
        extensionPublication: {
          extensionId,
          version: stringValue(rawExtensionPublication.version).trim(),
          name: stringValue(rawExtensionPublication.name).trim() || '未命名插件',
          description: stringValue(rawExtensionPublication.description).trim(),
          ...(extensionShare === undefined ? {} : { share: extensionShare }),
          ...(() => {
            const iconRef = stringValue(rawExtensionPublication.icon_ref).trim()
            return iconRef === '' ? {} : { iconRef }
          })(),
          previewRefs: listValue(rawExtensionPublication.preview_refs).map(stringValue).map(value => value.trim()).filter(value => value !== ''),
          visibility: 'public' as const,
          ...(() => {
            const runtimeDshRange = stringValue(rawExtensionPublication.runtime_dsh_range).trim()
            return runtimeDshRange === '' ? {} : { runtimeDshRange }
          })(),
          desktopRequired: Boolean(rawExtensionPublication.desktop_required),
          publishedAtMillis: Math.trunc(numberValue(rawExtensionPublication.published_at)),
        },
      } : {}),
    }
  }

  private async extensionPublicationShare(extensionId: string, signal?: AbortSignal): Promise<ArkmeWorldExtensionShare | undefined> {
    const normalized = extensionId.trim()
    if (normalized === '') return undefined
    const now = Date.now()
    const cached = this.extensionPublicationShareCache.get(normalized)
    if (cached !== undefined && cached.expiresAtMillis > now) return cached.share
    const inFlight = this.extensionPublicationShareInFlight.get(normalized)
    if (inFlight !== undefined) return await inFlight

    const load = this.loadExtensionPublicationShare(normalized, signal)
    this.extensionPublicationShareInFlight.set(normalized, load)
    try {
      const share = await load
      if (this.extensionPublicationShareCache.size >= MAX_ARKME_WORLD_EXTENSION_SHARE_CACHE_ENTRIES) {
        const oldestKey = this.extensionPublicationShareCache.keys().next().value
        if (oldestKey !== undefined) this.extensionPublicationShareCache.delete(oldestKey)
      }
      this.extensionPublicationShareCache.set(normalized, {
        ...(share === undefined ? {} : { share }),
        expiresAtMillis: Date.now() + ARKME_WORLD_EXTENSION_SHARE_CACHE_TTL_MILLIS,
      })
      return share
    } finally {
      this.extensionPublicationShareInFlight.delete(normalized)
    }
  }

  private async loadExtensionPublicationShare(extensionId: string, signal?: AbortSignal): Promise<ArkmeWorldExtensionShare | undefined> {
    try {
      const detail = await this.runtime.extensionPost<unknown>(
        '/api/public/v1/extensions/detail',
        { extension_id: extensionId },
        signal,
        {
          lane: 'background-read',
          key: `world-extension-share:${extensionId}`,
          cacheMs: ARKME_WORLD_EXTENSION_SHARE_CACHE_TTL_MILLIS,
          failureCooldownMs: 30_000,
        },
      )
      return worldExtensionShareFromCatalogDetail(detail)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      return undefined
    }
  }

  private isTrustedWorldImageUrl(raw: string, publication = false): boolean {
    if (raw.length > 4096) return false
    try {
      trustedWorldImageUrl(this.runtime.config.environment, raw, this.runtime.config.worldBaseUrl, publication)
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
    const publishers = new Map<number, Record<string, unknown>>()
    const ids = [...new Set(rawItems.map(objectValue).filter(item => item.team_author).map(item => numberValue(item.publisher_user_id)).filter(id => Number.isSafeInteger(id) && id > 0))]
    for (let offset = 0; offset < ids.length; offset += 50) {
      signal?.throwIfAborted()
      const batch = ids.slice(offset, offset + 50)
      try {
        const data = await this.runtime.authenticatedAuthPost<Record<string, unknown>>('/api/v1/auth/get-public-users-by-ids', { user_ids: batch }, session, signal, { lane: 'interactive-read' })
        for (const raw of listValue(data.items)) {
          const profile = objectValue(raw), id = numberValue(profile.user_id)
          if (batch.includes(id)) publishers.set(id, { user_id: id, nick_name: stringValue(profile.nickname ?? profile.nick_name), avatar: stringValue(profile.avatar ?? profile.head_img) })
        }
      } catch { signal?.throwIfAborted() /* Profile decoration must not make the feed unavailable. */ }
    }
    for (const raw of rawItems) {
      const item = objectValue(raw)
      if (item.team_author) item.public_publisher = publishers.get(numberValue(item.publisher_user_id))
    }
    const requested = new Map<string, { owner_user_id: number; avatar_ref: string }>()
    for (const raw of [...rawItems, ...publishers.values()]) {
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

  private async publicPublisher(item: Record<string, unknown>, viewer: number, avatars: ReadonlyMap<string, string>): Promise<NonNullable<ArkmeWorldFeedItem['publisher']>> {
    const profile = objectValue(item.public_publisher), id = numberValue(profile.user_id)
    const rawAvatar = stringValue(profile.avatar), name = stringValue(profile.nick_name).trim() || '原发布人'
    const url = rawAvatar.startsWith('file_asset://') ? avatars.get(worldAvatarResolutionKey(id, rawAvatar)) ?? '' : rawAvatar
    return { name, ...(this.isTrustedWorldImageUrl(url) ? { avatarRef: await this.sealWorldImageRef(viewer, url, `avatar:${id}:${worldImageAssetIdentity(url)}`) } : {}) }
  }

  private async publicImageRefs(urls: string[], viewer: number, recordUid: string): Promise<string[]> {
    const refs: string[] = []
    for (const [index, url] of urls.entries()) {
      if (!this.isTrustedWorldImageUrl(url, true)) continue
      refs.push(await this.sealWorldImageRef(viewer, url, `record:${recordUid}:image:${String(index)}:${worldImageAssetIdentity(url)}`))
    }
    return refs
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
    const authorName = stringValue(item.nick_name ?? item.nickname).trim() || 'Arkme用户'
    const interactionRef = await this.worldRecordRef(viewerUserId, recordUid, {
        ownerUserId,
        authorName,
        ...(() => {
          const textPreview = optionalTrimmedText(textContent, 80)
          return textPreview === undefined ? {} : { textPreview }
        })(),
      })
    return {
      interactionRef,
      ...(item.team_author ? { publisher: await this.publicPublisher(item, viewerUserId, resolvedAvatars) } : {}),
      ...(item.team_author ? { teamAuthor: item.team_author as ArkmeWorldFeedItem['teamAuthor'] } : {}),
      parentRef: await this.worldRecordRef(viewerUserId, parentRecordUid),
      isSelf: ownerUserId === viewerUserId,
      ...(ownerUserId > 0 && ownerUserId !== viewerUserId ? { authorRef: interactionRef } : {}),
      authorName,
      ...(this.cachedAuthorMembership(viewerUserId, ownerUserId) === undefined ? {} : { memberType: this.cachedAuthorMembership(viewerUserId, ownerUserId) }),
      ...(avatarRef === undefined ? {} : { avatarRef }),
      ...(avatarRef === undefined && avatarFallback !== undefined ? { avatarFallback } : {}),
      textContent,
      createdAtMillis: Math.trunc(numberValue(item.created_at)),
      publishedAtMillis: Math.trunc(numberValue(item.published_at)),
      imageRefs: await this.publicImageRefs(listValue(item.images).map(stringValue).map(value => value.trim()).filter(Boolean), viewerUserId, recordUid),
      imageCount,
      videoCount,
      voiceCount,
    }
  }

  private soundExcerpt(raw:unknown,viewer:number,recordUID:string):import('../world-sound-contract.js').WorldSoundExcerpt{
    const excerpt=worldSoundProjection(raw),rows=listValue(objectValue(raw).segments)
    if(!this.media?.issueWorldSoundMediaRef)throw new ArkmePluginError('world-sound-unsupported','当前运行环境不支持声音摘录',false,409)
    return {...excerpt,segments:excerpt.segments.map((s,i)=>({...s,audioUrl:`${this.runtime.config.routePath}/media?ref=${encodeURIComponent(this.media!.issueWorldSoundMediaRef!(viewer,stringValue(objectValue(rows[i]).audio_url),{recordUID,index:i}))}`}))}
  }

  private async worldRecordRef(
    viewerUserId: number,
    recordUid: string,
    metadata: {
      ownerUserId?: number
      authorName?: string
      textPreview?: string
      imageCount?: number
      videoCount?: number
      voiceCount?: number
    } = {},
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
    const imageCount = Math.max(0, Math.trunc(metadata.imageCount ?? previous?.imageCount ?? 0))
    const videoCount = Math.max(0, Math.trunc(metadata.videoCount ?? previous?.videoCount ?? 0))
    const voiceCount = Math.max(0, Math.trunc(metadata.voiceCount ?? previous?.voiceCount ?? 0))
    this.worldRecordRefs.set(recordRef, {
      viewerUserId,
      recordUid,
      ...(resolvedOwnerUserId === undefined || resolvedOwnerUserId <= 0 ? {} : { ownerUserId: resolvedOwnerUserId }),
      ...(authorName === undefined ? {} : { authorName }),
      ...(textPreview === undefined ? {} : { textPreview }),
      ...(imageCount === 0 ? {} : { imageCount }),
      ...(videoCount === 0 ? {} : { videoCount }),
      ...(voiceCount === 0 ? {} : { voiceCount }),
      expiresAtMillis: now + ARKME_WORLD_RECORD_REF_TTL_MILLIS,
    })
    return recordRef
  }

  /** Resolve an opaque World author reference only inside the trusted Provider. */
  async worldAuthorFromRef(recordRef: string, allowSelf = false, options: { labels?: boolean; signal?: AbortSignal } = {}): Promise<{ userId: number; displayName: string }> {
    options.signal?.throwIfAborted()
    const session = await this.runtime.requireSession()
    options.signal?.throwIfAborted()
    const entry = this.openWorldRecordRef(recordRef, session.userId)
    const userId = entry.ownerUserId ?? 0
    if (!Number.isSafeInteger(userId) || userId <= 0 || (!allowSelf && userId === session.userId)) {
      throw new ArkmePluginError('world-author-target-invalid', '无法确认这位用户，请刷新世界后重试', false, 403)
    }
    const labels = options.labels === false || this.viewerLabels === undefined
      ? new Map<number, string>()
      : await this.viewerLabels.privateDisplayNamesByUserIds([userId], { ...(options.signal ? { signal: options.signal } : {}) }).catch(() => new Map<number, string>())
    options.signal?.throwIfAborted()
    return { userId, displayName: labels.get(userId) ?? entry.authorName ?? 'Arkme用户' }
  }

  /** Resolve viewer-local labels after World content has already been rendered. */
  private cachedAuthorMembership(viewerUserId: number, ownerUserId: number) {
    const value = this.authorMemberships.get(`${viewerUserId}:${ownerUserId}`)
    return value && value.expiresAt > Date.now() ? value.memberType : undefined
  }

  /** Decoration is bounded, shared across pages/details, and never blocks the feed read. */
  private async loadAuthorMemberships(userIds: readonly number[], session: ArkmeSessionCredentials) {
    const epoch = this.epoch
    const key = (id: number) => `${session.userId}:${id}`
    const missing = userIds.filter(id => this.cachedAuthorMembership(session.userId, id) === undefined && !this.authorMembershipInFlight.has(key(id)))
    if (missing.length > 0) {
      const controller = new AbortController()
      this.authorMembershipRequests.add(controller)
      const timeout = setTimeout(() => controller.abort(), 4_000)
      const request = (async () => {
        const values = new Map<number, ReturnType<typeof arkmePeerMemberType>>()
        try {
          const peers = missing.filter(id => id !== session.userId)
          const [data, own] = await Promise.all([
            peers.length ? this.runtime.authenticatedAuthPost<Record<string, unknown>>(
              '/api/v1/auth/get-public-users-by-ids', { user_ids: peers }, session, controller.signal,
              { lane: 'interactive-read', key: `world-author-membership:${[...peers].sort((a, b) => a - b).join('|')}` },
            ).catch(() => ({ items: [] })) : { items: [] },
            missing.includes(session.userId) ? this.runtime.authenticatedAuthReadPost<Record<string, unknown>>(
              '/api/v1/premium/get/member', {}, session, controller.signal,
            ).catch(() => undefined) : undefined,
          ])
          for (const raw of listValue(data.items)) {
            const row = objectValue(raw), userId = numberValue(row.user_id)
            if (peers.includes(userId)) values.set(userId, arkmePeerMemberType(row.member_type))
          }
          if (own) values.set(session.userId, arkmePeerMemberType(own.member_type))
        } catch { /* Missing entitlement stays unknown; never infer a free or paid membership. */ }
        finally { clearTimeout(timeout); this.authorMembershipRequests.delete(controller) }
        if (epoch !== this.epoch) return
        for (const id of missing) {
          const memberType = values.get(id) ?? 'unknown'
          this.authorMemberships.set(key(id), { memberType, expiresAt: Date.now() + (memberType === 'unknown' ? 5_000 : 60_000) })
        }
        while (this.authorMemberships.size > 4096) this.authorMemberships.delete(this.authorMemberships.keys().next().value!)
      })().finally(() => {
        for (const id of missing) if (this.authorMembershipInFlight.get(key(id)) === request) this.authorMembershipInFlight.delete(key(id))
      })
      for (const id of missing) this.authorMembershipInFlight.set(key(id), request)
    }
    await Promise.all(new Set(userIds.map(id => this.authorMembershipInFlight.get(key(id))).filter(value => value !== undefined)))
    return new Map(userIds.map(id => [id, this.cachedAuthorMembership(session.userId, id) ?? 'unknown']))
  }

  async worldAuthorLabels(recordRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeWorldAuthorLabel[]> {
    signal?.throwIfAborted()
    const epoch = this.epoch
    const session = await this.runtime.requireSession()
    const refs = [...new Set(recordRefs.map(value => value.trim()).filter(value => value !== ''))].slice(0, 20)
    const entries = refs.map(authorRef => ({ authorRef, entry: this.openWorldRecordRef(authorRef, session.userId) }))
      .filter(({ entry }) => Number.isSafeInteger(entry.ownerUserId) && entry.ownerUserId! > 0)
    if (entries.length === 0) return []
    const userIds = [...new Set(entries.map(({ entry }) => entry.ownerUserId!))]
    const peers = userIds.filter(id => id !== session.userId)
    const [labels, memberships] = await Promise.all([
      this.viewerLabels === undefined || peers.length === 0 ? new Map<number, string>()
        : this.viewerLabels.privateDisplayNamesByUserIds(peers, { ...(signal === undefined ? {} : { signal }) }).catch(() => new Map<number, string>()),
      this.loadAuthorMemberships(userIds, session),
    ])
    signal?.throwIfAborted()
    if (epoch !== this.epoch || (await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('world-account-changed', '账号状态已变化', false, 409)
    return entries.map(({ authorRef, entry }) => ({
      authorRef,
      authorName: labels.get(entry.ownerUserId!) ?? entry.authorName ?? 'Arkme用户',
      memberType: memberships.get(entry.ownerUserId!) ?? 'unknown',
    }))
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
