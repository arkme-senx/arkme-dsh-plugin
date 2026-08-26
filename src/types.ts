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
  voiceprintEnrollmentPath: string
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

export type ArkmeDirectorySectionKind =
  | 'groups' | 'bots' | 'unmarked-speakers' | 'teams' | 'contacts'

/** Browser-safe directory row. Provider-private identifiers never cross this boundary. */
export type ArkmeDirectoryItem =
  | { kind: 'group'; sourceRef: string; displayName: string; avatarRef?: string; groupAvatar?: ArkmeGroupAvatarPresentation }
  | { kind: 'bot'; botRef: string; displayName: string; avatarRef?: string }
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

/** Result of creating a canonical Record backed by uploaded file assets. */
export interface ArkmeCreateFileAssetRecordResult {
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
  /** Effective chat notification state. True when mute is on or push notifications are disabled. */
  isMuted?: boolean
  latestSequence?: number
  recordCount?: number
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
}

export interface ArkmeTimelineItem {
  itemUid: string
  /** Account-bound opaque reference for reporting this concrete group-chat message. */
  messageRef?: string
  /** Account- and conversation-bound opaque reference for actions on the sender. */
  memberRef?: string
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

/** Identity of one message returned by an Arkme private/group timeline. */
export interface ArkmeMessageReadReceiptQueryItem {
  itemUid: string
  sequence: number
}

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
  humanMentions?: ArkmeHumanMentionInput[]
}

export interface ArkmeHumanMentionInput {
  memberRef: string
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
  memberRef: string
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
  | 'chat.private.open-from-contact'
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
  | 'user.profile'
  | 'user.profile.refresh'
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
  | 'source.timeline'
  | 'source.members'
  | 'source.member-records'
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
  | 'chat.member.private.open'
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
  | 'extensions.installed-list'
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
  | 'extensions.client.failure'
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
