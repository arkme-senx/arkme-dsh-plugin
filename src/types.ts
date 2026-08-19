export type ArkmeEnvironment = 'test' | 'prod'

export const ARKME_PROVIDER_CONTRACT_VERSION = 1 as const

export type ArkmeAuthStatus = 'logged-out' | 'pending' | 'binding-required' | 'authenticated' | 'expired'

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
  environment: ArkmeEnvironment
  testLoginEnabled: boolean
  callAssetBasePath: string
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

export interface ArkmeWorldRecordItem {
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

export interface ArkmeWorldRecordList {
  items: ArkmeWorldRecordItem[]
  total: number
  hasMore: boolean
  nextOffset?: number
}

export type ArkmeWorldVisibility = 'visible' | 'pending_review' | 'rejected' | 'unknown' | 'not_published'

export interface ArkmeWorldPublishResult {
  recordSaved: boolean
  recordState: 'synced' | 'pending' | 'not_saved'
  worldPublished: boolean
  visibility: ArkmeWorldVisibility
  checkStatus: number
  retryable: boolean
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
    outgoingCall: true
    groupMembers: true
    userCard: true
    openPrivateChat: true
    groupSettings: true
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
  /** Whether this account can still use its one-time Arkme ID change. Omitted for legacy cached profiles. */
  canUpdateArkmeId?: boolean
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

export type ArkmeIdAvailabilityReason = '' | 'invalid' | 'taken' | 'modify_limited' | 'server_busy'

export interface ArkmeIdAvailabilitySnapshot {
  available: boolean
  reason: ArkmeIdAvailabilityReason
  arkmeId: string
}

export interface ArkmeIdMutationResult {
  arkmeId: string
  changed: boolean
  canUpdate: boolean
  revision: number
}

export type ArkmeSourceKind = 'default_category' | 'topic' | 'private_chat' | 'group_chat'
export type ArkmeSourceDirectory = 'root' | 'send_to_self'

export interface ArkmeSourceItem {
  sourceRef: string
  /** Opaque reference to this topic's parent. Present only when both topics are in the same directory response. */
  parentSourceRef?: string
  kind: ArkmeSourceKind
  displayName: string
  /** Opaque Provider image reference; consumers resolve it through image.read. */
  avatarRef?: string
  /** Ordered group-avatar tiles, also resolved only through image.read. */
  avatarRefs?: string[]
  latestPreview?: string
  activeAtMillis: number
  unreadCount: number
  /** Effective chat notification state. True when mute is on or push notifications are disabled. */
  isMuted?: boolean
  latestSequence?: number
  recordCount?: number
}

export interface ArkmeSourceList {
  directory: ArkmeSourceDirectory
  items: ArkmeSourceItem[]
  hasMore: boolean
  nextCursor?: string
}

/** Built-in UI result for creating a personal topic without exposing its server UID. */
export interface ArkmeTopicCreateResult {
  source: ArkmeSourceItem
  /** Present only when the requested parent relation and the automatic orphan cleanup both failed. */
  warning?: string
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
  recordVersion?: number
  aiPolish?: ArkmeTimelineAiPolish
}

export type ArkmeAiPolishSendState = 'none' | 'polishing' | 'polished' | 'kept_original' | 'failed'

export interface ArkmeTimelineAiPolish {
  state: ArkmeAiPolishSendState
  originalText?: string
  polishedText?: string
  failureMessage?: string
  /** Host-bound retry reference. Present only for the current sender's transient failed attempt. */
  retryRef?: string
}

export interface ArkmeGroupAiPolishRule {
  ruleRef: string
  name: string
  ruleText: string
  isActive: boolean
}

export interface ArkmeGroupAiPolishSnapshot {
  sourceRef: string
  groupName: string
  enabled: boolean
  canManage: boolean
  viewerRole: number
  activeRuleName: string
  rules: ArkmeGroupAiPolishRule[]
  updatedAtMillis: number
}

export interface ArkmeGroupAiPolishRuleCandidate {
  groupName: string
  ruleName: string
  ruleText: string
  confirmationRef: string
}

export interface ArkmeGroupAiPolishMutationResult {
  groupName: string
  enabled: boolean
  ruleName: string
  changed: boolean
}

export interface ArkmeGroupAiPolishNotice {
  noticeUid: string
  sourceKey: string
  message: string
  createdAtMillis: number
}

export interface ArkmeTimelinePage {
  source: ArkmeSourceItem
  items: ArkmeTimelineItem[]
  aiPolishNotices?: ArkmeGroupAiPolishNotice[]
  aiPolishSettings?: ArkmeGroupAiPolishSnapshot
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
  aiPolish?: ArkmeTimelineAiPolish
}

export type ArkmeRelatedRecordingPageState = 'empty' | 'generating' | 'success' | 'partial' | 'error'

export interface ArkmeRelatedRecordingEligibility {
  allowed: boolean
}

export interface ArkmeRelatedRecordingSpeaker {
  speakerId: string
  refUserId?: number
  nickname?: string
}

export interface ArkmeRelatedRecordingParticipant {
  speakerId: string
  refUserId?: number
  nickname?: string
  displayName: string
  role: number
}

export interface ArkmeRelatedRecordingItem {
  /** Account-bound opaque identity. Browser and Agent consumers must not parse it. */
  recordingRef: string
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
  speakers: ArkmeRelatedRecordingSpeaker[]
  participants: ArkmeRelatedRecordingParticipant[]
  isSharedByOther: boolean
}

export interface ArkmeRelatedRecordingMonthBucket {
  monthKey: string
  itemCount: number
}

export interface ArkmeRelatedRecordingPage {
  state: ArkmeRelatedRecordingPageState
  stateCode: number
  stateMessage: string
  hasEntry: boolean
  items: ArkmeRelatedRecordingItem[]
  hasMore: boolean
  nextCursor?: string
  partial: boolean
  monthBuckets?: ArkmeRelatedRecordingMonthBucket[]
  timeIndexComplete: boolean
  legacyTimeIndexFallback: boolean
}

export interface ArkmeRelatedRecordingPageOptions {
  limit?: number
  cursor?: string
  monthKey?: string
  timezoneOffsetMillis?: number
  includeTimeIndex?: boolean
  /** Host-side diagnostic classification only; browser SDK does not forward this field. */
  consumer?: 'ui' | 'tool'
  signal?: AbortSignal
}

export interface ArkmeDirectTextSendResult {
  recipientArkmeId: string
  chatSessionUid: string
  recordUid: string
  relationUid: string
  sequence: number
  targetKind: 'direct'
}

export interface ArkmeSourceReadResult {
  sourceRef: string
  effectiveReadSequence: number
  unreadCount: number
}

export type ArkmeGroupMemberRole = 'owner' | 'admin' | 'member' | 'unknown'
export type ArkmeGroupMemberStatus = 'active' | 'left' | 'removed' | 'unknown'

export interface ArkmeGroupMemberItem {
  userId: number
  displayName: string
  memberName?: string
  secondaryName?: string
  avatarRef?: string
  role: ArkmeGroupMemberRole
  status: ArkmeGroupMemberStatus
  isSelf: boolean
  isOwner: boolean
  joinedAtMillis: number
}

export interface ArkmeGroupMemberList {
  source: ArkmeSourceItem
  items: ArkmeGroupMemberItem[]
  total: number
  activeCount: number
  selfRole: ArkmeGroupMemberRole
  selfStatus: ArkmeGroupMemberStatus
}

export interface ArkmeUserCardSnapshot {
  displayName: string
  avatarRef?: string
}

export interface ArkmeOpenPrivateChatResult {
  source: ArkmeSourceItem
}

export interface ArkmeGroupSettingsSnapshot {
  source: ArkmeSourceItem
  selfRole: ArkmeGroupMemberRole
  selfStatus: ArkmeGroupMemberStatus
  canRename: boolean
  canDissolve: boolean
  canLeave: boolean
  messageDnd: boolean
}

export interface ArkmeGroupNotificationResult {
  messageDnd: boolean
}

export interface ArkmeGroupActionResult {
  source: ArkmeSourceItem
  status: 'ok'
}

export interface ArkmeRecordingCalendarDay {
  dateStamp: number
  durationMillis: number
  hasRecording: boolean
  unreviewedCount: number
}

export interface ArkmeRecordingCalendarMonth {
  fromStamp: number
  toStamp: number
  days: ArkmeRecordingCalendarDay[]
}

export type ArkmeRecordingProjectionKind = 'summary' | 'timeline'
export type ArkmeRecordingToolContent = 'transcript' | ArkmeRecordingProjectionKind

export interface ArkmeRecordingCursorPayload {
  version: 1
  dateStamp: number
  content: ArkmeRecordingToolContent
  versionId?: string
  itemOffset: number
  textOffset: number
  fingerprint: string
}

export interface ArkmeRecordingTranscriptItem {
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

export interface ArkmeRecordingTimelineEvent {
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

export type ArkmeRecordingVersionStatus = 'processing' | 'done' | 'failed'
export type ArkmeRecordingSectionState = 'ready' | 'empty' | 'processing' | 'failed' | 'error'

export interface ArkmeRecordingVersion {
  id: string
  status: ArkmeRecordingVersionStatus
  selectable: boolean
  generationStage: number
  generatedAtMillis: number
  modelDisplayName: string
  content: string
  timelineEvents: ArkmeRecordingTimelineEvent[]
  error: string
}

export interface ArkmeRecordingSection<T> {
  state: ArkmeRecordingSectionState
  items: T[]
  message: string
}

export interface ArkmeRecordingTranscriptSection extends ArkmeRecordingSection<ArkmeRecordingTranscriptItem> {
  identityCoverage?: 'complete' | 'partial'
  totalDurationMillis: number
}

export interface ArkmeRecordingDay {
  dateStamp: number
  totalDurationMillis: number
  transcript: ArkmeRecordingSection<ArkmeRecordingTranscriptItem>
  summary: ArkmeRecordingSection<ArkmeRecordingVersion>
  timeline: ArkmeRecordingSection<ArkmeRecordingVersion>
}

export type ArkmeWechatMessageFilter =
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

export type ArkmeWechatCallFilter = 'all' | 'audio' | 'video'

export interface ArkmeWechatConversation {
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

export interface ArkmeWechatConversationPage {
  conversations: ArkmeWechatConversation[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeWechatMessage {
  content: string
  senderName: string
  isMe: boolean
  sentAtMillis: number
  messageType: string
  hasMedia: boolean
  mediaDuration?: number
  mimeType?: string
}

export interface ArkmeWechatMessagePage {
  conversationRef: string
  messages: ArkmeWechatMessage[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeWechatConversationDetail {
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

export interface ArkmeWechatGroupMember {
  name: string
  messageCount: number
  lastSendAtMillis?: number
  isOwner: boolean
  isFriend: boolean
  isMe: boolean
  isInGroup: boolean
}

export interface ArkmeWechatGroupMemberPage {
  conversationRef: string
  members: ArkmeWechatGroupMember[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeWechatPhoneEvidence {
  why?: string
  content?: string
  sentAtMillis?: number
}

export interface ArkmeWechatPhone {
  phone: string
  likelyOwner?: string
  confidence?: number
  reason?: string
  occurrenceCount: number
  lastSeenAtMillis: number
  evidence: ArkmeWechatPhoneEvidence[]
  isRegistered: boolean
  registeredNickname?: string
  location?: string
  taskStatus?: string
}

export interface ArkmeWechatPhonePage {
  phones: ArkmeWechatPhone[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeWechatCommonGroupFriend {
  name: string
  commonGroupCount: number
  lastSendAtMillis?: number
  sampleConversationRefs: string[]
}

export interface ArkmeWechatCommonGroupPage {
  friends: ArkmeWechatCommonGroupFriend[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeWechatMoneyFlow {
  conversationRef?: string
  content: string
  senderName: string
  isMe: boolean
  sentAtMillis: number
}

export interface ArkmeWechatMoneyFlowPage {
  moneyFlows: ArkmeWechatMoneyFlow[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeWechatLocation {
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

export interface ArkmeWechatLocationPage {
  locations: ArkmeWechatLocation[]
  total: number
  hasMore: boolean
  nextCursor?: string
}

export type ArkmeAiVideoTranscriptSource = 'system' | 'doubao'

export interface ArkmeAiVideoSegmentSelector {
  childId: string
  asrItemIndex: number
  transcriptSource: ArkmeAiVideoTranscriptSource
}

export interface ArkmeAiVideoPreflightResult {
  allowed: boolean
  message: string
  selectedDurationMillis: number
  minimumDurationMillis: number
  selectedSegmentCount: number
  retryable: boolean
  reasonCode?: string
  proof?: string
}

export type ArkmeAiVideoJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface ArkmeAiVideoJob {
  jobId: string
  status: ArkmeAiVideoJobStatus
  stage: string
  progress: number
  selectedSegmentCount: number
  retryable: boolean
  videoAssetUid?: string
  coverAssetUid?: string
  videoDurationMillis?: number
  errorCode?: string
  errorMessage?: string
  failureStage?: string
}

export interface ArkmeArkoProfile {
  displayName: string
  version: number
}

export interface ArkmeArkoSession {
  sessionId: number
  created: boolean
  name: string
}

export interface ArkmeArkoModelOption {
  routeKey: string
  displayName: string
  provider: string
  description: string
  recommended: boolean
  selected: boolean
}

export interface ArkmeArkoModelCatalog {
  defaultRouteKey: string
  effectiveRouteKey: string
  selectionSource: 'default' | 'personal'
  options: ArkmeArkoModelOption[]
}

export type ArkmeArkoMessageRole = 'user' | 'assistant'

export interface ArkmeArkoHistoryItem {
  messageId: number
  sessionId: number
  role: ArkmeArkoMessageRole
  text: string
  reasoning: string
  createdAtMillis: number
  status: number
  runUid?: string
  runStatus?: string
  retryable?: boolean
  errorCode?: string
  retryOfRunUid?: string
  createdRecordUids: string[]
}

export interface ArkmeArkoHistoryPage {
  items: ArkmeArkoHistoryItem[]
  hasMore: boolean
  nextOffset?: number
}

export interface ArkmeArkoRunProjection {
  runUid: string
  status: string
  retryable: boolean
  errorCode?: string
  retryOfRunUid?: string
  clientAction?: Record<string, unknown>
}

export interface ArkmeArkoAskResult {
  sessionId: number
  userMsgId: number
  assistantMsgId: number
  runUid?: string
  text: string
  reasoning: string
  status: string
  terminal: boolean
  timedOut: boolean
  errorMessage?: string
  createdRecordUids: string[]
  profile?: ArkmeArkoProfile
  run?: ArkmeArkoRunProjection
}

export interface ArkmeArkoRunStatus {
  sessionId: number
  runUid: string
  status: string
  sequence: number
  surfaceAssistantMsgId: number
  retryable: boolean
  errorCode?: string
  retryOfRunUid?: string
  clientAction?: Record<string, unknown>
}

export interface ArkmeArkoCancelResult {
  sessionId: number
  assistantMsgId: number
  runUid: string
  status: string
}

export interface ArkmeProviderState {
  contractVersion: typeof ARKME_PROVIDER_CONTRACT_VERSION
  environment: ArkmeEnvironment
  authStatus: ArkmeAuthStatus
  userId?: number
  revision: number
}

export type ArkmePluginUpdateAvailability = 'unknown' | 'current' | 'available' | 'ahead'
export type ArkmePluginUpdateLevel = 'normal' | 'important' | 'critical'

export interface ArkmePluginUpdateNotice {
  schemaVersion: 1
  level: ArkmePluginUpdateLevel
  title?: string
  summary?: string
  publishedAt?: string
  releaseNotesUrl?: string
}

/** Browser-safe projection of the Host-owned plugin update state. */
export interface ArkmePluginUpdateStatus {
  enabled: boolean
  installedVersion: string
  latestVersion?: string
  availability: ArkmePluginUpdateAvailability
  level: ArkmePluginUpdateLevel
  title?: string
  summary?: string
  releaseNotesUrl?: string
  checkedAtMillis?: number
  lastSuccessfulCheckAtMillis?: number
  stale: boolean
  checkFailed: boolean
  checking: boolean
  acknowledged: boolean
  snoozedUntilMillis?: number
  updateCommand: string
  canInstallInApp: boolean
  installBlockedReason?: 'update-disabled' | 'local-install' | 'profile-unavailable' | 'runtime-unavailable'
  restartRequired: true
}

export type ArkmePluginUpdateInstallPhase =
  | 'idle'
  | 'preparing'
  | 'installing'
  | 'restarting'
  | 'succeeded'
  | 'failed'
  | 'rolled-back'

export interface ArkmePluginUpdateInstallSnapshot {
  schemaVersion: 1
  jobId: string
  phase: ArkmePluginUpdateInstallPhase
  previousVersion: string
  targetVersion: string
  message: string
  updatedAtMillis: number
}

export interface ArkmeChatRealtimeState {
  revision: number
  connected: boolean
  lastEventAtMillis?: number
}

export type ArkmeChatClientEvent = {
  type: 'reconcile'
  revision: number
  connected: boolean
} | {
  type: 'sessions-delta'
  revision: number
  updates: Array<{ source: ArkmeSourceItem; timelineItems: ArkmeTimelineItem[] }>
} | {
  type: 'read-ack'
  revision: number
  sourceRef: string
  unreadCount: number
}

export type ArkmePluginOperation =
  | 'provider.capabilities'
  | 'provider.state'
  | 'chat.realtime.state'
  | 'auth.status'
  | 'auth.config'
  | 'auth.begin'
  | 'auth.poll'
  | 'auth.test.login'
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
  | 'source.mark-read'
  | 'source.send-text'
  | 'related-recordings.eligibility'
  | 'related-recordings.page'
  | 'source.ai-polish.settings'
  | 'source.ai-polish.notices'
  | 'source.ai-polish.generate-rule'
  | 'source.ai-polish.confirm-enable'
  | 'source.ai-polish.prepare-disable'
  | 'source.ai-polish.confirm-disable'
  | 'source.ai-polish.retry'
  | 'group.members'
  | 'group.settings'
  | 'group.notification.set'
  | 'group.rename'
  | 'group.leave'
  | 'group.dissolve'
  | 'group.report'
  | 'user.card'
  | 'chat.private.open'
  | 'calls.outgoing.intent.claim'
  | 'calls.outgoing.intent.resolve'
  | 'calls.outgoing.prepare'
  | 'calls.outgoing.heartbeat'
  | 'calls.outgoing.release'

export type ArkmeHostOperation = ArkmePluginOperation
  | 'dsh-beta-community.entry-state'
  | 'dsh-beta-community.join'
  | 'recordings.calendar'
  | 'recordings.day'
  | 'topic.create'
  | 'arko.profile'
  | 'arko.session'
  | 'arko.new-session'
  | 'arko.models'
  | 'arko.model.activate'
  | 'arko.history'
  | 'arko.ask'
  | 'arko.run.status'
  | 'arko.cancel'
  | 'plugin.update.status'
  | 'plugin.update.check'
  | 'plugin.update.acknowledge'
  | 'plugin.update.install'
  | 'plugin.update.install-status'

export interface ArkmePluginRequest {
  operation: ArkmeHostOperation
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
