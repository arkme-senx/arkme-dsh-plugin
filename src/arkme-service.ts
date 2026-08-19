import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import OSS from 'ali-oss'
import { ArkmeChatRealtimeRuntime, type ArkmeChatRealtimeNotice } from './chat-realtime.js'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from './keychain-store.js'
import { ArkmeOutgoingCallBroker } from './outgoing-call-broker.js'
import {
  ArkmeRequestCoordinator,
  type ArkmeRequestLane,
  type ArkmeRequestService,
  type ArkmeRequestStats,
} from './request-coordinator.js'
import type {
  ArkmeOutgoingCallIntentClaim,
  ArkmeOutgoingCallIntentResolutionInput,
  ArkmeOutgoingCallMediaType,
  ArkmeOutgoingCallPrepareResult,
  ArkmeOutgoingCallToolResult,
} from './outgoing-call-contract.js'
import { projectRecordingTranscripts, projectRecordingVersions } from './recording-presentation.js'
import { ARKME_PROVIDER_CONTRACT_VERSION } from './types.js'
import type {
  ArkmeDSHBetaCommunityEntryState,
  ArkmeDSHBetaCommunityJoinResult,
  ArkmeDSHBetaCommunityStatus,
} from './dsh-beta-community.js'
import type {
  ArkmeAiVideoJob,
  ArkmeAiVideoListItem,
  ArkmeAiVideoListResult,
  ArkmeAiVideoJobStatus,
  ArkmeAiVideoPreflightResult,
  ArkmeAiVideoSegmentSelector,
  ArkmeArkoAskResult,
  ArkmeArkoCancelResult,
  ArkmeArkoHistoryItem,
  ArkmeArkoHistoryPage,
  ArkmeArkoModelCatalog,
  ArkmeArkoModelOption,
  ArkmeArkoProfile,
  ArkmeArkoRunProjection,
  ArkmeArkoRunStatus,
  ArkmeArkoSession,
  ArkmeAuthSnapshot,
  ArkmeCachedSnapshot,
  ArkmeCachedQueryResult,
  ArkmeChatClientEvent,
  ArkmeChatRealtimeState,
  ArkmeCaptchaResult,
  ArkmeClientConfig,
  ArkmeConversationWriteResult,
  ArkmeContentBlock,
  ArkmeCreateTextResult,
  ArkmeDirectTextSendResult,
  ArkmeEnvironment,
  ArkmeGroupActionResult,
  ArkmeGroupMemberItem,
  ArkmeGroupMemberList,
  ArkmeGroupMemberRole,
  ArkmeGroupMemberStatus,
  ArkmeGroupNotificationResult,
  ArkmeGroupSettingsSnapshot,
  ArkmeIdAvailabilityReason,
  ArkmeIdAvailabilitySnapshot,
  ArkmeIdMutationResult,
  ArkmeGroupAiPolishMutationResult,
  ArkmeGroupAiPolishNotice,
  ArkmeGroupAiPolishRuleCandidate,
  ArkmeGroupAiPolishSnapshot,
  ArkmeImageBytes,
  ArkmeImageMediaType,
  ArkmeFileAssetDisplayItem,
  ArkmeOpenPrivateChatResult,
  ArkmeInterwovenBootstrap,
  ArkmeInterwovenDetail,
  ArkmeInterwovenMention,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
  ArkmePendingWrite,
  ArkmeRelatedRecordingEligibility,
  ArkmeRelatedRecordingItem,
  ArkmeRelatedRecordingMonthBucket,
  ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageOptions,
  ArkmeRelatedRecordingPageState,
  ArkmeRecordCursor,
  ArkmeRecordSearchResult,
  ArkmeRecordingSearchResult,
  ArkmeRichSendInput,
  ArkmeSearchRecordItem,
  ArkmeSearchAssetItem,
  ArkmeSearchHistoryResult,
  ArkmeSearchSceneKind,
  ArkmeSearchSourceAggregate,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingCursorPayload,
  ArkmeRecordingDay,
  ArkmeRecordingProjectionKind,
  ArkmeRecordingSection,
  ArkmeRecordingTranscriptSection,
  ArkmeRecordingTranscriptItem,
  ArkmeRecordingVersion,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceKind,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
  ArkmeTimelinePage,
  ArkmeTopicCreateResult,
  ArkmeUploadedAsset,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
  ArkmeUserCardSnapshot,
  ArkmeWorldPublishResult,
  ArkmeWorldRecordItem,
  ArkmeWorldRecordList,
  ArkmeWorldVisibility,
  ArkmeWechatCallFilter,
  ArkmeWechatCommonGroupPage,
  ArkmeWechatConversationDetail,
  ArkmeWechatConversationPage,
  ArkmeWechatGroupMember,
  ArkmeWechatGroupMemberPage,
  ArkmeWechatLocation,
  ArkmeWechatLocationPage,
  ArkmeWechatMessage,
  ArkmeWechatMessageFilter,
  ArkmeWechatMessagePage,
  ArkmeWechatMoneyFlow,
  ArkmeWechatMoneyFlowPage,
  ArkmeWechatPhonePage,
} from './types.js'

interface StateStore {
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
  getLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined>
  putLongArticleDraft(userId: number, draft: ArkmeLongArticleDraft): Promise<void>
  removeLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<void>
}

export interface ArkmeServiceConfig {
  environment: ArkmeEnvironment
  authBaseUrl: string
  subjectBaseUrl: string
  recordBaseUrl: string
  chatBaseUrl: string
  imBaseUrl: string
  webrtcBaseUrl: string
  worldBaseUrl: string
  relationBaseUrl: string
  intelligentBaseUrl: string
  routePath: string
  audioBaseUrl: string
  requestTimeoutMs: number
  maxTextLength: number
  geetestCaptchaId: string
  relatedRecordingsEnabled?: boolean
  interwovenMomentsEnabled: boolean
  richMediaRenderEnabled?: boolean
  richMediaSendEnabled?: boolean
  maxUploadBytes?: number
}

interface ArkmeMediaDescriptor {
  viewerUserId: number
  remoteUrl: string
  mimeType: string
  fileName: string
  size: number
  expiresAtMillis: number
}

interface ArkmePreparedUpload {
  upload_session_uid?: unknown
  upload_url?: unknown
  upload_headers?: unknown
  upload_mode?: unknown
  multipart_part_size?: unknown
  multipart_parts?: unknown
}

interface LoginAttempt {
  attemptId: string
  sceneStr: string
  qrContent: string
  expiresAtMillis: number
}

interface ArkmeEnvelope<T> {
  code: number
  message?: string
  data?: T
}

interface QrResponse {
  url?: unknown
  scene_str?: unknown
  expire_seconds?: unknown
}

interface ArkmeOssCredentials {
  accessKeyId: string
  accessKeySecret: string
  stsToken: string
  expiration: string
}

interface ArkmeSourceRefPayload {
  version: 1
  userId: number
  kind: ArkmeSourceKind
  ownerRef: string
  displayName: string
}

interface ArkmeAiPolishConfigSnapshot {
  enabled: boolean
  canManage: boolean
  viewerRole: number
  activeRuleUid: string
  activeRuleName: string
  updatedAtMillis: number
  rules: Array<{
    ruleUid: string
    name: string
    ruleText: string
    ruleVersion: number
  }>
}

interface ArkmePendingAiPolishConfirmation {
  userId: number
  chatSessionUid: string
  groupName: string
  action: 'enable' | 'disable'
  expiresAtMillis: number
  candidateUid?: string
  ruleName?: string
  ruleText?: string
  promptVersion?: string
  extra?: Record<string, unknown>
}

interface ArkmePendingAiPolishRetry {
  userId: number
  sourceRef: string
  chatSessionUid: string
  relationUid: string
  recordUid: string
  originalText: string
  attempt: number
  expiresAtMillis: number
}

interface ArkmeAiPolishTextResult {
  taskUid: string
  attempt: number
  state: number
  action: number
  polishedText: string
  recordUid: string
  revisionUid: string
  ruleUid: string
  modelVersion: string
  promptVersion: string
  failureMessage: string
  extra: Record<string, unknown>
}

interface ArkmeProfileImageRefPayload {
  version: 1
  viewerUserId: number
  targetUserId: number
}

interface ArkmeWechatConversationRefPayload {
  version: 1
  userId: number
  importSessionKey: string
}

interface ArkmeWechatCursorPayload {
  version: 1
  userId: number
  scope: string
  offset: number
}

interface ArkmePublicProfile {
  userId: number
  displayName: string
  avatarUrl?: string
  arkmeId?: string
}

interface ArkmeInterwovenMomentReference {
  userId: number
  sourceOwnerRef: string
  sourceChatSessionUid: string
  recordOwnerUserId: number
  recordUid: string
  relationUid: string
  sequence: number
  momentId: string
  groupName: string
  senderUserId: number
  senderName: string
  senderAvatarRef?: string
  occurredAtMillis: number
  detailMode: 'chat' | 'owner_payload'
  fallbackTitle: string
  fallbackTextContent: string
  expiresAtMillis: number
}

interface ScanResponse {
  access_token?: unknown
  refresh_token?: unknown
  user_id?: unknown
}

interface PhoneLoginResponse extends ScanResponse {
  ok?: unknown
}

interface TestLoginResponse {
  access_token?: unknown
  refresh_token?: unknown
}

interface BindPhoneResponse {
  result?: unknown
}

type FetchLike = typeof fetch

interface ArkmeRemoteRequestOptions {
  lane?: ArkmeRequestLane
  service?: ArkmeRequestService
  scope?: string
  key?: string
  cacheMs?: number
  failureCooldownMs?: number
  bypassCache?: boolean
}

const ARKME_PHONE_BIND_SUCCESS = 1
const ARKME_PHONE_BIND_REPEAT = 2
const ARKME_PHONE_BIND_CODE_ERR = 3

export const MAX_ARKME_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_ARKME_RELATED_RECORDING_PAGE_SIZE = 20
export const MAX_ARKME_RELATED_RECORDING_CURSOR_LENGTH = 1024
const MAX_ARKME_TIMEZONE_OFFSET_MILLIS = 14 * 60 * 60 * 1000
const RELATED_RECORDINGS_FUNC_TYPE = 17
const ARKME_ID_MIN_LENGTH_DEFAULT = 6
const ARKME_ID_MIN_LENGTH_STAFF = 5
const ARKME_ID_MAX_LENGTH = 20
const ARKME_STAFF_ACCOUNT_TYPE = 2
const PROFILE_CACHE_TTL_MS = 60_000
const SOURCE_LIST_CACHE_TTL_MS = 30_000
const SOURCE_LIST_CACHE_MAX_ENTRIES = 200
const PUBLIC_PROFILE_CACHE_TTL_MS = 60_000
const PUBLIC_PROFILE_NEGATIVE_CACHE_TTL_MS = 30_000
const PUBLIC_PROFILE_CACHE_MAX_ENTRIES = 4_096
const GROUP_AVATAR_CACHE_TTL_MS = 5 * 60_000
const GROUP_AVATAR_NEGATIVE_CACHE_TTL_MS = 60_000
const IMAGE_CACHE_TTL_MS = 5 * 60_000
const IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024
const IMAGE_CACHE_MAX_ENTRIES = 64
const IMAGE_DOWNLOAD_CONCURRENCY = 4
const MAX_PROJECTION_RETRIES = 5

interface CacheEntry<T> {
  value: T
  expiresAtMillis: number
}
const ARKO_AGENT_DIRECT_SESSION_TYPE = 2
const ARKO_DEFAULT_SESSION_NAME = 'Arko'
const ARKO_COMPLETED_STATUS = 'completed'
const ARKO_STREAM_TIMEOUT_STATUS = 'stream_timeout'
const ARKO_HISTORY_PAGE_LIMIT = 50
const ARKO_MODEL_ROUTE_PATTERN = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/
const ARKO_RUN_STATUSES = new Set([
  'queued', 'running', 'waiting_user', 'waiting_tool', 'completed', 'partial',
  'failed', 'cancelled', 'expired',
])
const RECORD_CONTENT_FILE_ROLE_BACKGROUND_SOUND = 4

export class ArkmePluginError extends Error {
  readonly upstreamStatus?: number
  readonly retryAfterMillis?: number

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus = 400,
    options?: ErrorOptions & { upstreamStatus?: number; retryAfterMillis?: number },
  ) {
    super(message, options)
    this.name = 'ArkmePluginError'
    if (options?.upstreamStatus !== undefined) this.upstreamStatus = options.upstreamStatus
    if (options?.retryAfterMillis !== undefined) this.retryAfterMillis = options.retryAfterMillis
  }
}

function retryAfterMillis(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, Math.round(seconds * 1000))
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.min(60_000, Math.max(0, date - Date.now()))
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

function compactAiPolishActorLabel(value: unknown): string {
  const normalized = stringValue(value).replace(/\s+/g, ' ').trim()
  if (normalized === '') return ''
  const characters = [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(normalized)]
    .map(segment => segment.segment)
  return characters.length <= 4 ? normalized : `${characters.slice(0, 4).join('')}…`
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const number = numberValue(value)
  return number > 0 ? number : undefined
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim()
  return text === '' ? undefined : text
}

function safeHttpsUrl(value: unknown): string | undefined {
  const raw = stringValue(value).trim()
  if (raw === '') return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function clippedText(value: unknown, limit = 4_000): string {
  const text = stringValue(value).trim()
  return text.length > limit ? `${text.slice(0, limit)}…[已截断]` : text
}

const WECHAT_MESSAGE_TYPES: Readonly<Record<number, string>> = {
  0: 'text',
  1: 'image',
  2: 'voice',
  3: 'video',
  5: 'emoji',
  8: 'location',
  23: 'call',
  25: 'reply',
  49: 'chat_record',
  81: 'location_share',
  99: 'money_flow',
}

const WECHAT_FILTER_TYPES: Readonly<Record<Exclude<ArkmeWechatMessageFilter, 'all'>, number>> = {
  image: 1,
  voice: 2,
  video: 3,
  emoji: 5,
  location: 8,
  call: 23,
  reply: 25,
  chat_record: 49,
  location_share: 81,
}

function optionalBooleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
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
  if (normalized === '') {
    throw new ArkmePluginError('arkme-id-empty', '请输入要设置的 Arkme ID', false)
  }
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
    case 'taken':
      return new ArkmePluginError('arkme-id-taken', '这个 Arkme ID 已被占用，请换一个再试', false, 409)
    case 'modify_limited':
      return new ArkmePluginError('arkme-id-modify-limited', '每个账号通常只能修改一次 Arkme ID，你当前已无法再次修改', false, 409)
    case 'invalid':
      return new ArkmePluginError('arkme-id-invalid', '这个 Arkme ID 不符合设置规则，请检查后重试', false)
    default:
      return new ArkmePluginError('arkme-id-availability-unavailable', '暂时无法确认这个 Arkme ID 是否可用，请稍后重试', true, 503)
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

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function chatMessageDnd(value: unknown): boolean | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const policy = value as Record<string, unknown>
  return numberValue(policy.mute_state) === 2 || numberValue(policy.notify_state) === 2
}

function jsonObjectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return objectValue(value)
  try { return objectValue(JSON.parse(value)) } catch { return {} }
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function joinUrlWithQuery(baseUrl: string, path: string, query: Record<string, string | number>): string {
  const url = new URL(joinUrl(baseUrl, path))
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  return url.toString()
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  const record = objectValue(value)
  return Object.keys(record).length === 0 ? undefined : record
}

function arkoProfileFromData(data: Record<string, unknown>): ArkmeArkoProfile {
  const displayName = stringValue(data.display_name).trim()
  const version = numberValue(data.version)
  if (displayName === '' || !Number.isSafeInteger(version) || version < 0) {
    throw new ArkmePluginError('arko-profile-contract-invalid', 'Arko 资料响应不完整', true, 502)
  }
  return { displayName, version }
}

function arkoModelRouteKey(value: unknown): string {
  const routeKey = stringValue(value)
  if (routeKey.length > 128 || routeKey.trim() !== routeKey || !ARKO_MODEL_ROUTE_PATTERN.test(routeKey)) {
    throw new ArkmePluginError('arko-model-contract-invalid', 'Arko 模型目录响应无效', true, 502)
  }
  return routeKey
}

function arkoModelOptionFromData(value: unknown): ArkmeArkoModelOption {
  const data = objectValue(value)
  const routeKey = arkoModelRouteKey(data.route_key)
  const displayName = stringValue(data.display_name)
  const provider = stringValue(data.provider)
  const description = stringValue(data.description)
  if (displayName === '' || displayName.trim() !== displayName
    || provider === '' || provider.trim() !== provider
    || description.trim() !== description || routeKey.split('/', 1)[0] !== provider) {
    throw new ArkmePluginError('arko-model-contract-invalid', 'Arko 模型目录响应无效', true, 502)
  }
  return {
    routeKey,
    displayName,
    provider,
    description,
    recommended: booleanValue(data.recommended),
    selected: booleanValue(data.selected),
  }
}

function arkoModelCatalogFromData(data: Record<string, unknown>): ArkmeArkoModelCatalog {
  const defaultRouteKey = arkoModelRouteKey(data.default_route_key)
  const effectiveRouteKey = arkoModelRouteKey(data.effective_route_key)
  const selectionSource = stringValue(data.selection_source)
  const options = listValue(data.items).map(arkoModelOptionFromData)
  const routeKeys = new Set(options.map(option => option.routeKey))
  const selected = options.filter(option => option.selected)
  if ((selectionSource !== 'default' && selectionSource !== 'personal')
    || options.length === 0 || options.length > 16 || routeKeys.size !== options.length
    || !routeKeys.has(defaultRouteKey) || !routeKeys.has(effectiveRouteKey)
    || selected.length !== 1 || selected[0]?.routeKey !== effectiveRouteKey) {
    throw new ArkmePluginError('arko-model-contract-invalid', 'Arko 模型目录响应无效', true, 502)
  }
  return { defaultRouteKey, effectiveRouteKey, selectionSource, options }
}

function parsedJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.trim() === '') return objectValue(value)
  try {
    return objectValue(JSON.parse(value) as unknown)
  } catch {
    return {}
  }
}

