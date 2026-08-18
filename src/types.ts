export type ArkmeEnvironment = 'test' | 'prod'

export const ARKME_PROVIDER_CONTRACT_VERSION = 1 as const

export type ArkmeAuthStatus = 'logged-out' | 'pending' | 'authenticated' | 'expired'

export interface ArkmeAuthSnapshot {
  status: ArkmeAuthStatus
  environment: ArkmeEnvironment
  userId?: number
  attemptId?: string
  qrContent?: string
  expiresAtMillis?: number
}

export interface ArkmeCaptchaResult {
  lot_number: string
  captcha_output: string
  pass_token: string
  gen_time: string
}

export interface ArkmeClientConfig {
  captchaId: string
}

export interface ArkmeRecordCursor {
  sendAtMillis: number
  recordUid: string
}

export interface ArkmeSelfRecordItem {
  recordUid: string
  sendAtMillis: number
  title: string
  textContent: string
  templateKind: number
  status: number
  version: number
  localState?: 'synced' | 'pending' | 'failed'
  lastError?: string
}

export interface ArkmeSelfRecordList {
  items: ArkmeSelfRecordItem[]
  hasMore: boolean
  nextCursor?: ArkmeRecordCursor
}

export interface ArkmeSelfSummary {
  recordCount: number
  wordsCount: number
  totalSec: number
}

export interface ArkmePendingWrite {
  recordUid: string
  textContent: string
  createdAtMillis: number
  sendAtMillis: number
  attempts: number
  lastError?: string
}

export interface ArkmeCreateTextResult {
  recordUid: string
  status: number
}

export interface ArkmeConversationWriteResult {
  recordUid: string
  status: number
  localState: 'synced' | 'failed'
  error?: string
}

export interface ArkmeCachedSnapshot {
  items: ArkmeSelfRecordItem[]
  hasMore: boolean
  nextCursor?: ArkmeRecordCursor
  summary?: ArkmeSelfSummary
  cachedAtMillis: number
  revision: number
}

export interface ArkmeCachedQueryResult {
  items: ArkmeSelfRecordItem[]
  cacheComplete: boolean
  cachedAtMillis: number
  revision: number
}

export interface ArkmeProviderCapabilities {
  contractVersion: typeof ARKME_PROVIDER_CONTRACT_VERSION
  provider: '@senguoyun/dsh-arkme'
  sdk: '@senguoyun/dsh-arkme/sdk'
  environment: ArkmeEnvironment
  features: {
    authStatus: true
    cachedSnapshot: true
    remoteRefresh: true
    search: true
    createText: true
    retryOutbox: true
    revisionPolling: true
    userProfile: true
    imageRead: true
    sourceDirectory: true
    sourceTimeline: true
    sourceTextSend: true
  }
  limits: {
    maxTextLength: number
    maxSearchResults: number
    maxSyncPages: number
    maxImageBytes: number
  }
}

export type ArkmeImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ArkmeImageBytes {
  mediaType: ArkmeImageMediaType
  bytes: number
  data: Uint8Array
}

/** Browser-safe image payload. Signed OSS URLs and credentials never cross the Provider boundary. */
export interface ArkmeImagePayload {
  mediaType: ArkmeImageMediaType
  bytes: number
  dataBase64: string
}

export interface ArkmeUserProfile {
  userId: number
  displayName: string
  nickname: string
  avatarRef: string
  avatarUrl?: string
  arkmeId: string
  accountType: number
  createdAt: number
  bindings: {
    apple: boolean
    wechat: boolean
    google: boolean
  }
  contact: {
    phoneMasked?: string
    emailMasked?: string
  }
}

export interface ArkmeUserProfileSnapshot {
  profile: ArkmeUserProfile | null
  cachedAtMillis: number
  revision: number
}

export type ArkmeSourceKind = 'default_category' | 'topic' | 'private_chat' | 'group_chat'
export type ArkmeSourceDirectory = 'root' | 'send_to_self'

export interface ArkmeSourceItem {
  sourceRef: string
  kind: ArkmeSourceKind
  displayName: string
  /** Opaque Provider image reference; consumers resolve it through image.read. */
  avatarRef?: string
  /** Ordered group-avatar tiles, also resolved only through image.read. */
  avatarRefs?: string[]
  latestPreview?: string
  activeAtMillis: number
  unreadCount: number
  recordCount?: number
}

export interface ArkmeSourceList {
  directory: ArkmeSourceDirectory
  items: ArkmeSourceItem[]
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeTimelineCursor {
  sendAtMillis?: number
  itemUid?: string
  beforeSequence?: number
}

export interface ArkmeTimelineItem {
  itemUid: string
  senderName: string
  /** Opaque Provider image reference for the concrete message sender. */
  avatarRef?: string
  isMe: boolean
  sendAtMillis: number
  title: string
  textContent: string
  status: number
  sequence?: number
}

export interface ArkmeTimelinePage {
  source: ArkmeSourceItem
  items: ArkmeTimelineItem[]
  hasMore: boolean
  nextCursor?: ArkmeTimelineCursor
}

export interface ArkmeSourceSendResult {
  sourceRef: string
  itemUid: string
  status: number
  sequence?: number
  localState: 'synced' | 'failed'
  error?: string
}

export interface ArkmeDirectTextSendResult {
  recipientArkmeId: string
  chatSessionUid: string
  recordUid: string
  relationUid: string
  sequence: number
  targetKind: 'direct'
}

export interface ArkmeProviderState {
  contractVersion: typeof ARKME_PROVIDER_CONTRACT_VERSION
  environment: ArkmeEnvironment
  authStatus: ArkmeAuthStatus
  userId?: number
  revision: number
}

export type ArkmePluginOperation =
  | 'provider.capabilities'
  | 'provider.state'
  | 'auth.status'
  | 'auth.config'
  | 'auth.begin'
  | 'auth.poll'
  | 'auth.phone.send'
  | 'auth.phone.verify'
  | 'auth.logout'
  | 'records.summary'
  | 'records.cache'
  | 'records.refresh'
  | 'records.search'
  | 'records.list'
  | 'records.create'
  | 'records.outbox'
  | 'records.retry'
  | 'user.profile'
  | 'user.profile.refresh'
  | 'image.read'
  | 'sources.list'
  | 'source.timeline'
  | 'source.send-text'

export interface ArkmePluginRequest {
  operation: ArkmePluginOperation
  params?: Record<string, unknown>
}

export interface ArkmePluginErrorBody {
  code: string
  message: string
  retryable: boolean
}

export type ArkmePluginResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: ArkmePluginErrorBody }
