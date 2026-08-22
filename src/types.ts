export type ArkmeEnvironment = 'test' | 'prod'

export const ARKME_PROVIDER_CONTRACT_VERSION = 1 as const
export const ARKME_DEFAULT_SHARE_WEBSITE = 'https://app.arkme.ai'

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
  shareWebsite: string
}

export type ArkmeContactIdentifierKind = 'phone' | 'arkme_id'

/** Browser/model-safe projection returned by contact lookup. */
export interface ArkmeContactSearchResult {
  contactRef: string
  identifierKind: ArkmeContactIdentifierKind
  displayName: string
  arkmeId?: string
  avatarRef?: string
  registered: boolean
  inviteBySms: boolean
  canAdd: boolean
  isSelf: boolean
}

export interface ArkmeContactAddResult {
  state: 'ready' | 'pending'
  source: ArkmeSourceItem
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
  displayKind?: number
  contentBlocks?: ArkmeContentBlock[]
  /** Record owner reported media refs, but their delivery projection was temporarily unavailable. */
  mediaUnavailable?: boolean
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

export type ArkmeCalendarScopeKind = 'self'

export interface ArkmeCalendarBucketDay {
  bucketDate: string
  count: number
  protectedCount: number
  hasRecords: boolean
  firstSendAtMillis?: number
}

export interface ArkmeCalendarBucketPage {
  scope: ArkmeCalendarScopeKind
  startDate: string
  endDate: string
  timezone: string
  refreshedAtMillis: number
  days: ArkmeCalendarBucketDay[]
}

export type ArkmeCalendarContentAccessState = 'available' | 'protected' | 'unknown'

export interface ArkmeCalendarRecordCursor {
  sendAtMillis: number
  recordUid: string
}

export interface ArkmeCalendarRecordItem {
  recordUid: string
  sendAtMillis: number
  accessState: ArkmeCalendarContentAccessState
  title: string
  textContent: string
  preview: string
  topicTitle?: string
  sourceKind: 'self' | 'topic' | 'chat' | 'unknown'
  creationSource: number
  templateKind: number
  displayKind: number
  protected: boolean
  isUncategorized?: boolean
  hasManualEdit?: boolean
  hasPolish?: boolean
}

export interface ArkmeCalendarDayRecordPage {
  scope: ArkmeCalendarScopeKind
  bucketDate: string
  timezone: string
  refreshedAtMillis: number
  items: ArkmeCalendarRecordItem[]
  hasMore: boolean
  nextCursor?: ArkmeCalendarRecordCursor
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

export type ArkmeBotProvider = 'openclaw' | 'webhook'
export type ArkmeBotStatus = 'online' | 'offline' | 'unknown'

export interface ArkmeBotSummary {
  botRef: string
  name: string
  provider: ArkmeBotProvider
  description: string
  status: ArkmeBotStatus
  directChatAvailable: boolean
}

export interface ArkmeBotList {
  items: ArkmeBotSummary[]
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

/** Browser-safe public World card. Stable IDs and signed media URLs stay inside the Provider. */
export interface ArkmeWorldAvatarFallback {
  kind: 'phone_default'
  colorIndex: number
  label: string
}

export interface ArkmeWorldFeedItem {
  recordRef: string
  authorName: string
  avatarRef?: string
  avatarFallback?: ArkmeWorldAvatarFallback
  headline: string
  textContent: string
  tags: string[]
  templateKind: number
  createdAtMillis: number
  publishedAtMillis: number
  imageRefs: string[]
  imageCount: number
  videoCount: number
  voiceCount: number
  extendCount: number
}

export interface ArkmeWorldFeedPage {
  items: ArkmeWorldFeedItem[]
  total: number
  hasMore: boolean
  nextOffset?: number
}

export interface ArkmeWorldVoiceprintAvailabilityItem {
  recordRef: string
  playable: boolean
}

export interface ArkmeWorldVoiceprintAvailability {
  items: ArkmeWorldVoiceprintAvailabilityItem[]
}

/** Browser-safe generated World voice chunk. The signed Audio URL stays inside the Provider. */
export interface ArkmeWorldVoiceprintPlaybackChunk {
  mediaRef: string
  mimeType: string
  durationMillis: number
  cacheHit: boolean
  chunkIndex: number
  chunkCount: number
  chunkStartRune: number
  chunkEndRune: number
}

export interface ArkmeWorldVoiceprintInviteResult {
  sent: true
  peerDisplayName: string
  messageItemUid?: string
  expiresAtMillis: number
}

/** Browser-safe World comment or reply. Stable record IDs stay inside the Provider. */
export interface ArkmeWorldInteractionItem {
  interactionRef: string
  parentRef: string
  authorName: string
  avatarRef?: string
  avatarFallback?: ArkmeWorldAvatarFallback
  textContent: string
  createdAtMillis: number
  publishedAtMillis: number
  imageCount: number
  videoCount: number
  voiceCount: number
}

export interface ArkmeWorldInteractionPage {
  items: ArkmeWorldInteractionItem[]
  total: number
  hasMore: boolean
  nextOffset?: number
}

export interface ArkmeWorldInteractionCreateResult {
  interaction: ArkmeWorldInteractionItem
}

export type ArkmeArrangementStatus = 'identified' | 'following' | 'completed' | 'unknown'
export type ArkmeArrangementListStatus = Exclude<ArkmeArrangementStatus, 'unknown'> | 'all'

/** Browser-safe Arrangement projection. Stable owner UIDs stay inside the Provider. */
export interface ArkmeArrangementItem {
  arrangementRef: string
  title: string
  description: string
  status: ArkmeArrangementStatus
  reminderEnabled: boolean
  reminderState: string
  createdAtMillis: number
  updatedAtMillis: number
  dueAtMillis?: number
  remindAtMillis?: number
}

export interface ArkmeArrangementPage {
  items: ArkmeArrangementItem[]
  total: number
  hasMore: boolean
  nextOffset?: number
}

export type ArkmeArrangementDetail = ArkmeArrangementItem

/** Reminder-event identity is intentionally separate from Arrangement identity. */
export interface ArkmeArrangementReminderEvent {
  eventRef: string
  arrangementRef: string
  title: string
  description: string
  eventKind: string
  eventAtMillis: number
  dueAtMillis?: number
  remindAtMillis?: number
  read: boolean
  readAtMillis?: number
  reminderState: string
  createdAtMillis: number
  updatedAtMillis: number
}

export interface ArkmeArrangementReminderPage {
  items: ArkmeArrangementReminderEvent[]
  total: number
  hasMore: boolean
  nextOffset?: number
}

export interface ArkmeArrangementReminderSummary {
  unreadCount: number
  latestUnread?: ArkmeArrangementReminderEvent
  latestEvent?: ArkmeArrangementReminderEvent
  nextReminder?: ArkmeArrangementReminderEvent
}

export type ArkmeArrangementMutationIntent =
  | 'start-follow'
  | 'cancel-follow'
  | 'complete'
  | 'cancel-complete'
  | 'delete'

export type ArkmeArrangementMutationOutcome = 'confirmed' | 'reconciled' | 'unknown'

export interface ArkmeArrangementMutationResult {
  arrangementRef: string
  intent: ArkmeArrangementMutationIntent
  outcome: ArkmeArrangementMutationOutcome
  item?: ArkmeArrangementItem
  deleted?: boolean
}

export interface ArkmeArrangementReminderToggleResult {
  arrangementRef: string
  enabled: boolean
  outcome: ArkmeArrangementMutationOutcome
  item?: ArkmeArrangementItem
}

export interface ArkmeArrangementReminderWriteResult {
  outcome: ArkmeArrangementMutationOutcome
  updatedCount?: number
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

export type ArkmeSearchSceneKind = 'audio' | 'link' | 'image_video' | 'file' | 'long_article'

export interface ArkmeSearchQueryGuard {
  state: string
  reason?: string
}

export interface ArkmeSearchHistoryItem {
  searchHistoryUid: string
  keyword: string
  searchedAtMillis: number
}

export interface ArkmeSearchHistoryResult {
  items: ArkmeSearchHistoryItem[]
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeSearchAssetItem {
  fileAssetUid: string
  fileUid?: string
  fileName?: string
  mimeType?: string
  fileKind?: number
  size?: number
  durationMillis?: number
}

/** Browser-safe image projection used by the desktop search image library. */
export interface ArkmeImageSearchItem {
  itemKey: string
  mediaRef: string
  recordUid: string
  sendAtMillis: number
  fileName: string
  mimeType: string
  size: number
  recordTitle: string
  sourceTitle?: string
}

export interface ArkmeImageSearchResult {
  items: ArkmeImageSearchItem[]
  hasMore: boolean
  nextCursor?: string
  queryGuard: ArkmeSearchQueryGuard
}

export interface ArkmeSearchRecordItem {
  recordUid: string
  sourceKind: number
  sourceUid?: string
  routeTargetKind: string
  routeTargetUid?: string
  sendAtMillis: number
  title: string
  textContent: string
  snippet: string
  nickname?: string
  templateKind?: number
  displayKind?: number
  sourceTitle?: string
  media: ArkmeSearchAssetItem[]
  files: ArkmeSearchAssetItem[]
  voice?: ArkmeSearchAssetItem
  linkUrl?: string
  recordDurationMillis?: number
  sceneItemCount?: number
  sceneItemSize?: number
}

export interface ArkmeSearchSourceAggregate {
  sourceKind: number
  sourceUid: string
  routeTargetKind: string
  routeTargetUid?: string
  title: string
  matchedRecordCount: number
  matchedRecordCountExact: boolean
}

export interface ArkmeRecordSearchResult {
  items: ArkmeSearchRecordItem[]
  sourceAggregates: ArkmeSearchSourceAggregate[]
  hasMore: boolean
  nextCursor?: string
  queryGuard: ArkmeSearchQueryGuard
  itemCount?: number
  itemSize?: number
}

export interface ArkmeRecordingSearchItem {
  sessionId: string
  recordUid?: string
  dateStamp: number
  startAtMillis: number
  snippet: string
  score: number
}

export interface ArkmeRecordingSearchResult {
  items: ArkmeRecordingSearchItem[]
  hasMore: boolean
  nextCursor?: string
  queryGuard: ArkmeSearchQueryGuard
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
    /** Record-calendar bucket and day-record reads backed by the Arkme record service. */
    recordCalendar?: true
    /** Authorized image-library listing with opaque, account-bound media references is available. */
    imageLibrary?: true
    sourceDirectory: true
    sourceTimeline: true
    sourceTextSend: true
    richContentRead: boolean
    richContentSend: boolean
    fileUpload: boolean
    outgoingCall: true
    groupMembers: true
    groupMemberAdd?: true
    userCard: true
    openPrivateChat: true
    /** Search accounts and idempotently add/open a contact conversation. */
    contactAdd?: true
    /** Built-in quick-add surface plus SDK/Host support for contacts, groups, and Bots. */
    conversationQuickAdd?: true
    groupSettings: true
    /** Installed-extension inspection and desired enable/disable state are available. */
    extensionManagement?: true
    /** Owner-authorized extension name, description, and private/public visibility editing is available. */
    extensionMetadataEdit?: true
    /** Extension-level icon upload and same-origin rendering are available. */
    extensionIcons?: true
    /** Extension-level preview gallery SDK and Tool mutations are available. */
    extensionPreviews?: true
    relatedRecordings?: true
    /** Optional additive capability so older Providers remain detectable by consumer plugins. */
    worldFeed?: true
    /** Optional additive capability for reading and writing World comments and replies. */
    worldInteractions?: true
    /** Optional additive capability for author-voice playback of public World text. */
    worldVoiceprintPlayback?: true
    /** Optional additive capability for sending a voiceprint invite reminder to a World author. */
    worldVoiceprintInvite?: true
    /** Optional additive capability for the independent Arrangement consumer. */
    arrangements?: true
    /** Optional additive current-account Cordis/Profile/cloud extension inventory. */
    myExtensions?: true
    /** Optional additive publication of an exact owned live Cordis Package. */
    extensionPublish?: true
    /** Optional additive capability for extension reviews, replies, and rating summaries. */
    extensionReviews?: true
    /** Optional additive capability for reading system and Doubao all-day recording transcripts. */
    recordingTranscripts?: true
    /** Optional additive capability for explicitly starting Doubao backfill for one local recording day. */
    recordingDoubaoBackfill?: true
  }
  limits: {
    maxTextLength: number
    maxSearchResults: number
    maxSyncPages: number
    maxImageBytes: number
    maxRelatedRecordingPageSize?: number
    maxRelatedRecordingCursorLength?: number
    maxUploadBytes: number
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

export type ArkmeSourceKind = 'send_to_self' | 'default_category' | 'topic' | 'private_chat' | 'group_chat'
export type ArkmeSourceDirectory = 'root' | 'send_to_self'

export type ArkmeGroupAvatarFallback =
  | { kind: 'phone_default'; colorIndex: number; label: string }
  | { kind: 'default' }

export interface ArkmeGroupAvatarSlot {
  /** Opaque Provider image reference. Missing images keep their slot and use fallback instead. */
  avatarRef?: string
  fallback?: ArkmeGroupAvatarFallback
}

/** Additive presentation data for the desktop-compatible, ordered group avatar. */
export interface ArkmeGroupAvatarPresentation {
  memberCount: number
  strategy: string
  computedAtMillis: number
  /** Server-selected member order, capped at five slots. */
  slots: ArkmeGroupAvatarSlot[]
}

export interface ArkmeSourceItem {
  sourceRef: string
  /** Stable Host-projected directory identity. Consumers must treat it as opaque when present. */
  sourceKey?: string
  /** Opaque reference to this topic's parent. Present only when both topics are in the same directory response. */
  parentSourceRef?: string
  kind: ArkmeSourceKind
  displayName: string
  /** Opaque Provider image reference; consumers resolve it through image.read. */
  avatarRef?: string
  /** Ordered group-avatar tiles, also resolved only through image.read. */
  avatarRefs?: string[]
  /** Preferred group-avatar projection. Consumers that do not understand it may keep using avatarRefs. */
  groupAvatar?: ArkmeGroupAvatarPresentation
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
  /** Account-bound opaque reference for reporting this concrete group-chat message. */
  messageRef?: string
  senderName: string
  agentSource?: ArkmeTimelineAgentSource
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
  templateKind?: number
  displayKind?: number
  version?: number
  updateAtMillis?: number
  recordDurationMillis?: number
  editDurationMillis?: number
  contentBlocks?: ArkmeContentBlock[]
  /** Record owner reported media refs, but their delivery projection was temporarily unavailable. */
  mediaUnavailable?: boolean
  /** Browser-safe Chat forward snapshot. It is present only for explicit `render_kind=forward_records` payloads. */
  forwardRecords?: ArkmeForwardRecordsPreview
}

export interface ArkmeForwardRecordsPreview {
  title: string
  createdAtMillis: number
  summaryLines: string[]
  items: ArkmeForwardRecordPreviewItem[]
}

export interface ArkmeForwardRecordPreviewItem {
  senderName: string
  /** Opaque Provider image reference for the snapshotted sender. */
  avatarRef?: string
  sendAtMillis: number
  title: string
  textContent: string
  contentLabel?: string
}

export interface ArkmeTimelineAgentSource {
  kind: 'agent'
  displayName: string
  label: string
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

export type ArkmeContentKind = 'image' | 'video' | 'audio' | 'file'

/** Browser-safe media metadata. `mediaRef` is opaque and resolves only through the local Provider route. */
export interface ArkmeContentBlock {
  kind: ArkmeContentKind
  mediaRef: string
  fileAssetUid?: string
  fileName: string
  mimeType: string
  size: number
  durationSec?: number
  sortOrder: number
}

export interface ArkmeUploadedAsset {
  fileAssetUid: string
  fileName: string
  mimeType: string
  size: number
  fileKind: 1 | 2 | 3 | 4
}

export interface ArkmeRichSendInput {
  title?: string
  textContent?: string
  displayKind?: 0 | 1
  thinkingDurationMillis?: number
  assets?: ArkmeUploadedAsset[]
}

export interface ArkmeLongArticleDetail {
  sourceRef: string
  itemUid: string
  title: string
  textContent: string
  sendAtMillis: number
  updateAtMillis: number
  recordDurationMillis: number
  editDurationMillis: number
  thinkingDurationMillis: number
  version: number
  editable: boolean
}

export interface ArkmeLongArticleDraft {
  sourceRef: string
  itemUid?: string
  title: string
  textContent: string
  durationMillis: number
  updatedAtMillis: number
}

export interface ArkmeMessageReportResult {
  messageRef: string
  reportUid: string
  status: number
}

export interface ArkmeTimelinePage {
  source: ArkmeSourceItem
  items: ArkmeTimelineItem[]
  aiPolishNotices?: ArkmeGroupAiPolishNotice[]
  aiPolishSettings?: ArkmeGroupAiPolishSnapshot
  hasMore: boolean
  nextCursor?: ArkmeTimelineCursor
}

/** Built-in UI projection of private-chat group mention moments. References stay opaque to the Browser. */
export type ArkmeInterwovenState = 'disabled' | 'empty' | 'partial' | 'success'

export interface ArkmeInterwovenMention {
  momentId: string
  momentRef: string
  occurredAtMillis: number
  groupName: string
  senderName: string
  senderIsMe: boolean
  senderAvatarRef?: string
  summary: string
  degraded: boolean
}

export interface ArkmeInterwovenBootstrap {
  state: ArkmeInterwovenState
  moments: ArkmeInterwovenMention[]
  preparedAtMillis: number
  message?: string
}

export interface ArkmeInterwovenDetail {
  momentId: string
  groupName: string
  senderName: string
  senderIsMe: boolean
  senderAvatarRef?: string
  occurredAtMillis: number
  title: string
  textContent: string
  status: number
  degraded: boolean
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
  recordCount: number
}

export interface ArkmeGroupMemberList {
  source: ArkmeSourceItem
  items: ArkmeGroupMemberItem[]
  total: number
  activeCount: number
  selfRole: ArkmeGroupMemberRole
  selfStatus: ArkmeGroupMemberStatus
}

export interface ArkmeGroupMemberCandidate {
  candidateRef: string
  displayName: string
  avatarRef?: string
  origin: 'private_chat' | 'group_chat'
  relation: 'contact' | 'stranger' | 'group'
  disabled?: boolean
  alreadyMember?: boolean
  statusText?: string
}

export interface ArkmeGroupMemberCandidateGroup {
  group: ArkmeSourceItem
  items: ArkmeGroupMemberCandidate[]
  total: number
  error?: string
}

export interface ArkmeGroupBotCandidate {
  botRef: string
  name: string
  description: string
  installed: boolean
}

export interface ArkmeGroupBotCandidateList {
  groupSourceRef: string
  displayName: string
  canAddBots: boolean
  items: ArkmeGroupBotCandidate[]
}

export interface ArkmeGroupBotAddResult {
  botRef: string
  groupSourceRef: string
  installed: boolean
}

export interface ArkmeGroupMemberCandidateList {
  source: ArkmeSourceItem
  items: ArkmeGroupMemberCandidate[]
  total: number
  hasMore: boolean
  mode: 'direct_add' | 'approval_invite'
  groups: ArkmeSourceItem[]
  groupCandidates: ArkmeGroupMemberCandidateGroup[]
  contactCount: number
  strangerCount: number
}

export interface ArkmeGroupInvitePreview {
  source: ArkmeSourceItem
  title: string
  inviterDisplayName: string
  inviteLink: string
  expireAtMillis: number
  mode: 'direct_add' | 'approval_invite'
}

export type ArkmeGroupMemberAddStatus = 'added' | 'reactivated' | 'already_member' | 'invite_sent' | 'failed'

export interface ArkmeGroupMemberAddItemResult {
  candidateRef: string
  displayName: string
  status: ArkmeGroupMemberAddStatus
  error?: string
}

export interface ArkmeGroupMemberAddResult {
  source: ArkmeSourceItem
  results: ArkmeGroupMemberAddItemResult[]
  succeededCount: number
  failedCount: number
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
  transcriptSource?: ArkmeAiVideoTranscriptSource
  versionId?: string
  itemOffset: number
  textOffset: number
  fingerprint: string
}

export interface ArkmeRecordingTranscriptItem {
  itemId: string
  sessionId: string
  childId: string
  asrItemIndex: number
  transcriptSource: ArkmeAiVideoTranscriptSource
  startAtMillis: number
  endAtMillis: number
  speakerNumber: number
  speakerColorIndex: number
  speakerLabel: string
  isSelf: boolean
  isBackground: boolean
  text: string
  /** Omitted by older providers and treated as a completed transcript row. */
  transcriptStatus?: 'ready' | 'processing' | 'silent' | 'failed'
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

export interface ArkmeRecordingDoubaoBackfillResult {
  queuedChildCount: number
  inFlightChildCount: number
  missingAudioChildCount: number
}

export interface ArkmeRecordingDay {
  dateStamp: number
  totalDurationMillis: number
  transcript: ArkmeRecordingSection<ArkmeRecordingTranscriptItem>
  /** Optional for compatibility with Providers released before Doubao comparison. */
  doubaoTranscript?: ArkmeRecordingSection<ArkmeRecordingTranscriptItem>
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
  selectedTextCount?: number
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
  selectedTextCount?: number
  retryable: boolean
  videoAssetUid?: string
  coverAssetUid?: string
  videoDurationMillis?: number
  errorCode?: string
  errorMessage?: string
  failureStage?: string
}

export interface ArkmeAiVideoListItem {
  jobId: string
  sessionId: string
  status: ArkmeAiVideoJobStatus
  stage: string
  progress: number
  title: string
  sourceStartedAtMillis: number
  selectedDurationMillis: number
  selectedSegmentCount: number
  retryable: boolean
  createdAtMillis: number
  updatedAtMillis: number
  coverAssetUid?: string
  videoAssetUid?: string
  videoDurationMillis?: number
  errorCode?: string
  errorMessage?: string
}

export interface ArkmeAiVideoListResult {
  items: ArkmeAiVideoListItem[]
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeFileAssetDisplayItem {
  fileAssetUid: string
  fileName?: string
  mimeType?: string
  previewUrl?: string
  downloadUrl?: string
  status: string
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
  | 'downloading'
  | 'verifying'
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
  connectionGeneration: number
  lastEventAtMillis?: number
}

export type ArkmeChatClientEvent = {
  type: 'reconcile'
  revision: number
  connected: boolean
  refresh?: 'none' | 'if-stale' | 'force'
  connectionGeneration: number
} | {
  type: 'sessions-delta'
  revision: number
  updates: Array<{ sourceKey?: string; source: ArkmeSourceItem; timelineItems: ArkmeTimelineItem[] }>
} | {
  type: 'message-notification'
  revision: number
  notification: {
    eventUid: string
    sourceRef: string
    sourceKey: string
    sourceKind: 'private_chat' | 'group_chat'
    title: string
    body: string
    eventAtMillis: number
  }
} | {
  type: 'read-ack'
  revision: number
  sourceRef: string
  sourceKey?: string
  effectiveReadSequence: number
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
  | 'contacts.search'
  | 'contacts.add'
  | 'group.create'
  | 'bots.create'
  | 'records.summary'
  | 'records.cache'
  | 'records.refresh'
  | 'records.search'
  | 'records.list'
  | 'records.create'
  | 'records.outbox'
  | 'records.retry'
  | 'calendar.buckets'
  | 'calendar.records'
  | 'recordings.day'
  | 'recordings.doubao.start'
  | 'user.profile'
  | 'user.profile.refresh'
  | 'image.read'
  | 'images.list'
  | 'world.feed'
  | 'world.mine'
  | 'world.user'
  | 'world.voiceprint.availability'
  | 'world.voiceprint.playback.generate'
  | 'world.voiceprint.invite'
  | 'world.interactions.list'
  | 'world.interactions.create-text'
  | 'world.image.read'
  | 'arrangements.list'
  | 'arrangements.detail'
  | 'arrangements.mutate'
  | 'arrangements.reminder-enabled'
  | 'arrangements.reminders.summary'
  | 'arrangements.reminders.list'
  | 'arrangements.reminders.mark-read'
  | 'arrangements.reminders.mark-all-read'
  | 'arrangements.reminders.clear'
  | 'extensions.reviews.list'
  | 'extensions.reviews.create'
  | 'extensions.audit.check'
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
  | 'group.member-candidates'
  | 'group.invite-preview'
  | 'group.members.add'
  | 'group.bots'
  | 'group.bot.add'
  | 'group.settings'
  | 'group.notification.set'
  | 'group.rename'
  | 'group.leave'
  | 'group.dissolve'
  | 'group.report'
  | 'user.card'
  | 'chat.private.open'
  | 'source.send-rich'
  | 'source.long-article.detail'
  | 'source.long-article.update'
  | 'source.long-article.draft.get'
  | 'source.long-article.draft.put'
  | 'source.long-article.draft.delete'
  | 'calls.outgoing.intent.claim'
  | 'calls.outgoing.intent.resolve'
  | 'calls.outgoing.prepare'
  | 'calls.outgoing.heartbeat'
  | 'calls.outgoing.release'
  | 'extensions.mine.list'
  | 'extensions.mine.publish'
  | 'extensions.catalog.list'
  | 'extensions.catalog.detail'
  | 'extensions.install.preview'
  | 'extensions.metadata.update'
	| 'extensions.share.rotate'
	| 'extensions.share.detail'
  | 'extensions.installed-list'
  | 'extensions.enabled-state'
  | 'extensions.persistent.client-state'
  | 'extensions.enabled.set'
  | 'extensions.preview.delete'
  | 'extensions.preview.reorder'
  | 'extensions.catalog.list'
  | 'extensions.classification.tree'
  | 'extensions.classification.items'

export type ArkmeHostOperation = ArkmePluginOperation
  | 'provider.instance'
  | 'dsh-beta-community.entry-state'
  | 'dsh-beta-community.join'
  | 'recordings.calendar'
  | 'search.records'
  | 'search.scene'
  | 'search.recordings'
  | 'search.history'
  | 'search.history.create'
  | 'ai-video.list'
  | 'files.assets'
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
  | 'source.interwoven-moments'
  | 'source.interwoven-detail'
  | 'extensions.catalog.list'
  | 'extensions.classification.tree'
  | 'extensions.classification.items'
  | 'extensions.catalog.detail'
  | 'extensions.audit.check'
  | 'extensions.my-list'
  | 'extensions.delete'
  | 'extensions.updates'
  | 'extensions.install.preview'
  | 'extensions.install.start'
  | 'extensions.install.status'
  | 'extensions.install.pause'
  | 'extensions.install.resume'
  | 'extensions.uninstall'
  | 'extensions.restart'
  | 'extensions.persistent.invoke'
  | 'extensions.bundle.invoke'

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