function arkoHistoryItemFromData(value: unknown): ArkmeArkoHistoryItem | undefined {
  const data = objectValue(value)
  const messageId = numberValue(data.id ?? data.msg_id ?? data.msgId)
  const sessionId = numberValue(data.session_id ?? data.sessionId)
  const roleCode = numberValue(data.role ?? data.sender_role ?? data.senderRole)
  if (!Number.isSafeInteger(messageId) || messageId <= 0
    || !Number.isSafeInteger(sessionId) || sessionId <= 0
    || (roleCode !== 2 && roleCode !== 3)) return undefined
  const extra = parsedJsonRecord(data.extra ?? data.metadata ?? data.meta)
  const createdAt = numberValue(data.created_at ?? data.create_at ?? data.createdAt ?? data.createAt)
  const runUid = optionalString(extra.agent_run_uid)
  const runStatus = optionalString(extra.agent_run_status)
  const retryable = optionalBooleanValue(extra.agent_run_retryable)
  const errorCode = optionalString(extra.agent_run_error_code)
  const retryOfRunUid = optionalString(extra.retry_of_run_uid)
  return {
    messageId,
    sessionId,
    role: roleCode === 2 ? 'user' : 'assistant',
    text: stringValue(data.content ?? data.text_content ?? data.textContent),
    reasoning: stringValue(data.reason_content ?? data.reason_text ?? data.reasonText),
    createdAtMillis: createdAt > 0 && createdAt < 100_000_000_000 ? createdAt * 1000 : createdAt,
    status: numberValue(data.status ?? data.msg_status),
    ...(runUid === undefined ? {} : { runUid }),
    ...(runStatus === undefined ? {} : { runStatus }),
    ...(retryable === undefined ? {} : { retryable }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(retryOfRunUid === undefined ? {} : { retryOfRunUid }),
    createdRecordUids: arkoCreatedRecordUids(data.created_record_uids ?? data.createdRecordUids),
  }
}

function arkoRunProjectionFromData(data: Record<string, unknown>): ArkmeArkoRunProjection | undefined {
  const runUid = stringValue(data.agent_run_uid ?? data.run_uid).trim()
  const status = stringValue(data.agent_run_status ?? data.status).trim()
  if (runUid === '' || status === '') return undefined
  const errorCode = stringValue(data.agent_run_error_code ?? data.error_code).trim()
  const retryOfRunUid = stringValue(data.retry_of_run_uid).trim()
  const clientAction = optionalRecord(data.agent_client_action ?? data.client_action)
  return {
    runUid,
    status,
    retryable: booleanValue(data.agent_run_retryable ?? data.retryable),
    ...(errorCode === '' ? {} : { errorCode }),
    ...(retryOfRunUid === '' ? {} : { retryOfRunUid }),
    ...(clientAction === undefined ? {} : { clientAction }),
  }
}

function arkoCreatedRecordUids(value: unknown): string[] {
  return listValue(value).map(item => stringValue(item).trim()).filter(item => item !== '')
}

function arkoStreamFrame(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    return optionalRecord(parsed)
  } catch {
    return undefined
  }
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return 'Arkme请求失败'
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

function isSourceKind(value: unknown): value is ArkmeSourceKind {
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

function worldVisibility(checkStatus: number): ArkmeWorldVisibility {
  if (checkStatus === 1) return 'pending_review'
  if (checkStatus === 4) return 'rejected'
  if (checkStatus === 0 || checkStatus === 2 || checkStatus === 3) return 'visible'
  return 'unknown'
}

function chatMemberRole(value: unknown): ArkmeGroupMemberRole {
  if (value === 'owner' || value === 1) return 'owner'
  if (value === 'admin' || value === 2) return 'admin'
  if (value === 'member' || value === 'participant' || value === 3) return 'member'
  return 'unknown'
}

function chatMemberStatus(value: unknown): ArkmeGroupMemberStatus {
  if (value === 'active' || value === 1) return 'active'
  if (value === 'left' || value === 2) return 'left'
  if (value === 'removed' || value === 3) return 'removed'
  return 'unknown'
}

function worldTags(text: string): string[] {
  return [...text.matchAll(/#(\S+)/gu)].map(match => match[1] ?? '').filter(tag => tag !== '')
}

function trustedSignedImageUrl(environment: ArkmeEnvironment, raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch (error) {
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

function imageFileIdFromRef(imageRef: string, userId: number): string {
  const normalized = imageRef.trim()
  if (normalized === '' || normalized.startsWith('phone_avatar://')) {
    throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false)
  }
  let candidate = normalized
  if (/^https?:\/\//i.test(candidate)) {
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch (error) {
      throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false, 400, { cause: error })
    }
    if (parsed.protocol !== 'https:') {
      throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用必须使用安全连接', false)
    }
    candidate = parsed.pathname
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(candidate)
  } catch (error) {
    throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false, 400, { cause: error })
  }
  const pathMatch = decoded.match(/(?:^|\/)([a-f0-9]{32})\/(\d+)\/([^/]+)$/i)
  const fileId = (pathMatch?.[3] ?? decoded).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(fileId) || fileId.includes('..')) {
    throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false)
  }
  const ownerMatch = /^(\d+)(?:_|$)/.exec(fileId)
  const ownerId = ownerMatch === null ? 0 : Number(ownerMatch[1])
  if (!Number.isSafeInteger(ownerId) || ownerId !== userId) {
    throw new ArkmePluginError('image-owner-mismatch', '头像不属于当前登录的Arkme 账号', false, 403)
  }
  if (pathMatch !== null && (Number(pathMatch[2]) !== userId || pathMatch[1]?.toLowerCase() !== md5Text(String(userId)))) {
    throw new ArkmePluginError('image-owner-mismatch', '头像路径与当前Arkme 账号不匹配', false, 403)
  }
  return fileId
}

function imageMediaType(data: Uint8Array): ArkmeImageMediaType | undefined {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const prefix = Buffer.from(data.subarray(0, 6)).toString('ascii')
  if (prefix === 'GIF87a' || prefix === 'GIF89a') return 'image/gif'
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

function allowedSignedImageHost(environment: ArkmeEnvironment, hostname: string): boolean {
  const allowed = environment === 'prod'
    ? ['jotmo-userfiles.oss-cn-hangzhou.aliyuncs.com', 'userfiles.jotmo.cc']
    : ['jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com', 'jotmo-userfiles.senguo.me']
  return allowed.includes(hostname.toLowerCase())
}

function cloneSourceList(value: ArkmeSourceList): ArkmeSourceList {
  return {
    ...value,
    items: value.items.map(item => ({
      ...item,
      ...(item.avatarRefs === undefined ? {} : { avatarRefs: [...item.avatarRefs] }),
    })),
  }
}

function cloneImageBytes(value: ArkmeImageBytes): ArkmeImageBytes {
  return { mediaType: value.mediaType, bytes: value.bytes, data: value.data.slice() }
}

export class ArkmeService {
  private readonly attempts = new Map<string, LoginAttempt>()
  private readonly refreshInFlightByUserId = new Map<number, Promise<ArkmeSessionCredentials>>()
  private readonly requestCoordinator = new ArkmeRequestCoordinator()
  private readonly chatRealtime: ArkmeChatRealtimeRuntime
  private readonly chatClientListeners = new Set<(event: ArkmeChatClientEvent) => void>()
  private readonly chatSourceCache = new Map<string, ArkmeSourceItem>()
  private readonly profileCache = new Map<number, CacheEntry<ArkmeUserProfileSnapshot>>()
  private readonly profileInFlight = new Map<number, Promise<ArkmeUserProfileSnapshot>>()
  private readonly sourceListCache = new Map<string, CacheEntry<ArkmeSourceList>>()
  private readonly sourceListInFlight = new Map<string, Promise<ArkmeSourceList>>()
  private readonly publicProfileCache = new Map<string, CacheEntry<ArkmePublicProfile | null>>()
  private readonly groupAvatarSnapshotCache = new Map<string, CacheEntry<number[] | null>>()
  private readonly imageCache = new Map<string, CacheEntry<ArkmeImageBytes>>()
  private readonly imageInFlight = new Map<string, Promise<ArkmeImageBytes>>()
  private imageCacheBytes = 0
  private activeImageDownloads = 0
  private readonly imageDownloadWaiters: Array<() => void> = []
  private readonly pendingProjectionSequences = new Map<string, number>()
  private readonly projectionRetryCounts = new Map<string, number>()
  private projectionTimer: ReturnType<typeof setTimeout> | undefined
  private projectionInFlight = false
  private projectionFailureCount = 0
  private chatClientRevision = 0
  private pendingBindingSession: ArkmeSessionCredentials | undefined
  private readonly aiPolishConfirmations = new Map<string, ArkmePendingAiPolishConfirmation>()
  private readonly aiPolishRetries = new Map<string, ArkmePendingAiPolishRetry>()
  private readonly interwovenMomentReferences = new Map<string, ArkmeInterwovenMomentReference>()
  private readonly mediaRefs = new Map<string, ArkmeMediaDescriptor>()

  constructor(
    private readonly config: ArkmeServiceConfig,
    private readonly sessionStore: ArkmeSessionStore,
    private readonly stateStore: StateStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly pendingSessionStore?: ArkmeSessionStore,
    private readonly outgoingCallBroker = new ArkmeOutgoingCallBroker(),
  ) {
    this.chatRealtime = new ArkmeChatRealtimeRuntime({
      imBaseUrl: config.imBaseUrl,
      readSession: async () => await this.sessionStore.read(),
      refreshSession: async session => {
        try { return await this.refreshAccessToken(session) }
        catch (error) {
          console.warn('dsh-arkme: Chat SSE credential refresh paused:', safeFailureMessage(error))
          return undefined
        }
      },
      fetchImpl,
    })
  }

  startChatRealtime(): () => void {
    const unsubscribe = this.chatRealtime.subscribe(notice => { this.handleChatRealtimeNotice(notice) })
    const stop = this.chatRealtime.start()
    return () => {
      unsubscribe()
      stop()
      if (this.projectionTimer !== undefined) clearTimeout(this.projectionTimer)
      this.projectionTimer = undefined
      this.pendingProjectionSequences.clear()
      this.projectionRetryCounts.clear()
    }
  }

  chatRealtimeState(): ArkmeChatRealtimeState {
    return this.chatRealtime.state()
  }

  subscribeChatRealtime(listener: (event: ArkmeChatClientEvent) => void): () => void {
    this.chatClientListeners.add(listener)
    return () => { this.chatClientListeners.delete(listener) }
  }

  chatRealtimeInitialEvent(): ArkmeChatClientEvent {
    const state = this.chatRealtime.state()
    return { type: 'reconcile', revision: this.chatClientRevision, connected: state.connected, refresh: 'if-stale' }
  }

  private handleChatRealtimeNotice(notice: ArkmeChatRealtimeNotice): void {
    if (notice.cause === 'reconcile') {
      this.emitChatClientEvent({
        type: 'reconcile', revision: this.nextChatClientRevision(), connected: notice.state.connected, refresh: 'none',
      })
      return
    }
    if (notice.cause === 'hint' && notice.hint !== undefined) {
      this.scheduleChatSessionProjection(notice.hint.chatSessionUid, notice.hint.latestSequence)
    }
  }

  private scheduleChatSessionProjection(chatSessionUid: string, latestSequence: number): void {
    const uid = chatSessionUid.trim()
    if (uid === '') return
    if (latestSequence > (this.pendingProjectionSequences.get(uid) ?? 0)) this.projectionRetryCounts.delete(uid)
    this.pendingProjectionSequences.set(uid, Math.max(latestSequence, this.pendingProjectionSequences.get(uid) ?? 0))
    if (this.projectionTimer !== undefined || this.projectionInFlight) return
    this.projectionTimer = setTimeout(() => {
      this.projectionTimer = undefined
      void this.flushChatSessionProjections()
    }, 200)
  }

  private async flushChatSessionProjections(): Promise<void> {
    if (this.projectionInFlight || this.pendingProjectionSequences.size === 0) return
    this.projectionInFlight = true
    const pending = [...this.pendingProjectionSequences.entries()].slice(0, 50)
    for (const [uid] of pending) this.pendingProjectionSequences.delete(uid)
    try {
      const failed = await this.refreshChatSessionProjectionBatch(pending)
      for (const [uid] of pending) {
        if (!failed.some(([failedUid]) => failedUid === uid)) this.projectionRetryCounts.delete(uid)
      }
      if (failed.length === 0) {
        this.projectionFailureCount = 0
      } else {
        this.projectionFailureCount += 1
        this.requeueProjectionFailures(failed)
      }
    } catch (error) {
      console.warn('dsh-arkme: Chat incremental projection failed:', safeFailureMessage(error))
      this.projectionFailureCount += 1
      this.requeueProjectionFailures(pending)
    } finally {
      this.projectionInFlight = false
      if (this.pendingProjectionSequences.size > 0 && this.projectionTimer === undefined) {
        const retryDelayBase = this.projectionFailureCount === 0
          ? 200
          : Math.min(5_000, 500 * 2 ** Math.min(3, this.projectionFailureCount - 1))
        const retryDelay = Math.max(100, Math.round(retryDelayBase * (0.8 + Math.random() * 0.4)))
        this.projectionTimer = setTimeout(() => {
          this.projectionTimer = undefined
          void this.flushChatSessionProjections()
        }, retryDelay)
      }
    }
  }

  private requeueProjectionFailures(failed: Array<[string, number]>): void {
    for (const [uid, sequence] of failed) {
      const retries = (this.projectionRetryCounts.get(uid) ?? 0) + 1
      if (retries > MAX_PROJECTION_RETRIES) {
        this.projectionRetryCounts.delete(uid)
        console.warn('dsh-arkme: Chat projection retry exhausted for one session')
        continue
      }
      this.projectionRetryCounts.set(uid, retries)
      this.pendingProjectionSequences.set(uid, Math.max(sequence, this.pendingProjectionSequences.get(uid) ?? 0))
    }
  }

  private async refreshChatSessionProjectionBatch(
    pending: Array<[string, number]>,
  ): Promise<Array<[string, number]>> {
    const session = await this.requireSession()
    const sessionUids = pending.map(([uid]) => uid).sort()
    const projectionBatchKey = sessionUids.join('|')
    const displayData = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/display-snapshots', { chat_session_uids: sessionUids }, session,
      undefined,
      {
        lane: 'background-read',
        key: `projection:display:${projectionBatchKey}`,
      },
    )
    const bundles = new Map(listValue(displayData.items).map(raw => {
      const bundle = objectValue(raw)
      return [stringValue(objectValue(bundle.session).chat_session_uid).trim(), bundle] as const
    }).filter(([uid]) => uid !== ''))
    const tailItemsByUid = new Map<string, ArkmeTimelineItem[]>()
    const failedUids = new Set<string>()
    for (let offset = 0; offset < pending.length; offset += 3) {
      const chunk = pending.slice(offset, offset + 3)
      const results = await Promise.allSettled(chunk.map(async ([uid, hintedSequence]) => {
        const cached = this.chatSourceCache.get(`${String(session.userId)}:${uid}`)
        const afterSequence = Math.max(0, cached?.latestSequence ?? hintedSequence - 1)
        const data = await this.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chat/timeline/tail', { chat_session_uid: uid, after_seq: afterSequence, limit: 50 }, session,
          undefined,
          {
            lane: 'background-read',
            key: `projection:tail:${uid}:${String(afterSequence)}`,
          },
        )
        return [uid, await this.chatTimelineItems(data, session)] as const
      }))
      results.forEach((result, index) => {
        const uid = chunk[index]?.[0]
        if (uid === undefined) return
        if (result.status === 'fulfilled') tailItemsByUid.set(result.value[0], result.value[1])
        else failedUids.add(uid)
      })
    }
    const updates: Array<{ source: ArkmeSourceItem; timelineItems: ArkmeTimelineItem[] }> = []
    for (const [uid] of pending) {
      const bundle = bundles.get(uid)
      if (bundle === undefined || failedUids.has(uid)) {
        failedUids.add(uid)
        continue
      }
      const cacheKey = `${String(session.userId)}:${uid}`
      const timelineItems = tailItemsByUid.get(uid) ?? []
      try {
        const source = await this.chatSourceFromBundle(bundle, session, this.chatSourceCache.get(cacheKey), timelineItems)
        this.chatSourceCache.set(cacheKey, source)
        updates.push({ source, timelineItems })
      } catch {
        failedUids.add(uid)
      }
    }
    if (updates.length > 0) {
      this.invalidateSourceListCache(session.userId, 'root')
      this.emitChatClientEvent({
        type: 'sessions-delta',
        revision: this.nextChatClientRevision(),
        updates,
      })
    }
    return pending.filter(([uid]) => failedUids.has(uid))
  }

  private emitChatClientEvent(event: ArkmeChatClientEvent): void {
    for (const listener of [...this.chatClientListeners]) listener(event)
  }

  private nextChatClientRevision(): number {
    this.chatClientRevision += 1
    return this.chatClientRevision
  }

  private invalidateSourceListCache(userId: number, directory?: ArkmeSourceDirectory): void {
    const prefix = `${String(userId)}:`
    for (const key of this.sourceListCache.keys()) {
      if (!key.startsWith(prefix)) continue
      if (directory !== undefined && !key.startsWith(`${prefix}${directory}:`)) continue
      this.sourceListCache.delete(key)
    }
  }

  private invalidateAiPolishReadCache(userId: number, chatSessionUid: string): void {
    const scope = this.requestScope(userId)
    this.requestCoordinator.invalidateKey(scope, `ai-polish:settings:${chatSessionUid}`)
    this.requestCoordinator.invalidateKey(scope, `ai-polish:notices:${chatSessionUid}`)
  }

  private pruneSourceListCache(): void {
    const now = Date.now()
    for (const [key, cached] of this.sourceListCache) {
      if (cached.expiresAtMillis <= now) this.sourceListCache.delete(key)
    }
    while (this.sourceListCache.size > SOURCE_LIST_CACHE_MAX_ENTRIES) {
      const oldestKey = this.sourceListCache.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      this.sourceListCache.delete(oldestKey)
    }
  }

  async authStatus(): Promise<ArkmeAuthSnapshot> {
    const activeSession = await this.sessionStore.read()
    if (activeSession !== undefined) {
      const cachedProfile = await this.stateStore.cachedProfile(activeSession.userId)
      const snapshot = cachedProfile.profile === null
        ? await this.authSnapshotForSession(activeSession)
        : {
            status: this.profileHasBoundPhone(cachedProfile) ? 'authenticated' : 'binding-required',
            environment: this.config.environment,
            userId: activeSession.userId,
          } satisfies ArkmeAuthSnapshot
      if (snapshot.status === 'binding-required') {
        await this.writePendingBindingSession(activeSession)
        await this.sessionStore.delete()
        this.chatRealtime.reconnect()
      }
      return snapshot
    }
    const pendingSession = await this.readPendingBindingSession()
    return pendingSession === undefined
      ? { status: 'logged-out', environment: this.config.environment }
      : {
          status: 'binding-required',
          environment: this.config.environment,
          userId: pendingSession.userId,
        }
  }

  clientConfig(): ArkmeClientConfig {
    return {
      captchaId: this.config.geetestCaptchaId,
      environment: this.config.environment,
      testLoginEnabled: this.config.environment === 'test',
      callAssetBasePath: `${this.config.routePath}/call`,
    }
  }

  providerCapabilities(): ArkmeProviderCapabilities {
    return {
      contractVersion: ARKME_PROVIDER_CONTRACT_VERSION,
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
        richContentRead: this.config.richMediaRenderEnabled !== false,
        richContentSend: this.config.richMediaSendEnabled !== false,
        fileUpload: this.config.richMediaSendEnabled !== false,
        outgoingCall: true,
        groupMembers: true,
        userCard: true,
        openPrivateChat: true,
        groupSettings: true,
        ...(this.relatedRecordingsEnabled() ? { relatedRecordings: true as const } : {}),
      },
      limits: {
        maxTextLength: this.config.maxTextLength,
        maxSearchResults: 30,
        maxSyncPages: 20,
        maxImageBytes: MAX_ARKME_IMAGE_BYTES,
        ...(this.relatedRecordingsEnabled() ? {
          maxRelatedRecordingPageSize: MAX_ARKME_RELATED_RECORDING_PAGE_SIZE,
          maxRelatedRecordingCursorLength: MAX_ARKME_RELATED_RECORDING_CURSOR_LENGTH,
        } : {}),
        maxUploadBytes: this.config.maxUploadBytes ?? 100 * 1024 * 1024,
      },
    }
  }

  async providerState(): Promise<ArkmeProviderState> {
    const auth = await this.authStatus()
    return {
      contractVersion: ARKME_PROVIDER_CONTRACT_VERSION,
      environment: this.config.environment,
      authStatus: auth.status,
      ...(auth.userId === undefined ? {} : { userId: auth.userId }),
      revision: auth.userId === undefined ? 0 : await this.stateStore.revision(auth.userId),
    }
  }

  async requestOutgoingCall(
    sourceRef: string,
    mediaType: ArkmeOutgoingCallMediaType,
    signal?: AbortSignal,
  ): Promise<ArkmeOutgoingCallToolResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('call-source-invalid', '仅支持向私聊用户发起通话', false)
    }
    return await this.outgoingCallBroker.request({
      userId: session.userId,
      sourceRef,
      displayName: source.displayName,
      mediaType,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async claimOutgoingCallIntent(): Promise<ArkmeOutgoingCallIntentClaim | null> {
    const session = await this.requireSession()
    return this.outgoingCallBroker.claim(session.userId)
  }

  async resolveOutgoingCallIntent(
    input: Omit<ArkmeOutgoingCallIntentResolutionInput, 'userId'>,
  ): Promise<void> {
    const session = await this.requireSession()
    this.outgoingCallBroker.resolveIntent({ ...input, userId: session.userId })
  }

  async prepareOutgoingCall(input: {
    sourceRef: string
    mediaType: ArkmeOutgoingCallMediaType
    callRequestId: string
    signal?: AbortSignal
  }): Promise<ArkmeOutgoingCallPrepareResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(input.sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('call-source-invalid', '仅支持向私聊用户发起通话', false)
    }
    this.outgoingCallBroker.acquireLease(session.userId, input.callRequestId)
    try {
      const detail = await this.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/detail',
        { chat_session_uid: source.ownerRef },
        session,
        input.signal,
      )
      const chatSession = objectValue(detail.session)
      const sessionUid = stringValue(chatSession.chat_session_uid).trim()
      const sessionKind = numberValue(chatSession.session_kind)
      if (sessionUid !== source.ownerRef || (sessionKind !== 1 && sessionKind !== 3)) {
        throw new ArkmePluginError('call-source-invalid', '当前私聊会话不可用，请刷新后重试', false, 409)
      }
      const counterpart = objectValue(detail.private_counterpart)
      const supplement = objectValue(detail.private_supplement)
      const counterpartUserId = numberValue(counterpart.user_id)
      if (!Number.isSafeInteger(counterpartUserId) || counterpartUserId <= 0 || counterpartUserId === session.userId) {
        throw new ArkmePluginError('call-peer-unavailable', '当前私聊用户不可用，请刷新后重试', false, 409)
      }
      const detailDisplayName = stringValue(
        supplement.remark ?? supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot
        ?? supplement.pending_name ?? counterpart.visible_phone,
      ).trim()
      const callerProfile = (await this.refreshProfile()).profile
      if (callerProfile === null) {
        throw new ArkmePluginError('profile-contract-invalid', 'Arkme 个人资料响应不完整', false, 502)
      }
      const publicProfiles = await this.publicProfilesByUserIds([counterpartUserId], session, input.signal)
      const peerProfile = publicProfiles.get(counterpartUserId)
      const displayName = detailDisplayName || peerProfile?.displayName || source.displayName || 'Arkme 用户'
      const credentials = await this.authenticatedWebrtcPost<Record<string, unknown>>(
        '/api/v1/trtc/credentials',
        {},
        session,
        input.signal,
      )
      const sdkAppId = numberValue(credentials.sdk_app_id)
      const trtcUserId = stringValue(credentials.user_id).trim()
      const userSig = stringValue(credentials.user_sig).trim()
      if (!Number.isSafeInteger(sdkAppId) || sdkAppId <= 0 || trtcUserId === '' || userSig === '') {
        throw new ArkmePluginError('call-credentials-invalid', '桌面通话初始化失败', true, 502)
      }
      const callerName = callerProfile.displayName.trim() || 'Arkme 用户'
      const callerAvatarRef = callerProfile.avatarRef.trim()
      const room = await this.authenticatedWebrtcPost<Record<string, unknown>>(
        '/api/v1/trtc/create-room',
        {
          shared_topic_id: 0,
          chat_session_uid: source.ownerRef,
          callee_user_ids: [counterpartUserId],
          call_media_type: input.mediaType === 'video' ? 1 : 0,
          caller_name: callerName,
          ...(callerAvatarRef === '' ? {} : {
            sender_avatar_url: callerAvatarRef,
            caller_avatar_url: callerAvatarRef,
          }),
        },
        session,
        input.signal,
      )
      const roomId = stringValue(room.room_id).trim()
      const calleeAccounts = [...new Set(listValue(room.callee_accounts)
        .map(value => stringValue(value).trim())
        .filter(value => value !== ''))]
      if (roomId === '') {
        throw new ArkmePluginError('call-room-invalid', '呼叫房间创建失败，请重试', true, 502)
      }
      if (calleeAccounts.length === 0) {
        throw new ArkmePluginError('call-peer-unavailable', '对方未开通通话，请对方先登录后再试', false, 409)
      }
      const sharedTopicId = numberValue(room.shared_topic_id)
      const userData = JSON.stringify({
        sharedTopicId: sharedTopicId > 0 ? sharedTopicId : 0,
        sourceTag: 'arkme-private-chat-header',
        callerName,
        callerAvatar: '',
      })
      const description = input.mediaType === 'video' ? '邀请你进行视频通话' : '邀请你进行语音通话'
      return {
        callRequestId: input.callRequestId,
        displayName,
        ...(peerProfile === undefined ? {} : {
          peerAvatarRef: await this.sealProfileImageRef(session.userId, counterpartUserId),
        }),
        bootstrap: {
          sdkAppId,
          userId: trtcUserId,
          userSig,
          nickName: callerName,
          avatar: '',
          outgoingOnly: true,
        },
        call: {
          roomId,
          mediaType: input.mediaType,
          calleeAccounts,
          calleeName: displayName,
          calleeAvatar: '',
          callerName,
          callerAvatar: '',
          timeoutSec: 30,
          userData,
          offlinePushInfo: {
            title: callerName,
            description,
            extension: userData,
            ignoreIOSBadge: true,
            iOSPushType: 1,
          },
        },
      }
    } catch (error) {
      this.outgoingCallBroker.releaseLease(session.userId, input.callRequestId)
      throw error
    }
  }

  async heartbeatOutgoingCall(callRequestId: string): Promise<{ expiresAtMillis: number }> {
    const session = await this.requireSession()
    return { expiresAtMillis: this.outgoingCallBroker.heartbeatLease(session.userId, callRequestId) }
  }

  async releaseOutgoingCall(callRequestId: string): Promise<void> {
    const session = await this.requireSession()
    this.outgoingCallBroker.releaseLease(session.userId, callRequestId)
  }

  dispose(): void {
    this.aiPolishConfirmations.clear()
    this.aiPolishRetries.clear()
    this.requestCoordinator.dispose()
    this.outgoingCallBroker.dispose()
    this.interwovenMomentReferences.clear()
    this.mediaRefs.clear()
  }

  requestStats(): Record<string, ArkmeRequestStats> {
    return this.requestCoordinator.snapshotStats()
  }

  async cachedProfile(): Promise<ArkmeUserProfileSnapshot> {
    const session = await this.requireAuthFlowSession()
    return await this.stateStore.cachedProfile(session.userId)
  }

  /** Read-only Audio capability shared by the built-in UI and Arkme recording tools. */
  async recordingCalendar(
    fromStamp: number,
    toStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingCalendarMonth> {
    const from = Math.trunc(fromStamp)
    const to = Math.trunc(toStamp)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from
      || to - from > 33 * 24 * 60 * 60 * 1000) {
      throw new ArkmePluginError('recording-range-invalid', '录音日历范围无效', false)
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

  /** Read-only Audio capability shared by the built-in UI and Arkme recording tools. */
  async recordingTranscript(
    dateStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingTranscriptSection> {
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

  /** Read-only Audio capability shared by the built-in UI and Arkme recording tools. */
  async recordingProjection(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> {
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

  async sealRecordingCursor(payload: ArkmeRecordingCursorPayload): Promise<string> {
    const session = await this.requireSession()
    const encoded = encodeOpaqueJson(payload)
    const signature = createHmac('sha256', await this.recordingCursorKey(session.userId))
      .update(encoded)
      .digest('base64url')
    return `arkme-recording-cursor-v1.${encoded}.${signature}`
  }

  async openRecordingCursor(cursor: string): Promise<ArkmeRecordingCursorPayload> {
    const session = await this.requireSession()
    const [prefix, encoded, suppliedText, ...extra] = cursor.trim().split('.')
    if (prefix !== 'arkme-recording-cursor-v1' || encoded === undefined
      || suppliedText === undefined || extra.length > 0) {
      throw new ArkmePluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    const supplied = Buffer.from(suppliedText, 'base64url')
    const expected = createHmac('sha256', await this.recordingCursorKey(session.userId))
      .update(encoded)
      .digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    let raw: Record<string, unknown>
    try {
      raw = objectValue(decodeOpaqueJson(encoded))
    } catch (error) {
      throw new ArkmePluginError(
        'recording-cursor-invalid',
        '录音分页游标无效',
        false,
        400,
        { cause: error },
      )
    }
    const content = raw.content
    const payload: ArkmeRecordingCursorPayload = {
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
      throw new ArkmePluginError('recording-cursor-invalid', '录音分页游标无效', false)
    }
    return payload
  }

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async recordingDay(dateStamp: number): Promise<ArkmeRecordingDay> {
    const date = this.recordingDayStart(dateStamp).getTime()
    const [transcriptResult, summaryResult, timelineResult] = await Promise.allSettled([
      this.recordingTranscript(date),
      this.recordingProjection(date, 'summary'),
      this.recordingProjection(date, 'timeline'),
    ])
    const transcript: ArkmeRecordingDay['transcript'] = transcriptResult.status === 'fulfilled'
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

  async refreshProfile(): Promise<ArkmeUserProfileSnapshot> {
    const session = await this.requireAuthFlowSession()
    return await this.refreshProfileForSession(session)
  }

  async arkoProfile(signal?: AbortSignal): Promise<ArkmeArkoProfile> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/profile/query',
      {},
      session,
      signal,
    )
    return arkoProfileFromData(data)
  }

  async arkoEnsureSession(signal?: AbortSignal): Promise<ArkmeArkoSession> {
    const session = await this.requireSession()
    const latest = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/latest-session',
      { type: ARKO_AGENT_DIRECT_SESSION_TYPE },
      session,
      signal,
    )
    const latestSessionId = numberValue(latest.id)
    if (Number.isSafeInteger(latestSessionId) && latestSessionId > 0) {
      return {
        sessionId: latestSessionId,
        created: false,
        name: stringValue(latest.name).trim() || ARKO_DEFAULT_SESSION_NAME,
      }
    }
    return await this.arkoCreateSession(signal)
  }

  async arkoCreateSession(signal?: AbortSignal): Promise<ArkmeArkoSession> {
    const session = await this.requireSession()
    const created = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/new-session',
      { name: ARKO_DEFAULT_SESSION_NAME, type: ARKO_AGENT_DIRECT_SESSION_TYPE },
      session,
      signal,
    )
    const createdSessionId = numberValue(created.session_id)
    if (!Number.isSafeInteger(createdSessionId) || createdSessionId <= 0) {
      throw new ArkmePluginError('arko-session-contract-invalid', 'Arko 会话响应不完整', true, 502)
    }
    return { sessionId: createdSessionId, created: true, name: ARKO_DEFAULT_SESSION_NAME }
  }

  async arkoModelCatalog(signal?: AbortSignal): Promise<ArkmeArkoModelCatalog> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/model/list',
      {},
      session,
      signal,
    )
    return arkoModelCatalogFromData(data)
  }

  async arkoActivateModel(routeKey: string, signal?: AbortSignal): Promise<ArkmeArkoModelCatalog> {
    const normalized = routeKey.trim()
    if (normalized !== routeKey || normalized.length > 128 || !ARKO_MODEL_ROUTE_PATTERN.test(normalized)) {
      throw new ArkmePluginError('arko-model-route-invalid', '请选择有效的 Arko 模型', false)
    }
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/model/activate',
      { route_key: normalized },
      session,
      signal,
    )
    return arkoModelCatalogFromData(data)
  }

  async arkoHistoryPage(
    limit = ARKO_HISTORY_PAGE_LIMIT,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<ArkmeArkoHistoryPage> {
    const normalizedLimit = Math.min(ARKO_HISTORY_PAGE_LIMIT, Math.max(1, Math.trunc(limit)))
    const normalizedOffset = Math.max(0, Math.trunc(offset))
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/message-list',
      { limit: normalizedLimit, offset: normalizedOffset, session_type: ARKO_AGENT_DIRECT_SESSION_TYPE },
      session,
      signal,
    )
    const rawItems = listValue(data.message_ls)
    const items = rawItems
      .map(arkoHistoryItemFromData)
      .filter((item): item is ArkmeArkoHistoryItem => item !== undefined)
    const hasMore = rawItems.length === normalizedLimit
    return {
      items,
      hasMore,
      ...(hasMore ? { nextOffset: normalizedOffset + rawItems.length } : {}),
    }
  }

  async arkoAsk(
    text: string,
    options: {
      sessionId?: number
      clientTurnUid?: string
      waitMillis?: number
      modelRouteKey?: string
      replyToRunUid?: string
      replyToAssistantMsgId?: number
      signal?: AbortSignal
    } = {},
  ): Promise<ArkmeArkoAskResult> {
    const session = await this.requireSession()
    const sessionId = options.sessionId ?? (await this.arkoEnsureSession(options.signal)).sessionId
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const replyToRunUid = options.replyToRunUid?.trim() ?? ''
    const replyToAssistantMsgId = options.replyToAssistantMsgId
    const hasContinuationRun = replyToRunUid !== ''
    const hasContinuationMessage = replyToAssistantMsgId !== undefined
      && Number.isSafeInteger(replyToAssistantMsgId) && replyToAssistantMsgId > 0
    if (hasContinuationRun !== hasContinuationMessage) {
      throw new ArkmePluginError('arko-continuation-invalid', 'Arko 续接参数不完整', false)
    }
    let modelRouteKey = options.modelRouteKey?.trim() ?? ''
    if (hasContinuationRun && modelRouteKey !== '') {
      throw new ArkmePluginError('arko-continuation-model-invalid', '继续 Arko 任务时不能切换模型', false)
    }
    if (!hasContinuationRun && modelRouteKey === '') {
      try {
        const catalog = await this.arkoModelCatalog(options.signal)
        if (catalog.options.length > 1) modelRouteKey = catalog.effectiveRouteKey
      } catch {
        // Model selection is an enhancement. Omitting the route preserves the server default.
      }
    }
    if (modelRouteKey !== '' && (modelRouteKey.length > 128 || !ARKO_MODEL_ROUTE_PATTERN.test(modelRouteKey))) {
      throw new ArkmePluginError('arko-model-route-invalid', '请选择有效的 Arko 模型', false)
    }
    const body: Record<string, unknown> = {
      model: 2,
      session_id: sessionId,
      content: text,
      extra: '{}',
      ...(timezone === undefined || timezone.trim() === '' ? {} : { tz_inna: timezone.trim() }),
      ...(options.clientTurnUid === undefined || options.clientTurnUid.trim() === ''
        ? {}
        : { client_turn_uid: options.clientTurnUid.trim() }),
      ...(hasContinuationRun ? {
        reply_to_run_uid: replyToRunUid,
        reply_to_assistant_msg_id: replyToAssistantMsgId,
      } : {}),
      client_capabilities: ['dsh.arko.v1'],
    }
    if (modelRouteKey !== '') body.model_route_key = modelRouteKey
    const accepted = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/qa/new-msg-v2',
      body,
      session,
      options.signal,
    )
    const userMsgId = numberValue(accepted.user_msg_id)
    const assistantMsgId = numberValue(accepted.assistant_msg_id)
    const acceptedSessionId = numberValue(accepted.session_id) || sessionId
    if (!Number.isSafeInteger(acceptedSessionId) || acceptedSessionId <= 0
      || !Number.isSafeInteger(userMsgId) || userMsgId <= 0
      || !Number.isSafeInteger(assistantMsgId) || assistantMsgId <= 0) {
      throw new ArkmePluginError('arko-ask-contract-invalid', 'Arko 消息响应不完整', true, 502)
    }
    const runUid = stringValue(accepted.run_uid).trim()
    if (runUid === '') {
      throw new ArkmePluginError('arko-ask-contract-invalid', 'Arko 消息响应缺少运行标识', true, 502)
    }
    let events: { events: string[]; timedOut: boolean }
    try {
      events = await this.authenticatedIntelligentSseEvents(
        '/api/v1/qa/stream-v2',
        { session_id: acceptedSessionId, user_msg_id: userMsgId, assistant_msg_id: assistantMsgId },
        options.waitMillis ?? 25_000,
        session,
        options.signal,
      )
    } catch (error) {
      if (error instanceof ArkmePluginError && error.code === 'arko-stream-cancelled') throw error
      // The run is already durable once new-msg-v2 succeeds. Preserve its identity so
      // callers recover through the status endpoint instead of submitting it again.
      events = { events: [], timedOut: true }
    }
    return this.projectArkoStreamEvents({
      sessionId: acceptedSessionId,
      userMsgId,
      assistantMsgId,
      runUid,
      initialStatus: 'queued',
      events: events.events,
      timedOut: events.timedOut,
    })
  }

  async arkoRunStatus(sessionId: number, runUid: string, signal?: AbortSignal): Promise<ArkmeArkoRunStatus> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/runs/status',
      { session_id: sessionId, run_uid: runUid.trim() },
      session,
      signal,
    )
    const status = stringValue(data.status).trim()
    const normalizedRunUid = stringValue(data.run_uid).trim() || runUid.trim()
    const sequence = numberValue(data.sequence)
    const surfaceAssistantMsgId = numberValue(data.surface_assistant_msg_id)
    const clientAction = optionalRecord(data.client_action)
    if (normalizedRunUid !== runUid.trim() || !ARKO_RUN_STATUSES.has(status)
      || !Number.isSafeInteger(sequence) || sequence < 0
      || !Number.isSafeInteger(surfaceAssistantMsgId) || surfaceAssistantMsgId <= 0) {
      throw new ArkmePluginError('arko-run-status-contract-invalid', 'Arko 运行状态响应不完整', true, 502)
    }
    return {
      sessionId,
      runUid: normalizedRunUid,
      status,
      sequence,
      surfaceAssistantMsgId,
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.error_code).trim() === '' ? {} : { errorCode: stringValue(data.error_code).trim() }),
      ...(stringValue(data.retry_of_run_uid).trim() === '' ? {} : { retryOfRunUid: stringValue(data.retry_of_run_uid).trim() }),
      ...(clientAction === undefined ? {} : { clientAction }),
    }
  }

  async arkoCancel(
    sessionId: number,
    assistantMsgId: number,
    runUid: string,
    signal?: AbortSignal,
  ): Promise<ArkmeArkoCancelResult> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/agent/runs/cancel',
      { session_id: sessionId, assistant_msg_id: assistantMsgId, run_uid: runUid.trim() },
      session,
      signal,
    )
    const status = stringValue(data.status).trim()
    const normalizedRunUid = stringValue(data.run_uid).trim() || runUid.trim()
    if (normalizedRunUid === '' || status === '') {
      throw new ArkmePluginError('arko-cancel-contract-invalid', 'Arko 取消响应不完整', true, 502)
    }
    return { sessionId, assistantMsgId, runUid: normalizedRunUid, status }
  }

  private async profileForSession(session: ArkmeSessionCredentials): Promise<ArkmeUserProfileSnapshot> {
    const memory = this.profileCache.get(session.userId)
    if (memory !== undefined && memory.expiresAtMillis > Date.now()) return memory.value
    const persisted = await this.stateStore.cachedProfile(session.userId).catch(() => undefined)
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

  private async refreshProfileForSession(session: ArkmeSessionCredentials): Promise<ArkmeUserProfileSnapshot> {
    const existing = this.profileInFlight.get(session.userId)
    if (existing !== undefined) return await existing
    const pending = (async () => {
      const data = await this.authenticatedAuthGet<Record<string, unknown>>(
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
      const snapshot = await this.stateStore.cacheProfile(userId, profile)
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

  private async authSnapshotForSession(
    session: ArkmeSessionCredentials,
    options: { forceProfile?: boolean } = {},
  ): Promise<ArkmeAuthSnapshot> {
    const profile = options.forceProfile === true
      ? await this.refreshProfileForSession(session)
      : await this.profileForSession(session)
    return {
      status: this.profileHasBoundPhone(profile) ? 'authenticated' : 'binding-required',
      environment: this.config.environment,
      userId: session.userId,
    }
  }

  private profileHasBoundPhone(snapshot: ArkmeUserProfileSnapshot): boolean {
    return (snapshot.profile?.contact.phoneMasked?.trim() ?? '') !== ''
  }

  private isPendingBindingSession(session: ArkmeSessionCredentials): boolean {
    return this.pendingBindingSession?.userId === session.userId
      && this.pendingBindingSession.refreshToken === session.refreshToken
  }

  private async readPendingBindingSession(): Promise<ArkmeSessionCredentials | undefined> {
    if (this.pendingBindingSession !== undefined) return this.pendingBindingSession
    const session = await this.pendingSessionStore?.read()
    this.pendingBindingSession = session
    return session
  }

  private async writePendingBindingSession(session: ArkmeSessionCredentials): Promise<void> {
    this.pendingBindingSession = session
    await this.pendingSessionStore?.write(session)
  }

  private async clearPendingBindingSession(): Promise<void> {
    this.pendingBindingSession = undefined
    await this.pendingSessionStore?.delete()
  }

  private async acceptLoginSession(session: ArkmeSessionCredentials): Promise<ArkmeAuthSnapshot> {
    this.requestCoordinator.invalidateScope(this.requestScope(session.userId))
    this.profileCache.delete(session.userId)
    this.profileInFlight.delete(session.userId)
    const snapshot = await this.authSnapshotForSession(session, { forceProfile: true })
    if (snapshot.status === 'authenticated') {
      await this.clearPendingBindingSession()
      await this.sessionStore.write(session)
      this.chatRealtime.reconnect()
      return snapshot
    }
    await this.writePendingBindingSession(session)
    await this.sessionStore.delete()
    this.chatRealtime.reconnect()
    return snapshot
  }

  async aiVideoPreflight(
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoPreflightResult> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/preflight',
      this.aiVideoSelectionBody(sessionId, segments),
      session,
      signal,
    )
    return {
      allowed: booleanValue(data.allowed),
      message: stringValue(data.message).trim() || 'AI 视频内容检查已完成',
      selectedDurationMillis: Math.max(0, numberValue(data.selected_duration_millis)),
      minimumDurationMillis: Math.max(0, numberValue(data.minimum_duration_millis)),
      selectedSegmentCount: Math.max(0, numberValue(data.selected_segment_count)),
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.reason_code).trim() === '' ? {} : { reasonCode: stringValue(data.reason_code).trim() }),
      ...(stringValue(data.proof).trim() === '' ? {} : { proof: stringValue(data.proof).trim() }),
    }
  }

  async aiVideoCreate(
    clientRequestId: string,
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
    preflightProof: string,
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoJob> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/jobs/create',
      {
        client_request_id: clientRequestId,
        ...this.aiVideoSelectionBody(sessionId, segments),
        ...(preflightProof.trim() === '' ? {} : { preflight_proof: preflightProof.trim() }),
      },
      session,
      signal,
    )
    return this.aiVideoJob(data)
  }

  async aiVideoStatus(jobId: string, signal?: AbortSignal): Promise<ArkmeAiVideoJob> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/jobs/status',
      { job_id: jobId.trim() },
      session,
      signal,
    )
    return this.aiVideoJob(data)
  }

  async aiVideoList(options: {
    limit: number
    cursor?: string
    statuses?: readonly ArkmeAiVideoJobStatus[]
    signal?: AbortSignal
  }): Promise<ArkmeAiVideoListResult> {
    const allowedStatuses = new Set<ArkmeAiVideoJobStatus>(['queued', 'running', 'succeeded', 'failed', 'canceled'])
    if (options.statuses?.some(status => !allowedStatuses.has(status)) === true) {
      throw new ArkmePluginError('ai-video-status-filter-invalid', 'AI 视频状态筛选无效', false)
    }
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-comic-video/jobs/list',
      {
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
        ...(options.statuses === undefined || options.statuses.length === 0 ? {} : { statuses: options.statuses }),
      },
      session,
      options.signal,
    )
    return {
      items: listValue(data.items).map(raw => this.aiVideoListItem(raw)).filter((item): item is ArkmeAiVideoListItem => item !== undefined),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
    }
  }

  async queryFileAssets(fileAssetUids: readonly string[], signal?: AbortSignal): Promise<ArkmeFileAssetDisplayItem[]> {
    const unique = [...new Set(fileAssetUids.map(uid => uid.trim()).filter(uid => uid !== ''))].slice(0, 50)
    if (unique.length === 0) return []
    const session = await this.requireSession()
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/files/assets/query',
      { file_asset_uids: unique },
      session,
      signal,
    )
    return listValue(data.items).map(raw => {
      const item = objectValue(raw)
      const previewUrl = safeHttpsUrl(item.preview_url)
      const downloadUrl = safeHttpsUrl(item.download_url)
      return {
        fileAssetUid: stringValue(item.file_asset_uid).trim(),
        status: stringValue(item.status).trim(),
        ...(stringValue(item.file_name).trim() === '' ? {} : { fileName: stringValue(item.file_name).trim() }),
        ...(stringValue(item.mime_type).trim() === '' ? {} : { mimeType: stringValue(item.mime_type).trim() }),
        ...(previewUrl === undefined ? {} : { previewUrl }),
        ...(downloadUrl === undefined ? {} : { downloadUrl }),
      }
    }).filter(item => item.fileAssetUid !== '')
  }

  async textAiVideoPreflight(
    title: string,
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoPreflightResult> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-video/text/preflight',
      { ...(title.trim() === '' ? {} : { title: title.trim() }), texts },
      session,
      signal,
    )
    return {
      allowed: booleanValue(data.allowed),
      message: stringValue(data.message).trim() || 'AI 视频内容检查已完成',
      selectedDurationMillis: Math.max(0, numberValue(data.selected_duration_millis)),
      minimumDurationMillis: Math.max(0, numberValue(data.minimum_duration_millis)),
      selectedSegmentCount: Math.max(0, numberValue(data.selected_segment_count)),
      selectedTextCount: Math.max(0, numberValue(data.selected_text_count)),
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.reason_code).trim() === '' ? {} : { reasonCode: stringValue(data.reason_code).trim() }),
      ...(stringValue(data.proof).trim() === '' ? {} : { proof: stringValue(data.proof).trim() }),
    }
  }

  async textAiVideoCreate(
    clientRequestId: string,
    title: string,
    texts: readonly string[],
    preflightProof: string,
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoJob> {
    const session = await this.requireSession()
    const data = await this.authenticatedIntelligentPost<Record<string, unknown>>(
      '/api/v1/ai-video/text/jobs/create',
      {
        client_request_id: clientRequestId,
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        texts,
        ...(preflightProof.trim() === '' ? {} : { preflight_proof: preflightProof.trim() }),
      },
      session,
      signal,
    )
    return this.aiVideoJob(data)
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
    const session = await this.requireSession()
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
      const data = await this.authenticatedAuthPost<Record<string, unknown>>(
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
      after = await this.stateStore.cacheProfile(session.userId, {
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

  async createTopic(titleInput: string, parentSourceRef?: string): Promise<ArkmeTopicCreateResult> {
    const session = await this.requireSession()
    const title = titleInput.trim()
    if (title === '' || Array.from(title).length > 100) {
      throw new ArkmePluginError('topic-title-invalid', '主题名称不能为空或超过 100 个字符', false)
    }

    let parentTopicUid: string | undefined
    if (parentSourceRef !== undefined) {
      const parent = await this.openSourceRef(parentSourceRef, session.userId)
      if (parent.kind !== 'topic') {
        throw new ArkmePluginError('topic-parent-invalid', '只能在主题下创建子主题', false)
      }
      parentTopicUid = parent.ownerRef
    }

    const createdAtMillis = Date.now()
    const created = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/topics/create',
      {
        title,
        show_in_home: true,
        privacy_state: 1,
        extra: { source: 'dsh-arkme' },
      },
      session,
    )
    const topicUid = stringValue(created.topic_uid).trim()
    if (topicUid === '' || numberValue(created.status) !== 1) {
      throw new ArkmePluginError('topic-create-contract-invalid', '主题创建响应不完整', true, 502)
    }

    const sourceRef = await this.sealSourceRef(session.userId, 'topic', topicUid, title)
    if (parentTopicUid !== undefined) {
      try {
        const bound = await this.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/hierarchy/bind',
          { parent_topic_uid: parentTopicUid, child_topic_uid: topicUid },
          session,
        )
        if (numberValue(objectValue(bound.relation).status) !== 1) {
          throw new ArkmePluginError('topic-hierarchy-bind-contract-invalid', '子主题层级响应不完整', true, 502)
        }
      } catch (bindError) {
        try {
          const rolledBack = await this.authenticatedPost<Record<string, unknown>>(
            '/api/v1/topics/update',
            {
              topic_uid: topicUid,
              title,
              show_in_home: true,
              privacy_state: 1,
              status: 2,
              extra: { source: 'dsh-arkme' },
            },
            session,
          )
          if (stringValue(rolledBack.topic_uid).trim() !== topicUid || !booleanValue(rolledBack.updated)) {
            throw new ArkmePluginError('topic-rollback-contract-invalid', '子主题清理响应不完整', true, 502)
          }
        } catch {
          return {
            source: {
              sourceRef,
              kind: 'topic',
              displayName: title,
              activeAtMillis: createdAtMillis,
              unreadCount: 0,
              recordCount: 0,
            },
            warning: '主题已创建，但父子关系添加及自动清理均未完成，请在根主题列表中检查后重试',
          }
        }
        throw new ArkmePluginError(
          'topic-hierarchy-bind-failed',
          '未能创建子主题，已自动清理，请重试',
          true,
          409,
          { cause: bindError },
        )
      }
    }

    return {
      source: {
        sourceRef,
        ...(parentSourceRef !== undefined ? { parentSourceRef } : {}),
        kind: 'topic',
        displayName: title,
        activeAtMillis: createdAtMillis,
        unreadCount: 0,
        recordCount: 0,
      },
    }
  }

  async listSources(
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal; refresh?: boolean } = {},
  ): Promise<ArkmeSourceList> {
    const session = await this.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    const cursor = options.cursor?.trim() ?? ''
    const cacheKey = `${String(session.userId)}:${directory}:${String(limit)}:${cursor}`
    this.pruneSourceListCache()
    const cached = this.sourceListCache.get(cacheKey)
    if (options.refresh !== true && cached !== undefined && cached.expiresAtMillis > Date.now()) return cloneSourceList(cached.value)
    const existing = this.sourceListInFlight.get(cacheKey)
    if (existing !== undefined) return cloneSourceList(await existing)
    const pending = this.listSourcesUncached(session, directory, { ...options, ...(cursor === '' ? {} : { cursor }) }, limit)
    this.sourceListInFlight.set(cacheKey, pending)
    try {
      const result = await pending
      this.sourceListCache.delete(cacheKey)
      this.sourceListCache.set(cacheKey, { value: cloneSourceList(result), expiresAtMillis: Date.now() + SOURCE_LIST_CACHE_TTL_MS })
      this.pruneSourceListCache()
      return cloneSourceList(result)
    } finally {
      if (this.sourceListInFlight.get(cacheKey) === pending) this.sourceListInFlight.delete(cacheKey)
    }
  }

  private async listSourcesUncached(
    session: ArkmeSessionCredentials,
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal; refresh?: boolean },
    limit: number,
  ): Promise<ArkmeSourceList> {
    if (directory === 'send_to_self') {
      if (options.cursor !== undefined && options.cursor.trim() !== '') {
        throw new ArkmePluginError('source-cursor-invalid', '发给自己的主题目录不支持该分页游标', false)
      }
      const [data, hierarchyData] = await Promise.all([
        this.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/display/list',
          { limit: Math.min(100, Math.max(1, limit)) },
          session,
        ),
        this.authenticatedPost<Record<string, unknown>>(
          '/api/v1/topics/hierarchy/relations/list',
          {},
          session,
        ).catch(() => undefined),
      ])
      const [summaryResult, latestRecordsResult] = await Promise.allSettled([
        this.summary(),
        this.authenticatedPost<Record<string, unknown>>(
          '/api/v1/records/uncategorized/query',
          { limit: 1 },
          session,
        ),
      ])
      const cached = summaryResult.status === 'rejected' || latestRecordsResult.status === 'rejected'
        ? await this.stateStore.cachedSnapshot(session.userId).catch(() => undefined)
        : undefined
      // Source-card decoration is best-effort and must not make the directory unavailable.
      const defaultRecordCount = summaryResult.status === 'fulfilled'
        ? summaryResult.value.recordCount
        : cached?.summary?.recordCount
      const defaultLatestRecord = latestRecordsResult.status === 'fulfilled'
        ? listValue(latestRecordsResult.value.items).map(raw => this.recordItem(raw)).find(item => item !== undefined)
        : cached?.items.reduce<ArkmeSelfRecordItem | undefined>((latest, item) => (
          latest === undefined || item.sendAtMillis > latest.sendAtMillis ? item : latest
        ), undefined)
      const defaultLatestPreview = defaultLatestRecord === undefined
        ? ''
        : (defaultLatestRecord.textContent.trim() || defaultLatestRecord.title.trim())
      const defaultCategory: ArkmeSourceItem = {
        sourceRef: await this.sealSourceRef(session.userId, 'default_category', 'uncategorized', '默认分类'),
        kind: 'default_category',
        displayName: '默认分类',
        activeAtMillis: defaultLatestRecord?.sendAtMillis ?? 0,
        unreadCount: 0,
        ...(defaultLatestPreview === '' ? {} : { latestPreview: defaultLatestPreview }),
        ...(defaultRecordCount === undefined ? {} : { recordCount: defaultRecordCount }),
      }
      const topicDescriptors: Array<{
        topicUid: string
        parentTopicUid?: string
        title: string
        latestPreview: string
        activeAtMillis: number
        recordCount: number
      }> = []
      const seenTopicUids = new Set<string>()
      const parentTopicUidByChild = new Map<string, string>()
      for (const raw of listValue(hierarchyData?.relations)) {
        const relation = objectValue(raw)
        if (numberValue(relation.rel_kind) !== 1 || numberValue(relation.status) !== 1) continue
        const parentTopicUid = stringValue(relation.parent_topic_uid).trim()
        const childTopicUid = stringValue(relation.child_topic_uid).trim()
        if (parentTopicUid === '' || childTopicUid === '' || parentTopicUid === childTopicUid) continue
        parentTopicUidByChild.set(childTopicUid, parentTopicUid)
      }
      for (const raw of listValue(data.items)) {
        const item = objectValue(raw)
        const core = objectValue(item.topic_core)
        const summary = objectValue(item.summary)
        const latest = objectValue(item.latest_record_core)
        const parent = objectValue(
          core.parent_topic_core ?? core.parent_topic ?? item.parent_topic_core ?? item.parent_topic,
        )
        const topicUid = stringValue(core.topic_uid).trim()
        const title = stringValue(core.title).trim()
        if (topicUid === '' || title === '' || seenTopicUids.has(topicUid)) continue
        seenTopicUids.add(topicUid)
        const parentTopicUid = stringValue(
          parentTopicUidByChild.get(topicUid)
          ?? core.parent_topic_uid ?? core.parent_uid ?? item.parent_topic_uid ?? item.parent_uid
          ?? parent.topic_uid ?? parent.uid,
        ).trim()
        topicDescriptors.push({
          topicUid,
          ...(parentTopicUid === '' || parentTopicUid === topicUid ? {} : { parentTopicUid }),
          title,
          latestPreview: textPreview(latest),
          activeAtMillis: numberValue(latest.send_at ?? summary.latest_send_at ?? core.update_at),
          recordCount: numberValue(summary.record_count),
        })
      }
      const sourceRefByTopicUid = new Map<string, string>()
      for (const topic of topicDescriptors) {
        sourceRefByTopicUid.set(
          topic.topicUid,
          await this.sealSourceRef(session.userId, 'topic', topic.topicUid, topic.title),
        )
      }
      const topics: ArkmeSourceItem[] = topicDescriptors.map(topic => {
        const parentSourceRef = topic.parentTopicUid === undefined
          ? undefined
          : sourceRefByTopicUid.get(topic.parentTopicUid)
        return {
          sourceRef: sourceRefByTopicUid.get(topic.topicUid)!,
          ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
          kind: 'topic',
          displayName: topic.title,
          ...(topic.latestPreview === '' ? {} : { latestPreview: topic.latestPreview }),
          activeAtMillis: topic.activeAtMillis,
          unreadCount: 0,
          recordCount: topic.recordCount,
        }
      })
      return { directory, items: [defaultCategory, ...topics], hasMore: false }
    }
    if (directory !== 'root') throw new ArkmePluginError('source-directory-invalid', 'Arkme 数据源目录无效', false)
    const pageCursor = options.cursor === undefined || options.cursor.trim() === ''
      ? undefined
      : this.decodeCursor(options.cursor)
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/list',
      { limit, ...(pageCursor === undefined ? {} : { page_cursor: pageCursor }) },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `directory:root:${String(limit)}:${options.cursor?.trim() ?? ''}`,
        failureCooldownMs: 2_000,
        bypassCache: options.refresh === true,
      },
    )
    const items: ArkmeSourceItem[] = []
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
      const isMuted = chatMessageDnd(bundle.current_policy) ?? false
      const uid = stringValue(chatSession.chat_session_uid).trim()
      const sessionKind = numberValue(chatSession.session_kind)
      const kind: ArkmeSourceKind | undefined = sessionKind === 2
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
      const item: ArkmeSourceItem = {
        sourceRef: await this.sealSourceRef(session.userId, kind, uid, displayName),
        kind,
        displayName,
        ...(preview === '' ? {} : { latestPreview: preview }),
        activeAtMillis: numberValue(bundle.sort_active_at ?? chatSession.last_active_at),
        unreadCount: numberValue(unread.unread_count),
        isMuted,
        ...((numberValue(unread.session_last_seq ?? chatSession.last_seq)) > 0
          ? { latestSequence: numberValue(unread.session_last_seq ?? chatSession.last_seq) }
          : {}),
      }
      const itemIndex = items.push(item) - 1
      this.chatSourceCache.set(`${String(session.userId)}:${uid}`, item)
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

  async dshBetaCommunityEntryState(signal?: AbortSignal): Promise<ArkmeDSHBetaCommunityEntryState> {
    const session = await this.requireSession()
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/community/dsh-beta/entry-state',
      {},
      session,
      signal,
    )
    const status = this.dshBetaCommunityStatus(data.status)
    const visible = booleanValue(data.visible)
    const groupTitle = stringValue(data.group_title).trim()
    const snapshot = objectValue(data.group_avatar_snapshot)
    const memberCount = Math.max(0, Math.trunc(numberValue(snapshot.member_count)))
    const memberIds = listValue(snapshot.members)
      .map(member => numberValue(objectValue(member).user_id))
      .filter(userId => Number.isSafeInteger(userId) && userId > 0)
      .slice(0, 4)
    let avatarRefs: string[] = []
    if (visible && status === 'ready' && memberIds.length > 0) {
      try {
        const profiles = await this.publicProfilesByUserIds(memberIds, session, signal)
        avatarRefs = await Promise.all(
          memberIds
            .filter(userId => profiles.has(userId))
            .map(userId => this.sealProfileImageRef(session.userId, userId)),
        )
      } catch {
        // The optional entry must never degrade the normal conversation directory.
      }
    }
    return { status, visible, groupTitle, memberCount, avatarRefs }
  }

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async interwovenMoments(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeInterwovenBootstrap> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持普通私聊', false, 400)
    }
    if (!this.config.interwovenMomentsEnabled) {
      return { state: 'disabled', moments: [], preparedAtMillis: Date.now() }
    }
    const gate = await this.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/able-func',
      { func_type: 12 },
      session,
      signal,
    )
    if (!booleanValue(gate.able)) {
      return { state: 'disabled', moments: [], preparedAtMillis: Date.now() }
    }
    const counterpartUserId = await this.assertHumanPrivateSource(source, session, signal)
    const legacyRmSubjectId = await this.resolveLegacyPrivateSubjectId(counterpartUserId, session, signal)
    let data: Record<string, unknown> | undefined
    if (legacyRmSubjectId > 0) {
      try {
        data = await this.authenticatedWorldPost<Record<string, unknown>>(
          '/api/v1/interwoven-moments/inline-bootstrap',
          { rm_subject_id: legacyRmSubjectId, force_refresh: true },
          session,
          signal,
        )
      } catch (error) {
        if (!this.isUnsupportedInterwovenWorldRoute(error)) throw error
      }
    }
    data ??= await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/interwoven/inline-bootstrap',
      { chat_session_uid: source.ownerRef, rm_subject_id: legacyRmSubjectId, limit: 100 },
      session,
      signal,
    )
    const preparedAtMillis = Math.max(0, Math.trunc(numberValue(data.prepared_at))) || Date.now()
    const descriptors: Array<{
      rawMomentId: string
      occurredAtMillis: number
      groupName: string
      senderUserId: number
      summary: string
      degraded: boolean
      sourceChatSessionUid: string
      recordOwnerUserId: number
      recordUid: string
      relationUid: string
      sequence: number
      detailMode: 'chat' | 'owner_payload'
      fallbackTitle: string
      fallbackTextContent: string
    }> = []
    let invalidItemCount = 0
    for (const rawGroup of listValue(data.groups)) {
      const group = objectValue(rawGroup)
      if (numberValue(group.moment_type) !== 1) continue
      const groupTitle = stringValue(group.group_title).trim() || '群聊'
      for (const rawItem of listValue(group.group_preview_items)) {
        const item = objectValue(rawItem)
        if (numberValue(item.moment_type) !== 1) continue
        const jumpTarget = objectValue(item.jump_target)
        const renderPayload = objectValue(item.render_payload)
        const groupName = stringValue(renderPayload.group_name ?? item.title).trim() || groupTitle
        const rawMomentId = stringValue(item.moment_id).trim()
        const occurredAtMillis = Math.trunc(numberValue(item.occurred_at))
        const sourceChatSessionUid = stringValue(jumpTarget.chat_session_uid).trim()
        const recordOwnerUserId = Math.trunc(numberValue(
          jumpTarget.record_owner_user_id ?? renderPayload.record_owner_user_id ?? renderPayload.sender_user_id,
        ))
        const recordUid = stringValue(jumpTarget.record_uid ?? renderPayload.record_uid).trim()
        const relationUid = stringValue(jumpTarget.rel_uid).trim()
        const sequence = Math.trunc(numberValue(jumpTarget.seq))
        const senderUserId = Math.trunc(numberValue(renderPayload.sender_user_id))
        const hasChatDetailLocator = sourceChatSessionUid !== '' && recordOwnerUserId > 0
          && recordUid !== '' && relationUid !== '' && sequence > 0
        const fallbackTextContent = stringValue(
          renderPayload.content ?? renderPayload.mention_text ?? item.summary,
        ).trim().slice(0, 20_000)
        const fallbackTitle = stringValue(item.title ?? renderPayload.group_name).trim().slice(0, 500)
        if (rawMomentId === '' || !Number.isSafeInteger(occurredAtMillis) || occurredAtMillis <= 0
          || occurredAtMillis > 8_640_000_000_000_000
          || !Number.isSafeInteger(recordOwnerUserId) || recordOwnerUserId <= 0
          || recordUid === ''
          || !Number.isSafeInteger(senderUserId) || senderUserId <= 0) {
          invalidItemCount += 1
          continue
        }
        descriptors.push({
          rawMomentId,
          occurredAtMillis,
          groupName,
          senderUserId,
          summary: stringValue(renderPayload.content ?? item.summary).trim().slice(0, 1000),
          degraded: booleanValue(item.is_degraded),
          sourceChatSessionUid,
          recordOwnerUserId,
          recordUid,
          relationUid,
          sequence,
          detailMode: hasChatDetailLocator ? 'chat' : 'owner_payload',
          fallbackTitle,
          fallbackTextContent,
        })
      }
    }
    const profiles = await this.interwovenProfilesByUserIds(
      descriptors.map(item => item.senderUserId), session, signal,
    ).catch(() => new Map<number, { displayName: string; hasAvatar: boolean }>())
    const moments: ArkmeInterwovenMention[] = []
    const seenMomentIds = new Set<string>()
    for (const descriptor of descriptors) {
      const momentId = await this.interwovenStableMomentId(descriptor.rawMomentId)
      if (seenMomentIds.has(momentId)) continue
      seenMomentIds.add(momentId)
      const profile = profiles.get(descriptor.senderUserId)
      const senderName = profile?.displayName
        || (descriptor.senderUserId === session.userId ? '我' : descriptor.senderUserId === counterpartUserId
          ? source.displayName : 'Arkme 用户')
      const senderAvatarRef = profile?.hasAvatar === true
        ? await this.sealProfileImageRef(session.userId, descriptor.senderUserId)
        : undefined
      const reference: Omit<ArkmeInterwovenMomentReference, 'expiresAtMillis'> = {
        userId: session.userId,
        sourceOwnerRef: source.ownerRef,
        sourceChatSessionUid: descriptor.sourceChatSessionUid,
        recordOwnerUserId: descriptor.recordOwnerUserId,
        recordUid: descriptor.recordUid,
        relationUid: descriptor.relationUid,
        sequence: descriptor.sequence,
        momentId,
        groupName: descriptor.groupName,
        senderUserId: descriptor.senderUserId,
        senderName,
        ...(senderAvatarRef === undefined ? {} : { senderAvatarRef }),
        occurredAtMillis: descriptor.occurredAtMillis,
        detailMode: descriptor.detailMode,
        fallbackTitle: descriptor.fallbackTitle,
        fallbackTextContent: descriptor.fallbackTextContent,
      }
      moments.push({
        momentId,
        momentRef: await this.sealInterwovenMomentRef(reference),
        occurredAtMillis: descriptor.occurredAtMillis,
        groupName: descriptor.groupName,
        senderName,
        senderIsMe: descriptor.senderUserId === session.userId,
        ...(senderAvatarRef === undefined ? {} : { senderAvatarRef }),
        summary: descriptor.summary,
        degraded: descriptor.degraded,
      })
    }
    moments.sort((left, right) => left.occurredAtMillis - right.occurredAtMillis
      || left.momentId.localeCompare(right.momentId))
    const sourceStatusPartial = listValue(data.source_status).some(raw => {
      const status = objectValue(raw)
      return numberValue(status.moment_type) === 1 && numberValue(status.status) !== 1
    })
    if (moments.length === 0 && invalidItemCount === 0 && !sourceStatusPartial) {
      return { state: 'empty', moments, preparedAtMillis }
    }
    const partial = invalidItemCount > 0 || sourceStatusPartial || moments.some(moment => moment.degraded)
    return {
      state: partial ? 'partial' : 'success',
      moments,
      preparedAtMillis,
      ...(partial ? { message: '部分交织瞬间暂时不可用，可稍后重试' } : {}),
    }
  }

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async interwovenMomentDetail(
    sourceRef: string,
    momentRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeInterwovenDetail> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持普通私聊', false, 400)
    }
    const reference = await this.openInterwovenMomentRef(momentRef, session.userId, source.ownerRef)
    if (!this.config.interwovenMomentsEnabled) {
      throw new ArkmePluginError('interwoven-disabled', '交织瞬间能力当前未开启', false, 403)
    }
    const gate = await this.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/able-func', { func_type: 12 }, session, signal,
    )
    if (!booleanValue(gate.able)) {
      throw new ArkmePluginError('interwoven-disabled', '交织瞬间能力当前未开放', false, 403)
    }
    await this.assertHumanPrivateSource(source, session, signal)
    if (reference.detailMode === 'owner_payload') {
      return {
        momentId: reference.momentId,
        groupName: reference.groupName,
        senderName: reference.senderName,
        senderIsMe: reference.senderUserId === session.userId,
        ...(reference.senderAvatarRef === undefined ? {} : { senderAvatarRef: reference.senderAvatarRef }),
        occurredAtMillis: reference.occurredAtMillis,
        title: reference.fallbackTitle || reference.groupName,
        textContent: reference.fallbackTextContent,
        status: 1,
        degraded: true,
      }
    }
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/detail',
      {
        chat_session_uid: reference.sourceChatSessionUid,
        record_owner_user_id: reference.recordOwnerUserId,
        record_uid: reference.recordUid,
        rel_uid: reference.relationUid,
        seq: reference.sequence,
      },
      session,
      signal,
    )
    const item = objectValue(data.item)
    const relation = objectValue(item.relation)
    const record = objectValue(item.record)
    const payload = objectValue(record.payload)
    if (stringValue(data.chat_session_uid).trim() !== reference.sourceChatSessionUid
      || stringValue(relation.chat_session_uid).trim() !== reference.sourceChatSessionUid
      || numberValue(relation.record_owner_user_id) !== reference.recordOwnerUserId
      || stringValue(relation.record_uid).trim() !== reference.recordUid
      || stringValue(relation.rel_uid).trim() !== reference.relationUid
      || numberValue(relation.seq) !== reference.sequence) {
      throw new ArkmePluginError(
        'interwoven-detail-contract-invalid', '快记详情响应与所选交织瞬间不一致', true, 502,
      )
    }
    const status = Math.trunc(numberValue(record.status))
    const title = stringValue(payload.title).trim() || reference.groupName
    const textContent = stringValue(payload.text_content).trim()
    return {
      momentId: reference.momentId,
      groupName: reference.groupName,
      senderName: reference.senderName,
      senderIsMe: reference.senderUserId === session.userId,
      ...(reference.senderAvatarRef === undefined ? {} : { senderAvatarRef: reference.senderAvatarRef }),
      occurredAtMillis: reference.occurredAtMillis,
      title,
      textContent,
      status,
      degraded: status !== 1 || textContent === '',
    }
  }

  async joinDSHBetaCommunity(signal?: AbortSignal): Promise<ArkmeDSHBetaCommunityJoinResult> {
    const session = await this.requireSession()
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/community/dsh-beta/join',
      {},
      session,
      signal,
    )
    const status = this.dshBetaCommunityStatus(data.status)
    const chatSessionUid = stringValue(data.chat_session_uid).trim()
    if ((status !== 'joined' && status !== 'already_member') || chatSessionUid === '') {
      throw new ArkmePluginError(
        'dsh-beta-community-contract-invalid',
        'DSH 内测群入群响应不完整',
        true,
        502,
      )
    }
    let groupTitle = stringValue(data.group_title).trim()
    if (groupTitle === '') {
      try {
        const detail = await this.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/detail',
          { chat_session_uid: chatSessionUid },
          session,
          signal,
        )
        const chatSession = objectValue(detail.session)
        if (stringValue(chatSession.chat_session_uid).trim() === chatSessionUid
          && numberValue(chatSession.session_kind) === 2) {
          groupTitle = stringValue(chatSession.title).trim()
        }
      } catch {
        // Membership is already committed; detail hydration must not make the join look failed.
      }
    }
    if (groupTitle === '') groupTitle = 'DSH 内测群'
    this.groupAvatarSnapshotCache.delete(`${String(session.userId)}:${chatSessionUid}`)
    const source: ArkmeSourceItem = {
      sourceRef: await this.sealSourceRef(session.userId, 'group_chat', chatSessionUid, groupTitle),
      kind: 'group_chat',
      displayName: groupTitle,
      activeAtMillis: 0,
      unreadCount: 0,
    }
    try {
      await this.hydrateSourceAvatars(
        [source],
        new Map(),
        new Map([[0, chatSessionUid]]),
        session,
        signal,
      )
    } catch {
      // Membership is committed by Chat; avatar decoration cannot turn it into a failed join.
    }
    this.chatSourceCache.set(`${String(session.userId)}:${chatSessionUid}`, source)
    this.invalidateSourceListCache(session.userId, 'root')
    return { status, source }
  }

  async inspectGroupAiPolish(
    sourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishSnapshot> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
    }
    const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal)
    return this.groupAiPolishSnapshot(sourceRef, source.displayName, config)
  }

  async inspectGroupAiPolishByName(
    groupName: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishSnapshot> {
    const source = await this.resolveUniqueGroupByName(groupName, options.signal)
    return await this.inspectGroupAiPolish(source.sourceRef, options)
  }

  async readGroupAiPolishNotices(
    sourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishNotice[]> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色通知仅支持群聊', false)
    }
    return await this.queryGroupAiPolishNotices(source.ownerRef, session, options.signal)
  }

  async generateGroupAiPolishRuleForSource(
    sourceRef: string,
    requirement: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    const instruction = requirement.trim()
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
    }
    if (instruction === '' || [...instruction].length > 2_000) {
      throw new ArkmePluginError('group-ai-polish-requirement-invalid', '请提供不超过 2000 字的润色要求', false)
    }
    const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal)
    if (!config.canManage) {
      throw new ArkmePluginError('group-ai-polish-forbidden', '当前无法确认有效群成员身份，请稍后重试', false, 403)
    }
    const generated = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/ai-polish/rules/generate',
      { chat_session_uid: source.ownerRef, instruction },
      session,
      options.signal,
    )
    const candidate = objectValue(generated.candidate ?? generated.rule ?? generated.generated_rule ?? generated)
    const ruleName = stringValue(candidate.name).trim()
    const ruleText = stringValue(candidate.rule_text).trim()
    if (ruleName === '' || ruleText === '') {
      throw new ArkmePluginError('group-ai-polish-generate-invalid', 'AI 没有生成可用的润色规则，请换一种描述重试', true, 502)
    }
    this.cleanupAiPolishState()
    const confirmationRef = `arkme-ai-polish-confirm-v1.${crypto.randomUUID()}`
    this.aiPolishConfirmations.set(confirmationRef, {
      userId: session.userId,
      chatSessionUid: source.ownerRef,
      groupName: source.displayName,
      action: 'enable',
      expiresAtMillis: Date.now() + 10 * 60_000,
      candidateUid: stringValue(candidate.candidate_uid).trim(),
      ruleName,
      ruleText,
      promptVersion: stringValue(candidate.prompt_version).trim(),
      extra: objectValue(candidate.extra),
    })
    return { groupName: source.displayName, ruleName, ruleText, confirmationRef }
  }

  async generateGroupAiPolishRule(
    groupName: string,
    requirement: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    const source = await this.resolveUniqueGroupByName(groupName, options.signal)
    return await this.generateGroupAiPolishRuleForSource(source.sourceRef, requirement, options)
  }

  async confirmEnableGroupAiPolish(
    confirmationRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishMutationResult> {
    const session = await this.requireSession()
    const pending = this.requireAiPolishConfirmation(confirmationRef, session.userId, 'enable')
    const current = await this.queryGroupAiPolishConfig(pending.chatSessionUid, session, options.signal)
    if (!current.canManage) {
      throw new ArkmePluginError('group-ai-polish-forbidden', '当前无法确认有效群成员身份，请稍后重试', false, 403)
    }
    const updateAt = Date.now()
    const upserted = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/ai-polish/rules/upsert',
      {
        chat_session_uid: pending.chatSessionUid,
        ...(pending.candidateUid === undefined || pending.candidateUid === '' ? {} : { rule_uid: pending.candidateUid }),
        name: pending.ruleName,
        rule_text: pending.ruleText,
        ...(pending.promptVersion === undefined || pending.promptVersion === '' ? {} : { prompt_version: pending.promptVersion }),
        update_at: updateAt,
        ...(pending.extra === undefined || Object.keys(pending.extra).length === 0 ? {} : { extra: pending.extra }),
      },
      session,
      options.signal,
    )
    const rule = objectValue(upserted.rule ?? upserted)
    const ruleUid = stringValue(rule.rule_uid).trim()
    if (ruleUid === '') {
      throw new ArkmePluginError('group-ai-polish-rule-invalid', '保存润色规则后未返回有效规则', true, 502)
    }
    const updated = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/ai-polish/settings/update',
      {
        chat_session_uid: pending.chatSessionUid,
        enabled: true,
        active_rule_uid: ruleUid,
        update_at: Math.max(Date.now(), updateAt + 1),
      },
      session,
      options.signal,
    )
    const savedConfig = objectValue(updated.config ?? updated)
    if (!booleanValue(savedConfig.enabled) || stringValue(savedConfig.active_rule_uid).trim() !== ruleUid) {
      throw new ArkmePluginError('group-ai-polish-enable-invalid', '润色规则已保存，但开启状态确认失败，请重试', true, 502)
    }
    this.invalidateAiPolishReadCache(session.userId, pending.chatSessionUid)
    this.aiPolishConfirmations.delete(confirmationRef.trim())
    return { groupName: pending.groupName, enabled: true, ruleName: pending.ruleName ?? '', changed: true }
  }

  async prepareDisableGroupAiPolishForSource(
    sourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') throw new ArkmePluginError('group-ai-polish-source-invalid', 'AI 表达润色仅支持群聊', false)
    const config = await this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal)
    if (!config.canManage) throw new ArkmePluginError('group-ai-polish-forbidden', '当前无法确认有效群成员身份，请稍后重试', false, 403)
    this.cleanupAiPolishState()
    const confirmationRef = `arkme-ai-polish-confirm-v1.${crypto.randomUUID()}`
    this.aiPolishConfirmations.set(confirmationRef, {
      userId: session.userId, chatSessionUid: source.ownerRef, groupName: source.displayName,
      action: 'disable', expiresAtMillis: Date.now() + 10 * 60_000,
      ruleName: config.activeRuleName,
    })
    return {
      groupName: source.displayName,
      ruleName: config.activeRuleName,
      ruleText: '关闭后，新发送的群聊文本将不再自动润色。',
      confirmationRef,
    }
  }

  async prepareDisableGroupAiPolish(
    groupName: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    const source = await this.resolveUniqueGroupByName(groupName, options.signal)
    return await this.prepareDisableGroupAiPolishForSource(source.sourceRef, options)
  }

  async confirmDisableGroupAiPolish(
    confirmationRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishMutationResult> {
    const session = await this.requireSession()
    const pending = this.requireAiPolishConfirmation(confirmationRef, session.userId, 'disable')
    const current = await this.queryGroupAiPolishConfig(pending.chatSessionUid, session, options.signal)
    if (!current.canManage) throw new ArkmePluginError('group-ai-polish-forbidden', '当前无法确认有效群成员身份，请稍后重试', false, 403)
    const updated = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/ai-polish/settings/update',
      { chat_session_uid: pending.chatSessionUid, enabled: false, active_rule_uid: '', update_at: Date.now() },
      session,
      options.signal,
    )
    if (booleanValue(objectValue(updated.config ?? updated).enabled)) {
      throw new ArkmePluginError('group-ai-polish-disable-invalid', '关闭 AI 表达润色失败，请重试', true, 502)
    }
    this.invalidateAiPolishReadCache(session.userId, pending.chatSessionUid)
    this.aiPolishConfirmations.delete(confirmationRef.trim())
    return { groupName: pending.groupName, enabled: false, ruleName: pending.ruleName ?? '', changed: current.enabled }
  }

  async listGroupMembers(
    sourceRef: string,
    options: { activeOnly?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupMemberList> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持查看群聊成员', false)
    }
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/list',
      { chat_session_uid: source.ownerRef, active_only: options.activeOnly !== false },
      session,
      options.signal,
    )
    const rawItems = listValue(data.items).map(objectValue)
    const userIds = rawItems
      .map(item => numberValue(item.user_id))
      .filter(userId => Number.isSafeInteger(userId) && userId > 0)
    const profiles = await this.publicProfileSummariesByUserIds(userIds, session, options.signal).catch(() => new Map())
    const members: ArkmeGroupMemberItem[] = []
    for (const item of rawItems) {
      const userId = numberValue(item.user_id)
      if (!Number.isSafeInteger(userId) || userId <= 0) continue
      const profile = profiles.get(userId)
      const remarkName = stringValue(item.remark).trim()
      const memberName = stringValue(item.display_name_snapshot).trim()
      const profileDisplayName = profile?.displayName.trim() ?? ''
      const publicDisplayName = profileDisplayName === `用户 ${String(userId)}` ? '' : profileDisplayName
      const displayName = [remarkName, memberName, publicDisplayName]
        .find(value => value !== '' && value !== '成员' && value !== '群成员')
        ?? '群成员'
      const secondaryName = [memberName, publicDisplayName, remarkName]
        .find(value => value !== '' && value !== '成员' && value !== '群成员' && value !== displayName)
        ?? ''
      const role = chatMemberRole(item.role)
      const status = chatMemberStatus(item.status)
      members.push({
        userId,
        displayName,
        ...(memberName === '' ? {} : { memberName }),
        ...(secondaryName === '' ? {} : { secondaryName }),
        ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.sealProfileImageRef(session.userId, userId) }),
        role,
        status,
        isSelf: userId === session.userId,
        isOwner: role === 'owner',
        joinedAtMillis: numberValue(item.join_at),
      })
    }
    const roleRank = (role: ArkmeGroupMemberRole) => role === 'owner' ? 0 : role === 'admin' ? 1 : role === 'member' ? 2 : 3
    members.sort((left, right) => roleRank(left.role) - roleRank(right.role)
      || (right.status === 'active' ? 1 : 0) - (left.status === 'active' ? 1 : 0)
      || left.joinedAtMillis - right.joinedAtMillis
      || left.userId - right.userId)
    const self = members.find(item => item.isSelf)
    const resultSource = await this.sourceItem(source)
    this.chatSourceCache.set(`${String(session.userId)}:${source.ownerRef}`, resultSource)
    return {
      source: resultSource,
      items: members,
      total: members.length,
      activeCount: members.filter(item => item.status === 'active').length,
      selfRole: self?.role ?? 'unknown',
      selfStatus: self?.status ?? 'unknown',
    }
  }

  async groupSettings(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupSettingsSnapshot> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持查看群聊设置', false)
    }
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/detail',
      { chat_session_uid: source.ownerRef },
      session,
      signal,
    )
    const chatSession = objectValue(data.session)
    const currentMember = objectValue(data.current_member)
    const title = stringValue(chatSession.title).trim() || source.displayName
    const messageDnd = chatMessageDnd(data.current_policy) ?? false
    const nextSource: ArkmeSourceItem = {
      sourceRef: await this.sealSourceRef(session.userId, 'group_chat', source.ownerRef, title),
      kind: 'group_chat',
      displayName: title,
      activeAtMillis: numberValue(chatSession.last_active_at),
      unreadCount: numberValue(objectValue(data.unread_snapshot).unread_count),
      isMuted: messageDnd,
      ...((numberValue(chatSession.last_seq)) > 0 ? { latestSequence: numberValue(chatSession.last_seq) } : {}),
    }
    try {
      await this.hydrateSourceAvatars([nextSource], new Map(), new Map([[0, source.ownerRef]]), session, signal)
    } catch {
      // Settings must remain readable if group-avatar decoration is temporarily unavailable.
    }
    this.chatSourceCache.set(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    const selfRole = chatMemberRole(currentMember.role)
    const selfStatus = chatMemberStatus(currentMember.status)
    const active = selfStatus === 'active'
    return {
      source: nextSource,
      selfRole,
      selfStatus,
      canRename: active && selfRole === 'owner',
      canDissolve: active && selfRole === 'owner',
      canLeave: active && selfRole !== 'owner',
      messageDnd,
    }
  }

  async setGroupMessageDnd(
    sourceRef: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeGroupNotificationResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持设置群聊消息免打扰', false)
    }
    const current = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/policy/get',
      { chat_session_uid: source.ownerRef },
      session,
      signal,
    )
    await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/policy/update',
      {
        chat_session_uid: source.ownerRef,
        show_in_home_state: numberValue(current.show_in_home_state) || 1,
        privacy_state: numberValue(current.privacy_state) || 1,
        mute_state: enabled ? 2 : 1,
        pin_state: numberValue(current.pin_state) || 1,
        notify_state: enabled ? 2 : 1,
        status: numberValue(current.status) || 1,
        update_at: Date.now(),
      },
      session,
      signal,
    )
    const cacheKey = `${String(session.userId)}:${source.ownerRef}`
    const cached = this.chatSourceCache.get(cacheKey)
    if (cached !== undefined) this.chatSourceCache.set(cacheKey, { ...cached, isMuted: enabled })
    return {
      messageDnd: enabled,
    }
  }

  async renameGroup(sourceRef: string, title: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    const normalizedTitle = title.trim()
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持重命名群聊', false)
    }
    if (normalizedTitle === '' || normalizedTitle.length > 80) {
      throw new ArkmePluginError('group-title-invalid', '群聊名称需为 1-80 个字符', false)
    }
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/rename',
      { chat_session_uid: source.ownerRef, title: normalizedTitle, update_at: Date.now() },
      session,
      signal,
    )
    const nextSource = await this.chatSourceFromBundle(data, session, this.chatSourceCache.get(`${String(session.userId)}:${source.ownerRef}`), [])
    try {
      await this.hydrateSourceAvatars([nextSource], new Map(), new Map([[0, source.ownerRef]]), session, signal)
    } catch {
      // Rename success is authoritative; avatar refresh is optional.
    }
    this.chatSourceCache.set(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    return { source: nextSource, status: 'ok' }
  }

  async leaveGroup(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持退出群聊', false)
    }
    await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/members/update',
      { chat_session_uid: source.ownerRef, target_user_id: session.userId, action: 1 },
      session,
      signal,
    )
    const nextSource = await this.sourceItem(source)
    this.chatSourceCache.set(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    return { source: nextSource, status: 'ok' }
  }

  async dissolveGroup(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持解散群聊', false)
    }
    await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/dissolve',
      { chat_session_uid: source.ownerRef, update_at: Date.now() },
      session,
      signal,
    )
    const nextSource = await this.sourceItem(source)
    this.chatSourceCache.set(`${String(session.userId)}:${source.ownerRef}`, nextSource)
    return { source: nextSource, status: 'ok' }
  }

  async reportGroup(sourceRef: string, reason: string, signal?: AbortSignal): Promise<ArkmeGroupActionResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'group_chat') {
      throw new ArkmePluginError('group-source-invalid', '仅支持举报群聊', false)
    }
    await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/report',
      {
        chat_session_uid: source.ownerRef,
        report_type: 2,
        reason: reason.trim().slice(0, 200),
        created_at: Date.now(),
      },
      session,
      signal,
    )
    return { source: await this.sourceItem(source), status: 'ok' }
  }

  async userCard(userId: number, signal?: AbortSignal): Promise<ArkmeUserCardSnapshot> {
    const session = await this.requireSession()
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

  async openPrivateChatFromUser(
    peerUserId: number,
    options: { displayName?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.requireSession()
    if (!Number.isSafeInteger(peerUserId) || peerUserId <= 0) {
      throw new ArkmePluginError('private-chat-peer-invalid', '私聊用户参数无效', false)
    }
    if (peerUserId === session.userId) {
      throw new ArkmePluginError('private-chat-self-invalid', '不能给自己发起私聊', false, 409)
    }
    const profile = (await this.publicProfileSummariesByUserIds([peerUserId], session, options.signal).catch(() => new Map())).get(peerUserId)
    const displayName = options.displayName?.trim() || profile?.displayName || '群成员'
    const ownerSnapshot = (await this.stateStore.cachedProfile(session.userId).catch(() => undefined))?.profile?.displayName
      ?? ''
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/create-private',
      {
        chat_session_uid: `chat_session_${crypto.randomUUID()}`,
        peer_user_id: peerUserId,
        title: displayName,
        create_at: Date.now(),
        owner_display_name_snapshot: ownerSnapshot,
        peer_display_name_snapshot: displayName,
        extra: { source: 'dsh_arkme_user_card', client: 'deepseek_harness' },
      },
      session,
      options.signal,
    )
    const chatSession = objectValue(data.session)
    const uid = stringValue(chatSession.chat_session_uid).trim()
    if (uid === '') {
      throw new ArkmePluginError('private-chat-contract-invalid', '私聊会话响应不完整', true, 502)
    }
    const unread = objectValue(data.unread_snapshot)
    const latestSequence = numberValue(unread.session_last_seq ?? chatSession.last_seq)
    const source: ArkmeSourceItem = {
      sourceRef: await this.sealSourceRef(session.userId, 'private_chat', uid, displayName),
      kind: 'private_chat',
      displayName,
      ...(profile?.avatarUrl === undefined ? {} : { avatarRef: await this.sealProfileImageRef(session.userId, peerUserId) }),
      activeAtMillis: numberValue(chatSession.last_active_at) || Date.now(),
      unreadCount: numberValue(unread.unread_count),
      ...(latestSequence > 0 ? { latestSequence } : {}),
    }
    this.chatSourceCache.set(`${String(session.userId)}:${uid}`, source)
    return { source }
  }

  async readSource(
    sourceRef: string,
    options: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal } = {},
  ): Promise<ArkmeTimelinePage> {
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
        options.signal,
      )
      const rawRecords = listValue(data.records)
      const media = await this.hydrateRecordMediaPage(rawRecords, session, options.signal)
      const records = rawRecords.map(raw => {
        const recordUid = this.recordUid(raw)
        const displayItems = media.displayItemsByRecordUid.get(recordUid)
        return this.recordTimelineItemFromRaw(raw, session.userId, {
          ...(displayItems === undefined ? {} : { displayItems }),
          mediaUnavailable: media.unavailableRecordUids.has(recordUid),
        })
      })
      const nextSendAt = numberValue(data.next_cursor_send_at)
      const nextUid = stringValue(data.next_cursor_record_uid).trim()
      return {
        source: await this.sourceItem(source),
        items: records,
        hasMore: data.has_more === true,
        ...(nextSendAt > 0 && nextUid !== '' ? { nextCursor: { sendAtMillis: nextSendAt, itemUid: nextUid } } : {}),
      }
    }
    const aiPolishDecorations = source.kind === 'group_chat' && options.cursor === undefined
      ? Promise.allSettled([
        this.queryGroupAiPolishConfig(source.ownerRef, session, options.signal),
        this.queryGroupAiPolishNotices(source.ownerRef, session, options.signal),
      ])
      : undefined
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chat/timeline/page',
      {
        chat_session_uid: source.ownerRef,
        before_seq: Math.max(0, Math.trunc(options.cursor?.beforeSequence ?? 0)),
        limit,
      },
      session,
      options.signal,
      {
        lane: 'interactive-read',
        key: `timeline:${source.ownerRef}:${String(Math.max(0, Math.trunc(options.cursor?.beforeSequence ?? 0)))}:${String(limit)}`,
        failureCooldownMs: 2_000,
      },
    )
    const items: ArkmeTimelineItem[] = []
    const senderUserIdByIndex = new Map<number, number>()
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const relation = objectValue(item.relation)
      const record = objectValue(item.record)
      const payload = objectValue(record.payload)
      const uid = stringValue(relation.record_uid ?? payload.record_uid).trim()
      if (uid === '') continue
      const senderUserId = numberValue(relation.sender_user_id)
      const aiPolish = this.timelineAiPolish(record, payload)
      const itemIndex = items.push({
        itemUid: uid,
        senderName: stringValue(relation.display_name_snapshot).trim() || 'Arkme用户',
        isMe: senderUserId === session.userId,
        sendAtMillis: numberValue(relation.attach_at ?? payload.send_at),
        title: stringValue(payload.title),
        textContent: stringValue(payload.text_content),
        status: numberValue(record.status),
        sequence: numberValue(relation.seq),
        ...(numberValue(record.version ?? payload.version) > 0 ? { recordVersion: numberValue(record.version ?? payload.version) } : {}),
        ...(aiPolish === undefined ? {} : { aiPolish }),
        templateKind: numberValue(payload.template_kind),
        displayKind: numberValue(payload.display_kind),
        version: numberValue(payload.version ?? record.version),
        updateAtMillis: numberValue(payload.update_at ?? record.update_at),
        recordDurationMillis: numberValue(payload.record_duration_millis),
        editDurationMillis: numberValue(payload.edit_duration_millis),
        contentBlocks: this.richContentBlocks(item, session.userId),
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
    let aiPolishSettings: ArkmeGroupAiPolishSnapshot | undefined
    let aiPolishNotices: ArkmeGroupAiPolishNotice[] | undefined
    if (aiPolishDecorations !== undefined) {
      const [settingsResult, noticesResult] = await aiPolishDecorations
      if (settingsResult.status === 'fulfilled') {
        aiPolishSettings = this.groupAiPolishSnapshot(sourceRef, source.displayName, settingsResult.value)
      }
      if (noticesResult.status === 'fulfilled') aiPolishNotices = noticesResult.value
    }
    return {
      source: await this.sourceItem(source),
      items,
      ...(aiPolishSettings === undefined ? {} : { aiPolishSettings }),
      ...(aiPolishNotices === undefined ? {} : { aiPolishNotices }),
      hasMore: data.has_more === true,
      ...(beforeSequence > 0 ? { nextCursor: { beforeSequence } } : {}),
    }
  }

  async relatedRecordingEligibility(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeRelatedRecordingEligibility> {
    const session = await this.requireSession()
    await this.requirePrivateSource(sourceRef, session.userId)
    const allowed = this.relatedRecordingsEnabled()
      && await this.loadRelatedRecordingEligibility(session, signal)
    return { allowed }
  }

  async relatedRecordings(
    sourceRef: string,
    options: ArkmeRelatedRecordingPageOptions = {},
  ): Promise<ArkmeRelatedRecordingPage> {
    const limit = options.limit ?? 10
    const cursor = options.cursor?.trim() ?? ''
    const monthKey = options.monthKey?.trim() ?? ''
    const timezoneOffsetMillis = options.timezoneOffsetMillis ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ARKME_RELATED_RECORDING_PAGE_SIZE) {
      throw new ArkmePluginError('related-recordings-limit-invalid', '相关录音每页条数必须在 1 到 20 之间', false)
    }
    if (cursor.length > MAX_ARKME_RELATED_RECORDING_CURSOR_LENGTH) {
      throw new ArkmePluginError('related-recordings-cursor-invalid', '相关录音分页游标无效', false)
    }
    if (monthKey !== '' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
      throw new ArkmePluginError('related-recordings-month-invalid', '相关录音月份参数无效', false)
    }
    if (!Number.isInteger(timezoneOffsetMillis)
      || Math.abs(timezoneOffsetMillis) > MAX_ARKME_TIMEZONE_OFFSET_MILLIS) {
      throw new ArkmePluginError('related-recordings-timezone-invalid', '相关录音时区参数无效', false)
    }
    const session = await this.requireSession()
    const source = await this.requirePrivateSource(sourceRef, session.userId)
    if (!this.relatedRecordingsEnabled() || !await this.loadRelatedRecordingEligibility(session, options.signal)) {
      throw new ArkmePluginError('related-recordings-not-allowed', '当前账号暂未开放相关录音能力', false, 403)
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
        const safeLegacyProbe = error instanceof ArkmePluginError
          && error.code === 'arkme-code-1001'
          && cursor === ''
          && monthKey === ''
          && options.includeTimeIndex === true
        if (!safeLegacyProbe) throw error
        raw = await this.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/records/related-recordings/page', legacyBody, session, options.signal,
        )
        legacyTimeIndexFallback = true
      }
    } else {
      raw = await this.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/records/related-recordings/page', legacyBody, session, options.signal,
      )
    }
    return await this.relatedRecordingPage(raw, legacyTimeIndexFallback, session.userId, source.ownerRef)
  }

  recordRelatedRecordingsToolEvent(_event: {
    result: 'success' | 'error'
    durationMs: number
    itemCount?: number
    cursorPresent?: boolean
    transcriptRequested?: boolean
    transcriptTruncated?: boolean
  }): void {
    // Best-effort diagnostic sink. Recording content is deliberately excluded.
  }

  private relatedRecordingsEnabled(): boolean {
    return this.config.relatedRecordingsEnabled !== false
  }

  private async requirePrivateSource(sourceRef: string, userId: number): Promise<ArkmeSourceRefPayload> {
    const source = await this.openSourceRef(sourceRef, userId)
    if (source.kind !== 'private_chat') {
      throw new ArkmePluginError('related-recordings-private-source-required', '相关录音仅支持一对一私聊', false)
    }
    return source
  }

  private async loadRelatedRecordingEligibility(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const data = await this.authenticatedAuthPost<Record<string, unknown>>(
      '/api/v1/auth/able-func', { func_type: RELATED_RECORDINGS_FUNC_TYPE }, session, signal,
    )
    return data.able === true
  }

  private async relatedRecordingPage(
    raw: Record<string, unknown>,
    legacyTimeIndexFallback: boolean,
    userId: number,
    chatSessionUid: string,
  ): Promise<ArkmeRelatedRecordingPage> {
    const items: ArkmeRelatedRecordingItem[] = []
    for (const rawItem of listValue(raw.moment_ls)) {
      const item = await this.relatedRecordingItem(rawItem, userId, chatSessionUid)
      if (item !== undefined) items.push(item)
    }
    const partial = raw.partial === true
    const stateCode = numberValue(raw.state)
    const state: ArkmeRelatedRecordingPageState = partial
      ? items.length > 0 ? 'partial' : 'error'
      : items.length > 0 ? 'success'
        : stateCode === 2 ? 'generating'
          : stateCode === 4 ? 'error'
            : 'empty'
    const nextCursor = stringValue(raw.next_cursor).trim()
    const timeIndexComplete = raw.time_index_complete === true && !legacyTimeIndexFallback
    const monthBuckets: ArkmeRelatedRecordingMonthBucket[] = timeIndexComplete
      ? listValue(raw.month_bucket_ls).flatMap(value => {
          const bucket = objectValue(value)
          const monthKey = stringValue(bucket.month_key).trim()
          const itemCount = numberValue(bucket.item_count)
          return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey) && Number.isInteger(itemCount) && itemCount >= 0
            ? [{ monthKey, itemCount }]
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

  private async relatedRecordingItem(
    raw: unknown,
    userId: number,
    chatSessionUid: string,
  ): Promise<ArkmeRelatedRecordingItem | undefined> {
    const item = objectValue(raw)
    const momentId = stringValue(item.moment_id).trim()
    const startAtMillis = numberValue(item.start_at)
    if (momentId === '' || !Number.isSafeInteger(startAtMillis) || startAtMillis <= 0) return undefined
    const transcript = stringValue(item.transcript)
    const speakers = listValue(item.speaker_ls).flatMap(value => {
      const speaker = objectValue(value)
      const speakerId = stringValue(speaker.speaker_id).trim()
      if (speakerId === '') return []
      const refUserId = optionalPositiveNumber(speaker.ref_usr_id)
      const nickname = optionalString(speaker.nick_name)
      return [{ speakerId, ...(refUserId === undefined ? {} : { refUserId }), ...(nickname === undefined ? {} : { nickname }) }]
    })
    const participants = listValue(item.participant_ls).flatMap(value => {
      const participant = objectValue(value)
      const speakerId = stringValue(participant.speaker_id).trim()
      const nickname = optionalString(participant.nick_name)
      const displayName = stringValue(participant.display_name).trim() || nickname || ''
      if (speakerId === '' || displayName === '') return []
      const refUserId = optionalPositiveNumber(participant.ref_usr_id)
      return [{
        speakerId,
        ...(refUserId === undefined ? {} : { refUserId }),
        ...(nickname === undefined ? {} : { nickname }),
        displayName,
        role: numberValue(participant.role),
      }]
    })
    const dateStamp = optionalPositiveNumber(item.date_stamp)
    const timezoneOffsetMillis = numberValue(item.tz_offset)
    return {
      recordingRef: await this.relatedRecordingRef(userId, chatSessionUid, momentId),
      startAtMillis,
      endAtMillis: numberValue(item.end_at),
      ...(dateStamp === undefined ? {} : { dateStamp }),
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

  private async relatedRecordingRef(userId: number, chatSessionUid: string, momentId: string): Promise<string> {
    const signature = createHmac('sha256', await this.stateStore.uniqueCode())
      .update(`related-recording:${userId}:${chatSessionUid}:${momentId}`)
      .digest('base64url')
    return `arkme-related-recording-v1.${signature}`
  }

  async sendSourceText(
    sourceRef: string,
    textContent: string,
    options: { recordUid?: string; relationUid?: string } = {},
  ): Promise<ArkmeSourceSendResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    const text = textContent.trim()
    if (text === '' || text.length > this.config.maxTextLength) {
      throw new ArkmePluginError('source-text-invalid', '发送内容为空或超过长度限制', false)
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
    if (source.kind === 'group_chat') {
      return await this.sendGroupSourceTextWithAiPolish(
        sourceRef, source.ownerRef, text, recordUid, relationUid, session,
      )
    }
    return await this.sendChatSourceTextRaw(
      sourceRef, source.ownerRef, text, recordUid, relationUid, session,
    )
  }

  async retryGroupAiPolish(
    retryRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceSendResult> {
    const session = await this.requireSession()
    this.cleanupAiPolishState()
    const normalized = retryRef.trim()
    const pending = this.aiPolishRetries.get(normalized)
    if (pending === undefined || pending.userId !== session.userId || pending.expiresAtMillis <= Date.now()) {
      this.aiPolishRetries.delete(normalized)
      throw new ArkmePluginError('group-ai-polish-retry-expired', '本次润色重试已失效，请重新发送消息', false, 410)
    }
    const taskUid = crypto.randomUUID()
    const attempt = pending.attempt + 1
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/ai-polish/text/retry-apply',
      {
        task_uid: taskUid,
        chat_session_uid: pending.chatSessionUid,
        rel_uid: pending.relationUid,
        record_uid: pending.recordUid,
        attempt,
        original_text: pending.originalText,
        extra: { input_source: 'dsh_plugin', content_kind: 'plain_text' },
      },
      session,
      options.signal,
    )
    const result = this.aiPolishTextResult(data)
    if (result.state === 1 && result.action === 1 && result.polishedText !== '') {
      this.aiPolishRetries.delete(normalized)
      return {
        sourceRef: pending.sourceRef,
        itemUid: result.recordUid || pending.recordUid,
        status: 1,
        localState: 'synced',
        aiPolish: {
          state: 'polished', originalText: pending.originalText, polishedText: result.polishedText,
        },
      }
    }
    pending.attempt = attempt
    pending.expiresAtMillis = Date.now() + 30 * 60_000
    return {
      sourceRef: pending.sourceRef,
      itemUid: pending.recordUid,
      status: 1,
      localState: 'synced',
      aiPolish: {
        state: 'failed', originalText: pending.originalText,
        failureMessage: result.failureMessage || '润色失败', retryRef: normalized,
      },
    }
  }

  private async sendChatSourceTextRaw(
    sourceRef: string,
    chatSessionUid: string,
    text: string,
    recordUid: string,
    relationUid: string,
    session: ArkmeSessionCredentials,
    initialAiPolish?: Record<string, unknown>,
  ): Promise<ArkmeSourceSendResult> {
    const result = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/send',
      {
        chat_session_uid: chatSessionUid,
        record_uid: recordUid,
        rel_uid: relationUid,
        template_kind: 1,
        text_content: text,
        ...(initialAiPolish === undefined ? {} : { initial_ai_polish: initialAiPolish }),
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

  private async sendGroupSourceTextWithAiPolish(
    sourceRef: string,
    chatSessionUid: string,
    originalText: string,
    recordUid: string,
    relationUid: string,
    session: ArkmeSessionCredentials,
  ): Promise<ArkmeSourceSendResult> {
    let config: ArkmeAiPolishConfigSnapshot
    try {
      config = await this.queryGroupAiPolishConfig(chatSessionUid, session)
    } catch {
      return await this.sendChatSourceTextRaw(
        sourceRef, chatSessionUid, originalText, recordUid, relationUid, session,
      )
    }
    if (!config.enabled || config.activeRuleUid === '') {
      return await this.sendChatSourceTextRaw(
        sourceRef, chatSessionUid, originalText, recordUid, relationUid, session,
      )
    }
    const taskUid = crypto.randomUUID()
    let polished: ArkmeAiPolishTextResult
    try {
      const data = await this.authenticatedChatPost<Record<string, unknown>>(
        '/api/v1/chats/ai-polish/text/polish',
        {
          task_uid: taskUid,
          chat_session_uid: chatSessionUid,
          attempt: 1,
          original_text: originalText,
          extra: { input_source: 'dsh_plugin', content_kind: 'plain_text' },
        },
        session,
      )
      polished = this.aiPolishTextResult(data)
    } catch (error) {
      const sent = await this.sendChatSourceTextRaw(
        sourceRef, chatSessionUid, originalText, recordUid, relationUid, session,
      )
      return this.withFailedAiPolishRetry(
        sent, sourceRef, chatSessionUid, relationUid, recordUid, originalText, 1, session.userId,
        safeFailureMessage(error),
      )
    }
    if (polished.state === 1 && polished.action === 1 && polished.polishedText !== '') {
      const activeRule = config.rules.find(rule => rule.ruleUid === polished.ruleUid)
      const sent = await this.sendChatSourceTextRaw(
        sourceRef,
        chatSessionUid,
        originalText,
        recordUid,
        relationUid,
        session,
        {
          revision_uid: polished.revisionUid,
          attempt_uid: polished.taskUid || taskUid,
          original_text: originalText,
          polished_text: polished.polishedText,
          rule_uid: polished.ruleUid,
          rule_name: activeRule?.name ?? config.activeRuleName,
          model: polished.modelVersion,
          prompt: polished.promptVersion,
          ...(Object.keys(polished.extra).length === 0 ? {} : { extra: polished.extra }),
        },
      )
      return {
        ...sent,
        aiPolish: { state: 'polished', originalText, polishedText: polished.polishedText },
      }
    }
    const sent = await this.sendChatSourceTextRaw(
      sourceRef, chatSessionUid, originalText, recordUid, relationUid, session,
    )
    if (polished.action === 2) {
      return { ...sent, aiPolish: { state: 'kept_original', originalText } }
    }
    return this.withFailedAiPolishRetry(
      sent, sourceRef, chatSessionUid, relationUid, recordUid, originalText,
      Math.max(1, polished.attempt), session.userId, polished.failureMessage || '润色失败',
    )
  }

  private withFailedAiPolishRetry(
    sent: ArkmeSourceSendResult,
    sourceRef: string,
    chatSessionUid: string,
    relationUid: string,
    recordUid: string,
    originalText: string,
    attempt: number,
    userId: number,
    failureMessage: string,
  ): ArkmeSourceSendResult {
    this.cleanupAiPolishState()
    const retryRef = `arkme-ai-polish-retry-v1.${crypto.randomUUID()}`
    this.aiPolishRetries.set(retryRef, {
      userId, sourceRef, chatSessionUid, relationUid, recordUid, originalText, attempt,
      expiresAtMillis: Date.now() + 30 * 60_000,
    })
    return {
      ...sent,
      aiPolish: { state: 'failed', originalText, failureMessage, retryRef },
    }
  }

  async sendSourceRich(
    sourceRef: string,
    input: ArkmeRichSendInput,
    options: { recordUid?: string; relationUid?: string } = {},
  ): Promise<ArkmeSourceSendResult> {
    if (this.config.richMediaSendEnabled === false) {
      throw new ArkmePluginError('rich-content-disabled', '富内容发送已被插件配置关闭', false, 403)
    }
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    const title = input.title?.trim() ?? ''
    const textContent = input.textContent?.trim() ?? ''
    const assets = input.assets ?? []
    const displayKind = input.displayKind === 1 ? 1 : 0
    const longArticle = displayKind === 1
    const maxContentLength = longArticle ? 40000 : this.config.maxTextLength
    const thinkingDurationMillis = Math.max(0, Math.trunc(input.thinkingDurationMillis ?? 0))
    if (title.length > (longArticle ? 100 : 500) || textContent.length > maxContentLength || assets.length > 20
      || (textContent === '' && title === '' && assets.length === 0)) {
      throw new ArkmePluginError('rich-content-invalid', '富内容为空、过长或附件数量超限', false)
    }
    if (longArticle && (title === '' || textContent === '')) {
      throw new ArkmePluginError('long-article-invalid', '长文标题和正文不能为空', false)
    }
    for (const asset of assets) {
      if (!/^[A-Za-z0-9._:-]{8,256}$/.test(asset.fileAssetUid) || asset.size < 0
        || ![1, 2, 3, 4].includes(asset.fileKind)) {
        throw new ArkmePluginError('rich-asset-invalid', '附件资产参数无效', false)
      }
    }
    const recordUid = options.recordUid?.trim() || randomUUID()
    const relationUid = options.relationUid?.trim() || randomUUID()
    const templateKind = longArticle ? 1 : assets.length === 0 ? 1 : 2
    const contentPayload = assets.length === 0 ? undefined : {
      payload_kind: 2,
      schema_version: 1,
      text_state: textContent === '' ? 3 : 1,
      media_refs: assets.map((asset, index) => ({
        file_asset_uid: asset.fileAssetUid,
        content_file_role: 1,
        render_role: 1,
        sort_order: index,
        file_name: asset.fileName,
      })),
    }
    const commonBody = {
      record_uid: recordUid,
      template_kind: templateKind,
      display_kind: displayKind,
      title,
      text_content: textContent,
      ...(longArticle ? { record_duration_millis: thinkingDurationMillis } : {}),
      ...(contentPayload === undefined ? {} : { content_payload: contentPayload }),
      send_at: Date.now(),
    }
    if (source.kind === 'default_category') {
      const result = await this.authenticatedPost<Record<string, unknown>>('/api/v1/records/create', commonBody, session)
      return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
    }
    if (source.kind === 'topic') {
      const result = await this.authenticatedPost<Record<string, unknown>>(
        '/api/v1/topics/records/create', { topic_uid: source.ownerRef, ...commonBody }, session,
      )
      return { sourceRef, itemUid: stringValue(result.record_uid).trim() || recordUid, status: numberValue(result.status), localState: 'synced' }
    }
    const result = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/records/send',
      { chat_session_uid: source.ownerRef, rel_uid: relationUid, ...commonBody },
      session,
    )
    return {
      sourceRef,
      itemUid: stringValue(result.record_uid).trim() || recordUid,
      status: numberValue(result.audit_status ?? result.status),
      sequence: numberValue(result.seq),
      localState: 'synced',
    }
  }

  async longArticleDetail(sourceRef: string, itemUid: string, signal?: AbortSignal): Promise<ArkmeLongArticleDetail> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    const uid = itemUid.trim()
    if (uid === '') throw new ArkmePluginError('long-article-item-invalid', '长文记录标识无效', false)
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/records/detail', { record_uid: uid }, session, signal,
    )
    const core = objectValue(data.record_core)
    const recordUid = stringValue(core.record_uid).trim()
    const templateKind = numberValue(core.template_kind)
    const displayKind = numberValue(core.display_kind)
    if (recordUid !== uid || (templateKind !== 8 && displayKind !== 1)) {
      throw new ArkmePluginError('long-article-not-found', '未找到可用的长文详情', false, 404)
    }
    const originContainerRef = stringValue(core.origin_container_ref).trim()
    if (source.kind === 'topic') {
      const topicUid = stringValue(objectValue(data.topic_core).topic_uid).trim()
      if (topicUid !== source.ownerRef) throw new ArkmePluginError('long-article-source-mismatch', '长文不属于当前会话', false, 403)
    } else if (source.kind === 'private_chat' || source.kind === 'group_chat') {
      if (originContainerRef !== source.ownerRef) throw new ArkmePluginError('long-article-source-mismatch', '长文不属于当前会话', false, 403)
    } else if (numberValue(core.owner_user_id) !== session.userId) {
      throw new ArkmePluginError('long-article-source-mismatch', '长文不属于当前会话', false, 403)
    }
    const recordDurationMillis = Math.max(0, Math.trunc(numberValue(core.record_duration_millis)))
    const editDurationMillis = Math.max(0, Math.trunc(numberValue(core.edit_duration_millis)))
    return {
      sourceRef,
      itemUid: recordUid,
      title: stringValue(core.title),
      textContent: stringValue(core.text_content),
      sendAtMillis: Math.trunc(numberValue(core.send_at)),
      updateAtMillis: Math.trunc(numberValue(core.update_at)),
      recordDurationMillis,
      editDurationMillis,
      thinkingDurationMillis: recordDurationMillis + editDurationMillis,
      version: Math.trunc(numberValue(core.version)),
      editable: numberValue(core.owner_user_id) === session.userId && numberValue(core.creator_user_id) === session.userId,
    }
  }

  async updateLongArticle(
    sourceRef: string,
    itemUid: string,
    input: { title: string; textContent: string; version: number; editDurationMillis: number },
  ): Promise<ArkmeLongArticleDetail> {
    if (this.config.richMediaSendEnabled === false) {
      throw new ArkmePluginError('rich-content-disabled', '长文编辑已被插件配置关闭', false, 403)
    }
    const session = await this.requireSession()
    const detail = await this.longArticleDetail(sourceRef, itemUid)
    const title = input.title.trim()
    const textContent = input.textContent.trim()
    const editDurationMillis = Math.max(0, Math.trunc(input.editDurationMillis))
    if (!detail.editable) throw new ArkmePluginError('long-article-not-editable', '只能编辑自己发布的长文', false, 403)
    if (title === '' || title.length > 100 || textContent === '' || textContent.length > 40000
      || !Number.isSafeInteger(input.version) || input.version <= 0 || input.version !== detail.version) {
      throw new ArkmePluginError('long-article-update-invalid', '长文内容或版本无效，请刷新后重试', false, 409)
    }
    await this.authenticatedPost<Record<string, unknown>>('/api/v1/records/update', {
      record_uid: detail.itemUid,
      template_kind: 1,
      display_kind: 1,
      title,
      text_content: textContent,
      record_duration_millis: detail.recordDurationMillis,
      edit_duration_millis: editDurationMillis,
      version: detail.version,
    }, session)
    return await this.longArticleDetail(sourceRef, itemUid)
  }

  async getLongArticleDraft(sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined> {
    const session = await this.requireSession()
    await this.openSourceRef(sourceRef, session.userId)
    return await this.stateStore.getLongArticleDraft(session.userId, sourceRef, itemUid?.trim() || undefined)
  }

  async putLongArticleDraft(draft: ArkmeLongArticleDraft): Promise<void> {
    const session = await this.requireSession()
    await this.openSourceRef(draft.sourceRef, session.userId)
    const itemUid = draft.itemUid?.trim() || undefined
    if (draft.title.length > 100 || draft.textContent.length > 40000 || draft.durationMillis < 0) {
      throw new ArkmePluginError('long-article-draft-invalid', '长文草稿内容无效', false)
    }
    await this.stateStore.putLongArticleDraft(session.userId, {
      sourceRef: draft.sourceRef,
      ...(itemUid === undefined ? {} : { itemUid }),
      title: draft.title,
      textContent: draft.textContent,
      durationMillis: Math.max(0, Math.trunc(draft.durationMillis)),
      updatedAtMillis: Date.now(),
    })
  }

  async removeLongArticleDraft(sourceRef: string, itemUid?: string): Promise<void> {
    const session = await this.requireSession()
    await this.openSourceRef(sourceRef, session.userId)
    await this.stateStore.removeLongArticleDraft(session.userId, sourceRef, itemUid?.trim() || undefined)
  }

  async uploadLocalFile(
    filePath: string,
    metadata: { size: number; sha256: string; mimeType: string; fileName: string; fileKind: 1 | 2 | 3 | 4 },
  ): Promise<ArkmeUploadedAsset> {
    if (this.config.richMediaSendEnabled === false) {
      throw new ArkmePluginError('rich-content-disabled', '文件上传已被插件配置关闭', false, 403)
    }
    const maxBytes = this.config.maxUploadBytes ?? 100 * 1024 * 1024
    if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > maxBytes
      || !/^[a-f0-9]{64}$/.test(metadata.sha256) || metadata.fileName.trim() === '') {
      throw new ArkmePluginError('upload-metadata-invalid', '文件为空、过大或元数据无效', false, 400)
    }
    const session = await this.requireSession()
    const uploadMode = metadata.size > 16 * 1024 * 1024 ? 2 : 1
    const prepared = await this.authenticatedPost<ArkmePreparedUpload>('/api/v1/files/prepare-upload', {
      planned_size: metadata.size,
      file_hash: metadata.sha256,
      mime_type: metadata.mimeType || 'application/octet-stream',
      file_kind: metadata.fileKind,
      upload_mode: uploadMode,
      display_name: metadata.fileName,
    }, session)
    const uploadSessionUid = stringValue(prepared.upload_session_uid).trim()
    if (uploadSessionUid === '') throw new ArkmePluginError('upload-prepare-invalid', '上传准备响应无效', true, 502)
    try {
      let storageETag = ''
      const completedParts: Array<{ part_number: number; etag: string }> = []
      if (uploadMode === 1) {
        const uploadUrl = stringValue(prepared.upload_url).trim()
        if (uploadUrl === '') throw new ArkmePluginError('upload-url-missing', '对象存储上传地址缺失', true, 502)
        const response = await this.fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: Object.fromEntries(Object.entries(objectValue(prepared.upload_headers)).map(([key, value]) => [key, stringValue(value)])),
          body: createReadStream(filePath) as never,
          duplex: 'half',
          redirect: 'error',
        } as RequestInit)
        if (!response.ok) throw new ArkmePluginError('upload-storage-failed', `对象存储上传失败（${String(response.status)}）`, true, 502)
        storageETag = response.headers.get('etag') ?? ''
      } else {
        const partSize = Math.trunc(numberValue(prepared.multipart_part_size))
        const parts = listValue(prepared.multipart_parts).map(objectValue)
        if (partSize <= 0 || parts.length === 0) throw new ArkmePluginError('upload-parts-missing', '分片上传参数缺失', true, 502)
        const handle = await openFile(filePath, 'r')
        try {
          for (const part of parts) {
            const partNumber = Math.trunc(numberValue(part.part_number))
            const uploadUrl = stringValue(part.upload_url).trim()
            const offset = (partNumber - 1) * partSize
            const length = Math.min(partSize, metadata.size - offset)
            if (partNumber <= 0 || uploadUrl === '' || length <= 0) throw new ArkmePluginError('upload-part-invalid', '分片上传参数无效', true, 502)
            const buffer = Buffer.allocUnsafe(length)
            const read = await handle.read(buffer, 0, length, offset)
            if (read.bytesRead !== length) throw new ArkmePluginError('upload-part-read-failed', '读取上传分片失败', true, 500)
            const response = await this.fetchImpl(uploadUrl, {
              method: 'PUT',
              headers: Object.fromEntries(Object.entries(objectValue(part.upload_headers)).map(([key, value]) => [key, stringValue(value)])),
              body: buffer,
              redirect: 'error',
            })
            if (!response.ok) throw new ArkmePluginError('upload-storage-failed', `对象存储分片上传失败（${String(response.status)}）`, true, 502)
            completedParts.push({ part_number: partNumber, etag: response.headers.get('etag') ?? '' })
          }
        } finally { await handle.close() }
      }
      const completed = await this.authenticatedPost<Record<string, unknown>>('/api/v1/files/complete-upload', {
        upload_session_uid: uploadSessionUid,
        uploaded_size: metadata.size,
        storage_etag: storageETag,
        multipart_parts: completedParts,
      }, session)
      const fileAssetUid = stringValue(completed.file_asset_uid).trim()
      if (fileAssetUid === '') throw new ArkmePluginError('upload-complete-invalid', '上传完成响应无效', true, 502)
      return {
        fileAssetUid,
        fileName: metadata.fileName,
        mimeType: stringValue(completed.mime_type).trim() || metadata.mimeType,
        size: numberValue(completed.size) || metadata.size,
        fileKind: metadata.fileKind,
      }
    } catch (error) {
      await this.authenticatedPost('/api/v1/files/abort-upload', { upload_session_uid: uploadSessionUid }, session).catch(() => undefined)
      throw error
    }
  }

  async fetchMedia(
    mediaRef: string,
    range?: string,
  ): Promise<{ response: Response; descriptor: ArkmeMediaDescriptor }> {
    const session = await this.requireSession()
    const descriptor = this.mediaRefs.get(mediaRef)
    if (descriptor === undefined || descriptor.viewerUserId !== session.userId || descriptor.expiresAtMillis <= Date.now()) {
      this.mediaRefs.delete(mediaRef)
      throw new ArkmePluginError('media-ref-invalid', '媒体引用已失效，请刷新对话后重试', false, 404)
    }
    const url = new URL(descriptor.remoteUrl)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
      || !allowedSignedImageHost(this.config.environment, url.hostname)) {
      throw new ArkmePluginError('media-host-rejected', '媒体来源不受信任', false, 403)
    }
    const response = await this.fetchImpl(url, {
      headers: range === undefined ? {} : { Range: range },
      redirect: 'error',
    })
    if (!response.ok && response.status !== 206) {
      throw new ArkmePluginError('media-fetch-failed', `媒体读取失败（${String(response.status)}）`, true, 502)
    }
    return { response, descriptor }
  }

  async sendDirectText(
    recipientArkmeId: string,
    textContent: string,
    options: {
      recordUid?: string
      relationUid?: string
      sendAtMillis?: number
      signal?: AbortSignal
    } = {},
  ): Promise<ArkmeDirectTextSendResult> {
    const session = await this.requireSession()
    const recipient = recipientArkmeId.trim()
    if (recipient === '') {
      throw new ArkmePluginError('direct-recipient-invalid', '接收方 Arkme ID 不能为空', false)
    }
    const text = textContent.trim()
    if (text === '' || text.length > this.config.maxTextLength) {
      throw new ArkmePluginError('direct-text-invalid', '发送内容为空或超过长度限制', false)
    }
    const recordUid = options.recordUid?.trim() || crypto.randomUUID()
    const relationUid = options.relationUid?.trim() || crypto.randomUUID()
    const sendAtMillis = options.sendAtMillis ?? Date.now()
    if (!Number.isSafeInteger(sendAtMillis) || sendAtMillis <= 0) {
      throw new ArkmePluginError('direct-send-at-invalid', '发送时间无效', false)
    }
    const result = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/agent/records/send',
      {
        recipient_jotmo_id: recipient,
        record_uid: recordUid,
        rel_uid: relationUid,
        text_content: text,
        send_at: sendAtMillis,
      },
      session,
      options.signal,
    )
    const chatSessionUid = stringValue(result.chat_session_uid).trim()
    const sequence = numberValue(result.seq)
    const targetKind = stringValue(result.target_kind).trim()
    if (chatSessionUid === '' || !Number.isSafeInteger(sequence) || sequence <= 0 || targetKind !== 'direct') {
      throw new ArkmePluginError('direct-send-response-invalid', 'Chat Agent 发送返回了无效响应', true, 502)
    }
    return {
      recipientArkmeId: recipient,
      chatSessionUid,
      recordUid: stringValue(result.record_uid).trim() || recordUid,
      relationUid: stringValue(result.rel_uid).trim() || relationUid,
      sequence,
      targetKind: 'direct',
    }
  }

  async markSourceRead(sourceRef: string, readSequence: number): Promise<ArkmeSourceReadResult> {
    const session = await this.requireSession()
    const source = await this.openSourceRef(sourceRef, session.userId)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') {
      throw new ArkmePluginError('source-read-unsupported', '当前数据源不支持聊天已读', false)
    }
    if (!Number.isSafeInteger(readSequence) || readSequence <= 0) {
      throw new ArkmePluginError('source-read-sequence-invalid', '聊天已读游标无效', false)
    }
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/cursor/update',
      {
        chat_session_uid: source.ownerRef,
        read_seq: readSequence,
        read_at: Date.now(),
        client_ack_id: crypto.randomUUID(),
        reason: 'arkme_dsh_open_chat',
      },
      session,
    )
    const responseSessionUid = stringValue(data.chat_session_uid).trim()
    const effectiveReadSequence = numberValue(data.effective_read_seq)
    const readAt = numberValue(data.read_at)
    const sessionLastSequence = numberValue(data.session_last_seq)
    const unreadCount = numberValue(data.unread_count)
    if (responseSessionUid !== source.ownerRef || !Number.isSafeInteger(effectiveReadSequence)
      || effectiveReadSequence < readSequence || readAt <= 0 || sessionLastSequence < effectiveReadSequence
      || !Number.isSafeInteger(unreadCount) || unreadCount < 0) {
      throw new ArkmePluginError('source-read-ack-invalid', '聊天已读响应不完整', true, 502)
    }
    const cacheKey = `${String(session.userId)}:${source.ownerRef}`
    const cached = this.chatSourceCache.get(cacheKey)
    if (cached !== undefined) this.chatSourceCache.set(cacheKey, { ...cached, unreadCount })
    this.emitChatClientEvent({
      type: 'read-ack',
      revision: this.nextChatClientRevision(),
      sourceRef,
      unreadCount,
    })
    this.scheduleChatSessionProjection(source.ownerRef, sessionLastSequence)
    return { sourceRef, effectiveReadSequence, unreadCount }
  }

  private async chatSourceFromBundle(
    bundle: Record<string, unknown>,
    session: ArkmeSessionCredentials,
    cached: ArkmeSourceItem | undefined,
    timelineItems: ArkmeTimelineItem[],
  ): Promise<ArkmeSourceItem> {
    const chatSession = objectValue(bundle.session)
    const counterpart = objectValue(bundle.private_counterpart)
    const supplement = objectValue(bundle.private_supplement)
    const unread = objectValue(bundle.unread_snapshot)
    const isMuted = chatMessageDnd(bundle.current_policy) ?? cached?.isMuted ?? false
    const uid = stringValue(chatSession.chat_session_uid).trim()
    const sessionKind = numberValue(chatSession.session_kind)
    const kind: ArkmeSourceKind | undefined = sessionKind === 2
      ? 'group_chat'
      : sessionKind === 1 || sessionKind === 3 ? 'private_chat' : undefined
    if (uid === '' || kind === undefined) throw new Error('invalid chat display snapshot')
    const displayName = (kind === 'private_chat'
      ? stringValue(
        supplement.remark ?? supplement.counterpart_name_snapshot ?? counterpart.display_name_snapshot
        ?? supplement.pending_name ?? counterpart.visible_phone,
      )
      : stringValue(chatSession.title)).trim() || cached?.displayName || '未命名会话'
    const latestItem = [...timelineItems].sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0))[0]
    const latestPreview = latestItem === undefined
      ? cached?.latestPreview
      : latestItem.textContent || latestItem.title || '非文本内容'
    const latestSequence = Math.max(
      numberValue(unread.session_last_seq ?? chatSession.last_seq),
      latestItem?.sequence ?? 0,
      cached?.latestSequence ?? 0,
    )
    return {
      sourceRef: await this.sealSourceRef(session.userId, kind, uid, displayName),
      kind,
      displayName,
      ...(cached?.avatarRef === undefined ? {} : { avatarRef: cached.avatarRef }),
      ...(cached?.avatarRefs === undefined ? {} : { avatarRefs: cached.avatarRefs }),
      ...(latestPreview === undefined || latestPreview === '' ? {} : { latestPreview }),
      activeAtMillis: Math.max(
        numberValue(bundle.sort_active_at ?? chatSession.last_active_at),
        latestItem?.sendAtMillis ?? 0,
      ),
      unreadCount: Math.max(0, Math.trunc(numberValue(unread.unread_count))),
      isMuted,
      ...(latestSequence > 0 ? { latestSequence } : {}),
    }
  }

  private async chatTimelineItems(
    data: Record<string, unknown>,
    session: ArkmeSessionCredentials,
  ): Promise<ArkmeTimelineItem[]> {
    const items: ArkmeTimelineItem[] = []
    for (const raw of listValue(data.items)) {
      const item = objectValue(raw)
      const relation = objectValue(item.relation)
      const record = objectValue(item.record)
      const payload = objectValue(record.payload)
      const uid = stringValue(relation.record_uid ?? payload.record_uid).trim()
      if (uid === '') continue
      const senderUserId = numberValue(relation.sender_user_id)
      const aiPolish = this.timelineAiPolish(record, payload)
      items.push({
        itemUid: uid,
        senderName: stringValue(relation.display_name_snapshot).trim() || 'Arkme用户',
        ...(senderUserId > 0 ? { avatarRef: await this.sealProfileImageRef(session.userId, senderUserId) } : {}),
        isMe: senderUserId === session.userId,
        sendAtMillis: numberValue(relation.attach_at ?? payload.send_at),
        title: stringValue(payload.title),
        textContent: stringValue(payload.text_content),
        status: numberValue(record.status),
        sequence: numberValue(relation.seq),
        ...(numberValue(record.version ?? payload.version) > 0 ? { recordVersion: numberValue(record.version ?? payload.version) } : {}),
        ...(aiPolish === undefined ? {} : { aiPolish }),
        displayKind: numberValue(payload.display_kind),
        contentBlocks: this.richContentBlocks(item, session.userId),
      })
    }
    return items
  }

  private timelineAiPolish(
    record: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): ArkmeTimelineItem['aiPolish'] | undefined {
    const preview = objectValue(
      payload.ai_polish_preview ?? payload.aiPolishPreview
      ?? record.ai_polish_preview ?? record.aiPolishPreview,
    )
    const originalText = stringValue(preview.original_text ?? preview.originalText)
    const polishedText = stringValue(preview.polished_text ?? preview.polishedText)
    const hasPolish = booleanValue(
      payload.has_polish ?? payload.hasPolish ?? record.has_polish ?? record.hasPolish,
    ) || (originalText !== '' && polishedText !== '')
    if (!hasPolish || originalText === '' || polishedText === '') return undefined
    return { state: 'polished', originalText, polishedText }
  }

  private async queryGroupAiPolishConfig(
    chatSessionUid: string,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeAiPolishConfigSnapshot> {
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/ai-polish/settings/query',
      { chat_session_uid: chatSessionUid },
      session,
      signal,
      {
        lane: 'background-read',
        key: `ai-polish:settings:${chatSessionUid}`,
        cacheMs: 15_000,
        failureCooldownMs: 5_000,
      },
    )
    const config = objectValue(data.config ?? data.setting ?? data.settings ?? data)
    const activeRuleUid = stringValue(config.active_rule_uid).trim()
    const rules = listValue(data.rules).map(raw => objectValue(raw)).map(rule => ({
      ruleUid: stringValue(rule.rule_uid).trim(),
      name: stringValue(rule.name).trim() || '未命名规则',
      ruleText: stringValue(rule.rule_text).trim(),
      ruleVersion: numberValue(rule.rule_version),
    })).filter(rule => rule.ruleUid !== '' && rule.ruleText !== '')
    return {
      enabled: booleanValue(config.enabled ?? config.is_enabled),
      canManage: booleanValue(data.can_manage),
      viewerRole: numberValue(data.viewer_role),
      activeRuleUid,
      activeRuleName: rules.find(rule => rule.ruleUid === activeRuleUid)?.name ?? '',
      updatedAtMillis: numberValue(config.update_at),
      rules,
    }
  }

  private groupAiPolishSnapshot(
    sourceRef: string,
    groupName: string,
    config: ArkmeAiPolishConfigSnapshot,
  ): ArkmeGroupAiPolishSnapshot {
    return {
      sourceRef,
      groupName,
      enabled: config.enabled,
      canManage: config.canManage,
      viewerRole: config.viewerRole,
      activeRuleName: config.activeRuleName,
      rules: config.rules.map(rule => ({
        ruleRef: rule.ruleUid,
        name: rule.name,
        ruleText: rule.ruleText,
        isActive: rule.ruleUid === config.activeRuleUid,
      })),
      updatedAtMillis: config.updatedAtMillis,
    }
  }

  private async queryGroupAiPolishNotices(
    chatSessionUid: string,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeGroupAiPolishNotice[]> {
    const data = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/ai-polish/notices/query',
      { chat_session_uid: chatSessionUid, limit: 100 },
      session,
      signal,
      {
        lane: 'background-read',
        key: `ai-polish:notices:${chatSessionUid}`,
        cacheMs: 15_000,
        failureCooldownMs: 5_000,
      },
    )
    return listValue(data.notices).map(raw => objectValue(raw)).map(notice => {
      const kind = numberValue(notice.notice_kind)
      const rule = stringValue(notice.rule_name).trim() || stringValue(notice.rule_text).trim()
      const actor = compactAiPolishActorLabel(notice.actor_display_name_snapshot)
      return {
        noticeUid: stringValue(notice.notice_uid).trim(),
        sourceKey: stringValue(notice.source_key).trim(),
        message: kind === 1
          ? actor === '' ? `AI润色已开启：${rule}` : `${actor}开启了 AI 润色：${rule}`
          : kind === 2
            ? actor === '' ? `AI润色规则已修改：${rule}` : `${actor}修改了 AI 润色规则：${rule}`
            : '',
        createdAtMillis: numberValue(notice.created_at),
        status: numberValue(notice.status),
      }
    }).filter(notice => notice.noticeUid !== '' && notice.message !== '' && notice.createdAtMillis > 0
      && (notice.status === 0 || notice.status === 1))
      .map(({ status: _status, ...notice }) => notice)
  }

  private async resolveUniqueGroupByName(
    groupName: string,
    signal?: AbortSignal,
  ): Promise<ArkmeSourceItem> {
    const normalized = groupName.trim()
    if (normalized === '') throw new ArkmePluginError('group-name-required', '请提供准确的群名称', false)
    const matches = new Map<string, ArkmeSourceItem>()
    let cursor: string | undefined
    for (let page = 0; page < 20; page += 1) {
      const result = await this.listSources('root', {
        limit: 50,
        ...(cursor === undefined ? {} : { cursor }),
        ...(signal === undefined ? {} : { signal }),
      })
      for (const item of result.items) {
        if (item.kind === 'group_chat' && item.displayName.trim() === normalized) matches.set(item.sourceRef, item)
      }
      if (!result.hasMore || result.nextCursor === undefined) break
      cursor = result.nextCursor
    }
    if (matches.size === 0) {
      throw new ArkmePluginError('group-name-not-found', `没有找到名称为“${normalized}”的群聊，请核对完整群名`, false, 404)
    }
    if (matches.size > 1) {
      throw new ArkmePluginError('group-name-ambiguous', `找到 ${String(matches.size)} 个同名群“${normalized}”，请先在插件界面打开目标群后设置`, false, 409)
    }
    return [...matches.values()][0]!
  }

  private requireAiPolishConfirmation(
    confirmationRef: string,
    userId: number,
    action: 'enable' | 'disable',
  ): ArkmePendingAiPolishConfirmation {
    this.cleanupAiPolishState()
    const normalized = confirmationRef.trim()
    const pending = this.aiPolishConfirmations.get(normalized)
    if (pending === undefined || pending.userId !== userId || pending.action !== action
      || pending.expiresAtMillis <= Date.now()) {
      this.aiPolishConfirmations.delete(normalized)
      throw new ArkmePluginError('group-ai-polish-confirmation-invalid', '确认已失效，请重新生成或读取一次设置', false, 410)
    }
    return pending
  }

  private cleanupAiPolishState(): void {
    const now = Date.now()
    for (const [key, value] of this.aiPolishConfirmations) {
      if (value.expiresAtMillis <= now) this.aiPolishConfirmations.delete(key)
    }
    for (const [key, value] of this.aiPolishRetries) {
      if (value.expiresAtMillis <= now) this.aiPolishRetries.delete(key)
    }
  }

  private aiPolishTextResult(data: Record<string, unknown>): ArkmeAiPolishTextResult {
    return {
      taskUid: stringValue(data.task_uid).trim(),
      attempt: numberValue(data.attempt),
      state: numberValue(data.state),
      action: numberValue(data.action),
      polishedText: stringValue(data.polished_text),
      recordUid: stringValue(data.record_uid ?? data.recordUid).trim(),
      revisionUid: stringValue(data.revision_uid ?? data.revisionUid).trim(),
      ruleUid: stringValue(data.rule_uid).trim(),
      modelVersion: stringValue(data.model_version).trim(),
      promptVersion: stringValue(data.prompt_version).trim(),
      failureMessage: stringValue(data.failure_message).trim(),
      extra: objectValue(data.extra),
    }
  }

  async listWechatConversations(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatConversationPage> {
    const session = await this.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    const scope = 'conversations'
    const offset = await this.wechatOffset(options.cursor, session.userId, scope)
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-conversations/list',
      { limit, offset, include_bound: true },
      session,
      options.signal,
    )
    const conversations = []
    for (const raw of listValue(data.conversations)) {
      const item = objectValue(raw)
      const importSessionKey = stringValue(item.import_session_key).trim()
      if (importSessionKey === '') continue
      const remark = optionalString(item.remark)
      const nickname = optionalString(item.nickname)
      conversations.push({
        conversationRef: await this.sealWechatConversationRef(session.userId, importSessionKey),
        name: optionalString(item.name) ?? remark ?? nickname ?? '未命名微信会话',
        ...(remark === undefined ? {} : { remark }),
        ...(nickname === undefined ? {} : { nickname }),
        isGroup: booleanValue(item.ext_is_group),
        messageCount: numberValue(item.message_count),
        lastSendAtMillis: numberValue(item.last_send_at),
        isBound: numberValue(item.bound_rm_subject_id) > 0
          || stringValue(item.bound_chat_session_uid).trim() !== '',
      })
    }
    const hasMore = data.has_more === true
    const nextOffset = numberValue(data.next_offset) || offset + conversations.length
    return {
      conversations,
      total: numberValue(data.total),
      hasMore,
      ...(hasMore && nextOffset > offset
        ? { nextCursor: await this.sealWechatCursor(session.userId, scope, nextOffset) }
        : {}),
    }
  }

  async readWechatMessages(
    conversationRef: string,
    options: {
      limit?: number
      cursor?: string
      messageType?: ArkmeWechatMessageFilter
      callType?: ArkmeWechatCallFilter
      signal?: AbortSignal
    } = {},
  ): Promise<ArkmeWechatMessagePage> {
    const session = await this.requireSession()
    const conversation = await this.openWechatConversationRef(conversationRef, session.userId)
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 30)))
    const messageType = options.messageType ?? 'all'
    const callType = options.callType ?? 'all'
    if (callType !== 'all' && messageType !== 'call') {
      throw new ArkmePluginError('wechat-call-filter-invalid', '微信通话类型只能与通话消息筛选一起使用', false)
    }
    const scope = `messages:${conversation.importSessionKey}:${messageType}:${callType}`
    const offset = await this.wechatOffset(options.cursor, session.userId, scope)
    const msgType = messageType === 'all' ? undefined : WECHAT_FILTER_TYPES[messageType]
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-conversation-records/list',
      {
        import_session_key: conversation.importSessionKey,
        limit,
        offset,
        ...(msgType === undefined ? {} : { msg_type: msgType }),
        ...(callType === 'all' ? {} : { call_type: callType }),
      },
      session,
      options.signal,
    )
    const messages = listValue(data.records).map(raw => this.wechatMessage(raw))
    const hasMore = data.has_more === true
    const nextOffset = numberValue(data.next_offset) || offset + messages.length
    return {
      conversationRef,
      messages,
      total: numberValue(data.total),
      hasMore,
      ...(hasMore && nextOffset > offset
        ? { nextCursor: await this.sealWechatCursor(session.userId, scope, nextOffset) }
        : {}),
    }
  }

  async getWechatConversationDetail(
    conversationRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatConversationDetail> {
    const session = await this.requireSession()
    const conversation = await this.openWechatConversationRef(conversationRef, session.userId)
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-conversation-detail',
      { import_session_key: conversation.importSessionKey },
      session,
      options.signal,
    )
    const remark = optionalString(data.remark)
    const nickname = optionalString(data.nickname)
    const wechatAlias = optionalString(data.wechat_alias)
    const wechatId = optionalString(data.wechat_id)
    const groupOwnerName = optionalString(data.group_owner_name)
    const firstSendAtMillis = optionalPositiveNumber(data.first_send_at)
    const lastSendAtMillis = optionalPositiveNumber(data.last_send_at)
    const importedAtMillis = optionalPositiveNumber(data.imported_at)
    const commonGroupCount = optionalPositiveNumber(data.common_group_count)
    const groupMemberCount = optionalPositiveNumber(data.group_member_count)
    const groupCommonFriendCount = optionalPositiveNumber(data.group_common_friend_count)
    return {
      conversationRef,
      name: optionalString(data.name) ?? remark ?? nickname ?? '未命名微信会话',
      ...(remark === undefined ? {} : { remark }),
      ...(nickname === undefined ? {} : { nickname }),
      isGroup: booleanValue(data.ext_is_group),
      ...(wechatAlias === undefined ? {} : { wechatAlias }),
      ...(wechatId === undefined ? {} : { wechatId }),
      messageCount: numberValue(data.message_count),
      voiceCount: numberValue(data.voice_count),
      imageCount: numberValue(data.image_count),
      emojiCount: numberValue(data.emoji_count),
      videoCount: numberValue(data.video_count),
      ...(firstSendAtMillis === undefined ? {} : { firstSendAtMillis }),
      ...(lastSendAtMillis === undefined ? {} : { lastSendAtMillis }),
      ...(importedAtMillis === undefined ? {} : { importedAtMillis }),
      ...(commonGroupCount === undefined ? {} : { commonGroupCount }),
      ...(groupOwnerName === undefined ? {} : { groupOwnerName }),
      ...(groupMemberCount === undefined ? {} : { groupMemberCount }),
      ...(groupCommonFriendCount === undefined ? {} : { groupCommonFriendCount }),
    }
  }

  async listWechatGroupMembers(
    conversationRef: string,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatGroupMemberPage> {
    const session = await this.requireSession()
    const conversation = await this.openWechatConversationRef(conversationRef, session.userId)
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 50)))
    const scope = `group-members:${conversation.importSessionKey}`
    const offset = await this.wechatOffset(options.cursor, session.userId, scope)
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-group-members/list',
      { import_session_key: conversation.importSessionKey },
      session,
      options.signal,
    )
    const members = [
      ...listValue(data.members).map(raw => this.wechatGroupMember(raw, true)),
      ...listValue(data.inactive_speakers).map(raw => this.wechatGroupMember(raw, false)),
    ]
    const page = members.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    const hasMore = nextOffset < members.length
    return {
      conversationRef,
      members: page,
      total: numberValue(data.total_speakers) || members.length,
      hasMore,
      ...(hasMore ? { nextCursor: await this.sealWechatCursor(session.userId, scope, nextOffset) } : {}),
    }
  }

  async listWechatPhones(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatPhonePage> {
    const session = await this.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))
    const scope = 'phones'
    const offset = await this.wechatOffset(options.cursor, session.userId, scope)
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-phones/list',
      { limit, offset },
      session,
      options.signal,
    )
    const phones = listValue(data.phones).map(raw => {
      const item = objectValue(raw)
      const likelyOwner = optionalString(item.likely_owner)
      const reason = optionalString(clippedText(item.reason, 500))
      const registeredNickname = optionalString(item.registered_nick_name)
      const location = optionalString(item.phone_location_label)
      const taskStatus = optionalString(item.task_status)
      const evidence = listValue(item.evidence).slice(0, 2).map(rawEvidence => {
        const value = objectValue(rawEvidence)
        const why = optionalString(clippedText(value.why, 200))
        const content = optionalString(clippedText(value.content, 500))
        const sentAtMillis = optionalPositiveNumber(value.send_at)
        return {
          ...(why === undefined ? {} : { why }),
          ...(content === undefined ? {} : { content }),
          ...(sentAtMillis === undefined ? {} : { sentAtMillis }),
        }
      })
      return {
        phone: stringValue(item.phone).trim(),
        ...(likelyOwner === undefined ? {} : { likelyOwner }),
        ...(typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? { confidence: item.confidence }
          : {}),
        ...(reason === undefined ? {} : { reason }),
        occurrenceCount: numberValue(item.record_count),
        lastSeenAtMillis: numberValue(item.last_send_at),
        evidence,
        isRegistered: booleanValue(item.is_registered),
        ...(registeredNickname === undefined ? {} : { registeredNickname }),
        ...(location === undefined ? {} : { location }),
        ...(taskStatus === undefined ? {} : { taskStatus }),
      }
    }).filter(item => item.phone !== '')
    const hasMore = data.has_more === true
    const nextOffset = numberValue(data.next_offset) || offset + phones.length
    return {
      phones,
      total: numberValue(data.total),
      hasMore,
      ...(hasMore && nextOffset > offset
        ? { nextCursor: await this.sealWechatCursor(session.userId, scope, nextOffset) }
        : {}),
    }
  }

  async listWechatCommonGroups(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatCommonGroupPage> {
    const session = await this.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))
    const scope = 'common-groups'
    const offset = await this.wechatOffset(options.cursor, session.userId, scope)
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-common-groups/list',
      { limit, offset },
      session,
      options.signal,
    )
    const friends = []
    for (const raw of listValue(data.friends)) {
      const item = objectValue(raw)
      const sampleConversationRefs = await Promise.all(listValue(item.sample_group_keys)
        .map(key => stringValue(key).trim())
        .filter(key => key !== '')
        .map(key => this.sealWechatConversationRef(session.userId, key)))
      const lastSendAtMillis = optionalPositiveNumber(item.last_send_at)
      friends.push({
        name: optionalString(item.name) ?? '未命名微信联系人',
        commonGroupCount: numberValue(item.common_group_count),
        ...(lastSendAtMillis === undefined ? {} : { lastSendAtMillis }),
        sampleConversationRefs,
      })
    }
    const hasMore = data.has_more === true
    const nextOffset = numberValue(data.next_offset) || offset + friends.length
    return {
      friends,
      total: numberValue(data.total),
      hasMore,
      ...(hasMore && nextOffset > offset
        ? { nextCursor: await this.sealWechatCursor(session.userId, scope, nextOffset) }
        : {}),
    }
  }

  async listWechatMoneyFlows(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatMoneyFlowPage> {
    const session = await this.requireSession()
    const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? 20)))
    const scope = 'money-flows'
    const offset = await this.wechatOffset(options.cursor, session.userId, scope)
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-money-flows/list',
      { limit, offset },
      session,
      options.signal,
    )
    const moneyFlows: ArkmeWechatMoneyFlow[] = []
    for (const raw of listValue(data.records)) {
      const item = objectValue(raw)
      const importSessionKey = stringValue(item.import_session_key).trim()
      moneyFlows.push({
        ...(importSessionKey === '' ? {} : {
          conversationRef: await this.sealWechatConversationRef(session.userId, importSessionKey),
        }),
        content: clippedText(item.content, 1_500),
        senderName: optionalString(item.sender_display_name) ?? (booleanValue(item.sender_is_self) ? '我' : '未知发送者'),
        isMe: booleanValue(item.sender_is_self),
        sentAtMillis: numberValue(item.send_at ?? item.created_at),
      })
    }
    const hasMore = data.has_more === true
    const nextOffset = numberValue(data.next_offset) || offset + moneyFlows.length
    return {
      moneyFlows,
      total: numberValue(data.total),
      hasMore,
      ...(hasMore && nextOffset > offset
        ? { nextCursor: await this.sealWechatCursor(session.userId, scope, nextOffset) }
        : {}),
    }
  }

  async listWechatLocations(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatLocationPage> {
    const session = await this.requireSession()
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 30)))
    const scope = 'locations'
    const offset = await this.wechatOffset(options.cursor, session.userId, scope)
    const data = await this.authenticatedRelationPost<Record<string, unknown>>(
      '/api/v1/entity/wechat-import-location-entries',
      {},
      session,
      options.signal,
    )
    const locations: ArkmeWechatLocation[] = []
    for (const raw of listValue(data.entry_ls)) {
      const item = objectValue(raw)
      const conversation = objectValue(item.conversation)
      const importSessionKey = stringValue(item.import_session_key ?? conversation.import_session_key).trim()
      const poiName = optionalString(item.poi_name)
      const address = optionalString(item.address)
      const senderName = optionalString(item.sender_display_name)
      const sentAtMillis = optionalPositiveNumber(item.send_at)
      locations.push({
        ...(importSessionKey === '' ? {} : {
          conversationRef: await this.sealWechatConversationRef(session.userId, importSessionKey),
        }),
        conversationName: optionalString(conversation.name) ?? '未命名微信会话',
        entryType: optionalString(item.entry_type) ?? 'location',
        latitude: numberValue(item.lat),
        longitude: numberValue(item.lon),
        ...(poiName === undefined ? {} : { poiName }),
        ...(address === undefined ? {} : { address }),
        ...(senderName === undefined ? {} : { senderName }),
        isMe: booleanValue(item.sender_is_self),
        ...(sentAtMillis === undefined ? {} : { sentAtMillis }),
      })
    }
    const page = locations.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    const hasMore = nextOffset < locations.length
    return {
      locations: page,
      total: locations.length,
      hasMore,
      ...(hasMore ? { nextCursor: await this.sealWechatCursor(session.userId, scope, nextOffset) } : {}),
    }
  }

  private wechatMessage(raw: unknown): ArkmeWechatMessage {
    const item = objectValue(raw)
    const msgType = numberValue(item.msg_type)
    const mediaDuration = optionalPositiveNumber(item.media_duration)
    const mimeType = optionalString(item.mime_type)
    const isMe = booleanValue(item.sender_is_self)
    return {
      content: clippedText(item.content, 1_500),
      senderName: optionalString(item.sender_display_name) ?? (isMe ? '我' : '未知发送者'),
      isMe,
      sentAtMillis: numberValue(item.send_at ?? item.created_at),
      messageType: WECHAT_MESSAGE_TYPES[msgType] ?? `other_${String(msgType)}`,
      hasMedia: stringValue(item.oss_key).trim() !== '' || stringValue(item.media_path).trim() !== '',
      ...(mediaDuration === undefined ? {} : { mediaDuration }),
      ...(mimeType === undefined ? {} : { mimeType }),
    }
  }

  private wechatGroupMember(raw: unknown, defaultIsInGroup: boolean): ArkmeWechatGroupMember {
    const item = objectValue(raw)
    const lastSendAtMillis = optionalPositiveNumber(item.last_send_at)
    return {
      name: optionalString(item.name) ?? '未命名群成员',
      messageCount: numberValue(item.message_count),
      ...(lastSendAtMillis === undefined ? {} : { lastSendAtMillis }),
      isOwner: booleanValue(item.is_owner),
      isFriend: booleanValue(item.is_friend),
      isMe: booleanValue(item.is_self),
      isInGroup: item.is_in_group === undefined ? defaultIsInGroup : booleanValue(item.is_in_group),
    }
  }

  private async hydrateSourceAvatars(
    items: ArkmeSourceItem[],
    privateUserIdByIndex: ReadonlyMap<number, number>,
    groupSessionUidByIndex: ReadonlyMap<number, string>,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<void> {
    const groupMemberIdsByIndex = new Map<number, number[]>()
    const indexByGroupUid = new Map([...groupSessionUidByIndex].map(([index, uid]) => [uid, index]))
    const missingGroupUids: string[] = []
    const now = Date.now()
    for (const [uid, index] of indexByGroupUid) {
      const cacheKey = `${String(session.userId)}:${uid}`
      const cached = this.groupAvatarSnapshotCache.get(cacheKey)
      if (cached === undefined || cached.expiresAtMillis <= now) {
        if (cached !== undefined) this.groupAvatarSnapshotCache.delete(cacheKey)
        missingGroupUids.push(uid)
        continue
      }
      if (cached.value !== null && cached.value.length > 0) groupMemberIdsByIndex.set(index, [...cached.value])
    }
    for (const groupUids of chunksOf(missingGroupUids, 10)) {
      let data: Record<string, unknown>
      try {
        data = await this.authenticatedChatPost<Record<string, unknown>>(
          '/api/v1/chats/group-avatar-snapshots',
          { chat_session_uids: groupUids },
          session,
          signal,
          {
            lane: 'background-read',
            key: `group-avatar:${[...groupUids].sort().join('|')}`,
            failureCooldownMs: 5_000,
          },
        )
      } catch {
        continue
      }
      const membersByUid = new Map<string, number[]>()
      for (const raw of listValue(data.items)) {
        const snapshot = objectValue(raw)
        const uid = stringValue(snapshot.chat_session_uid).trim()
        const index = indexByGroupUid.get(uid)
        if (index === undefined || !groupUids.includes(uid)) continue
        const memberIds = listValue(snapshot.members)
          .map(member => numberValue(objectValue(member).user_id))
          .filter(userId => Number.isSafeInteger(userId) && userId > 0)
          .slice(0, 4)
        membersByUid.set(uid, memberIds)
        if (memberIds.length > 0) groupMemberIdsByIndex.set(index, memberIds)
      }
      for (const uid of groupUids) {
        const memberIds = membersByUid.get(uid) ?? null
        this.groupAvatarSnapshotCache.set(`${String(session.userId)}:${uid}`, {
          value: memberIds,
          expiresAtMillis: Date.now() + (memberIds === null
            ? GROUP_AVATAR_NEGATIVE_CACHE_TTL_MS
            : GROUP_AVATAR_CACHE_TTL_MS),
        })
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

  private dshBetaCommunityStatus(value: unknown): ArkmeDSHBetaCommunityStatus {
    if (value === 'ready' || value === 'already_member' || value === 'joined') return value
    throw new ArkmePluginError(
      'dsh-beta-community-contract-invalid',
      'DSH 内测群状态响应无效',
      true,
      502,
    )
  }

  private async publicProfileSummariesByUserIds(
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
      const data = await this.authenticatedAuthPost<Record<string, unknown>>(
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
        const arkmeId = stringValue(item.name_slug ?? item.arkme_id).trim()
        const avatarUrl = stringValue(item.head_img).trim()
        let trustedAvatarUrl: string | undefined
        if (avatarUrl !== '') {
          try {
            trustedSignedImageUrl(this.config.environment, avatarUrl)
            trustedAvatarUrl = avatarUrl
          } catch {
            trustedAvatarUrl = undefined
          }
        }
        profiles.set(userId, {
          userId,
          displayName: displayName || `用户 ${String(userId)}`,
          ...(trustedAvatarUrl === undefined ? {} : { avatarUrl: trustedAvatarUrl }),
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

  private async publicProfilesByUserIds(
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

  private async interwovenProfilesByUserIds(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Map<number, { displayName: string; hasAvatar: boolean }>> {
    const normalized = [...new Set(userIds.filter(userId => Number.isSafeInteger(userId) && userId > 0))]
    const profiles = new Map<number, { displayName: string; hasAvatar: boolean }>()
    for (const batch of chunksOf(normalized, 100)) {
      if (batch.length === 0) continue
      const data = await this.authenticatedAuthPost<Record<string, unknown>>(
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
            trustedSignedImageUrl(this.config.environment, avatarUrl)
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

  private async assertHumanPrivateSource(
    source: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<number> {
    const detail = await this.authenticatedChatPost<Record<string, unknown>>(
      '/api/v1/chats/detail', { chat_session_uid: source.ownerRef }, session, signal,
    )
    const chatSession = objectValue(detail.session)
    const counterpart = objectValue(detail.private_counterpart)
    const counterpartUserId = Math.trunc(numberValue(counterpart.user_id))
    if (stringValue(chatSession.chat_session_uid).trim() !== source.ownerRef
      || numberValue(chatSession.session_kind) !== 1
      || !Number.isSafeInteger(counterpartUserId) || counterpartUserId <= 0
      || counterpartUserId === session.userId) {
      throw new ArkmePluginError('interwoven-source-invalid', '交织瞬间仅支持有效的双人私聊', false, 409)
    }
    return counterpartUserId
  }

  private async resolveLegacyPrivateSubjectId(
    counterpartUserId: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<number> {
    const data = await this.authenticatedSubjectPost<Record<string, unknown>>(
      '/api/v1/private/check-contact-chat',
      { target_user_id: counterpartUserId },
      session,
      signal,
    )
    if (!booleanValue(data.exist)) return 0
    const rmSubjectId = Math.trunc(numberValue(data.rm_subject_id))
    if (!Number.isSafeInteger(rmSubjectId) || rmSubjectId <= 0) {
      throw new ArkmePluginError(
        'interwoven-subject-contract-invalid',
        '私聊交织主题定位响应不完整',
        true,
        502,
      )
    }
    return rmSubjectId
  }

  private isUnsupportedInterwovenWorldRoute(error: unknown): boolean {
    return error instanceof ArkmePluginError
      && ((error.code === 'arkme-http-error' && error.upstreamStatus === 404)
        || error.code === 'arkme-code-404')
  }

  private async interwovenStableMomentId(rawMomentId: string): Promise<string> {
    return `arkme-moment-${createHmac('sha256', await this.stateStore.uniqueCode())
      .update(`interwoven:${rawMomentId}`).digest('base64url').slice(0, 32)}`
  }

  private async sealInterwovenMomentRef(
    reference: Omit<ArkmeInterwovenMomentReference, 'expiresAtMillis'>,
  ): Promise<string> {
    const now = Date.now()
    for (const [key, value] of this.interwovenMomentReferences) {
      if (value.expiresAtMillis <= now) this.interwovenMomentReferences.delete(key)
    }
    while (this.interwovenMomentReferences.size >= 1000) {
      const oldest = this.interwovenMomentReferences.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.interwovenMomentReferences.delete(oldest)
    }
    const nonce = crypto.randomUUID()
    const signature = createHmac('sha256', await this.stateStore.uniqueCode()).update(nonce).digest('base64url')
    this.interwovenMomentReferences.set(nonce, { ...reference, expiresAtMillis: now + 12 * 60 * 60 * 1000 })
    return `arkme-moment-v1.${nonce}.${signature}`
  }

  private async openInterwovenMomentRef(
    momentRef: string,
    expectedUserId: number,
    expectedSourceOwnerRef: string,
  ): Promise<ArkmeInterwovenMomentReference> {
    const parts = momentRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-moment-v1') {
      throw new ArkmePluginError('interwoven-ref-invalid', '交织瞬间引用无效，请刷新会话后重试', false, 400)
    }
    const nonce = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.stateStore.uniqueCode()).update(nonce).digest()
    if (nonce === '' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('interwoven-ref-invalid', '交织瞬间引用无效，请刷新会话后重试', false, 400)
    }
    const reference = this.interwovenMomentReferences.get(nonce)
    if (reference === undefined || reference.expiresAtMillis <= Date.now()) {
      this.interwovenMomentReferences.delete(nonce)
      throw new ArkmePluginError('interwoven-ref-expired', '交织瞬间引用已过期，请刷新会话后重试', true, 410)
    }
    if (reference.userId !== expectedUserId || reference.sourceOwnerRef !== expectedSourceOwnerRef) {
      throw new ArkmePluginError('interwoven-ref-invalid', '交织瞬间引用与当前会话不匹配', false, 403)
    }
    return reference
  }

  private async sealProfileImageRef(viewerUserId: number, targetUserId: number): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, viewerUserId, targetUserId } satisfies ArkmeProfileImageRefPayload)
    const signature = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-profile-image-v1.${payload}.${signature}`
  }

  private async openProfileImageRef(
    imageRef: string,
    expectedViewerUserId: number,
  ): Promise<ArkmeProfileImageRefPayload> {
    const parts = imageRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-profile-image-v1') {
      throw new ArkmePluginError('image-ref-invalid', 'Arkme头像引用无效', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest()
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

  private cachedImage(cacheKey: string): ArkmeImageBytes | undefined {
    const cached = this.imageCache.get(cacheKey)
    if (cached === undefined) return undefined
    if (cached.expiresAtMillis <= Date.now()) {
      this.imageCache.delete(cacheKey)
      this.imageCacheBytes = Math.max(0, this.imageCacheBytes - cached.value.bytes)
      return undefined
    }
    this.imageCache.delete(cacheKey)
    this.imageCache.set(cacheKey, cached)
    return cloneImageBytes(cached.value)
  }

  private cacheImage(cacheKey: string, value: ArkmeImageBytes): void {
    const previous = this.imageCache.get(cacheKey)
    if (previous !== undefined) this.imageCacheBytes = Math.max(0, this.imageCacheBytes - previous.value.bytes)
    const cached = cloneImageBytes(value)
    this.imageCache.delete(cacheKey)
    this.imageCache.set(cacheKey, { value: cached, expiresAtMillis: Date.now() + IMAGE_CACHE_TTL_MS })
    this.imageCacheBytes += cached.bytes
    while (this.imageCache.size > IMAGE_CACHE_MAX_ENTRIES || this.imageCacheBytes > IMAGE_CACHE_MAX_BYTES) {
      const oldestKey = this.imageCache.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      const oldest = this.imageCache.get(oldestKey)
      this.imageCache.delete(oldestKey)
      if (oldest !== undefined) this.imageCacheBytes = Math.max(0, this.imageCacheBytes - oldest.value.bytes)
    }
  }

  private async withImageDownloadPermit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeImageDownloads >= IMAGE_DOWNLOAD_CONCURRENCY) {
      await new Promise<void>(resolve => { this.imageDownloadWaiters.push(resolve) })
    }
    this.activeImageDownloads += 1
    try {
      return await operation()
    } finally {
      this.activeImageDownloads = Math.max(0, this.activeImageDownloads - 1)
      this.imageDownloadWaiters.shift()?.()
    }
  }

  /** Resolve and download one Provider-authorized Arkme image without exposing OSS credentials or signed URLs. */
  async readImage(
    imageRef: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeImageBytes> {
    const session = await this.requireSession()
    const byteLimit = Math.min(MAX_ARKME_IMAGE_BYTES, Math.max(1, Math.trunc(options.maxBytes ?? MAX_ARKME_IMAGE_BYTES)))
    const cacheKey = `${String(session.userId)}:${String(byteLimit)}:${imageRef.trim()}`
    const cached = this.cachedImage(cacheKey)
    if (cached !== undefined) return cached
    const existing = this.imageInFlight.get(cacheKey)
    if (existing !== undefined) return cloneImageBytes(await existing)
    const pending = this.withImageDownloadPermit(
      async () => await this.readImageUncached(session, imageRef, byteLimit, options.signal),
    )
    this.imageInFlight.set(cacheKey, pending)
    try {
      const value = await pending
      this.cacheImage(cacheKey, value)
      return cloneImageBytes(value)
    } finally {
      if (this.imageInFlight.get(cacheKey) === pending) this.imageInFlight.delete(cacheKey)
    }
  }

  private async readImageUncached(
    session: ArkmeSessionCredentials,
    imageRef: string,
    byteLimit: number,
    signal?: AbortSignal,
  ): Promise<ArkmeImageBytes> {
    if (imageRef.trim().startsWith('arkme-profile-image-v1.')) {
      const reference = await this.openProfileImageRef(imageRef, session.userId)
      if (reference.targetUserId === session.userId) {
        let snapshot = await this.stateStore.cachedProfile(session.userId)
        if ((snapshot.profile?.avatarRef.trim() ?? '') === '') {
          try {
            snapshot = await this.refreshProfileForSession(session)
          } catch {
            // A missing current-user profile may still fall back to the public profile below.
          }
        }
        const ownAvatarRef = snapshot.profile?.avatarRef.trim() ?? ''
        if (ownAvatarRef !== '' && !ownAvatarRef.startsWith('arkme-profile-image-v1.')) {
          return await this.readImage(ownAvatarRef, {
            maxBytes: byteLimit,
            ...(signal === undefined ? {} : { signal }),
          })
        }
      }
      const profile = (await this.publicProfilesByUserIds([reference.targetUserId], session, signal))
        .get(reference.targetUserId)
      if (profile === undefined) {
        throw new ArkmePluginError('image-ref-unavailable', 'Arkme头像当前不可用', true, 404)
      }
      const avatarUrl = profile.avatarUrl
      if (avatarUrl === undefined) {
        throw new ArkmePluginError('image-ref-unavailable', 'Arkme头像当前不可用', true, 404)
      }
      return await this.downloadSignedImage(
        trustedSignedImageUrl(this.config.environment, avatarUrl), byteLimit, signal, this.requestScope(session.userId),
      )
    }
    const fileId = imageFileIdFromRef(imageRef, session.userId)
    const objectPath = `${md5Text(String(session.userId))}/${String(session.userId)}/${fileId}`
    const credentials = await this.ossCredentials(session, signal)
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
          const refreshed = await this.ossCredentials(await this.requireSession(), signal)
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
      throw new ArkmePluginError('image-sign-failed', 'Arkme 图片授权签名失败', true, 502, { cause: error })
    }
    let signedUrl: URL
    try {
      signedUrl = new URL(signedUrlText)
    } catch (error) {
      throw new ArkmePluginError('image-sign-contract-invalid', 'Arkme 图片授权响应无效', true, 502, { cause: error })
    }
    let signedPath: string
    try {
      signedPath = decodeURIComponent(signedUrl.pathname).replace(/^\/+/, '')
    } catch (error) {
      throw new ArkmePluginError('image-sign-contract-invalid', 'Arkme 图片授权路径无效', true, 502, { cause: error })
    }
    if (signedUrl.protocol !== 'https:' || signedUrl.username !== '' || signedUrl.password !== ''
      || !allowedSignedImageHost(this.config.environment, signedUrl.hostname) || signedPath !== objectPath) {
      throw new ArkmePluginError('image-sign-target-rejected', 'Arkme 图片授权目标不受信任', false, 502)
    }
    return await this.downloadSignedImage(signedUrl, byteLimit, signal, this.requestScope(session.userId))
  }

  async beginWechatLogin(): Promise<ArkmeAuthSnapshot> {
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
      throw new ArkmePluginError(
        'wechat-qr-unavailable',
        '测试环境当前未返回可用微信二维码，请使用手机号登录',
        true,
        503,
      )
    }
    if (sceneStr === '' || qrContent === '') {
      throw new ArkmePluginError('login-contract-invalid', 'Arkme 登录二维码响应不完整', true, 502)
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

  async pollWechatLogin(attemptId: string): Promise<ArkmeAuthSnapshot> {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) {
      throw new ArkmePluginError('login-attempt-not-found', '登录二维码已失效，请重新获取', false, 404)
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
      throw new ArkmePluginError('login-contract-invalid', 'Arkme 登录成功响应缺少凭据', false, 502)
    }
    const session = { accessToken, refreshToken, userId }
    this.attempts.delete(attemptId)
    return await this.acceptLoginSession(session)
  }

  async testLogin(userId: number): Promise<ArkmeAuthSnapshot> {
    if (this.config.environment !== 'test') {
      throw new ArkmePluginError('test-login-disabled', '测试账号登录仅允许测试环境使用', false, 403)
    }
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new ArkmePluginError('test-user-id-invalid', '请输入有效的测试账号 user_id', false)
    }
    const data = await this.post<TestLoginResponse>(
      this.config.authBaseUrl,
      '/api/public/v1/auth/the-best-api-for-testing',
      {
        user_id: userId,
        unique_code: await this.stateStore.uniqueCode(),
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

  async sendPhoneCode(phone: string, captcha: ArkmeCaptchaResult): Promise<{ sent: true }> {
    const normalizedPhone = this.normalizedPhone(phone)
    const normalizedCaptcha = this.normalizedCaptcha(captcha)
    const session = await this.sessionStore.read() ?? await this.readPendingBindingSession()
    if (session !== undefined) {
      const data = await this.post<BindPhoneResponse>(
        this.config.authBaseUrl,
        '/api/v1/auth/bind-phone-send-code',
        { phone: normalizedPhone, pre: '86', is_test: this.config.environment === 'test', ...normalizedCaptcha },
        session.accessToken,
        [200],
      )
      const result = numberValue(data.result)
      if (result === ARKME_PHONE_BIND_REPEAT) {
        throw new ArkmePluginError('phone-already-bound', '该手机号已绑定其他 Arkme 账号', false, 409)
      }
      return { sent: true }
    }
    await this.post<Record<string, unknown>>(
      this.config.authBaseUrl,
      '/api/public/v1/auth/phone-login-send-code',
      { phone: normalizedPhone, pre: '86', is_test: this.config.environment === 'test', ...normalizedCaptcha },
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
    const session = await this.sessionStore.read() ?? await this.readPendingBindingSession()
    if (session !== undefined) {
      const data = await this.post<BindPhoneResponse>(
        this.config.authBaseUrl,
        '/api/v1/auth/verify-bind-phone',
        {
          phone: normalizedPhone,
          pre: '86',
          code: normalizedCode,
          is_test: this.config.environment === 'test',
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

  async logout(): Promise<ArkmeAuthSnapshot> {
    const activeSession = await this.sessionStore.read()
    const pendingSession = await this.readPendingBindingSession()
    for (const userId of new Set([activeSession?.userId, pendingSession?.userId])) {
      if (userId !== undefined) {
        this.outgoingCallBroker.clearUser(userId, '账号已退出，呼叫已取消')
        this.requestCoordinator.invalidateScope(this.requestScope(userId))
        this.refreshInFlightByUserId.delete(userId)
      }
    }
    await this.sessionStore.delete()
    await this.clearPendingBindingSession()
    this.profileCache.clear()
    this.profileInFlight.clear()
    this.sourceListCache.clear()
    this.sourceListInFlight.clear()
    this.publicProfileCache.clear()
    this.groupAvatarSnapshotCache.clear()
    this.imageCache.clear()
    this.imageInFlight.clear()
    this.imageCacheBytes = 0
    this.chatRealtime.reconnect()
    this.attempts.clear()
    this.aiPolishConfirmations.clear()
    this.aiPolishRetries.clear()
    this.interwovenMomentReferences.clear()
    this.mediaRefs.clear()
    return { status: 'logged-out', environment: this.config.environment }
  }

  async cachedSnapshot(): Promise<ArkmeCachedSnapshot> {
    const session = await this.requireSession()
    return await this.stateStore.cachedSnapshot(session.userId)
  }

  async queryCached(options: {
    query?: string
    limit: number
    beforeMillis?: number
  }): Promise<ArkmeCachedQueryResult> {
    const session = await this.requireSession()
    return await this.stateStore.queryCached(session.userId, options)
  }

  async refreshLatest(): Promise<void> {
    await Promise.all([this.summary(), this.list(50)])
  }

  async refreshSnapshot(): Promise<ArkmeCachedSnapshot> {
    await this.refreshLatest()
    return await this.cachedSnapshot()
  }

  async searchRecords(options: {
    query: string
    limit: number
    beforeMillis?: number
    syncAll?: boolean
    signal?: AbortSignal
  }): Promise<ArkmeCachedQueryResult> {
    const query = options.query.trim()
    if (query === '') throw new ArkmePluginError('record-query-empty', '搜索关键词不能为空', false)
    if (options.syncAll === true) await this.syncHistory(20, options.signal)
    return await this.queryCached({
      query,
      limit: options.limit,
      ...(options.beforeMillis === undefined ? {} : { beforeMillis: options.beforeMillis }),
    })
  }

  async searchRemote(options: {
    query: string
    limit: number
    cursor?: string
    searchScope?: 'global' | 'topic' | 'chat_session'
    sourceUid?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult> {
    const query = options.query.trim()
    if (query === '') throw new ArkmePluginError('record-query-empty', '搜索关键词不能为空', false)
    const session = await this.requireSession()
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/records/query',
      {
        keyword: query,
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        search_scope: options.searchScope ?? 'global',
        source_kinds: [1, 2, 3],
        ...(options.sourceUid?.trim() ? { source_uid: options.sourceUid.trim() } : {}),
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
      },
      session,
      options.signal,
    )
    return this.recordSearchResult(data)
  }

  async searchHistory(limit = 10): Promise<ArkmeSearchHistoryResult> {
    const session = await this.requireSession()
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/history/list',
      { limit: Math.min(20, Math.max(1, Math.trunc(limit))) },
      session,
    )
    return {
      items: listValue(data.items).map(raw => {
        const item = objectValue(raw)
        return {
          searchHistoryUid: stringValue(item.search_history_uid).trim(),
          keyword: stringValue(item.keyword).trim(),
          searchedAtMillis: numberValue(item.searched_at ?? item.created_at),
        }
      }).filter(item => item.keyword !== ''),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
    }
  }

  async createSearchHistory(keyword: string): Promise<void> {
    const normalized = keyword.trim()
    if (normalized === '') return
    const session = await this.requireSession()
    await this.authenticatedPost(
      '/api/v1/search/history/create',
      {
        client_event_uid: `dsh-${randomUUID()}`,
        keyword: normalized,
        searched_at: Date.now(),
        stay_sec: 0,
        client_name: 'DSH',
      },
      session,
    )
  }

  async searchScene(options: {
    scene: ArkmeSearchSceneKind
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult> {
    const sceneKinds: Record<ArkmeSearchSceneKind, number> = {
      audio: 1,
      link: 2,
      image_video: 3,
      file: 4,
      long_article: 5,
    }
    if (sceneKinds[options.scene] === undefined) {
      throw new ArkmePluginError('search-scene-invalid', '快速查找类型无效', false)
    }
    const session = await this.requireSession()
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/records/scene/query',
      {
        scene_kind: sceneKinds[options.scene],
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        search_scope: 'global',
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
      },
      session,
      options.signal,
    )
    return this.recordSearchResult(data)
  }

  async searchRecordings(options: {
    query: string
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordingSearchResult> {
    const query = options.query.trim()
    if (query === '') throw new ArkmePluginError('recording-query-empty', '搜索关键词不能为空', false)
    const session = await this.requireSession()
    const data = await this.authenticatedPost<Record<string, unknown>>(
      '/api/v1/search/recordings/query',
      {
        keyword: query,
        limit: Math.min(50, Math.max(1, Math.trunc(options.limit))),
        ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
      },
      session,
      options.signal,
    )
    const guard = objectValue(data.query_guard)
    return {
      items: listValue(data.items).map(raw => {
        const item = objectValue(raw)
        return {
          sessionId: stringValue(item.session_id).trim(),
          ...(stringValue(item.record_uid).trim() === '' ? {} : { recordUid: stringValue(item.record_uid).trim() }),
          dateStamp: numberValue(item.date_stamp),
          startAtMillis: numberValue(item.start_at),
          snippet: clippedText(item.snippet, 1_000),
          score: numberValue(item.score),
        }
      }).filter(item => item.sessionId !== '' && item.snippet !== ''),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
      queryGuard: {
        state: stringValue(guard.state).trim() || 'complete',
        ...(stringValue(guard.reason).trim() === '' ? {} : { reason: stringValue(guard.reason).trim() }),
      },
    }
  }

  async syncHistory(maxPages = 20, signal?: AbortSignal): Promise<{ pages: number; complete: boolean }> {
    const pageCap = Math.min(20, Math.max(1, Math.trunc(maxPages)))
    await this.refreshLatest()
    let snapshot = await this.cachedSnapshot()
    let pages = 0
    while (snapshot.hasMore && snapshot.nextCursor !== undefined && pages < pageCap) {
      if (signal?.aborted === true) throw new Error('Arkme历史同步已取消')
      await this.list(50, snapshot.nextCursor)
      pages += 1
      snapshot = await this.cachedSnapshot()
    }
    return { pages, complete: !snapshot.hasMore }
  }

  async summary(): Promise<ArkmeSelfSummary> {
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

  async list(limit: number, cursor?: ArkmeRecordCursor): Promise<ArkmeSelfRecordList> {
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
    const rawItems = listValue(data.items)
    const media = await this.hydrateRecordMediaPage(rawItems, session)
    const items = rawItems.map(raw => {
      const recordUid = this.recordUid(raw)
      const displayItems = media.displayItemsByRecordUid.get(recordUid)
      return this.recordItem(raw, session.userId, {
        ...(displayItems === undefined ? {} : { displayItems }),
        mediaUnavailable: media.unavailableRecordUids.has(recordUid),
      })
    }).filter(
      (item): item is ArkmeSelfRecordItem => item !== undefined,
    )
    const nextSendAt = numberValue(data.next_cursor_send_at)
    const nextUid = stringValue(data.next_cursor_record_uid)
    const page: ArkmeSelfRecordList = {
      items,
      hasMore: data.has_more === true,
      ...(nextSendAt > 0 && nextUid !== ''
        ? { nextCursor: { sendAtMillis: nextSendAt, recordUid: nextUid } }
        : {}),
    }
    await this.stateStore.cachePage(session.userId, page, cursor)
    return page
  }

  async listWorldRecords(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldRecordList> {
    const limit = Math.min(20, Math.max(1, Math.trunc(options.limit ?? 10)))
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    const data = await this.post<Record<string, unknown>>(
      this.config.worldBaseUrl, '/api/public/v1/public-record/world-list',
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
    if (normalizedText.length > this.config.maxTextLength) {
      throw new ArkmePluginError('world-text-too-long', `内容不能超过 ${this.config.maxTextLength} 个字符`, false)
    }
    let profile: ArkmeUserProfile
    try {
      const snapshot = await this.refreshProfile()
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
    const recordResult = await this.createTextForConversation(normalizedUid, normalizedText)
    if (recordResult.localState !== 'synced') {
      return {
        recordSaved: true, recordState: 'pending', worldPublished: false,
        visibility: 'not_published', checkStatus: 0, retryable: true,
        ...(recordResult.error === undefined ? {} : { error: recordResult.error }),
      }
    }
    try {
      const published = await this.authenticatedWorldPost<Record<string, unknown>>(
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
      return { recordSaved: true, recordState: 'synced', worldPublished: true, visibility: worldVisibility(checkStatus), checkStatus, retryable: false }
    } catch (error) {
      try {
        if (await this.worldRecordIsPublic(normalizedUid, signal)) {
          return { recordSaved: true, recordState: 'synced', worldPublished: true, visibility: 'unknown', checkStatus: 0, retryable: false }
        }
      } catch { /* Preserve the original publication failure. */ }
      return this.worldPublishFailure(true, error, 'synced')
    }
  }

  async createText(recordUid: string, textContent: string): Promise<ArkmeCreateTextResult> {
    const session = await this.requireSession()
    const normalizedUid = recordUid.trim()
    const normalizedText = textContent.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUid)) {
      throw new ArkmePluginError('record-uid-invalid', '写入标识无效，请重试', false)
    }
    if (normalizedText === '') {
      throw new ArkmePluginError('record-text-empty', '请输入要发给自己的内容', false)
    }
    if (normalizedText.length > this.config.maxTextLength) {
      throw new ArkmePluginError(
        'record-text-too-long',
        `内容不能超过 ${this.config.maxTextLength} 个字符`,
        false,
      )
    }
    const now = Date.now()
    const pending: ArkmePendingWrite = {
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
  ): Promise<ArkmeConversationWriteResult> {
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

  async pendingWrites(): Promise<ArkmePendingWrite[]> {
    const session = await this.requireSession()
    return await this.stateStore.listPending(session.userId)
  }

  async retryPending(recordUid: string): Promise<ArkmeCreateTextResult> {
    const session = await this.requireSession()
    const pending = (await this.stateStore.listPending(session.userId))
      .find(item => item.recordUid === recordUid)
    if (pending === undefined) {
      throw new ArkmePluginError('outbox-entry-not-found', '待重试内容不存在', false, 404)
    }
    return await this.sendPending(session, pending)
  }

  private async sendPending(
    session: ArkmeSessionCredentials,
    pending: ArkmePendingWrite,
  ): Promise<ArkmeCreateTextResult> {
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

  private async sealWechatConversationRef(userId: number, importSessionKey: string): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, userId, importSessionKey } satisfies ArkmeWechatConversationRefPayload)
    const signature = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-wechat-conversation-v1.${payload}.${signature}`
  }

  private async openWechatConversationRef(
    conversationRef: string,
    expectedUserId: number,
  ): Promise<ArkmeWechatConversationRefPayload> {
    const parts = conversationRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-wechat-conversation-v1') {
      throw new ArkmePluginError('wechat-conversation-ref-invalid', '微信会话引用无效，请先重新查询微信会话列表', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('wechat-conversation-ref-invalid', '微信会话引用无效，请先重新查询微信会话列表', false)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = objectValue(decodeOpaqueJson(payload))
    } catch (error) {
      throw new ArkmePluginError(
        'wechat-conversation-ref-invalid',
        '微信会话引用无效，请先重新查询微信会话列表',
        false,
        400,
        { cause: error },
      )
    }
    const result: ArkmeWechatConversationRefPayload = {
      version: 1,
      userId: numberValue(parsed.userId),
      importSessionKey: stringValue(parsed.importSessionKey).trim(),
    }
    if (parsed.version !== 1 || result.userId !== expectedUserId || result.importSessionKey === '') {
      throw new ArkmePluginError('wechat-conversation-ref-invalid', '微信会话引用与当前账号不匹配', false, 403)
    }
    return result
  }

  private async sealWechatCursor(userId: number, scope: string, offset: number): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, userId, scope, offset } satisfies ArkmeWechatCursorPayload)
    const signature = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-wechat-cursor-v1.${payload}.${signature}`
  }

  private async wechatOffset(cursor: string | undefined, expectedUserId: number, expectedScope: string): Promise<number> {
    if (cursor === undefined || cursor.trim() === '') return 0
    const parts = cursor.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-wechat-cursor-v1') {
      throw new ArkmePluginError('wechat-cursor-invalid', '微信数据分页游标无效，请从第一页重新查询', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('wechat-cursor-invalid', '微信数据分页游标无效，请从第一页重新查询', false)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = objectValue(decodeOpaqueJson(payload))
    } catch (error) {
      throw new ArkmePluginError(
        'wechat-cursor-invalid',
        '微信数据分页游标无效，请从第一页重新查询',
        false,
        400,
        { cause: error },
      )
    }
    const result: ArkmeWechatCursorPayload = {
      version: 1,
      userId: numberValue(parsed.userId),
      scope: stringValue(parsed.scope),
      offset: numberValue(parsed.offset),
    }
    if (parsed.version !== 1 || result.userId !== expectedUserId || result.scope !== expectedScope
      || !Number.isSafeInteger(result.offset) || result.offset < 0) {
      throw new ArkmePluginError('wechat-cursor-invalid', '微信数据分页游标与当前查询不匹配', false, 403)
    }
    return result.offset
  }

  private async sealSourceRef(
    userId: number,
    kind: ArkmeSourceKind,
    ownerRef: string,
    displayName: string,
  ): Promise<string> {
    const payload = encodeOpaqueJson({ version: 1, userId, kind, ownerRef, displayName } satisfies ArkmeSourceRefPayload)
    const signature = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest('base64url')
    return `arkme-source-v1.${payload}.${signature}`
  }

  private async openSourceRef(sourceRef: string, expectedUserId: number): Promise<ArkmeSourceRefPayload> {
    const parts = sourceRef.trim().split('.')
    if (parts.length !== 3 || parts[0] !== 'arkme-source-v1') {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用无效', false)
    }
    const payload = parts[1] ?? ''
    const supplied = Buffer.from(parts[2] ?? '', 'base64url')
    const expected = createHmac('sha256', await this.stateStore.uniqueCode()).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用无效', false)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = objectValue(decodeOpaqueJson(payload))
    } catch (error) {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用无效', false, 400, { cause: error })
    }
    const kind = parsed.kind
    const result: ArkmeSourceRefPayload = {
      version: 1,
      userId: numberValue(parsed.userId),
      kind: isSourceKind(kind) ? kind : 'default_category',
      ownerRef: stringValue(parsed.ownerRef).trim(),
      displayName: stringValue(parsed.displayName).trim(),
    }
    if (parsed.version !== 1 || result.userId !== expectedUserId || !isSourceKind(kind)
      || result.ownerRef === '' || result.displayName === '') {
      throw new ArkmePluginError('source-ref-invalid', 'Arkme 数据源引用与当前账号不匹配', false, 403)
    }
    return result
  }

  private async sourceItem(source: ArkmeSourceRefPayload): Promise<ArkmeSourceItem> {
    return {
      sourceRef: await this.sealSourceRef(source.userId, source.kind, source.ownerRef, source.displayName),
      kind: source.kind,
      displayName: source.displayName,
      activeAtMillis: 0,
      unreadCount: 0,
    }
  }

  private encodeCursor(value: Record<string, unknown>): string {
    return `arkme-cursor-v1.${encodeOpaqueJson(value)}`
  }

  private decodeCursor(cursor: string): Record<string, unknown> {
    const [prefix, payload, ...extra] = cursor.trim().split('.')
    if (prefix !== 'arkme-cursor-v1' || payload === undefined || extra.length > 0) {
      throw new ArkmePluginError('source-cursor-invalid', 'Arkme 数据源分页游标无效', false)
    }
    try {
      const decoded = objectValue(decodeOpaqueJson(payload))
      if (Object.keys(decoded).length === 0) throw new Error('empty cursor')
      return decoded
    } catch (error) {
      throw new ArkmePluginError('source-cursor-invalid', 'Arkme 数据源分页游标无效', false, 400, { cause: error })
    }
  }

  private mediaKind(fileKind: number, mimeType: string): ArkmeContentBlock['kind'] {
    if (fileKind === 1 || mimeType.startsWith('image/')) return 'image'
    if (fileKind === 2 || mimeType.startsWith('audio/')) return 'audio'
    if (fileKind === 3 || mimeType.startsWith('video/')) return 'video'
    return 'file'
  }

  private recordUid(raw: unknown): string {
    const item = objectValue(raw)
    return stringValue(item.record_uid ?? objectValue(item.record_core).record_uid).trim()
  }

  private recordContentPayload(raw: unknown): Record<string, unknown> {
    const root = objectValue(raw)
    const record = objectValue(root.record)
    const payload = jsonObjectValue(record.payload)
    const core = objectValue(root.record_core)
    return jsonObjectValue(
      root.content_payload ?? payload.content_payload ?? record.content_payload ?? core.content_payload,
    )
  }

  private recordMediaRefs(raw: unknown): Record<string, unknown>[] {
    return listValue(this.recordContentPayload(raw).media_refs).map(objectValue).filter(item => {
      return Math.trunc(numberValue(item.content_file_role)) !== RECORD_CONTENT_FILE_ROLE_BACKGROUND_SOUND
        && stringValue(item.file_asset_uid).trim() !== ''
    })
  }

  private async hydrateRecordMediaPage(
    rawItems: unknown[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<{
      displayItemsByRecordUid: Map<string, unknown[]>
      unavailableRecordUids: Set<string>
    }> {
    const displayItemsByRecordUid = new Map<string, unknown[]>()
    const expectedRecordUids = [...new Set(rawItems.flatMap(raw => {
      const recordUid = this.recordUid(raw)
      return recordUid !== '' && this.recordMediaRefs(raw).length > 0 ? [recordUid] : []
    }))]
    const unavailableRecordUids = new Set<string>()
    if (this.config.richMediaRenderEnabled === false || expectedRecordUids.length === 0) {
      return { displayItemsByRecordUid, unavailableRecordUids }
    }
    try {
      const data = await this.authenticatedPost<Record<string, unknown>>(
        '/api/v1/records/media/batch-list',
        { record_uids: expectedRecordUids },
        session,
        signal,
        {
          lane: 'interactive-read',
          scope: 'record-media-page',
          key: expectedRecordUids.join(','),
          cacheMs: 1_000,
        },
      )
      // The deployed Record owner names the per-record projection array `items`.
      // Accept the older `results` draft as a read-only compatibility fallback.
      for (const rawResult of listValue(data.items ?? data.results)) {
        const result = objectValue(rawResult)
        const recordUid = stringValue(result.record_uid).trim()
        if (recordUid === '' || !expectedRecordUids.includes(recordUid)) continue
        const items = listValue(result.items)
        displayItemsByRecordUid.set(recordUid, items)
        const hasDeliverableItem = items.some(rawItem => {
          const item = objectValue(rawItem)
          return stringValue(item.preview_url ?? item.download_url).trim() !== ''
        })
        if (!hasDeliverableItem) unavailableRecordUids.add(recordUid)
      }
      for (const recordUid of expectedRecordUids) {
        if (!displayItemsByRecordUid.has(recordUid)) unavailableRecordUids.add(recordUid)
      }
    } catch (error) {
      if (signal?.aborted === true) throw error
      for (const recordUid of expectedRecordUids) unavailableRecordUids.add(recordUid)
    }
    return { displayItemsByRecordUid, unavailableRecordUids }
  }

  private issueMediaRef(
    viewerUserId: number,
    descriptor: Omit<ArkmeMediaDescriptor, 'viewerUserId' | 'expiresAtMillis'>,
  ): string {
    const now = Date.now()
    for (const [key, value] of this.mediaRefs) {
      if (value.expiresAtMillis <= now) this.mediaRefs.delete(key)
    }
    while (this.mediaRefs.size >= 2_000) {
      const oldest = this.mediaRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.mediaRefs.delete(oldest)
    }
    const ref = `arkme-media-v1.${randomUUID()}`
    this.mediaRefs.set(ref, { ...descriptor, viewerUserId, expiresAtMillis: now + 30 * 60_000 })
    return ref
  }

  private richContentBlocks(raw: unknown, viewerUserId: number, hydratedDisplayItems: unknown[] = []): ArkmeContentBlock[] {
    if (this.config.richMediaRenderEnabled === false) return []
    const root = objectValue(raw)
    const record = objectValue(root.record)
    const payload = jsonObjectValue(record.payload)
    const core = objectValue(root.record_core)
    const contentPayload = this.recordContentPayload(raw)
    const displayItems = [
      ...listValue(root.media_display_items),
      ...listValue(record.media_display_items),
      ...listValue(payload.media_display_items),
      ...listValue(core.media_display_items),
      ...hydratedDisplayItems,
    ].map(objectValue)
    const displayByAsset = new Map<string, Record<string, unknown>>()
    for (const item of displayItems) {
      const uid = stringValue(item.file_asset_uid).trim()
      if (uid !== '') displayByAsset.set(uid, item)
    }
    const mediaRefs = listValue(contentPayload.media_refs).map(objectValue)
    const candidates = mediaRefs.length > 0
      ? mediaRefs.map(ref => ({ ...(displayByAsset.get(stringValue(ref.file_asset_uid).trim()) ?? {}), ...ref }))
      : displayItems
    return candidates.filter(item => {
      // content_file_role=4 is ambient background sound captured while writing a record.
      // It is author-only record metadata, not an attachment that belongs in a chat bubble.
      return Math.trunc(numberValue(item.content_file_role)) !== RECORD_CONTENT_FILE_ROLE_BACKGROUND_SOUND
    }).flatMap((item, index): ArkmeContentBlock[] => {
      const fileAssetUid = stringValue(item.file_asset_uid).trim()
      const mimeType = stringValue(item.mime_type).trim() || 'application/octet-stream'
      const fileName = stringValue(item.file_name).trim() || `附件-${String(index + 1)}`
      const fileKind = Math.trunc(numberValue(item.file_kind))
      const kind = this.mediaKind(fileKind, mimeType)
      const remoteUrl = stringValue(kind === 'image' ? item.preview_url ?? item.download_url : item.download_url).trim()
      if (remoteUrl === '') return []
      return [{
        kind,
        mediaRef: this.issueMediaRef(viewerUserId, {
          remoteUrl, mimeType, fileName, size: Math.max(0, Math.trunc(numberValue(item.size))),
        }),
        ...(fileAssetUid === '' ? {} : { fileAssetUid }),
        fileName,
        mimeType,
        size: Math.max(0, Math.trunc(numberValue(item.size))),
        ...(numberValue(item.duration_sec) > 0 ? { durationSec: numberValue(item.duration_sec) } : {}),
        sortOrder: Math.trunc(numberValue(item.sort_order ?? index)),
      }]
    }).sort((left, right) => left.sortOrder - right.sortOrder)
  }

  private recordTimelineItem(item: ArkmeSelfRecordItem): ArkmeTimelineItem {
    return {
      itemUid: item.recordUid,
      senderName: '我',
      isMe: true,
      sendAtMillis: item.sendAtMillis,
      title: item.title,
      textContent: item.textContent,
      status: item.status,
      templateKind: item.templateKind,
      version: item.version,
      ...(item.displayKind === undefined ? {} : { displayKind: item.displayKind }),
      ...(item.contentBlocks === undefined ? {} : { contentBlocks: item.contentBlocks }),
      ...(item.mediaUnavailable === true ? { mediaUnavailable: true } : {}),
    }
  }

  private recordTimelineItemFromRaw(
    raw: unknown,
    userId: number,
    options: { displayItems?: unknown[]; mediaUnavailable?: boolean } = {},
  ): ArkmeTimelineItem {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    return {
      itemUid: stringValue(item.record_uid ?? core.record_uid).trim(),
      senderName: stringValue(item.nickname).trim() || '我',
      isMe: numberValue(item.creator_user_id ?? item.owner_user_id ?? core.creator_user_id ?? core.owner_user_id) === userId,
      sendAtMillis: numberValue(item.send_at ?? core.send_at),
      title: stringValue(item.title ?? core.title),
      textContent: stringValue(item.text_content ?? core.text_content),
      status: numberValue(item.status ?? core.status),
      templateKind: numberValue(item.template_kind ?? core.template_kind),
      displayKind: numberValue(item.display_kind ?? core.display_kind),
      version: numberValue(item.version ?? core.version),
      updateAtMillis: numberValue(item.update_at ?? core.update_at),
      recordDurationMillis: numberValue(item.record_duration_millis ?? core.record_duration_millis),
      editDurationMillis: numberValue(item.edit_duration_millis ?? core.edit_duration_millis),
      contentBlocks: this.richContentBlocks(raw, userId, options.displayItems),
      ...(options.mediaUnavailable === true ? { mediaUnavailable: true } : {}),
    }
  }

  private recordItem(
    raw: unknown,
    userId?: number,
    options: { displayItems?: unknown[]; mediaUnavailable?: boolean } = {},
  ): ArkmeSelfRecordItem | undefined {
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
      displayKind: numberValue(item.display_kind ?? core.display_kind),
      ...(userId === undefined ? {} : { contentBlocks: this.richContentBlocks(raw, userId, options.displayItems) }),
      ...(options.mediaUnavailable === true ? { mediaUnavailable: true } : {}),
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
    const data = await this.post<Record<string, unknown>>(
      this.config.worldBaseUrl, '/api/public/v1/public-record/status-batch',
      { record_uids: [recordUid] }, undefined, [200], signal,
    )
    return listValue(data.items).some(raw => {
      const item = objectValue(raw)
      return stringValue(item.record_uid).trim() === recordUid && item.is_public === true
    })
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

  private async remoteArkmeIdAvailability(
    name: string,
    initialSession?: ArkmeSessionCredentials,
  ): Promise<ArkmeIdAvailabilitySnapshot> {
    const data = await this.authenticatedAuthPost<Record<string, unknown>>(
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

  private async tryRefreshProfile(): Promise<ArkmeUserProfileSnapshot | undefined> {
    try {
      return await this.refreshProfile()
    } catch {
      return undefined
    }
  }

  private arkmeIdMutationResult(
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

  private authenticatedRequestOptions(
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

  private async authenticatedAuthGet<T>(
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

  private async ossCredentials(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeOssCredentials> {
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
      throw new ArkmePluginError('image-sts-contract-invalid', 'Arkme 图片授权凭据无效或已过期', true, 502)
    }
    return normalized
  }

  private async authenticatedPost<T>(
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

  private async authenticatedAuthPost<T>(
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

  private async authenticatedSubjectPost<T>(
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

  private async authenticatedChatPost<T>(
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

  private async authenticatedWebrtcPost<T>(
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

  private async authenticatedAudioPost<T>(
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

  private async recordingCursorKey(userId: number): Promise<Buffer> {
    return createHmac('sha256', await this.stateStore.uniqueCode())
      .update(`arkme-recording-cursor:${String(userId)}`)
      .digest()
  }

  private recordingDayStart(dateStamp: number): Date {
    const date = Math.trunc(dateStamp)
    const dayStart = new Date(date)
    if (!Number.isSafeInteger(date) || date <= 0 || dayStart.getTime() !== date
      || dayStart.getHours() !== 0 || dayStart.getMinutes() !== 0
      || dayStart.getSeconds() !== 0 || dayStart.getMilliseconds() !== 0) {
      throw new ArkmePluginError('recording-date-invalid', '录音日期必须是本地零点', false)
    }
    return dayStart
  }

  private recordingVersionSection(
    items: ArkmeRecordingVersion[],
  ): ArkmeRecordingSection<ArkmeRecordingVersion> {
    if (items[0]?.status === 'processing') {
      return { state: 'processing', items, message: '内容仍在生成' }
    }
    if (items[0]?.status === 'failed') {
      return { state: 'failed', items, message: '最近一次生成失败' }
    }
    if (items.some(item => item.selectable)) return { state: 'ready', items, message: '' }
    return { state: 'empty', items, message: '暂无已生成内容' }
  }

  private async authenticatedRelationPost<T>(
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

  private async authenticatedWorldPost<T>(
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

  private async authenticatedIntelligentPost<T>(
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

  private async authenticatedIntelligentSseEvents(
    path: string,
    query: Record<string, string | number>,
    waitMillis: number,
    initialSession?: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<{ events: string[]; timedOut: boolean }> {
    let session = initialSession ?? await this.requireSession()
    try {
      return await this.readIntelligentSseEvents(path, query, session.accessToken, waitMillis, signal)
    } catch (error) {
      if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) {
        throw error
      }
      session = await this.refreshAccessToken(session)
      return await this.readIntelligentSseEvents(path, query, session.accessToken, waitMillis, signal)
    }
  }

  private async readIntelligentSseEvents(
    path: string,
    query: Record<string, string | number>,
    bearer: string | undefined,
    waitMillis: number,
    signal?: AbortSignal,
  ): Promise<{ events: string[]; timedOut: boolean }> {
    const events: string[] = []
    const dataLines: string[] = []
    const decoder = new TextDecoder()
    let buffer = ''
    let timedOut = false
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, Math.max(1, waitMillis))
    const flushEvent = (): void => {
      if (dataLines.length === 0) return
      events.push(dataLines.join('\n'))
      dataLines.length = 0
    }
    const pushText = (chunk: string): void => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (line === '') flushEvent()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        newlineIndex = buffer.indexOf('\n')
      }
    }
    try {
      const response = await this.fetchImpl(joinUrlWithQuery(this.config.intelligentBaseUrl, path, query), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Accept-Language': 'zh-CN',
          Usersource: '3',
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
        },
        signal: controller.signal,
      })
      if (response.status === 401 || response.status === 403) {
        throw new ArkmePluginError(
          `auth-http-${response.status}`,
          'Arkme 登录凭据已失效',
          false,
          response.status,
        )
      }
      if (!response.ok) {
        throw new ArkmePluginError('arkme-http-error', `Arko 流返回 HTTP ${response.status}`, true, 502)
      }
      if (response.body === null) {
        throw new ArkmePluginError('arko-stream-empty', 'Arko 流响应为空', true, 502)
      }
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        pushText(decoder.decode(next.value, { stream: true }))
      }
      pushText(decoder.decode())
      flushEvent()
      return { events, timedOut: false }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError' && timedOut && signal?.aborted !== true) {
        flushEvent()
        return { events, timedOut: true }
      }
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('arko-stream-cancelled', 'Arko 流已取消', false, 499, { cause: error })
      }
      throw new ArkmePluginError('arko-stream-network-error', '无法连接 Arko 流', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private projectArkoStreamEvents(input: {
    sessionId: number
    userMsgId: number
    assistantMsgId: number
    runUid?: string
    initialStatus: string
    events: string[]
    timedOut: boolean
  }): ArkmeArkoAskResult {
    let text = ''
    let reasoning = ''
    let status = input.initialStatus
    let terminal = false
    let errorMessage: string | undefined
    let profile: ArkmeArkoProfile | undefined
    let run: ArkmeArkoRunProjection | undefined
    let createdRecordUids: string[] = []
    for (const rawEvent of input.events) {
      const frame = arkoStreamFrame(rawEvent)
      if (frame === undefined) {
        text += rawEvent
        continue
      }
      const mid = objectValue(frame.mid)
      if (Object.keys(mid).length > 0) {
        text += stringValue(mid.content)
        reasoning += stringValue(mid.reason_content)
      }
      const tail = objectValue(frame.tail)
      if (Object.keys(tail).length > 0) {
        terminal = true
        const tailRun = arkoRunProjectionFromData(tail)
        if (tailRun !== undefined) {
          run = tailRun
          status = tailRun.status
        } else if (booleanValue(tail.error) || stringValue(tail.status).trim() === 'error') {
          status = 'failed'
        } else {
          status = ARKO_COMPLETED_STATUS
        }
        createdRecordUids = arkoCreatedRecordUids(tail.created_record_uids)
        const nextProfile = optionalRecord(tail.agent_profile)
        if (nextProfile !== undefined) profile = arkoProfileFromData(nextProfile)
        if (booleanValue(tail.error) || stringValue(tail.status).trim() === 'error') {
          errorMessage = stringValue(tail.error_message).trim() || 'Arko 执行失败'
        }
      }
      const type = stringValue(frame.type ?? frame.event).trim()
      const payload = optionalRecord(frame.payload) ?? frame
      if (type === 'message.delta') text += stringValue(payload.text ?? payload.content)
      else if (type === 'message.final') {
        const finalText = stringValue(payload.text ?? payload.content)
        if (finalText !== '') text = finalText
      } else if (type === 'thinking.delta') {
        reasoning += stringValue(payload.text ?? payload.content)
      } else if (type === 'done') {
        terminal = true
        const doneRun = arkoRunProjectionFromData(payload)
        if (doneRun !== undefined) {
          run = doneRun
          status = doneRun.status
        } else status = ARKO_COMPLETED_STATUS
        createdRecordUids = arkoCreatedRecordUids(payload.created_record_uids)
        const nextProfile = optionalRecord(payload.agent_profile)
        if (nextProfile !== undefined) profile = arkoProfileFromData(nextProfile)
      } else if (type === 'error') {
        terminal = true
        status = 'failed'
        errorMessage = stringValue(payload.message ?? payload.errorMessage).trim() || 'Arko 执行失败'
      }
    }
    if (!terminal && input.timedOut) status = ARKO_STREAM_TIMEOUT_STATUS
    return {
      sessionId: input.sessionId,
      userMsgId: input.userMsgId,
      assistantMsgId: input.assistantMsgId,
      ...(input.runUid === undefined ? {} : { runUid: input.runUid }),
      text,
      reasoning,
      status,
      terminal,
      timedOut: input.timedOut,
      ...(errorMessage === undefined ? {} : { errorMessage }),
      createdRecordUids,
      ...(profile === undefined ? {} : { profile }),
      ...(run === undefined ? {} : { run }),
    }
  }

  private aiVideoSelectionBody(
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
  ): Record<string, unknown> {
    return {
      session_id: sessionId.trim(),
      selection: {
        kind: 'long_recording_segments',
        segments: segments.map(segment => ({
          child_id: segment.childId.trim(),
          asr_item_index: segment.asrItemIndex,
          transcript_source: segment.transcriptSource,
        })),
      },
    }
  }

  private aiVideoJob(data: Record<string, unknown>): ArkmeAiVideoJob {
    const jobId = stringValue(data.job_id).trim()
    const status = stringValue(data.status).trim()
    const allowedStatuses = new Set<ArkmeAiVideoJobStatus>([
      'queued', 'running', 'succeeded', 'failed', 'canceled',
    ])
    if (jobId === '' || !allowedStatuses.has(status as ArkmeAiVideoJobStatus)) {
      throw new ArkmePluginError('ai-video-contract-invalid', 'AI 视频服务返回了无效任务信息', true, 502)
    }
    const selection = objectValue(data.selection)
    const segmentCount = listValue(objectValue(selection).segments).length
    const textCount = listValue(objectValue(selection).texts).length
    return {
      jobId,
      status: status as ArkmeAiVideoJobStatus,
      stage: stringValue(data.stage).trim() || status,
      progress: Math.min(100, Math.max(0, Math.trunc(numberValue(data.progress)))),
      selectedSegmentCount: segmentCount,
      ...(textCount === 0 ? {} : { selectedTextCount: textCount }),
      retryable: booleanValue(data.retryable),
      ...(stringValue(data.video_asset_uid).trim() === '' ? {} : { videoAssetUid: stringValue(data.video_asset_uid).trim() }),
      ...(stringValue(data.cover_asset_uid).trim() === '' ? {} : { coverAssetUid: stringValue(data.cover_asset_uid).trim() }),
      ...(numberValue(data.video_duration_millis) <= 0 ? {} : { videoDurationMillis: numberValue(data.video_duration_millis) }),
      ...(stringValue(data.error_code).trim() === '' ? {} : { errorCode: stringValue(data.error_code).trim() }),
      ...(stringValue(data.error_message).trim() === '' ? {} : { errorMessage: stringValue(data.error_message).trim() }),
      ...(stringValue(data.failure_stage).trim() === '' ? {} : { failureStage: stringValue(data.failure_stage).trim() }),
    }
  }

  private aiVideoListItem(raw: unknown): ArkmeAiVideoListItem | undefined {
    const item = objectValue(raw)
    const jobId = stringValue(item.job_id).trim()
    const status = stringValue(item.status).trim() as ArkmeAiVideoJobStatus
    if (jobId === '' || !['queued', 'running', 'succeeded', 'failed', 'canceled'].includes(status)) return undefined
    const source = objectValue(item.source_recording)
    return {
      jobId,
      sessionId: stringValue(item.session_id).trim(),
      status,
      stage: stringValue(item.stage).trim() || status,
      progress: Math.min(100, Math.max(0, Math.trunc(numberValue(item.progress)))),
      title: stringValue(source.title).trim() || '长录音 AI 视频',
      sourceStartedAtMillis: numberValue(source.started_at),
      selectedDurationMillis: Math.max(0, numberValue(source.selected_duration_millis)),
      selectedSegmentCount: Math.max(0, Math.trunc(numberValue(item.selected_segment_count))),
      retryable: booleanValue(item.retryable),
      createdAtMillis: numberValue(item.created_at),
      updatedAtMillis: numberValue(item.updated_at),
      ...(stringValue(item.cover_asset_uid).trim() === '' ? {} : { coverAssetUid: stringValue(item.cover_asset_uid).trim() }),
      ...(stringValue(item.video_asset_uid).trim() === '' ? {} : { videoAssetUid: stringValue(item.video_asset_uid).trim() }),
      ...(numberValue(item.video_duration_millis) <= 0 ? {} : { videoDurationMillis: numberValue(item.video_duration_millis) }),
      ...(stringValue(item.error_code).trim() === '' ? {} : { errorCode: stringValue(item.error_code).trim() }),
      ...(stringValue(item.error_message).trim() === '' ? {} : { errorMessage: clippedText(item.error_message, 500) }),
    }
  }

  private recordSearchResult(data: Record<string, unknown>): ArkmeRecordSearchResult {
    const guard = objectValue(data.query_guard)
    const summary = objectValue(data.page_summary)
    return {
      items: listValue(data.items).map(raw => this.searchRecordItem(raw)).filter((item): item is ArkmeSearchRecordItem => item !== undefined),
      sourceAggregates: listValue(data.source_aggregates)
        .map(raw => this.searchSourceAggregate(raw))
        .filter((item): item is ArkmeSearchSourceAggregate => item !== undefined),
      hasMore: booleanValue(data.has_more),
      ...(stringValue(data.next_cursor).trim() === '' ? {} : { nextCursor: stringValue(data.next_cursor).trim() }),
      queryGuard: {
        state: stringValue(guard.state).trim() || 'complete',
        ...(stringValue(guard.reason).trim() === '' ? {} : { reason: stringValue(guard.reason).trim() }),
      },
      ...(numberValue(summary.item_count) <= 0 ? {} : { itemCount: numberValue(summary.item_count) }),
      ...(numberValue(summary.item_size) <= 0 ? {} : { itemSize: numberValue(summary.item_size) }),
    }
  }

  private searchRecordItem(raw: unknown): ArkmeSearchRecordItem | undefined {
    const item = objectValue(raw)
    const core = objectValue(item.record_core)
    const match = objectValue(item.match_summary)
    const payload = objectValue(core.content_payload)
    const topic = objectValue(item.topic_core)
    const chat = objectValue(item.chat_core)
    const recordUid = stringValue(item.record_uid ?? core.record_uid).trim()
    if (recordUid === '') return undefined
    const assetItem = (value: unknown): ArkmeSearchAssetItem | undefined => {
      const source = objectValue(value)
      const fileAssetUid = stringValue(source.file_asset_uid ?? source.source_file_asset_uid).trim()
      if (fileAssetUid === '') return undefined
      return {
        fileAssetUid,
        ...(stringValue(source.file_uid).trim() === '' ? {} : { fileUid: stringValue(source.file_uid).trim() }),
        ...(stringValue(source.file_name).trim() === '' ? {} : { fileName: stringValue(source.file_name).trim() }),
        ...(stringValue(source.mime_type).trim() === '' ? {} : { mimeType: stringValue(source.mime_type).trim() }),
        ...(numberValue(source.file_kind) <= 0 ? {} : { fileKind: Math.trunc(numberValue(source.file_kind)) }),
        ...(numberValue(source.size) <= 0 ? {} : { size: numberValue(source.size) }),
        ...(numberValue(source.duration_millis) <= 0 ? {} : { durationMillis: numberValue(source.duration_millis) }),
      }
    }
    const media = listValue(payload.media_refs).map(assetItem).filter((value): value is NonNullable<typeof value> => value !== undefined)
    const files = listValue(item.file_ls).map(assetItem).filter((value): value is NonNullable<typeof value> => value !== undefined)
    const voice = assetItem(payload.voice)
    const textContent = clippedText(core.text_content, 2_000)
    const linkMatch = textContent.match(/https:\/\/[^\s<>()]+/u)
    return {
      recordUid,
      sourceKind: Math.trunc(numberValue(item.source_kind)),
      ...(stringValue(item.source_uid).trim() === '' ? {} : { sourceUid: stringValue(item.source_uid).trim() }),
      routeTargetKind: stringValue(item.route_target_kind).trim(),
      ...(stringValue(item.route_target_uid).trim() === '' ? {} : { routeTargetUid: stringValue(item.route_target_uid).trim() }),
      sendAtMillis: numberValue(item.send_at ?? core.send_at),
      title: clippedText(core.title, 500),
      textContent,
      snippet: clippedText(match.snippet, 1_000),
      ...(stringValue(core.nickname).trim() === '' ? {} : { nickname: stringValue(core.nickname).trim() }),
      ...(numberValue(core.template_kind) <= 0 ? {} : { templateKind: Math.trunc(numberValue(core.template_kind)) }),
      ...(numberValue(core.display_kind) <= 0 ? {} : { displayKind: Math.trunc(numberValue(core.display_kind)) }),
      ...(stringValue(topic.title ?? chat.title).trim() === '' ? {} : { sourceTitle: stringValue(topic.title ?? chat.title).trim() }),
      media,
      files,
      ...(voice === undefined ? {} : { voice }),
      ...(linkMatch === null ? {} : { linkUrl: linkMatch[0] }),
      ...(numberValue(core.duration_millis ?? core.record_duration_millis) <= 0 ? {} : { recordDurationMillis: numberValue(core.duration_millis ?? core.record_duration_millis) }),
      ...(numberValue(item.scene_item_count) <= 0 ? {} : { sceneItemCount: numberValue(item.scene_item_count) }),
      ...(numberValue(item.scene_item_size) <= 0 ? {} : { sceneItemSize: numberValue(item.scene_item_size) }),
    }
  }

  private searchSourceAggregate(raw: unknown): ArkmeSearchSourceAggregate | undefined {
    const item = objectValue(raw)
    const topic = objectValue(item.topic_core)
    const chat = objectValue(item.chat_core)
    const sourceUid = stringValue(item.source_uid).trim()
    if (sourceUid === '') return undefined
    return {
      sourceKind: Math.trunc(numberValue(item.source_kind)),
      sourceUid,
      routeTargetKind: stringValue(item.route_target_kind).trim(),
      ...(stringValue(item.route_target_uid).trim() === '' ? {} : { routeTargetUid: stringValue(item.route_target_uid).trim() }),
      title: stringValue(topic.title ?? chat.title).trim() || '未命名来源',
      matchedRecordCount: Math.max(0, Math.trunc(numberValue(item.matched_record_count))),
      matchedRecordCountExact: booleanValue(item.matched_record_count_exact),
    }
  }

  private async downloadSignedImage(
    signedUrl: URL,
    byteLimit: number,
    signal?: AbortSignal,
    scope = 'public',
  ): Promise<ArkmeImageBytes> {
    return await this.requestCoordinator.run({
      scope,
      lane: 'image',
      service: 'oss',
      ...(signal === undefined ? {} : { signal }),
      operation: async coordinatedSignal => await this.downloadSignedImageDirect(
        signedUrl, byteLimit, coordinatedSignal,
      ),
    })
  }

  private async downloadSignedImageDirect(
    signedUrl: URL,
    byteLimit: number,
    signal: AbortSignal,
  ): Promise<ArkmeImageBytes> {
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
        throw new ArkmePluginError('image-download-failed', `Arkme 图片读取返回 HTTP ${response.status}`, true, 502)
      }
      const declaredLength = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
        throw new ArkmePluginError('image-too-large', 'Arkme 图片超过读取大小限制', false, 413)
      }
      if (response.body === null) {
        throw new ArkmePluginError('image-response-empty', 'Arkme 图片响应为空', true, 502)
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
          throw new ArkmePluginError('image-too-large', 'Arkme 图片超过读取大小限制', false, 413)
        }
        chunks.push(next.value)
      }
      if (bytes === 0) throw new ArkmePluginError('image-response-empty', 'Arkme 图片响应为空', true, 502)
      const data = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      const mediaType = imageMediaType(data)
      if (mediaType === undefined) {
        throw new ArkmePluginError('image-type-unsupported', 'Arkme 图片不是受支持的 PNG、JPEG、WebP 或 GIF', false, 415)
      }
      const declaredType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase()
      if (declaredType !== '' && declaredType !== 'application/octet-stream'
        && !(mediaType === 'image/jpeg' && declaredType === 'image/jpg') && declaredType !== mediaType) {
        throw new ArkmePluginError('image-type-mismatch', 'Arkme 图片类型与响应声明不一致', false, 502)
      }
      return { mediaType, bytes, data }
    } catch (error) {
      if (error instanceof ArkmePluginError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new ArkmePluginError('image-download-timeout', 'Arkme 图片读取超时或已取消', true, 504, { cause: error })
      }
      throw new ArkmePluginError('image-download-failed', '无法读取 Arkme 图片', true, 502, { cause: error })
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async refreshAccessToken(session: ArkmeSessionCredentials): Promise<ArkmeSessionCredentials> {
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
        else await this.sessionStore.write(updated)
        return updated
      } catch (error) {
        if (error instanceof ArkmePluginError && ['auth-http-401', 'auth-http-403'].includes(error.code)) {
          if (this.isPendingBindingSession(session)) await this.clearPendingBindingSession()
          else await this.sessionStore.delete()
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

  private async requireSession(): Promise<ArkmeSessionCredentials> {
    const session = await this.sessionStore.read()
    if (session === undefined) {
      throw new ArkmePluginError('login-required', '请先登录 Arkme', false, 401)
    }
    return session
  }

  private async requireAuthFlowSession(): Promise<ArkmeSessionCredentials> {
    const session = await this.sessionStore.read() ?? await this.readPendingBindingSession()
    if (session === undefined) {
      throw new ArkmePluginError('login-required', '请先登录 Arkme', false, 401)
    }
    return session
  }

  private requestService(baseUrl: string): ArkmeRequestService {
    const normalized = baseUrl.replace(/\/+$/, '')
    const services: Array<[string, ArkmeRequestService]> = [
      [this.config.authBaseUrl, 'auth'],
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

  private requestScope(userId: number | undefined): string {
    return userId !== undefined && Number.isSafeInteger(userId) && userId > 0 ? `user:${String(userId)}` : 'public'
  }

  private remoteServiceCooldownMs(error: unknown): number {
    if (!(error instanceof ArkmePluginError)
      || ['auth-http-401', 'auth-http-403', 'login-expired'].includes(error.code)) return 0
    if (error.upstreamStatus === 429 || error.upstreamStatus === 503) {
      return Math.max(1_000, error.retryAfterMillis ?? 5_000)
    }
    return 0
  }

  private async post<T>(
    baseUrl: string,
    path: string,
    body: Record<string, unknown>,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal?: AbortSignal,
    preferDataError = false,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    return await this.requestCoordinator.run({
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
      operation: async coordinatedSignal => await this.postDirect(
        baseUrl, path, body, bearer, successCodes, coordinatedSignal, preferDataError,
      ),
    })
  }

  private async postDirect<T>(
    baseUrl: string,
    path: string,
    body: Record<string, unknown>,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal: AbortSignal,
    preferDataError: boolean,
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
        throw new ArkmePluginError(
          `auth-http-${response.status}`,
          'Arkme 登录凭据已失效',
          false,
          response.status,
        )
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
      try {
        envelope = await response.json() as ArkmeEnvelope<T>
      } catch (error) {
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
      signal?.removeEventListener('abort', abort)
    }
  }

  private async get<T>(
    baseUrl: string,
    path: string,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
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
        baseUrl, path, bearer, successCodes, coordinatedSignal,
      ),
    })
  }

  private async getDirect<T>(
    baseUrl: string,
    path: string,
    bearer: string | undefined,
    successCodes: readonly number[],
    signal: AbortSignal,
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
        throw new ArkmePluginError(
          `auth-http-${response.status}`,
          'Arkme 登录凭据已失效',
          false,
          response.status,
        )
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
      try {
        envelope = await response.json() as ArkmeEnvelope<T>
      } catch (error) {
        throw new ArkmePluginError('arkme-response-invalid', 'Arkme 服务返回了无效响应', true, 502, { cause: error })
      }
      if (!successCodes.includes(envelope.code)) {
        throw new ArkmePluginError(
          `arkme-code-${envelope.code}`,
          envelope.message?.trim() || 'Arkme 服务请求失败',
          envelope.code >= 500,
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
      signal?.removeEventListener('abort', abort)
    }
  }
}
