export type { ArkmeLinkMetadata } from './link-metadata.js'

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
  jiwoScanLoginEnabled: boolean
  callAssetBasePath: string
  voiceprintEnrollmentPath: string
  recordingImportPath: string
  mediaPath: string
  shareWebsite: string
  recordingWorkbenchEnabled: boolean
}

export type ArkmeBillingPaymentMethod = 'alipay_pc_web' | 'wechat_native'
export type ArkmeBillingPaymentProvider = 'alipay' | 'wechat'
export type ArkmeBillingPaymentActionType = 'open_url' | 'display_qr'

export interface ArkmeBillingPaymentMethodOption {
  id: ArkmeBillingPaymentMethod
  provider: ArkmeBillingPaymentProvider
  actionType: ArkmeBillingPaymentActionType
}

export type ArkmeBillingPaymentAction =
  | { type: 'open_url'; url: string }
  | { type: 'display_qr'; qrContent: string }
export type ArkmeBillingOrderStatus = 'pending' | 'crediting' | 'paid' | 'expired' | 'closed' | 'failed'

export interface ArkmeQuotaSnapshot {
  availableNanoCny: string
  totalNanoCny: string
  reservedNanoCny: string
  currency: 'CNY'
}

export interface ArkmeBillingProduct {
  productId: string
  title: string
  description?: string
  creditNanoCny: string
  priceMinor: number
  currency: 'CNY'
  paymentMethods: ArkmeBillingPaymentMethodOption[]
  enabled: boolean
}

export interface ArkmeBillingProductList {
  items: ArkmeBillingProduct[]
}

export interface ArkmeBillingOrderCreateInput {
  productId: string
  paymentMethod: ArkmeBillingPaymentMethod
  clientRequestId: string
}

