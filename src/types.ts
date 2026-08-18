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

export interface JotmoWorldRecordItem {
  authorName: string
  headline: string
  textContent: string
  tags: string[]
  templateKind: number
  createdAtMillis: number
  publishedAtMillis: number
  imageCount: number
  videoCount: number
  voiceCount: number
  extendCount: number
}

export interface JotmoWorldRecordList {
  items: JotmoWorldRecordItem[]
  total: number
  hasMore: boolean
  nextOffset?: number
}

export type JotmoWorldVisibility = 'visible' | 'pending_review' | 'rejected' | 'unknown' | 'not_published'

export interface JotmoWorldPublishResult {
  recordSaved: boolean
  recordState: 'synced' | 'pending' | 'not_saved'
  worldPublished: boolean
  visibility: JotmoWorldVisibility
  checkStatus: number
  retryable: boolean
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

export type JotmoCallMediaType = 'audio' | 'video' | 'unknown'
export type JotmoCallDirection = 'incoming' | 'outgoing' | 'group' | 'unknown'
export type JotmoCallSectionState = 'ready' | 'empty' | 'processing' | 'failed'

export interface JotmoCallListItem {
  callRef: string
  displayName: string
  /** Opaque provider-scoped reference; resolve through `image.read`. */
  avatarRef?: string
  participantCount: number
  mediaType: JotmoCallMediaType
  direction: JotmoCallDirection
  connected: boolean
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  summaryState: JotmoCallSectionState
  summaryPreview: string
}

export interface JotmoCallList {
  items: JotmoCallListItem[]
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoCallParticipant {
  displayName: string
  /** Opaque provider-scoped reference; resolve through `image.read`. */
  avatarRef?: string
  isSelf: boolean
  connected: boolean
}

export interface JotmoCallTranscriptItem {
  itemId: string
  startOffsetMillis: number
  endOffsetMillis: number
  speakerLabel: string
  /** Opaque provider-scoped reference; resolve through `image.read`. */
  avatarRef?: string
  isSelf: boolean
  text: string
}

export interface JotmoCallTextSection {
  state: JotmoCallSectionState
  content: string
  message: string
}

export interface JotmoCallTranscriptSection {
  state: JotmoCallSectionState
  /** Partial plain-text items may be present while state is `processing`. */
  items: JotmoCallTranscriptItem[]
  message: string
}

export interface JotmoCallDetail {
  callRef: string
  displayName: string
  participants: JotmoCallParticipant[]
  mediaType: JotmoCallMediaType
  direction: JotmoCallDirection
  connected: boolean
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  summary: JotmoCallTextSection
  transcript: JotmoCallTranscriptSection
}

export interface JotmoProviderCapabilities {
  contractVersion: typeof JOTMO_PROVIDER_CONTRACT_VERSION
  provider: '@senguoyun/dsh-arkme'
  sdk: '@senguoyun/dsh-arkme/sdk'
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
    sourceDirectory: true
    sourceTimeline: true
    sourceTextSend: true
    callHistory: true
    callDetail: true
    relatedRecordings?: true
  }
  limits: {
    maxTextLength: number
    maxSearchResults: number
    maxSyncPages: number
    maxImageBytes: number
    maxRelatedRecordingPageSize?: number
    maxRelatedRecordingCursorLength?: number
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

export type JotmoSourceKind = 'default_category' | 'topic' | 'private_chat' | 'group_chat'
export type JotmoSourceDirectory = 'root' | 'send_to_self'

export interface JotmoSourceItem {
  sourceRef: string
  kind: JotmoSourceKind
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

export interface JotmoSourceList {
  directory: JotmoSourceDirectory
  items: JotmoSourceItem[]
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoTimelineCursor {
  sendAtMillis?: number
  itemUid?: string
  beforeSequence?: number
}

export interface JotmoTimelineItem {
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

export interface JotmoTimelinePage {
  source: JotmoSourceItem
  items: JotmoTimelineItem[]
  hasMore: boolean
  nextCursor?: JotmoTimelineCursor
}

export interface JotmoSourceSendResult {
  sourceRef: string
  itemUid: string
  status: number
  sequence?: number
  localState: 'synced' | 'failed'
  error?: string
}

export type JotmoRelatedRecordingPageState = 'empty' | 'generating' | 'success' | 'partial' | 'error'

export interface JotmoRelatedRecordingEligibility {
  allowed: boolean
}

export interface JotmoRelatedRecordingSpeaker {
  speakerId: string
  refUserId?: number
  nickname?: string
}

export interface JotmoRelatedRecordingParticipant {
  speakerId: string
  refUserId?: number
  nickname?: string
  displayName: string
  role: number
}

export interface JotmoRelatedRecordingItem {
  /** Stable opaque identity from the recording owner; consumers must not parse it. */
  recordingRef: string
  momentId: string
  sessionId: string
  summaryId?: string
  originalName?: string
  startAtMillis: number
  endAtMillis: number
  dateStamp?: number
  timezoneOffsetMillis?: number
  timeRangeText: string
  title: string
  summary: string
  summaryStatus: number
  transcript?: string
  transcriptAvailable: boolean
  speakers: JotmoRelatedRecordingSpeaker[]
  participants: JotmoRelatedRecordingParticipant[]
  isSharedByOther: boolean
}

export interface JotmoRelatedRecordingMonthBucket {
  monthKey: string
  itemCount: number
}

export interface JotmoRelatedRecordingPage {
  state: JotmoRelatedRecordingPageState
  stateCode: number
  stateMessage: string
  hasEntry: boolean
  items: JotmoRelatedRecordingItem[]
  hasMore: boolean
  nextCursor?: string
  partial: boolean
  monthBuckets?: JotmoRelatedRecordingMonthBucket[]
  timeIndexComplete: boolean
  legacyTimeIndexFallback: boolean
}

export interface JotmoRelatedRecordingPageOptions {
  limit?: number
  cursor?: string
  monthKey?: string
  timezoneOffsetMillis?: number
  includeTimeIndex?: boolean
  /** Host-side diagnostic classification only; browser SDK does not forward this field. */
  consumer?: 'ui' | 'tool'
  signal?: AbortSignal
}

export type JotmoWechatMessageFilter =
  | 'all'
  | 'image'
  | 'voice'
  | 'video'
  | 'emoji'
  | 'location'
  | 'location_share'
  | 'call'
  | 'chat_record'
  | 'reply'

export type JotmoWechatCallFilter = 'all' | 'audio' | 'video'

export interface JotmoWechatConversation {
  /** Account-bound opaque reference used by the other WeChat tools. */
  conversationRef: string
  name: string
  remark?: string
  nickname?: string
  isGroup: boolean
  messageCount: number
  lastSendAtMillis: number
  isBound: boolean
}

export interface JotmoWechatConversationPage {
  conversations: JotmoWechatConversation[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoWechatMessage {
  content: string
  senderName: string
  isMe: boolean
  sentAtMillis: number
  messageType: string
  hasMedia: boolean
  mediaDuration?: number
  mimeType?: string
}

export interface JotmoWechatMessagePage {
  conversationRef: string
  messages: JotmoWechatMessage[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoWechatConversationDetail {
  conversationRef: string
  name: string
  remark?: string
  nickname?: string
  isGroup: boolean
  wechatAlias?: string
  wechatId?: string
  messageCount: number
  voiceCount: number
  imageCount: number
  emojiCount: number
  videoCount: number
  firstSendAtMillis?: number
  lastSendAtMillis?: number
  importedAtMillis?: number
  commonGroupCount?: number
  groupOwnerName?: string
  groupMemberCount?: number
  groupCommonFriendCount?: number
}

export interface JotmoWechatGroupMember {
  name: string
  messageCount: number
  lastSendAtMillis?: number
  isOwner: boolean
  isFriend: boolean
  isMe: boolean
  isInGroup: boolean
}

export interface JotmoWechatGroupMemberPage {
  conversationRef: string
  members: JotmoWechatGroupMember[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoWechatPhoneEvidence {
  why?: string
  content?: string
  sentAtMillis?: number
}

export interface JotmoWechatPhone {
  phone: string
  likelyOwner?: string
  confidence?: number
  reason?: string
  occurrenceCount: number
  lastSeenAtMillis: number
  evidence: JotmoWechatPhoneEvidence[]
  isRegistered: boolean
  registeredNickname?: string
  location?: string
  taskStatus?: string
}

export interface JotmoWechatPhonePage {
  phones: JotmoWechatPhone[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoWechatCommonGroupFriend {
  name: string
  commonGroupCount: number
  lastSendAtMillis?: number
  sampleConversationRefs: string[]
}

export interface JotmoWechatCommonGroupPage {
  friends: JotmoWechatCommonGroupFriend[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoWechatMoneyFlow {
  conversationRef?: string
  content: string
  senderName: string
  isMe: boolean
  sentAtMillis: number
}

export interface JotmoWechatMoneyFlowPage {
  moneyFlows: JotmoWechatMoneyFlow[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoWechatLocation {
  conversationRef?: string
  conversationName: string
  entryType: string
  latitude: number
  longitude: number
  poiName?: string
  address?: string
  senderName?: string
  isMe: boolean
  sentAtMillis?: number
}

export interface JotmoWechatLocationPage {
  locations: JotmoWechatLocation[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface JotmoRecordingCalendarDay {
  dateStamp: number
  durationMillis: number
  hasRecording: boolean
  unreviewedCount: number
}

export interface JotmoRecordingCalendarMonth {
  fromStamp: number
  toStamp: number
  days: JotmoRecordingCalendarDay[]
}

export interface JotmoRecordingTranscriptItem {
  itemId: string
  sessionId: string
  childId: string
  startAtMillis: number
  endAtMillis: number
  speakerNumber: number
  speakerColorIndex: number
  speakerLabel: string
  isSelf: boolean
  isBackground: boolean
  text: string
}

export interface JotmoRecordingTimelineEvent {
  eventId: string
  startAt: string
  endAt: string
  timeRange: string
  title: string
  description: string
  scene: string
  emotion: string
  todo: string
  tags: string[]
  participants: string[]
  rawText: string
}

export type JotmoRecordingVersionStatus = 'processing' | 'done' | 'failed'
export type JotmoRecordingSectionState = 'ready' | 'empty' | 'processing' | 'failed' | 'error'
export type JotmoRecordingProjectionKind = 'summary' | 'timeline'
export type JotmoRecordingIdentityCoverage = 'complete' | 'partial'
export type JotmoRecordingToolContent = 'transcript' | 'summary' | 'timeline'

export interface JotmoRecordingVersion {
  id: string
  status: JotmoRecordingVersionStatus
  selectable: boolean
  generationStage: number
  generatedAtMillis: number
  modelDisplayName: string
  content: string
  timelineEvents: JotmoRecordingTimelineEvent[]
  error: string
}

export interface JotmoRecordingSection<T> {
  state: JotmoRecordingSectionState
  items: T[]
  message: string
}

export interface JotmoRecordingTranscriptSection
  extends JotmoRecordingSection<JotmoRecordingTranscriptItem> {
  identityCoverage: JotmoRecordingIdentityCoverage
  totalDurationMillis: number
}

export type JotmoRecordingVersionSection = JotmoRecordingSection<JotmoRecordingVersion>

export interface JotmoRecordingCursorPayload {
  version: 1
  dateStamp: number
  content: JotmoRecordingToolContent
  versionId?: string
  itemOffset: number
  textOffset: number
  fingerprint: string
}

export interface JotmoRecordingDay {
  dateStamp: number
  totalDurationMillis: number
  transcript: JotmoRecordingSection<JotmoRecordingTranscriptItem>
  summary: JotmoRecordingSection<JotmoRecordingVersion>
  timeline: JotmoRecordingSection<JotmoRecordingVersion>
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
  | 'sources.list'
  | 'source.timeline'
  | 'source.send-text'
  | 'calls.list'
  | 'calls.detail'
  | 'related-recordings.eligibility'
  | 'related-recordings.page'

export type JotmoHostOperation = JotmoPluginOperation
  | 'recordings.calendar'
  | 'recordings.day'

export interface JotmoPluginRequest {
  operation: JotmoHostOperation
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
