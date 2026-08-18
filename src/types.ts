export type JotmoEnvironment = 'test' | 'prod'

export const JOTMO_PROVIDER_CONTRACT_VERSION = 1 as const

export type JotmoAuthStatus = 'logged-out' | 'pending' | 'authenticated' | 'expired'

export interface JotmoAuthSnapshot {
  status: JotmoAuthStatus
  environment: JotmoEnvironment
  userId?: number
  attemptId?: string
  qrContent?: string
  expiresAtMillis?: number
}

export interface JotmoCaptchaResult {
  lot_number: string
  captcha_output: string
  pass_token: string
  gen_time: string
}

export interface JotmoClientConfig {
  captchaId: string
}

export interface JotmoRecordCursor {
  sendAtMillis: number
  recordUid: string
}

export interface JotmoSelfRecordItem {
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

export interface JotmoSelfRecordList {
  items: JotmoSelfRecordItem[]
  hasMore: boolean
  nextCursor?: JotmoRecordCursor
}

export interface JotmoSelfSummary {
  recordCount: number
  wordsCount: number
  totalSec: number
}

export interface JotmoPendingWrite {
  recordUid: string
  textContent: string
  createdAtMillis: number
  sendAtMillis: number
  attempts: number
  lastError?: string
}

export interface JotmoCreateTextResult {
  recordUid: string
  status: number
}

export interface JotmoConversationWriteResult {
  recordUid: string
  status: number
  localState: 'synced' | 'failed'
  error?: string
}

export interface JotmoCachedSnapshot {
  items: JotmoSelfRecordItem[]
  hasMore: boolean
  nextCursor?: JotmoRecordCursor
  summary?: JotmoSelfSummary
  cachedAtMillis: number
  revision: number
}

export interface JotmoCachedQueryResult {
  items: JotmoSelfRecordItem[]
  cacheComplete: boolean
  cachedAtMillis: number
  revision: number
}

export interface JotmoProviderCapabilities {
  contractVersion: typeof JOTMO_PROVIDER_CONTRACT_VERSION
  provider: '@senqisi/dsh-jotmo'
  sdk: '@senqisi/dsh-jotmo/sdk'
  environment: JotmoEnvironment
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
  }
  limits: {
    maxTextLength: number
    maxSearchResults: number
    maxSyncPages: number
    maxImageBytes: number
  }
}

export type JotmoImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Browser-safe image payload. Signed OSS URLs and credentials never cross the Provider boundary. */
export interface JotmoImagePayload {
  mediaType: JotmoImageMediaType
  bytes: number
  dataBase64: string
}

export interface JotmoUserProfile {
  userId: number
  displayName: string
  nickname: string
  avatarRef: string
  avatarUrl?: string
  jotmoId: string
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

export interface JotmoUserProfileSnapshot {
  profile: JotmoUserProfile | null
  cachedAtMillis: number
  revision: number
}

export interface JotmoProviderState {
  contractVersion: typeof JOTMO_PROVIDER_CONTRACT_VERSION
  environment: JotmoEnvironment
  authStatus: JotmoAuthStatus
  userId?: number
  revision: number
}

export type JotmoPluginOperation =
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

export interface JotmoPluginRequest {
  operation: JotmoPluginOperation
  params?: Record<string, unknown>
}

export interface JotmoPluginErrorBody {
  code: string
  message: string
  retryable: boolean
}

export type JotmoPluginResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: JotmoPluginErrorBody }