export interface ArkmeBillingOrderSnapshot {
  orderId: string
  paymentProvider: ArkmeBillingPaymentProvider
  paymentMethod: ArkmeBillingPaymentMethod
  status: ArkmeBillingOrderStatus
  amountMinor: number
  currency: 'CNY'
  creditNanoCny: string
  expiresAtMillis: number
  paymentAction?: ArkmeBillingPaymentAction
  pollIntervalMillis?: number
  paidAtMillis?: number
  creditedAtMillis?: number
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

export type ArkmeDirectorySectionKind =
  | 'groups' | 'bots' | 'unmarked-speakers' | 'teams' | 'contacts'

/** Browser-safe directory row. Provider-private identifiers never cross this boundary. */
export type ArkmeDirectoryItem =
  | { kind: 'group'; sourceRef: string; displayName: string; avatarRef?: string; groupAvatar?: ArkmeGroupAvatarPresentation }
  | { kind: 'bot'; bot: ArkmeBotSummary }
  | { kind: 'unmarked-speaker'; candidateRef: string; speakerToken?: string; displayName: string; subtitle: string }
  | { kind: 'team'; rowKey: string; displayName: string; publicId?: string; avatarRef?: string }
  | { kind: 'contact'; contactRef: string; displayName: string; nickname: string; remark: string; accountName?: string; avatarRef?: string; letter: string }

export interface ArkmeDirectoryPage {
  section: ArkmeDirectorySectionKind
  items: ArkmeDirectoryItem[]
  total: number
  hasMore: boolean
  nextCursor?: string
  projectionState?: 'fresh' | 'stale' | 'building' | 'failed'
  retryAfterMillis?: number
  cursorStale?: boolean
}

export interface ArkmeDirectoryContactProfile {
  contactRef: string
  displayName: string
  nickname: string
  remark: string
  avatarRef?: string
}

export type ArkmeUnmarkedSpeakerInferenceState = 'pending' | 'ready' | 'failed' | 'unavailable'

export interface ArkmeUnmarkedSpeakerInference {
  state: ArkmeUnmarkedSpeakerInferenceState
  recommendedSpeakerRef?: string
  recommendedDisplayName?: string
  retryable?: boolean
}

export interface ArkmeUnmarkedSpeakerChoice {
  speakerRef: string
  displayName: string
  source: 'recommended' | 'manual'
}

/** Browser-safe detail projection for one opaque unmarked-speaker candidate ref. */
export interface ArkmeUnmarkedSpeakerOptions {
  candidateRef: string
  candidateVersion: string
  speakerToken?: string
  appearanceDays: number
  validAudioDurationMillis: number
  segmentCount: number
  latestAtMillis: number
  conversationSummaryState?: 'ready' | 'pending' | 'unavailable'
  conversationSummary?: string
  inference: ArkmeUnmarkedSpeakerInference
  speakerChoices: ArkmeUnmarkedSpeakerChoice[]
}

export interface ArkmeUnmarkedSpeakerInferenceRetry {
  candidateRef: string
  inference: ArkmeUnmarkedSpeakerInference
}

export interface ArkmeUnmarkedSpeakerSegment {
  segmentRef: string
  date: string
  sessionLabel: string
  timeRange: string
  durationMillis: number
  transcript: string
  mediaRef?: string
}

export interface ArkmeUnmarkedSpeakerSegmentPage {
  items: ArkmeUnmarkedSpeakerSegment[]
  total: number
  hasMore: boolean
  nextCursor?: string
  cursorStale?: boolean
}

export type ArkmeUnmarkedSpeakerMarkOutcome =
  | 'marked' | 'stale' | 'conflict' | 'candidate_not_found' | 'speaker_not_found'

export interface ArkmeUnmarkedSpeakerMarkResult {
  outcome: ArkmeUnmarkedSpeakerMarkOutcome
}

export interface ArkmeMyVoiceprint {
  hasVoiceprint: boolean
  nickname: string
  updatedAtMillis: number
  canIdentify: boolean
  canPlay: boolean
  canRestorePlayback: boolean
  enrollmentStatus: 'none' | 'processing' | 'ready'
  enrollmentPending: boolean
}

export interface ArkmeVoiceprintGrantItem {
  grantRef: string
  displayName: string
  avatarRef?: string
  identifyEnabled: boolean
  playEnabled: boolean
  grantedAtMillis: number
  updatedAtMillis: number
}

export interface ArkmeVoiceprintGrantPage {
  items: ArkmeVoiceprintGrantItem[]
  nextCursor: string
  hasMore: boolean
}

export type ArkmeRecognizedPersonIdentityKind = 'speaker' | 'authorized_user'

export interface ArkmeRecognizedPersonItem {
  personRef: string
  identityKind: ArkmeRecognizedPersonIdentityKind
  displayName: string
  avatarRef?: string
  playGranted: boolean
  previewAvailable: boolean
  canInvite: boolean
  inviteTargetSelectionRequired: boolean
}

export type ArkmeRecognizedPersonDetail = ArkmeRecognizedPersonItem

export interface ArkmeRecognizedPersonPage {
  items: ArkmeRecognizedPersonItem[]
  nextCursor: string
  hasMore: boolean
}

export type ArkmeRecognizedVoiceprintKind = 'local' | 'legacy' | 'authorized'

export interface ArkmeRecognizedVoiceprintItem {
  kind: ArkmeRecognizedVoiceprintKind
  hitCount: number
  createdAtMillis?: number
}

export interface ArkmeRecognizedVoiceprintLibrary {
  items: ArkmeRecognizedVoiceprintItem[]
}

export interface ArkmeVoiceprintInvitation {
  inviteUrl: string
  expiresAtMillis: number
}

export interface ArkmeVoiceprintGrantRevocation {
  revoked: true
}

export interface ArkmeVoiceprintPlaybackRestore {
  canPlay: boolean
  restored: boolean
  updatedAtMillis: number
}

export const ARKME_VOICEPRINT_ENROLLMENT_MIN_DURATION_MS = 3_000
export const ARKME_VOICEPRINT_ENROLLMENT_MAX_DURATION_MS = 60_000
export const ARKME_VOICEPRINT_ENROLLMENT_MAX_AUDIO_BYTES = 10 * 1024 * 1024

export interface ArkmeVoiceprintEnrollmentResult {
  status: 'processing'
  cloneReady: boolean
  updatedAtMillis: number
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
  creationSource?: number
  localState?: 'synced' | 'pending' | 'failed'
  lastError?: string
  displayKind?: number
  contentBlocks?: ArkmeContentBlock[]
  /** Durable extension edge restored from record/home/topic projections. */
  extensionParentRecordUid?: string
  /** Inline parent snapshot returned with a persisted record extension. */
  extensionParent?: ArkmeTimelineExtensionParent
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
  /** Composer time that must survive the durable outbox retry path. */
  recordDurationMillis?: number
  /** Browser capture data that must survive the durable outbox retry path. */
  captureContext?: ArkmeRecordCaptureContext
  lastError?: string
}

export interface ArkmeCreateTextResult {
  recordUid: string
  status: number
}

/** Result of creating a canonical Record backed by uploaded file assets. */
export interface ArkmeCreateFileAssetRecordResult {
  recordUid: string
  status: number
}

export type ArkmeBotProvider = 'openclaw' | 'webhook'
export type ArkmeBotStatus = 'online' | 'offline' | 'unknown'
export type ArkmeBotConversationProjection = 'record' | 'chat' | 'none'

export interface ArkmeBotSummary {
  botRef: string
  /** Stable, account-scoped opaque key for plugin-local directory preferences. */
  directoryKey?: string
  name: string
  provider: ArkmeBotProvider
  description: string
  status: ArkmeBotStatus
  directChatAvailable: boolean
  /** Whether this Bot accepts outbound private-chat messages from Arkme. */
  privateChatOutboundEnabled?: boolean
  /** Whether canonical Record changes can update this Bot conversation. */
  refreshOnRecordChanges?: boolean
  /** Owner-neutral projection channel used to refresh the current conversation. */
  conversationProjection?: ArkmeBotConversationProjection
  /** Account-bound opaque key matching the canonical Chat directory item, when Chat owns the conversation. */
  chatSourceKey?: string
  /** Creation time supplied by the Bot service, when available. */
  createdAtMillis?: number
  /** Latest private-chat message time, when the conversation directory has been hydrated. */
  latestMessageAtMillis?: number
  /** Safe preview of the latest private-chat message. */
  latestMessagePreview?: string
  /** Unread count projected from the canonical Chat conversation, when Chat owns the Bot conversation. */
  unreadCount?: number
  /** Attention count after applying the canonical Chat notification policy. */
  badgeUnreadCount?: number
  /** Whether new-message notifications are allowed by the canonical Chat policy. */
  notificationAllowed?: boolean
  /** Notification mute projection from the canonical Chat conversation, when available. */
  isMuted?: boolean
  /** Account-bound opaque reference resolved through image.read. */
  avatarRef?: string
}

export interface ArkmeBotList {
  items: ArkmeBotSummary[]
}

/** Browser-safe projection of one Bot private-chat message. */
export interface ArkmeBotConversationMessage {
  /** Owner-local immutable occurrence identity. Subject message IDs and Chat relation IDs are never compared across owners. */
  messageId: string
  /** Optional Record content identity; this is not the Chat relation identity. */
  recordUid?: string
  role: 'user' | 'assistant'
  content: string
  status: string
  createdAtMillis: number
  attachments: ArkmeBotConversationAttachment[]
  /** Account-, owner- and conversation-bound capability; absent for unstable or owner-incomplete messages. */
  messageActionRef?: string
  messageActionCapabilities?: ArkmeMessageActionCapabilities
}

export interface ArkmeMessageActionCapabilities {
  copyLink: boolean
  forward: boolean
}

/** Safe attachment metadata; source file identifiers and remote URLs remain Host-owned. */
export interface ArkmeBotConversationAttachment {
  kind: string
  fileName: string
  mimeType: string
  size: number
  durationMillis: number
  width: number
  height: number
  sortOrder: number
}

export interface ArkmeBotConversation {
  messages: ArkmeBotConversationMessage[]
  latestSequence?: number
}

export interface ArkmeBotConversationDirectory {
  items: ArkmeBotSummary[]
}

/** Browser-safe projection of the Flutter desktop Bot settings profile. */
export interface ArkmeBotManageProfile extends ArkmeBotSummary {
  mentionEntryEnabled: boolean
  tokenPreview: string
  canRevealToken: boolean
  tokenRevealEnabled: boolean
  gatewayUrl: string
  webhookUrl: string
  recordCount: number
  webhookSecurity: ArkmeBotWebhookSecurity
  joinedGroups: ArkmeBotJoinedGroup[]
}

export interface ArkmeBotWebhookSecurity {
  keywordEnabled: boolean
  keyword: string
  tokenEnabled: boolean
  ipWhitelistEnabled: boolean
  ipWhitelist: string[]
}

export interface ArkmeBotJoinedGroup {
  title: string
  installedAtMillis: number
}

export interface ArkmeBotNotificationPreference {
  /** `true` means the current Bot direct chat will not receive push notifications. */
  muted: boolean
}

export interface ArkmeBotConversationSendResult {
  userMessage: ArkmeBotConversationMessage
  botMessages: ArkmeBotConversationMessage[]
  status: string
}

export interface ArkmeBotConversationReadResult {
  effectiveReadSequence: number
  unreadCount: number
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

export interface ArkmeWorldExtensionShare {
  ref: string
  url: string
}

/** Immutable display snapshot emitted after one extension version becomes public. */
export interface ArkmeWorldExtensionPublication {
  extensionId: string
  version: string
  name: string
  description: string
  share?: ArkmeWorldExtensionShare
  iconRef?: string
  previewRefs: string[]
  visibility: 'public'
  runtimeDshRange?: string
  desktopRequired: boolean
  publishedAtMillis: number
}

export interface ArkmeWorldFeedItem {
  recordRef: string
  /** Opaque, viewer-bound reference for opening this non-self author's card. */
  authorRef?: string
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
  recordType?: 'extension_publication'
  extensionPublication?: ArkmeWorldExtensionPublication
}

export interface ArkmeWorldFeedPage {
  items: ArkmeWorldFeedItem[]
  total: number
  hasMore: boolean
  nextOffset?: number
}

/** Viewer-specific display label for one opaque World author reference. */
export interface ArkmeWorldAuthorLabel {
  authorRef: string
  authorName: string
}

export interface ArkmeWorldVoiceprintAvailabilityItem {
  recordRef: string
  playable: boolean
}

export interface ArkmeWorldVoiceprintAvailability {
  items: ArkmeWorldVoiceprintAvailabilityItem[]
}

export type ArkmeWorldVoiceprintSocialRelationType =
  | 'reciprocal_expectation'
  | 'call'
  | 'world_interaction'
  | 'group_interaction'
  | 'private_chat'

/** Browser-safe relationship evidence used by the World voiceprint reminder dialog. */
export interface ArkmeWorldVoiceprintSocialRelation {
  type: ArkmeWorldVoiceprintSocialRelationType
  displayLine: string
  reasonCode: string
  reasonLabel: string
}

export interface ArkmeWorldVoiceprintSocialContext {
  relations: ArkmeWorldVoiceprintSocialRelation[]
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
  /** Opaque, viewer-bound reference for opening this non-self author's card. */
  authorRef?: string
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

export const ARKME_WORLD_PUBLISH_MAX_IMAGES = 27
export const ARKME_WORLD_PUBLISH_MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface ArkmeWorldPublishResult {
  recordSaved: boolean
  recordState: 'synced' | 'pending' | 'not_saved'
  worldPublished: boolean
  visibility: ArkmeWorldVisibility
  checkStatus: number
  retryable: boolean
  error?: string
}

/** Media upload output accepted by the World image-publish boundary. */
export interface ArkmeWorldPublishFileAsset {
  fileAssetUid: string
  fileName: string
  mimeType: string
  size: number
  fileKind: 1
}

export interface ArkmeWorldPublishTextInput {
  clientMutationId: string
  textContent: string
}

export interface ArkmeWorldPublishFileAssetsInput extends ArkmeWorldPublishTextInput {
  fileAssets: ArkmeWorldPublishFileAsset[]
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
  /** Opaque browser-safe reference for streaming this search asset through the plugin media proxy. */
  mediaRef?: string
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
  creationSource?: number
  sourceTitle?: string
  media: ArkmeSearchAssetItem[]
  files: ArkmeSearchAssetItem[]
  voice?: ArkmeSearchAssetItem
  linkUrl?: string
  recordDurationMillis?: number
  sceneItemCount?: number
  sceneItemSize?: number
  /** Current-account navigation target for opening this hit in its owning Arkme conversation. */
  targetSource?: ArkmeSourceItem
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

export type ArkmeCallMediaType = 'audio' | 'video' | 'unknown'
export type ArkmeCallSummaryStatus = 'idle' | 'pending' | 'done' | 'failed'

export interface ArkmeCallHistoryOptions {
  limit?: number
  cursor?: string
  includeRecentContacts?: boolean
}

export interface ArkmeCallHistoryItem {
  callRef: string
  stableId: string
  peerDisplayName: string
  peerUserId?: number
  peerAvatarRef?: string
  mediaType: ArkmeCallMediaType
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationSeconds: number
  callResult: string
  resultLabel: string
  summaryStatus: ArkmeCallSummaryStatus
  summaryPreview?: string
  summaryUpdatedAtMillis?: number
  canOpenDetail: boolean
  canRedial: boolean
  chatSessionUid?: string
  sharedTopicId?: number
}

export interface ArkmeCallRecentContact {
  userId: number
  displayName: string
  avatarRef?: string
  sharedTopicId?: number
}

export interface ArkmeCallHistoryPage {
  items: ArkmeCallHistoryItem[]
  recentContacts?: ArkmeCallRecentContact[]
  hasMore: boolean
  nextCursor?: string
}

export interface ArkmeCallParticipant {
  userId?: number
  displayName: string
  isCurrentUser?: boolean
  avatarRef?: string
}

export interface ArkmeCallTranscriptSegment {
  segmentId: string
  speakerDisplayName: string
  speakerUserId?: number
  text: string
  startMillis: number
  endMillis: number
}

export interface ArkmeCallVideoRecord {
  available: boolean
  source: 'real' | 'sample'
  videoUrl?: string
  posterUrl?: string
  perspectives?: ArkmeCallVideoPerspective[]
}

export interface ArkmeCallVideoPerspective {
  perspective: 'self' | 'peer' | 'main' | 'unknown'
  label?: string
  videoUrl?: string
  posterUrl?: string
}

export interface ArkmeCallDetail {
  callRef: string
  title: string
  mediaType: ArkmeCallMediaType
  startedAtMillis: number
  acceptedAtMillis: number
  endedAtMillis: number
  durationSeconds: number
  callResult: string
  resultLabel: string
  summaryStatus: ArkmeCallSummaryStatus
  summaryText?: string
  summaryUpdatedAtMillis?: number
  transcriptPending: boolean
  transcriptFailed: boolean
  videoRecord?: ArkmeCallVideoRecord
  participants: ArkmeCallParticipant[]
  transcriptSegments: ArkmeCallTranscriptSegment[]
}

export interface ArkmeCallSummaryRetryResult {
  status: 'submitted'
  detail: ArkmeCallDetail
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
    /** Current-account profile settings support Arkme ID, personal QR, and phone binding flows. */
    accountSettings?: true
    imageRead: true
    /** Record-calendar bucket and day-record reads backed by the Arkme record service. */
    recordCalendar?: true
    /** Authorized image-library listing with opaque, account-bound media references is available. */
    imageLibrary?: true
    sourceDirectory: true
    sourceTimeline: true
    /** Forward snapshots include typed transcripts and account-bound attachment references. */
    forwardContent?: true
    sourceTextSend: true
    /** Recipient read/unread summaries and group member detail for current-user-sent messages. */
    messageReadReceipts?: true
    /** Peer group-chat messages expose an account-bound report action. */
    messageReport?: true
    /** Employee-only, source-bound private-chat user ban inspection and mutation are available. */
    userBanManagement?: true
    /** Group owners can withdraw peer messages, remove members, and manage future join restrictions. */
    groupOwnerGovernance?: true
    richContentRead: boolean
    richContentSend: boolean
    /** Explicit text background-sound descriptors are supported by direct and durable rich sends. */
    backgroundSound?: true
    fileUpload: boolean
    outgoingCall: true
    /** Browser-safe call-history list/detail and explicit summary retry are available. */
    callHistory?: true
    groupMembers: true
    groupMemberAdd?: true
    userCard: true
    openPrivateChat: true
    /** Search accounts and idempotently add/open a contact conversation. */
    contactAdd?: true
    /** Built-in quick-add surface plus SDK/Host support for contacts, groups, and Bots. */
    conversationQuickAdd?: true
    groupSettings: true
    /** Group AI expression-polish settings, rule previews, and confirmation-based mutations. */
    groupAiPolish?: true
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
    /** Optional additive capability for publishing text and file-asset World records. */
    worldPublish?: true
    /** Optional additive capability for author-voice playback of public World text. */
    worldVoiceprintPlayback?: true
    /** Optional additive capability for sending a voiceprint invite reminder to a World author. */
    worldVoiceprintInvite?: true
    /** Optional additive capability for mobile-aligned relationship context in the voiceprint reminder dialog. */
    worldVoiceprintSocialContext?: true
    /** Optional additive capability for current-account voiceprint management in the built-in UI. */
    voiceprintManagement?: true
    /** Optional additive capability for the independent Arrangement consumer. */
    arrangements?: true
    /** Optional additive current-account Cordis/Profile/cloud extension inventory. */
    myExtensions?: true
    /** Optional additive publication of an exact owned live Cordis Package. */
    extensionPublish?: true
    /** Optional additive capability for extension reviews, replies, and rating summaries. */
    extensionReviews?: true
  }
  limits: {
    maxTextLength: number
    maxSearchResults: number
    maxSyncPages: number
    maxImageBytes: number
    maxRelatedRecordingPageSize?: number
    maxRelatedRecordingCursorLength?: number
    maxMessageReadReceiptItems?: number
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
  /** Backing file-asset reference for the signed-in user's avatar when the profile endpoint has not returned a public URL. */
  avatarAssetRef?: string
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
  bindingNames?: {
    wechat?: string
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

export type ArkmeUserBanStatus = 'banned' | 'unbanned'

/** Browser-safe current fact for the peer bound to one private-chat source. */
export interface ArkmeUserBanRecord {
  sourceRef: string
  displayName: string
  status: ArkmeUserBanStatus
  remark: string
  bannedAtMillis: number
  unbannedAtMillis: number
  updatedAtMillis: number
}

export interface ArkmeUserBanSnapshot {
  sourceRef: string
  displayName: string
  exists: boolean
  banned: boolean
  record?: ArkmeUserBanRecord
}

/** Host-only owner fact used to bind confirmation to the same resolved peer. Never serialize directly. */
export interface ArkmeUserBanOwnerRecord extends ArkmeUserBanRecord {
  targetUserId: number
  operatorUserId: number
}

/** Host-only lookup result. UI, Browser SDK and model output receive ArkmeUserBanSnapshot instead. */
export interface ArkmeUserBanOwnerSnapshot extends Omit<ArkmeUserBanSnapshot, 'record'> {
  targetUserId: number
  record?: ArkmeUserBanOwnerRecord
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
  /** Private-chat peer identity when this source is a one-to-one chat. */
  peerUserId?: number
  /** Opaque reference to this topic's parent when both topic labels are available in the same response. */
  parentSourceRef?: string
  /** Opaque topic identity for reconciling hierarchy across paginated directory responses. */
  topicHierarchyKey?: string
  /** Opaque parent topic identity. A child stays hidden until this key is present in the loaded tree. */
  parentTopicHierarchyKey?: string
  /** Some direct child topics are still on later pages of the personal-topic directory. */
  hasPendingChildren?: boolean
  /** Server-persisted order within this topic's sibling group. */
  siblingOrder?: number
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
  /** Attention count after applying mute/notification policy; raw unreadCount remains authoritative. */
  badgeUnreadCount?: number
  /** Whether new-message notifications are allowed for this conversation. */
  notificationAllowed?: boolean
  hasUnreadMention?: boolean
  /** Effective chat notification state. True when mute is on or push notifications are disabled. */
  isMuted?: boolean
  /** Server-persisted conversation pin state for private and group chats. */
  isPinned?: boolean
  latestSequence?: number
  recordCount?: number
}

/** Result of a server-backed conversation-directory policy mutation. */
export interface ArkmeSourceDirectoryPolicyResult {
  sourceRef: string
  pinned: boolean
  hidden: boolean
}

export interface ArkmeSourceList {
  directory: ArkmeSourceDirectory
  items: ArkmeSourceItem[]
  total?: number
  hasMore: boolean
  nextCursor?: string
}

/** Built-in UI result for creating a personal topic without exposing its server UID. */
export interface ArkmeTopicCreateResult {
  source: ArkmeSourceItem
  /** Present only when the requested parent relation and the automatic orphan cleanup both failed. */
  warning?: string
}

/** Result of moving a personal topic to a different hierarchy parent. */
export interface ArkmeTopicHierarchyMoveResult {
  sourceRef: string
  parentSourceRef?: string
  siblingOrder: number
}

/** Result of renaming one personal topic. The opaque reference changes with the title. */
export interface ArkmeTopicRenameResult {
  sourceRef: string
  displayName: string
}

/** Result of dissolving one personal topic while retaining its child topics. */
export interface ArkmeTopicDissolveResult {
  sourceRef: string
  movedChildSourceRefs: string[]
  movedRecordCount: number
  /** Undefined means the records returned to the default category. */
  recordTargetSourceRef?: string
}

/** Live status for a long-running topic dissolve operation. */
export interface ArkmeTopicDissolveProgress {
  requestId: string
  stage: 'reading' | 'migrating' | 'promoting' | 'dissolving' | 'completed' | 'failed'
  completedRecordCount: number
  totalRecordCount: number
  error?: string
}

/** A viewer-bound dissolve task that can be restored after the page reloads. */
export interface ArkmeTopicDissolveTask extends ArkmeTopicDissolveProgress {
  sourceRef: string
  parentSourceRef?: string
}

export interface ArkmeTimelineCursor {
  sendAtMillis?: number
  itemUid?: string
  beforeSequence?: number
  afterSequence?: number
}

/** A browser-safe topic projection attached to an item in the aggregate self feed. */
export interface ArkmeTimelineSelfTopic {
  /** Browser-safe stable key for resolving the current topic from the self topic tree. */
  topicHierarchyKey: string
  /** Available immediately when the feed includes the topic title. */
  sourceRef?: string
  title?: string
}

/** Static environment data captured when a user creates a chat record. */
export interface ArkmeRecordCaptureContext {
  clientName?: string
  networkName?: string
  electric?: number
  charge?: number
}

/** Browser-safe device location saved for one record after an explicit user grant. */
export interface ArkmeRecordLocationCapture {
  latitude: number
  longitude: number
  /** Horizontal accuracy reported by the browser, in metres. */
  accuracyMeters?: number
  altitudeMeters?: number
  speedMetersPerSecond?: number
  capturedAtMillis: number
}

/** Browser-safe playback projection for every segment of one background recording. */
export interface ArkmeMessageSnapshotBackgroundSoundPlayback {
  mediaRefs: string[]
  amplitudes: number[]
  durationSeconds?: number
}

export interface ArkmeMessageSnapshotDetail {
  itemUid: string
  textContent: string
  recordDurationMillis?: number
  editDurationMillis?: number
  viewTimes?: number
  shareTimes?: number
  captureContext?: ArkmeRecordCaptureContext
  backgroundSound: 'available' | 'not-recorded' | 'disabled' | 'unknown'
  backgroundSoundPlayback?: ArkmeMessageSnapshotBackgroundSoundPlayback
  locationCapture?: ArkmeRecordLocationCapture
  locationLabel?: string
  weather?: string
  altitudeMeters?: number
  movement?: string
  belongDate?: string
  startAtMillis?: number
  completeAtMillis?: number
  syncedAtMillis?: number
  syncState?: 'synced' | 'syncing' | 'failed' | 'not-synced'
}

export interface ArkmeTimelineItem {
  itemUid: string
  /** Account- and conversation-bound stable key used only for realtime timeline invalidation. */
  timelineItemKey?: string
  /** Account-bound opaque reference for reporting this concrete group-chat message. */
  messageRef?: string
  /** Account-bound opaque reference for owner withdrawal of this concrete group-chat message. */
  messageWithdrawalRef?: string
  /** Account- and conversation-bound opaque reference for copy-link and forward actions. */
  messageActionRef?: string
  /** Account- and conversation-bound opaque reference for actions on the sender. */
  memberRef?: string
  senderName: string
  agentSource?: ArkmeTimelineAgentSource
  /** Opaque Provider image reference for the concrete message sender. */
  avatarRef?: string
  isMe: boolean
  /** Browser-safe projection of whether this incoming message mentions the current viewer. */
  mentionsViewer?: boolean
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
  /** Snapshot metadata returned with the record when the originating client captured it. */
  captureContext?: ArkmeRecordCaptureContext
  /** Explicitly user-authorized location captured by this client for the record. */
  locationCapture?: ArkmeRecordLocationCapture
  contentBlocks?: ArkmeContentBlock[]
  /** Record owner reported media refs, but their delivery projection was temporarily unavailable. */
  mediaUnavailable?: boolean
  /** Present only for a categorized record in the aggregate “发给自己” feed. */
  selfTopic?: ArkmeTimelineSelfTopic
  /** Browser-safe Chat forward snapshot. It is present only for explicit `render_kind=forward_records` payloads. */
  forwardRecords?: ArkmeForwardRecordsPreview
  /** Browser-safe shared recording snapshot. It is present only for explicit `render_kind=shared_recording_memory` payloads. */
  sharedRecording?: ArkmeSharedRecordingPreview
  /** Record uid of the message this chat extension continues. */
  extensionParentRecordUid?: string
  /** Browser-safe desktop-style preview rendered above an extension child message. */
  extensionParent?: ArkmeTimelineExtensionParent
  /** Successful local send waiting for the authoritative chat timeline projection. */
  awaitingTimelineProjection?: true
}

export interface ArkmeTimelineExtensionParent {
  itemUid: string
  senderName: string
  title: string
  textContent: string
  /** Authoritative record owner required by Chat's exact around lookup. */
  recordOwnerUserId?: number
  sequence?: number
  sendAtMillis?: number
  contentBlocks?: ArkmeContentBlock[]
}

/** Browser-safe summary of one quick note related to the current message or moment. */
export interface ArkmeRelatedQuickNoteItem {
  /** Viewer- and source-bound opaque reference used to open the related note. */
  relatedRef: string
  senderName: string
  /** Opaque Provider image reference for the related note author. */
  senderAvatarRef?: string
  sendAtMillis: number
  title: string
  textPreview: string
  sourceLabel?: string
}

export interface ArkmeRelatedQuickNoteList {
  items: ArkmeRelatedQuickNoteItem[]
  total: number
}

/** Allowlisted presentation fields for one related note; routing identifiers stay host-side. */
export interface ArkmeRelatedQuickNoteDetail {
  relatedRef: string
  senderName: string
  /** Opaque Provider image reference for the related note author. */
  avatarRef?: string
  isMe: boolean
  sendAtMillis: number
  title: string
  textContent: string
  status: number
  recordVersion?: number
  aiPolish?: ArkmeTimelineAiPolish
  templateKind?: number
  displayKind?: number
  version?: number
  updateAtMillis?: number
  recordDurationMillis?: number
  editDurationMillis?: number
  contentBlocks?: ArkmeContentBlock[]
  mediaUnavailable?: boolean
  forwardRecords?: ArkmeForwardRecordsPreview
}

/** Identity of one message returned by an Arkme private/group timeline. */
export interface ArkmeMessageReadReceiptQueryItem {
  itemUid: string
  sequence: number
}

export const ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS = 50 as const

export type ArkmeMessageReadReceiptStatus = 'read' | 'partially_read' | 'unread'

/** Read/unread aggregate for one current-user-sent private/group message. */
export interface ArkmeMessageReadReceiptSummary extends ArkmeMessageReadReceiptQueryItem {
  readCount: number
  unreadCount: number
  /** Active human recipients, excluding the sender. */
  totalMemberCount: number
  status: ArkmeMessageReadReceiptStatus
}

export interface ArkmeMessageReadReceiptSummaryList {
  sourceRef: string
  conversationKind: 'private_chat' | 'group_chat'
  items: ArkmeMessageReadReceiptSummary[]
}

export interface ArkmeMessageReadReceiptMember {
  /** Account- and conversation-bound member reference. */
  memberRef: string
  displayName: string
  avatarRef?: string
  readStatus: 'read' | 'unread'
  /** Present only when this member has read the message. */
  readAtMillis?: number
}

/** Member-level receipt detail for one current-user-sent group message. */
export interface ArkmeMessageReadReceiptDetail extends ArkmeMessageReadReceiptQueryItem {
  sourceRef: string
  readCount: number
  unreadCount: number
  totalMemberCount: number
  items: ArkmeMessageReadReceiptMember[]
}

export interface ArkmeForwardRecordsPreview {
  title: string
  createdAtMillis: number
  summaryLines: string[]
  items: ArkmeForwardRecordPreviewItem[]
  /** The bounded snapshot omitted additional records or nested content. */
  truncated?: true
}

export interface ArkmeForwardTranscriptSegment {
  speakerName: string
  textContent: string
  /** Offsets in the forwarded recording, not wall-clock timestamps. */
  startMillis: number
  endMillis: number
  contentBlocks?: ArkmeContentBlock[]
  mediaUnavailable?: true
}

export interface ArkmeForwardRecordPreviewItem {
  senderName: string
  /** Opaque Provider image reference for the snapshotted sender. */
  avatarRef?: string
  sendAtMillis: number
  title: string
  textContent: string
  contentLabel?: string
  sourceType?: 'record' | 'chat_record' | 'long_recording_segments' | 'agent' | 'ai_letter' | 'unknown'
  segments?: ArkmeForwardTranscriptSegment[]
  contentBlocks?: ArkmeContentBlock[]
  mediaUnavailable?: true
  truncated?: true
}

export interface ArkmeSharedRecordingParticipant {
  refUserId?: number
  displayName: string
  role: number
}

export interface ArkmeSharedRecordingPreview {
  /** Backend record digest for opening the shared recording snapshot. */
  sourceDigest: string
  /** Browser-safe Host-bound detail reference for loading the full transcript on demand. */
  detailRef?: string
  sharedByUserId: number
  sharedAtMillis: number
  displayAtMillis: number
  endAtMillis: number
  timeRangeText: string
  title: string
  summary: string
  transcript?: string
  transcriptAvailable: boolean
  participants: ArkmeSharedRecordingParticipant[]
}

export interface ArkmeTimelineAgentSource {
  kind: 'agent' | 'dsh_agent_input'
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
  /** Browser-safe conversation history persisted with the rule for mobile/desktop continuity. */
  threadMessages?: ArkmeGroupAiPolishThreadMessage[]
}

export interface ArkmeGroupAiPolishThreadMessage {
  id: string
  role: 'ai' | 'user'
  text: string
  isRule?: boolean
  ruleRef?: string
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
  threadMessages?: ArkmeGroupAiPolishThreadMessage[]
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
  /** Backend media render role. 3 means a standalone chat sticker. */
  renderRole?: 1 | 3
  /** Original bytes, distinct from an image preview. */
  originalRef?: string
  localFileRef?: string
  uploadProgress?: import('./file-transfer-contract.js').ArkmeFileProgress
}

export interface ArkmeUploadedAsset {
  fileAssetUid: string
  fileName: string
  mimeType: string
  size: number
  fileKind: 1 | 2 | 3 | 4
}

/** Explicit background-audio role. Ordinary `audio/*` assets never acquire this role implicitly. */
export interface ArkmeRichBackgroundSoundInput {
  assets: ArkmeUploadedAsset[]
  amplitudes: number[]
}

export type ArkmeBackgroundSoundEligibilityReason = 'eligible' | 'membership-required' | 'membership-unavailable'

/** Current-account server projection for the text background-sound switch. */
export interface ArkmeBackgroundSoundPreference {
  userId: number
  found: boolean
  enabled: boolean
  eligible: boolean
  memberType?: number
  eligibilityReason: ArkmeBackgroundSoundEligibilityReason
  sourceVersion?: number
  updatedAtMillis?: number
}

export interface ArkmeFavoriteSticker {
  fileAssetUid: string
  fileName: string
  mimeType: string
  size: number
  fileKind: 1
  isAnimated: boolean
  isAvailable: boolean
  mediaRef?: string
  unavailableReason?: string
}

export interface ArkmeFavoriteStickerList {
  items: ArkmeFavoriteSticker[]
  itemCount: number
  updatedAtMillis: number
}

export interface ArkmeFavoriteStickerAddInput {
  fileAssetUid: string
  fileName: string
  mimeType: string
  size: number
  fileKind: 1
  isAnimated?: boolean
}

export type ArkmeFavoriteStickerManageAction = 'move-to-front' | 'delete'

export interface ArkmeRichSendInput {
  title?: string
  textContent?: string
  displayKind?: 0 | 1
  thinkingDurationMillis?: number
  /** Time spent composing this record before it was sent. */
  recordDurationMillis?: number
  /** Browser/device data captured at send time, when available. */
  captureContext?: ArkmeRecordCaptureContext
  assets?: ArkmeUploadedAsset[]
  backgroundSound?: ArkmeRichBackgroundSoundInput
  humanMentions?: ArkmeHumanMentionInput[]
  botMentions?: ArkmeBotMentionInput[]
}

interface ArkmeHumanMentionRange {
  startIndex: number
  length: number
}

export type ArkmeHumanMentionInput =
  | (ArkmeHumanMentionRange & { mentionRef: string; memberRef?: never; all?: never })
  | (ArkmeHumanMentionRange & { all: true; mentionRef?: never; memberRef?: never })

export interface ArkmeBotMentionInput {
  botRef: string
  startIndex: number
  length: number
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

export type ArkmeMessageReportType = 1 | 2 | 3 | 4

export interface ArkmeMessageReportResult {
  messageRef: string
  reportUid: string
  status: number
}

export interface ArkmeMessageWithdrawalResult {
  messageWithdrawalRef: string
  timelineItemKey: string
  withdrawnAtMillis: number
  alreadyWithdrawn: boolean
}

export interface ArkmeMessageCopyLinkResult {
  sid: string
  url: string
}

export interface ArkmeMessageCopyLinkExtendResult {
  sid: string
  recordUid: string
  parentRecordUid: string
  status: number
  localState: 'synced'
  extension?: ArkmeMessageCopyLinkExtensionItem
}

/** Extension state for a message authorized by its source-scoped action reference. */
export interface ArkmeSourceMessageExtensionContext extends ArkmeMessageCopyLinkRecordContext {
  parentRecordUid: string
}

export interface ArkmeSourceMessageExtendResult {
  recordUid: string
  parentRecordUid: string
  relationUid?: string
  sequence?: number
  status: number
  localState: 'synced'
  extension: ArkmeMessageCopyLinkExtensionItem
}

export type ArkmeMessageCopyLinkAccessMode = 'normal' | 'link_read_only'

export interface ArkmeMessageCopyLinkMediaItem {
  fileKind: number
  fileName: string
  size: number
}

export interface ArkmeMessageCopyLinkStructuredContent {
  structuredKind: number
  durationMillis: number
}

export interface ArkmeMessageCopyLinkSnapshotItem {
  recordUid?: string
  sourceKind?: string
  senderDisplayName: string
  senderAvatarUrl?: string
  title: string
  textContent: string
  sendAtMillis: number
  templateKind: number
  displayKind: number
  officialMark: number
  mediaItems: ArkmeMessageCopyLinkMediaItem[]
  /** Browser-safe rich media resolved by the Host for detail rendering. */
  contentBlocks?: ArkmeContentBlock[]
  /** Media metadata exists but its authorized display projection is unavailable. */
  mediaUnavailable?: boolean
  structuredContent?: ArkmeMessageCopyLinkStructuredContent
}

export type ArkmeMessageCopyLinkPresentationNode =
  | { kind: 'item'; itemIndex: number }
  | {
    kind: 'forward_bundle'
    title: string
    commentText: string
    createdAtMillis: number
    senderDisplayName: string
    children: ArkmeMessageCopyLinkPresentationNode[]
  }

export interface ArkmeMessageCopyLinkSourceAnchor {
  relationUid: string
  recordUid: string
  recordOwnerUserId: number
  sequence: number
}

export interface ArkmeMessageCopyLinkExtensionItem extends ArkmeMessageCopyLinkSnapshotItem {
  recordUid: string
  /** Record this extension directly continues; used to render the desktop two-level tree. */
  parentRecordUid?: string
  /** Owner required by the durable chat extension endpoint when this item becomes the next target. */
  recordOwnerUserId?: number
  level: number
}

export interface ArkmeMessageCopyLinkRecordContext {
  extensionCount: number
  extensions: ArkmeMessageCopyLinkExtensionItem[]
}

export interface ArkmeMessageCopyLinkResolveResult {
  sid: string
  displayTitle: string
  generatedAtMillis: number
  accessMode: ArkmeMessageCopyLinkAccessMode
  items: ArkmeMessageCopyLinkSnapshotItem[]
  presentation: ArkmeMessageCopyLinkPresentationNode[]
  sourceSessionUid?: string
  sourceAnchors?: ArkmeMessageCopyLinkSourceAnchor[]
  recordContext?: ArkmeMessageCopyLinkRecordContext
}

export interface ArkmeTimelinePage {
  source: ArkmeSourceItem
  items: ArkmeTimelineItem[]
  aiPolishNotices?: ArkmeGroupAiPolishNotice[]
  aiPolishSettings?: ArkmeGroupAiPolishSnapshot
  hasMore: boolean
  nextCursor?: ArkmeTimelineCursor
}

/** A continuous chat timeline window centered on an exact record. */
export interface ArkmeTimelineAroundPage {
  source: ArkmeSourceItem
  items: ArkmeTimelineItem[]
  anchorItemUid: string
  anchorSequence: number
  anchorIndex: number
  olderHasMore: boolean
  newerHasMore: boolean
  olderCursor?: ArkmeTimelineCursor
  newerCursor?: ArkmeTimelineCursor
  latestKnownSequence?: number
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
  /** Host-signed reference for immediate actions before timeline convergence. */
  messageActionRef?: string
  status: number
  sequence?: number
  localState: 'synced' | 'failed'
  error?: string
  warningText?: string
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
  /** UI-only opaque reference for shared/related recording details that need lazy transcript loading. */
  sharedRecordingDetailRef?: string
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
  sharedByUserId?: number
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
  mentionCount?: number
}

export interface ArkmeGroupMemberList {
  source: ArkmeSourceItem
  items: ArkmeGroupMemberItem[]
  total: number
  activeCount: number
  selfRole: ArkmeGroupMemberRole
  selfStatus: ArkmeGroupMemberStatus
}

export interface ArkmeConversationMemberItem {
  /** Stable account-and-session-scoped identity for member actions. */
  memberRef: string
  /** Present only when this active non-self group member can be selected for a new human mention. */
  mentionRef?: string
  /** Public/group-safe name bound to mentionRef; never contains the viewer's private contact label. */
  mentionDisplayName?: string
  /** Viewer-facing label; it may be the current viewer's private contact remark. */
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
  mentionCount: number
}

export interface ArkmeGroupMemberRemoveResult {
  sourceRef: string
  memberRef: string
  status: 'removed'
  joinRestricted: boolean
}

export interface ArkmeGroupJoinRestrictionItem {
  memberRef: string
  displayName: string
  memberName?: string
  secondaryName?: string
  avatarRef?: string
  restrictedAtMillis: number
}

export interface ArkmeGroupJoinRestrictionPage {
  sourceRef: string
  items: ArkmeGroupJoinRestrictionItem[]
  nextCursor?: string
}

export interface ArkmeGroupJoinRestrictionMutationResult {
  sourceRef: string
  memberRef: string
  restricted: boolean
  updatedAtMillis?: number
}

export type ArkmeConversationMemberJoinAction = 'invite' | 'direct_add'

export interface ArkmeConversationMemberJoinPerson {
  memberRef?: string
  displayName: string
  isSelf: boolean
}

export interface ArkmeConversationMemberJoinEvent {
  eventId: string
  action: ArkmeConversationMemberJoinAction
  occurredAtMillis: number
  inviter: ArkmeConversationMemberJoinPerson
  invitees: ArkmeConversationMemberJoinPerson[]
}

export interface ArkmeConversationMemberList {
  source: ArkmeSourceItem
  items: ArkmeConversationMemberItem[]
  total: number
  activeCount: number
  joinEvents?: ArkmeConversationMemberJoinEvent[]
}

export type ArkmeConversationMemberRecordMode = 'owner' | 'mentioned'

export interface ArkmeConversationMemberRecordPage {
  source: ArkmeSourceItem
  member: ArkmeConversationMemberItem
  mode: ArkmeConversationMemberRecordMode
  items: ArkmeTimelineItem[]
  hasMore: boolean
  nextCursor?: ArkmeTimelineCursor
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
  avatarRef?: string
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

export interface ArkmeOfficialAuthorProfile {
  userId: number
  displayName: string
  avatarRef?: string
}

export interface ArkmeOpenPrivateChatResult {
  source: ArkmeSourceItem
}

export interface ArkmeGroupActionTarget {
  sourceRef: string
  sourceKey?: string
  kind: 'group_chat'
  displayName: string
}

export interface ArkmeGroupSettingsSnapshot {
  target: ArkmeGroupActionTarget
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

export interface ArkmeGroupProjectionResult {
  source: ArkmeSourceItem
  status: 'ok'
}

export interface ArkmeGroupCommandResult {
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
  asrItemIndex: number
  transcriptSource: ArkmeAiVideoTranscriptSource
  startAtMillis: number
  endAtMillis: number
  speakerNumber: number
  speakerColorIndex: number
  speakerLabel: string
  /** Opaque image reference for a speaker already associated with an Arkme user. */
  speakerAvatarRef?: string
  isSelf: boolean
  isBackground: boolean
  text: string
}

/** Browser-safe day projection. Audio owner ids remain sealed in itemRef. */
export interface ArkmeRecordingWorkbenchItem {
  itemId: string
  itemRef: string
  startAtMillis: number
  endAtMillis: number
  speakerNumber: number
  speakerKey: string
  speakerColorIndex: number
  speakerLabel: string
  speakerAvatarRef?: string
  sameSpeakerItemCount: number
  isSelf: boolean
  isBackground: boolean
  text: string
}

export interface ArkmeRecordingPlayback {
  playbackRef: string
  mimeType: string
  startOffsetMillis: number
  endOffsetMillis: number
}

export interface ArkmeRecordingSpeakerOption {
  speakerRef: string
  label: string
  avatarRef?: string
  kind: 'arkme-user' | 'speaker'
  currentAssignment: boolean
  isCurrentUser: boolean
  recommended: boolean
}

export interface ArkmeRecordingSpeakerMutationResult {
  scope: 'item' | 'speaker'
  affectedCount: number
  day: ArkmeRecordingDay
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

export interface ArkmeRecordingTranscriptSection<T = ArkmeRecordingTranscriptItem> extends ArkmeRecordingSection<T> {
  identityCoverage?: 'complete' | 'partial'
  totalDurationMillis: number
  processingCount: number
}

export interface ArkmeRecordingDay {
  dateStamp: number
  totalDurationMillis: number
  transcript: ArkmeRecordingTranscriptSection<ArkmeRecordingWorkbenchItem>
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
  /** Original user input Record identity. This is distinct from Agent-created side effects. */
  entryRecordUid?: string
  /** Host-signed message action capability for one stable persisted message. */
  messageActionRef?: string
  /** Session-bound conversation capability paired with this historical Agent message. */
  messageActionConversationRef?: string
  messageActionCapabilities?: ArkmeMessageActionCapabilities
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
  targetArtifactPath?: string
  targetArtifactSha512?: string
  appVersion?: string
  dshVersion?: string
  message: string
  updatedAtMillis: number
}

export interface ArkmeChatRealtimeState {
  revision: number
  connected: boolean
  connectionGeneration: number
  lastEventAtMillis?: number
}

/** Server-owned unread attention summary across every visible conversation. */
export interface ArkmeChatAttentionSummary {
  badgeCount: number
  mutedUnreadCount: number
  sessionCountWithUnread: number
  hasAttention: boolean
  summaryVersion: number
  updatedAtMillis: number
}

export type ArkmeChatClientEvent = {
  type: 'reconcile'
  revision: number
  connected: boolean
  refresh?: 'none' | 'if-stale' | 'force'
  connectionGeneration: number
  /** Latest server-owned full attention summary for Browser SSE reconnects. */
  attentionSummary?: ArkmeChatAttentionSummary
} | {
  type: 'sessions-delta'
  revision: number
  updates: Array<{ sourceKey?: string; source: ArkmeSourceItem; timelineItems: ArkmeTimelineItem[] }>
} | {
  type: 'timeline-changed'
  revision: number
  sourceKey: string
  timelineItemKey: string
  changeKind: 'deleted' | 'recovered' | 'reedited' | 'extended'
  changeVersion: number
  relationTerminal: boolean
  throughSequence: number
} | {
  type: 'attention-summary'
  revision: number
  summary: ArkmeChatAttentionSummary
} | {
  type: 'projection-invalidated'
  revision: number
  projection: 'record'
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
} | {
  type: 'read-receipts-invalidated'
  revision: number
  /** Account-bound conversation identity; raw Chat session and reader identities stay in Host memory. */
  sourceKey: string
  throughSequence: number
}

export type ArkmePluginOperation =
  | 'provider.capabilities'
  | 'provider.state'
  | 'chat.realtime.state'
  | 'auth.status'
  | 'auth.config'
  | 'auth.begin'
  | 'auth.poll'
  | 'auth.app.begin'
  | 'auth.app.poll'
  | 'auth.app.cancel'
  | 'auth.test.login'
  | 'auth.phone.send'
  | 'auth.phone.verify'
  | 'auth.logout'
  | 'user-ban.status'
  | 'user-ban.ban'
  | 'user-ban.unban'
  | 'openapi.mcp.status'
  | 'openapi.mcp.retry'
  | 'remote.getStatus'
  | 'remote.renameDesktop'
  | 'billing.quota'
  | 'billing.products'
  | 'billing.order.create'
  | 'billing.order.status'
  | 'contacts.search'
  | 'contacts.add'
  | 'chat.private.open-from-contact'
  | 'group.create'
  | 'bots.list'
  | 'bots.create'
  | 'bots.manage.profile'
  | 'bots.manage.update'
  | 'bots.manage.reveal-token'
  | 'bots.manage.delete'
  | 'bots.private-chat.notification.status'
  | 'bots.private-chat.notification.update'
  | 'bots.private-chat.directory'
  | 'bots.private-chat.open'
  | 'bots.private-chat.refresh'
  | 'bots.private-chat.send'
  | 'bots.private-chat.mark-read'
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
  | 'user.profile'
  | 'user.profile.refresh'
  | 'settings.background-sound.get'
  | 'settings.background-sound.update'
  | 'user.arkme-id.check'
  | 'user.arkme-id.set'
  | 'image.read'
  | 'images.list'
  | 'world.feed'
  | 'world.mine'
  | 'world.user'
  | 'world.author-labels'
  | 'chat.world.private.open'
  | 'chat.official-author.profile'
  | 'chat.official-author.private.open'
  | 'world.voiceprint.availability'
  | 'world.voiceprint.playback.generate'
  | 'world.voiceprint.social-context'
  | 'world.voiceprint.invite'
  | 'world.interactions.list'
  | 'world.interactions.create-text'
  | 'world.image.read'
  | 'world.publish-text'
  | 'world.publish-file-assets'
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
  | 'source.directory.policy.set'
  | 'source.timeline'
  | 'source.timeline-around'
  | 'source.members'
  | 'source.member-records'
  | 'source.mark-read'
  | 'source.read-receipts.summary-list'
  | 'source.read-receipts.detail'
  | 'source.message-report'
  | 'source.message-withdraw'
  | 'source.message-copy-link'
  | 'source.message-copy-link.resolve'
  | 'source.message-copy-link.extend'
  | 'source.message-extension.context'
  | 'source.message-extension.extend'
  | 'source.message-snapshot.detail'
  | 'source.message-location.set'
  | 'source.link-metadata.resolve'
  | 'source.forward-messages'
  | 'source.send-text'
  | 'related-recordings.eligibility'
  | 'related-recordings.page'
  | 'source.ai-polish.settings'
  | 'source.ai-polish.notices'
  | 'source.ai-polish.generate-rule'
  | 'source.ai-polish.prepare-enable'
  | 'source.ai-polish.confirm-enable'
  | 'source.ai-polish.prepare-disable'
  | 'source.ai-polish.confirm-disable'
  | 'source.ai-polish.retry'
  | 'group.members'
  | 'group.member-candidates'
  | 'group.invite-preview'
  | 'group.members.add'
  | 'group.member-remove'
  | 'group.join-restrictions'
  | 'group.join-restriction.set'
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
  | 'chat.member.private.open'
  | 'source.send-rich'
  | 'favorite-stickers.list'
  | 'favorite-stickers.add'
  | 'favorite-stickers.send'
  | 'favorite-stickers.manage'
  | 'files.capabilities'
  | 'files.search'
  | 'files.stage-bytes'
  | 'files.send.discard'
  | 'files.send.reconcile'
  | 'files.local.list'
  | 'files.local.open'
  | 'files.local.remove'
  | 'files.send'
  | 'files.send.tasks'
  | 'files.send.retry'
  | 'files.receive'
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
  | 'calls.outgoing.diag'
  | 'calls.history.list'
  | 'calls.history.detail'
  | 'calls.history.summary.retry'
  | 'extensions.mine.list'
  | 'extensions.mine.publish'
  | 'extensions.catalog.list'
  | 'extensions.catalog.detail'
  | 'extensions.install.preview'
  | 'extensions.delete'
  | 'extensions.metadata.update'
	| 'extensions.share.rotate'
	| 'extensions.share.detail'
	| 'extensions.share.resolve'
  | 'extensions.installed-list'
  | 'extensions.quarantine.status'
  | 'extensions.quarantine.dismiss'
  | 'extensions.quarantine.reenable'
  | 'extensions.quarantine.health'
  | 'extensions.enabled-state'
  | 'extensions.persistent.client-state'
  | 'extensions.enabled.set'
  | 'extensions.preview.delete'
  | 'extensions.preview.reorder'
  | 'extensions.catalog.list'
  | 'extensions.classification.tree'
  | 'extensions.classification.items'
  | 'topic.hierarchy.move'
  | 'topic.rename'
  | 'topic.dissolve'
  | 'topic.dissolve.status'
  | 'topic.dissolve.active'

export type ArkmeHostOperation = ArkmePluginOperation
  | 'provider.instance'
  | 'link.metadata'
  | 'directory.list'
  | 'directory.contact.profile'
  | 'directory.contact.world'
  | 'directory.contact.open-chat'
  | 'directory.group.open-chat'
  | 'directory.bot.open-chat'
  | 'unmarked-speakers.options'
  | 'unmarked-speakers.retry-inference'
  | 'unmarked-speakers.segments'
  | 'unmarked-speakers.mark'
  | 'voiceprint.status'
  | 'voiceprint.grants'
  | 'voiceprint.people'
  | 'voiceprint.person'
  | 'voiceprint.person.voiceprints'
  | 'voiceprint.person.invite'
  | 'voiceprint.invite'
  | 'voiceprint.revoke'
  | 'voiceprint.restore'
  | 'dsh-beta-community.entry-state'
  | 'dsh-beta-community.join'
  | 'recordings.calendar'
  | 'recordings.day'
  | 'recordings.import.preflight'
  | 'recordings.import.list'
  | 'recordings.import.status'
  | 'recordings.import.retry'
  | 'recordings.import.cancel'
  | 'recordings.playback.open'
  | 'recordings.speaker.options'
  | 'recordings.speaker.assign-item'
  | 'search.records'
  | 'search.scene'
  | 'search.recordings'
  | 'search.history'
  | 'search.history.create'
  | 'ai-video.list'
  | 'files.assets'
  | 'topic.create'
  | 'topic.hierarchy.move'
  | 'topic.rename'
  | 'topic.dissolve'
  | 'topic.dissolve.status'
  | 'topic.dissolve.active'
  | 'arko.profile'
  | 'arko.session'
  | 'arko.new-session'
  | 'arko.models'
  | 'arko.model.activate'
  | 'arko.history'
  | 'arko.ask'
  | 'arko.run.status'
  | 'arko.cancel'
  | 'message-actions.copy-link'
  | 'message-actions.forward'
  | 'plugin.update.status'
  | 'plugin.update.check'
  | 'plugin.update.acknowledge'
  | 'plugin.update.install'
  | 'plugin.update.install-status'
  | 'source.interwoven-moments'
  | 'source.interwoven-detail'
  | 'source.shared-recording-detail'
  | 'source.related-quick-notes.from-message'
  | 'source.related-quick-notes.from-moment'
  | 'source.related-quick-note.detail'
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
  | 'extensions.client.failure'
  | 'extensions.bundle.client-state'
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
