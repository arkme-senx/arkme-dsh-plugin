import type { ArkmeChatRealtimeNotice } from './chat-realtime.js'
import { OwnerRecordingForwardGateway } from './services/recording-forward-gateway.js'
import type { RecordingForwardInput } from './recording-forward-contract.js'
import type {
  ArkmeDSHBetaCommunityEntryState,
  ArkmeDSHBetaCommunityJoinResult,
} from './dsh-beta-community.js'
import type {
  ArkmeExtensionReviewCreateInput,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewPage,
} from './extensions/types.js'
import type { ArkmeSessionStore } from './keychain-store.js'
import type { ArkmeRecordReeditCommitResult, ArkmeRecordReeditDiscardPreparedContext, ArkmeRecordReeditDiscardResult, ArkmeRecordReeditEditorSnapshot, ArkmeRecordReeditPrepareInput, ArkmeRecordReeditPreparedContext } from './record-reedit-contract.js'
import { createArkmeAccountSessionOwner } from './account-session-owner.js'
import { resolveManagedAccessCredential } from './managed-access-credential.js'
import type { createOpenClawProvisioner, OpenClawProvisionResult } from './openclaw/index.js'
import { ArkmeOutgoingCallBroker } from './outgoing-call-broker.js'
import {
  ArkmeBillingUnavailableError,
  HttpArkmeBillingGateway,
  type ArkmeBillingGateway,
} from './billing-gateway.js'
import type {
  ArkmeOutgoingCallIntentClaim,
  ArkmeOutgoingCallIntentResolutionInput,
  ArkmeOutgoingCallMediaType,
  ArkmeOutgoingCallPrepareResult,
  ArkmeOutgoingCallToolResult,
} from './outgoing-call-contract.js'
import type { ArkmeRequestStats } from './request-coordinator.js'
import type { PublicRecordingImportCurrentSnapshot, PublicRecordingImportHistoryPage, PublicRecordingImportJob } from './recording-import-contract.js'
import { LocalRecordingImportSource } from './recording-import-probe.js'
import { SecretValue } from './secret-value.js'
import {
  buildWorldVoiceprintInviteMessage,
  WORLD_VOICEPRINT_INVITE_VARIANT_COUNT,
} from './world-voiceprint-copy.js'
import { AiVideoService } from './services/ai-video-service.js'
import { ArkoService } from './services/arko-service.js'
import { ArrangementService } from './services/arrangement-service.js'
import { AuthService, jiwoScanLoginAvailable } from './services/auth-service.js'
import { BackgroundSoundMembershipService } from './services/background-sound-membership-service.js'
import { BackgroundSoundPreferenceService } from './services/background-sound-preference-service.js'
import { BotService, type ArkmeBotManageUpdateInput, type ArkmeBotRefPayload } from './services/bot-service.js'
import { BotConversationService } from './services/bot-conversation-service.js'
import { CalendarService } from './services/calendar-service.js'
import { CallHistoryService } from './services/call-history-service.js'
import { ChatRealtimeService } from './services/chat-realtime-service.js'
import { ChatService } from './services/chat-service.js'
import { ConversationDirectoryVisibilityService } from './services/conversation-directory-visibility-service.js'
import { ConversationListPreferenceService } from './services/conversation-list-preference-service.js'
import { ContactService } from './services/contact-service.js'
import { ContactDirectoryService } from './services/contact-directory-service.js'
import { CommunityService } from './services/community-service.js'
import { ExtensionReviewService, type ArkmeExtensionAuthorProjection } from './services/extension-review-service.js'
import { GroupAiPolishService } from './services/group-ai-polish-service.js'
import { GroupService } from './services/group-service.js'
import { InterwovenService } from './services/interwoven-service.js'
import {
  ArkmeLinkMetadataService,
  type ArkmeLinkDocumentReader,
} from './services/link-metadata-service.js'
import type { ArkmeLinkMetadata } from './link-metadata.js'
import {
  MAX_ARKME_IMAGE_BYTES,
  MediaService,
  type ArkmeMediaDescriptor,
  type ArkmeWorldImageEntry,
} from './services/media-service.js'
import { MessageActionService, type MessageActionForwardOptions } from './services/message-action-service.js'
import {
  ArkmeMessageActionGateway,
  LocalMessageActionCapabilityCodec,
} from './services/message-action-infrastructure.js'
import { OutgoingCallService } from './services/outgoing-call-service.js'
import { ProfileService, type ArkmePublicAvatarPresentation } from './services/profile-service.js'
import { RecordService } from './services/record-service.js'
import { RelatedQuickNoteService } from './services/related-quick-note-service.js'
import { ArkmePrivacyVisibilityService } from './services/privacy-visibility.js'
import { RecordingService } from './services/recording-service.js'
import { AudioRecordingImportGateway } from './services/recording-import-gateway.js'
import {
  MAX_ARKME_RELATED_RECORDING_CURSOR_LENGTH,
  MAX_ARKME_RELATED_RECORDING_PAGE_SIZE,
  RelatedRecordingService,
} from './services/related-recording-service.js'
import { SearchService } from './services/search-service.js'
import { createArkmeFileTransfers, type ArkmeFileSendInput, type ArkmeLocalFile, type FileTransfers } from './file-transfer-owner.js'
import {
  ArkmePluginError,
  ServiceRuntime,
  type ArkmeRemoteRequestOptions,
  type ArkmeServiceConfig,
  type FetchLike,
  type StateStore,
} from './services/service.js'
import { SourceService } from './services/source-service.js'
import { UnmarkedSpeakerService } from './services/unmarked-speaker-service.js'
import { WechatService } from './services/wechat-service.js'
import { VoiceprintService } from './services/voiceprint-service.js'
import { UserBanService } from './services/user-ban-service.js'
import { WorldService } from './services/world-service.js'
import type {
  ArkmeBotCreateInput,
  ArkmeBotCreateResult,
  ArkmeGroupBotList,
  ArkmeGroupBotMutationResult,
} from './tools/ports/bots.js'
import { ARKME_DEFAULT_SHARE_WEBSITE } from './types.js'
import type {
  ArkmeAiVideoJob,
  ArkmeAiVideoJobStatus,
  ArkmeAiVideoListResult,
  ArkmeAiVideoPreflightResult,
  ArkmeAiVideoSegmentSelector,
  ArkmeArkoAskResult,
  ArkmeArkoCancelResult,
  ArkmeArkoHistoryPage,
  ArkmeArkoModelCatalog,
  ArkmeArkoProfile,
  ArkmeArkoRunStatus,
  ArkmeArkoSession,
  ArkmeArrangementDetail,
  ArkmeArrangementListStatus,
  ArkmeArrangementMutationIntent,
  ArkmeArrangementMutationResult,
  ArkmeArrangementPage,
  ArkmeArrangementReminderPage,
  ArkmeArrangementReminderSummary,
  ArkmeArrangementReminderToggleResult,
  ArkmeArrangementReminderWriteResult,
  ArkmeAuthSnapshot,
  ArkmeBotList,
  ArkmeBotManageProfile,
  ArkmeBotNotificationPreference,
  ArkmeBotProvider,
  ArkmeBotSummary,
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeBillingOrderCreateInput,
  ArkmeBillingOrderSnapshot,
  ArkmeBillingProductList,
  ArkmeCallDetail,
  ArkmeCallHistoryOptions,
  ArkmeCallHistoryPage,
  ArkmeCallSummaryRetryResult,
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeCaptchaResult,
  ArkmeChatClientEvent,
  ArkmeChatRealtimeState,
  ArkmeClientConfig,
  ArkmeContactAddResult,
  ArkmeContactSearchResult,
  ArkmeDirectoryContactProfile,
  ArkmeDirectoryPage,
  ArkmeDirectorySectionKind,
  ArkmeConversationDirectoryVisibility,
  ArkmeConversationWriteResult,
  ArkmeConversationMemberList,
  ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberRecordPage,
  ArkmeCreateTextResult,
  ArkmeDirectTextSendResult,
  ArkmeFileAssetDisplayItem, ArkmeFavoriteStickerList, ArkmeFavoriteStickerAddInput, ArkmeFavoriteStickerManageAction,
  ArkmeGroupCommandResult,
  ArkmeGroupAiPolishMutationResult,
  ArkmeGroupAiPolishNotice,
  ArkmeGroupAiPolishRuleCandidate,
  ArkmeGroupAiPolishSnapshot,
  ArkmeGroupJoinRestrictionMutationResult,
  ArkmeGroupJoinRestrictionPage,
  ArkmeGroupMemberRemoveResult,
  ArkmeGroupAiPolishThreadMessage,
  ArkmeGroupMemberList,
  ArkmeGroupMemberAddResult,
  ArkmeGroupMemberCandidateList,
  ArkmeGroupInvitePreview,
  ArkmeGroupNotificationResult,
  ArkmeGroupProjectionResult,
  ArkmeGroupSettingsSnapshot,
  ArkmeIdAvailabilitySnapshot,
  ArkmeIdMutationResult,
  ArkmeImageBytes,
  ArkmeImageSearchItem,
  ArkmeImageSearchResult,
  ArkmeInterwovenBootstrap,
  ArkmeInterwovenDetail,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
  ArkmeMessageCopyLinkResult,
  ArkmeMessageCopyLinkExtendResult,
  ArkmeMessageCopyLinkResolveResult,
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptQueryItem,
  ArkmeMessageReadReceiptSummaryList,
  ArkmeMessageReportResult,
  ArkmeMessageWithdrawalResult,
  ArkmeOfficialAuthorProfile,
  ArkmeOpenPrivateChatResult,
  ArkmePendingWrite,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmeQuotaSnapshot,
  ArkmeRecordCursor,
  ArkmeRecordTagList,
  ArkmeRecordSearchResult,
  ArkmeRecordingCalendarMonth, ArkmeRecordingCursorPayload, ArkmeRecordingDay, ArkmeRecordingPlayback,
  ArkmeRecordingProjectionKind, ArkmeRecordingSearchResult, ArkmeRecordingSection, ArkmeRecordingSpeakerMutationResult,
  ArkmeRecordingSpeakerOption, ArkmeRecordingSummaryModelConfig, ArkmeRecordingSummaryModelRouteUpdate,
  ArkmeRecordingTranscriptSection, ArkmeRecordingVersion,
  ArkmeRelatedRecordingEligibility, ArkmeRelatedRecordingPage, ArkmeRelatedRecordingPageOptions, ArkmeRelatedQuickNoteDetail, ArkmeRelatedQuickNoteList, ArkmeRichSendInput, ArkmeRecordCaptureContext, ArkmeRecordLocationCapture, ArkmeMessageSnapshotDetail, ArkmeBotMentionInput, ArkmeHumanMentionInput,
  ArkmeSearchHistoryResult,
  ArkmeSearchSceneKind,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
  ArkmeSourceDirectory,
  ArkmeSourceDirectoryPinResult,
  ArkmeSourceItem,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeSharedRecordingPreview,
  ArkmeTimelineCursor,
  ArkmeTimelineAroundPage,
  ArkmeTimelinePage,
  ArkmeTopicCreateResult,
  ArkmeTopicDissolveResult,
  ArkmeTopicDissolveProgress,
  ArkmeTopicDissolveTask,
  ArkmeTopicHierarchyMoveResult,
  ArkmeTopicRenameResult,
  ArkmeUploadedAsset,
  ArkmeUnmarkedSpeakerInferenceRetry,
  ArkmeUnmarkedSpeakerMarkResult,
  ArkmeUnmarkedSpeakerOptions,
  ArkmeUnmarkedSpeakerSegmentPage,
  ArkmeUserCardSnapshot,
  ArkmeUserBanOwnerRecord,
  ArkmeUserBanOwnerSnapshot,
  ArkmeUserProfileSnapshot,
  ArkmeWechatCallFilter,
  ArkmeWechatCommonGroupPage,
  ArkmeWechatConversationDetail,
  ArkmeWechatConversationPage,
  ArkmeWechatGroupMemberPage,
  ArkmeWechatLocationPage,
  ArkmeWechatMessageFilter,
  ArkmeWechatMessagePage,
  ArkmeWechatMoneyFlowPage,
  ArkmeWechatPhonePage,
  ArkmeWorldFeedPage,
  ArkmeWorldAuthorLabel,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintInviteResult,
  ArkmeWorldVoiceprintPlaybackChunk,
  ArkmeWorldVoiceprintSocialContext,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionPage,
  ArkmeWorldPublishFileAssetsInput, ArkmeWorldPublishResult, ArkmeWorldPublishTextInput,
  ArkmeWorldRecordList,
} from './types.js'
import { ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS, ARKME_PROVIDER_CONTRACT_VERSION } from './types.js'

function voiceprintInviteRateLimitMessage(error: unknown): string | undefined {
  if (!(error instanceof ArkmePluginError)) return undefined
  if (error.upstreamStatus !== 429 && error.httpStatus !== 429 && !/\bHTTP\s*429\b/.test(error.message)) return undefined
  const seconds = error.retryAfterMillis === undefined ? 0 : Math.ceil(error.retryAfterMillis / 1000)
  return seconds > 0
    ? `提醒发送太频繁了，请 ${String(seconds)} 秒后再试。`
    : '提醒发送太频繁了，稍后再试。'
}

export { MAX_ARKME_IMAGE_BYTES } from './services/media-service.js'
export {
  MAX_ARKME_RELATED_RECORDING_CURSOR_LENGTH,
  MAX_ARKME_RELATED_RECORDING_PAGE_SIZE,
} from './services/related-recording-service.js'
export { ArkmePluginError, type ArkmeServiceConfig }
export class ArkmeService {
  private readonly runtime: ServiceRuntime
  readonly accountScope: ReturnType<typeof createArkmeAccountSessionOwner>
  private readonly billingGateway: ArkmeBillingGateway
  private readonly aiVideo: AiVideoService
  private readonly arrangement: ArrangementService
  private readonly calendar: CalendarService
  private readonly callHistory: CallHistoryService
  private readonly wechat: WechatService
  private readonly recording: RecordingService
  private readonly profile: ProfileService
  private readonly auth: AuthService
  private readonly extensionReview: ExtensionReviewService
  private readonly media: MediaService
  private readonly privacy: ArkmePrivacyVisibilityService
  private readonly source: SourceService
  private readonly conversationDirectoryVisibility: ConversationDirectoryVisibilityService
  private readonly record: RecordService
  private readonly search: SearchService
  private readonly bot: BotService
  private readonly messageActions: MessageActionService
  private readonly botConversation: BotConversationService
  private readonly outgoingCall: OutgoingCallService
  private readonly world: WorldService
  private readonly arko: ArkoService
  private readonly group: GroupService
  private readonly relatedRecording: RelatedRecordingService
  private readonly community: CommunityService
  private readonly realtime: ChatRealtimeService
  private readonly interwoven: InterwovenService
  private readonly linkMetadata: ArkmeLinkMetadataService
  private readonly aiPolish: GroupAiPolishService
  private readonly chat: ChatService
  private readonly relatedQuickNote: RelatedQuickNoteService
  private readonly contact: ContactService
  private readonly contactDirectory: ContactDirectoryService
  private readonly unmarkedSpeaker: UnmarkedSpeakerService
  private readonly voiceprint: VoiceprintService
  private readonly userBan: UserBanService
  private readonly backgroundSoundPreferenceOwner: BackgroundSoundPreferenceService
  private readonly fileTransfers: FileTransfers | undefined
  private localFileOpener?: (path: string, signal: AbortSignal) => Promise<void>
  private worldVoiceprintInviteVariantIndex = 0
  constructor(
    private readonly config: ArkmeServiceConfig,
    private readonly sessionStore: ArkmeSessionStore,
    private readonly stateStore: StateStore,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly pendingSessionStore?: ArkmeSessionStore,
    outgoingCallBroker = new ArkmeOutgoingCallBroker(),
    billingGateway?: ArkmeBillingGateway,
    linkDocumentReader?: ArkmeLinkDocumentReader,
  ) {
    this.accountScope = createArkmeAccountSessionOwner(sessionStore, fetchImpl)
    this.runtime = new ServiceRuntime(config, sessionStore, stateStore, fetchImpl, pendingSessionStore, this.accountScope)
    this.billingGateway = billingGateway ?? new HttpArkmeBillingGateway(this.runtime)
    this.privacy = new ArkmePrivacyVisibilityService(this.runtime)
    this.aiVideo = new AiVideoService(this.runtime)
    this.arrangement = new ArrangementService(this.runtime)
    this.calendar = new CalendarService(this.runtime, this.privacy)
    this.wechat = new WechatService(this.runtime)
    this.profile = new ProfileService(this.runtime)
    this.callHistory = new CallHistoryService(this.runtime, this.profile)
    this.extensionReview = new ExtensionReviewService(this.runtime, this.profile, {
      createTextForConversation: async (recordUid, textContent) => {
        return await this.createTextForConversation(recordUid, textContent)
      },
    })
    this.media = new MediaService(
      this.runtime,
      this.profile,
      { openWorldImageRef: async (imageRef, viewerUserId) => await this.openWorldImageRef(imageRef, viewerUserId) },
      { recordUid: raw => this.recordUid(raw) }, { openBotImageRef: async (imageRef, viewerUserId) => await this.bot.openBotImageRef(imageRef, viewerUserId) },
    )
    this.source = new SourceService(this.runtime, this.profile, {
      summary: async () => await this.summary(),
      recordItem: raw => this.recordItem(raw),
      isDSHAgentInput: raw => this.record.isDSHAgentInput(raw),
      isPrivacyLocked: raw => this.record.isPrivacyLocked(raw),
    }, this.privacy)
    this.record = new RecordService(this.runtime, this.media, this.source, this.privacy)
    this.search = new SearchService(this.runtime, this.record, this.media, this.source, this.privacy)
    this.bot = new BotService(this.runtime, this.source)
    this.messageActions = new MessageActionService(
      new ArkmeMessageActionGateway(
        this.runtime,
        this.source,
        async (target, sequence) => {
          if (target.kind === 'private_chat' || target.kind === 'group_chat') {
            this.realtime.scheduleChatSessionProjection(target.ownerRef, sequence ?? 0)
          } else {
            await this.realtime.invalidateRecordProjection()
          }
        },
      ),
      this.bot,
      new LocalMessageActionCapabilityCodec(async () => await this.runtime.stateStore.uniqueCode()),
    )
    this.outgoingCall = new OutgoingCallService(this.runtime, this.source, this.profile, outgoingCallBroker)
    this.world = new WorldService(
      this.runtime,
      { refreshProfile: async () => await this.refreshProfile() },
      this.media,
      this.record,
      this.source,
    )
    this.arko = new ArkoService(this.runtime, this.profile, this.messageActions)
    this.group = new GroupService(this.runtime, this.source, this.profile, {
      sendPrivateText: async (sourceRef, chatSessionUid, text, recordUid, relationUid, session, signal) => {
        await this.chat.sendChatSourceTextRaw(
          sourceRef, chatSessionUid, text, recordUid, relationUid, session, undefined, undefined, signal,
        )
      },
    }, () => { void this.realtime.refreshAttentionSummary() })
    this.relatedRecording = new RelatedRecordingService(this.runtime, this.source)
    this.community = new CommunityService(this.runtime, this.source, this.profile)
    this.interwoven = new InterwovenService(this.runtime, this.source, this.profile)
    this.linkMetadata = new ArkmeLinkMetadataService(linkDocumentReader)
    this.aiPolish = new GroupAiPolishService(this.runtime, this.source, {
      sendChatSourceTextRaw: async (...args) => await this.chat.sendChatSourceTextRaw(...args),
    })
    this.realtime = new ChatRealtimeService(this.runtime, this.source, {
      chatTimelineItems: async (data, session, chatSessionUid, sourceKind) => await this.chat.chatTimelineItems(data, session, chatSessionUid, sourceKind),
    })
    this.conversationDirectoryVisibility = new ConversationDirectoryVisibilityService(new ConversationListPreferenceService(this.runtime), this.source, this.bot, this.realtime)
    this.chat = new ChatService(
      this.runtime,
      this.source,
      this.profile,
      this.media,
      this.record,
      this.bot,
      this.arko,
      this.aiPolish,
      this.realtime,
      this.privacy,
      this.messageActions,
    )
    this.userBan = new UserBanService(this.runtime, this.chat)
    this.botConversation = new BotConversationService(
      this.runtime,
      this.bot,
      this.chat,
      async () => { await this.realtime.invalidateRecordProjection() },
      this.messageActions,
    )
    this.relatedQuickNote = new RelatedQuickNoteService(this.runtime, this.record, this.media, this.profile, this.privacy)
    this.contactDirectory = new ContactDirectoryService(
      this.runtime, this.source, this.bot, this.profile, this.world, this.chat,
    )
    const recordingImportGateway = new AudioRecordingImportGateway(this.runtime)
    this.recording = new RecordingService(this.runtime, {
      recordingImportGateway,
      recordingImportOwnerGateway: recordingImportGateway,
      recordingImportSource: new LocalRecordingImportSource(),
      profile: this.profile, media: this.media, userCandidates: this.contactDirectory,
      forwardGateway: new OwnerRecordingForwardGateway(this.runtime, this.source, this.realtime, this.chat),
    })
    this.unmarkedSpeaker = new UnmarkedSpeakerService(this.runtime, this.media)
    this.contact = new ContactService(this.runtime, this.source, this.profile, this.realtime)
    this.voiceprint = new VoiceprintService(this.runtime, this.profile, {
      resolveRegisteredContactUserId: async (contactRef, session, signal) => await this.contact.resolveRegisteredContactUserId(
        contactRef, session, signal,
      ),
    })
    this.auth = new AuthService(this.runtime, this.profile, {
      reconnectChatRealtime: () => { this.realtime.reconnect() },
      clearAccountState: userIds => { this.clearAccountState(userIds) },
    })
    this.backgroundSoundPreferenceOwner = new BackgroundSoundPreferenceService(
      this.runtime,
      new BackgroundSoundMembershipService(this.runtime),
    )
    this.fileTransfers = createArkmeFileTransfers({
      directory: config.fileStateDirectory,
      maxUploadBytes: config.maxUploadBytes,
      runtime: this.runtime,
      source: this.source,
      media: this.media,
      chat: this.chat,
      openPath: async (path, signal) => {
        if (this.localFileOpener === undefined) throw new Error('当前 DSH 宿主未提供本机文件打开能力')
        await this.localFileOpener(path, signal)
      },
    })
  }
  private filesOwner(): FileTransfers {
    if (!this.fileTransfers) throw new ArkmePluginError('file-flow-unavailable', '当前宿主不支持本地文件流程，请升级插件', false, 501)
    return this.fileTransfers
  }
  fileCapabilities() { return this.filesOwner().capabilities() }
  async fileSearch(options: { query?: string; limit: number; cursor?: string; signal?: AbortSignal }) { return await this.search.searchFiles(options) }
  async fileSessionUser() { return (await this.runtime.requireSession()).userId }
  async fileStage(path: string, metadata: Pick<ArkmeLocalFile, 'fileName' | 'mimeType' | 'size'>, expectedUserId?: number) { return await this.filesOwner().stage(path, metadata, expectedUserId) }
  async fileList() { return await this.filesOwner().files() }
  async fileReadLocal(ref: string) { return await this.filesOwner().readLocal(ref) }
  attachLocalFileOpener(openPath: (path: string, signal: AbortSignal) => Promise<void>) { this.localFileOpener = openPath }
  async fileOpenLocal(ref: string) { return await this.filesOwner().openLocal(ref) }
  async fileRemove(ref: string) { await this.filesOwner().remove(ref) }
  async fileSend(input: ArkmeFileSendInput) { return await this.filesOwner().enqueue(input) }
  async fileSendTasks(sourceRef?: string) { return await this.filesOwner().tasks(sourceRef) }
  async fileSendRetry(taskRef: string) { return await this.filesOwner().retry(taskRef) }
  async fileStageBytes(contentBase64: string, metadata: Pick<ArkmeLocalFile, 'fileName' | 'mimeType'>) { return await this.filesOwner().stageBytes(contentBase64, metadata) }
  async fileSendDiscard(taskRef: string) { return await this.filesOwner().discard(taskRef) }
  async fileSendReconcile(taskRef: string) { return await this.filesOwner().reconcile(taskRef) }
  async fileReceive(mediaRef: string, start = false) { return await this.filesOwner().reception(mediaRef, start) }
  async backgroundSoundPreference(signal?: AbortSignal) { return await this.backgroundSoundPreferenceOwner.preference(signal) }
  async updateBackgroundSoundPreference(enabled: boolean, signal?: AbortSignal, expectedUserId?: number) {
    return await this.backgroundSoundPreferenceOwner.update(enabled, signal, expectedUserId)
  }

  private clearAccountState(userIds: readonly number[]): void {
    this.realtime.resetAttentionSummary()
    for (const userId of userIds) this.privacy.clear(userId)
    this.fileTransfers?.cancelActive()
    for (const userId of userIds) this.outgoingCall.clearUser(userId, '账号已退出，呼叫已取消')
    this.source.dispose()
    this.media.dispose()
    this.aiPolish.dispose()
    this.interwoven.dispose()
    this.relatedQuickNote.dispose()
    this.world.dispose()
    this.arrangement.dispose()
    this.contact.dispose()
    this.contactDirectory.dispose()
    this.unmarkedSpeaker.dispose()
    this.bot.clearAccountRefs()
  }

  startChatRealtime(): () => void {
    return this.realtime.startChatRealtime()
  }

  chatRealtimeState(): ArkmeChatRealtimeState {
    return this.realtime.chatRealtimeState()
  }

  async resolveManagedAccessCredential(): Promise<SecretValue> { return await resolveManagedAccessCredential(this.runtime) }

  subscribeChatRealtime(listener: (event: ArkmeChatClientEvent) => void): () => void {
    return this.realtime.subscribeChatRealtime(listener)
  }

  chatRealtimeInitialEvent(): ArkmeChatClientEvent {
    return this.realtime.chatRealtimeInitialEvent()
  }

  private handleChatRealtimeNotice(notice: ArkmeChatRealtimeNotice): void {
    this.realtime.handleChatRealtimeNotice(notice)
  }

  private async refreshChatSessionProjectionBatch(
    pending: Array<[string, number]>,
  ): Promise<Array<[string, number]>> {
    const failed = await this.realtime.refreshChatSessionProjectionBatch(pending.map(([uid, latestSequence]) => [uid, {
      latestSequence,
      notificationHints: [],
    }]))
    return failed.map(([uid, projection]) => [uid, projection.latestSequence])
  }

  attachOpenClawProvisioner(provisioner: ReturnType<typeof createOpenClawProvisioner>): void {
    this.bot.attachOpenClawProvisioner(provisioner)
  }

  async connectOpenClawBot(botRef: string, options: { signal?: AbortSignal } = {}): Promise<OpenClawProvisionResult> {
    return await this.bot.connectOpenClawBot(botRef, options)
  }

  async listBots(options: { signal?: AbortSignal } = {}): Promise<ArkmeBotList> {
    return await this.bot.listBots(options)
  }

  async createBot(
    input: ArkmeBotCreateInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotCreateResult> {
    return await this.bot.createBot(input, options)
  }

  async createBotSummary(
    input: ArkmeBotCreateInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeBotSummary> {
    return await this.bot.createBotSummary(input, options)
  }

  async revealBotSecret(botRef: string, options: { signal?: AbortSignal } = {}): Promise<SecretValue> {
    return await this.bot.revealBotSecret(botRef, options)
  }

  async manageBotProfile(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotManageProfile> {
    return await this.bot.manageBotProfile(botRef, options)
  }

  async updateManagedBot(botRef: string, input: ArkmeBotManageUpdateInput, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotManageProfile> {
    return await this.bot.updateManagedBot(botRef, input, options)
  }

  async revealManagedBotToken(botRef: string, options: { signal?: AbortSignal } = {}): Promise<{ token: string }> {
    return await this.bot.revealManagedBotToken(botRef, options)
  }

  async deleteManagedBot(botRef: string, confirmationName: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    await this.bot.deleteManagedBot(botRef, confirmationName, options)
  }

  async botNotificationPreference(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotNotificationPreference> { return await this.botConversation.notificationPreference(botRef, options) }

  async updateBotNotificationPreference(botRef: string, muted: boolean, options: { signal?: AbortSignal } = {}): Promise<ArkmeBotNotificationPreference> { return await this.botConversation.updateNotificationPreference(botRef, muted, options) }

  async openBotChat(botRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeSourceItem> { return await this.conversationDirectoryVisibility.openBotContactConversation(botRef, options) }
  async listBotPrivateChatDirectory(options: { signal?: AbortSignal } = {}) { return await this.botConversation.directory(options) }

  async openBotPrivateChat(botRef: string, options: { signal?: AbortSignal } = {}) { return await this.botConversation.open(botRef, options) }

  async refreshBotPrivateChat(botRef: string, options: { signal?: AbortSignal } = {}) { return await this.botConversation.refresh(botRef, options) }

  async sendBotPrivateChatMessage(botRef: string, content: string, options: { signal?: AbortSignal } = {}) { return await this.botConversation.send(botRef, content, options) }

  async markBotPrivateChatRead(botRef: string, sequence: number, options: { signal?: AbortSignal } = {}) { return await this.botConversation.markRead(botRef, sequence, options) }

  async listGroupBots(
    groupSourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupBotList> {
    return await this.bot.listGroupBots(groupSourceRef, options)
  }

  async addGroupBot(
    groupSourceRef: string,
    botRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupBotMutationResult> {
    return await this.bot.addGroupBot(groupSourceRef, botRef, options)
  }

  async removeGroupBot(
    groupSourceRef: string,
    botRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupBotMutationResult> {
    return await this.bot.removeGroupBot(groupSourceRef, botRef, options)
  }

  private async openBotRef(botRef: string, expectedUserId: number): Promise<ArkmeBotRefPayload> {
    return await this.bot.openBotRef(botRef, expectedUserId)
  }

  async authStatus(): Promise<ArkmeAuthSnapshot> {
    return await this.auth.authStatus()
  }

  async dshRemoteGet<T>(path: string, signal?: AbortSignal): Promise<T> { return await this.runtime.authenticatedDshRemoteGet<T>(path, signal) }
  async dshRemotePost<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> { return await this.runtime.authenticatedDshRemotePost<T>(path, body, undefined, signal) }

  clientConfig(): ArkmeClientConfig {
    return {
      captchaId: this.config.geetestCaptchaId,
      environment: this.config.environment,
      testLoginEnabled: this.config.environment === 'test',
      jiwoScanLoginEnabled: jiwoScanLoginAvailable(this.config),
      callAssetBasePath: `${this.config.routePath}/call`,
      voiceprintEnrollmentPath: `${this.config.routePath}/voiceprint/enroll`,
      recordingImportPath: `${this.config.routePath}/recording/import`,
      mediaPath: `${this.config.routePath}/media`,
      shareWebsite: this.config.shareWebsite ?? ARKME_DEFAULT_SHARE_WEBSITE,
      recordingWorkbenchEnabled: this.config.recordingWorkbenchEnabled !== false,
    }
  }

  async billingQuota(signal?: AbortSignal): Promise<ArkmeQuotaSnapshot> {
    return await this.callBillingGateway(() => this.billingGateway.quota(signal))
  }

  async billingProducts(signal?: AbortSignal): Promise<ArkmeBillingProductList> {
    return await this.callBillingGateway(() => this.billingGateway.products(signal))
  }

  async createBillingOrder(
    input: ArkmeBillingOrderCreateInput,
    signal?: AbortSignal,
  ): Promise<ArkmeBillingOrderSnapshot> {
    return await this.callBillingGateway(() => this.billingGateway.createOrder(input, signal))
  }

  async billingOrderStatus(orderId: string, signal?: AbortSignal): Promise<ArkmeBillingOrderSnapshot> {
    return await this.callBillingGateway(() => this.billingGateway.orderStatus(orderId, signal))
  }

  private async callBillingGateway<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ArkmeBillingUnavailableError) {
        throw new ArkmePluginError('billing-unavailable', error.message, true, 503, { cause: error })
      }
      throw error
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
        accountSettings: true,
        imageRead: true,
        recordCalendar: true,
        imageLibrary: true,
        sourceDirectory: true,
        sourceTimeline: true,
        forwardContent: true,
        sourceTextSend: true,
        messageReadReceipts: true,
        messageReport: true,
        userBanManagement: true,
        groupOwnerGovernance: true,
        richContentRead: this.config.richMediaRenderEnabled !== false,
        richContentSend: this.config.richMediaSendEnabled !== false,
        ...(this.config.richMediaSendEnabled === false ? {} : { backgroundSound: true as const }),
        fileUpload: this.config.richMediaSendEnabled !== false,
        outgoingCall: true,
        callHistory: true,
        groupMembers: true,
        groupMemberAdd: true,
        userCard: true,
        openPrivateChat: true,
        contactAdd: true,
        conversationQuickAdd: true,
        groupSettings: true,
        groupAiPolish: true,
        extensionManagement: true,
        extensionMetadataEdit: true,
        extensionIcons: true,
        extensionPreviews: true,
        worldFeed: true,
        worldInteractions: true,
        worldPublish: true,
        worldVoiceprintPlayback: true,
        worldVoiceprintInvite: true,
        worldVoiceprintSocialContext: true,
        voiceprintManagement: true,
        arrangements: true,
        myExtensions: true,
        extensionPublish: true,
        extensionReviews: true,
        ...(this.relatedRecording.isEnabled() ? { relatedRecordings: true as const } : {}),
      },
      limits: {
        maxTextLength: this.config.maxTextLength,
        maxSearchResults: 30,
        maxSyncPages: 20,
        maxImageBytes: MAX_ARKME_IMAGE_BYTES,
        maxMessageReadReceiptItems: ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS,
        ...(this.relatedRecording.isEnabled() ? {
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
    return await this.outgoingCall.requestOutgoingCall(sourceRef, mediaType, signal)
  }

  async claimOutgoingCallIntent(): Promise<ArkmeOutgoingCallIntentClaim | null> {
    return await this.outgoingCall.claimOutgoingCallIntent()
  }

  async resolveOutgoingCallIntent(
    input: Omit<ArkmeOutgoingCallIntentResolutionInput, 'userId'>,
  ): Promise<void> {
    return await this.outgoingCall.resolveOutgoingCallIntent(input)
  }

  async prepareOutgoingCall(input: {
    sourceRef: string
    mediaType: ArkmeOutgoingCallMediaType
    callRequestId: string
    signal?: AbortSignal
  }): Promise<ArkmeOutgoingCallPrepareResult> {
    return await this.outgoingCall.prepareOutgoingCall(input)
  }

  async heartbeatOutgoingCall(callRequestId: string): Promise<{ expiresAtMillis: number }> {
    return await this.outgoingCall.heartbeatOutgoingCall(callRequestId)
  }

  async releaseOutgoingCall(callRequestId: string): Promise<void> {
    return await this.outgoingCall.releaseOutgoingCall(callRequestId)
  }

  async listCallHistory(options: ArkmeCallHistoryOptions = {}, signal?: AbortSignal): Promise<ArkmeCallHistoryPage> { return await this.callHistory.listCallHistory(options, signal) }
  async callDetail(callRef: string, signal?: AbortSignal): Promise<ArkmeCallDetail> { return await this.callHistory.callDetail(callRef, signal) }
  async retryCallSummary(callRef: string, signal?: AbortSignal): Promise<ArkmeCallSummaryRetryResult> { return await this.callHistory.retryCallSummary(callRef, signal) }
  dispose(): void {
    this.realtime.resetAttentionSummary()
    this.fileTransfers?.cancelActive()
    this.contact.dispose()
    this.contactDirectory.dispose()
    this.unmarkedSpeaker.dispose()
    this.realtime.dispose()
    this.arko.dispose()
    this.auth.dispose()
    this.bot.dispose()
    this.extensionReview.dispose()
    this.media.dispose()
    this.recording.dispose()
    this.source.dispose()
    this.aiPolish.dispose()
    this.arrangement.dispose()
    this.runtime.dispose()
    this.outgoingCall.dispose()
    this.interwoven.dispose()
    this.relatedQuickNote.dispose()
    this.world.dispose()
    this.linkMetadata.dispose()
  }

  requestStats(): Record<string, ArkmeRequestStats> { return this.runtime.requestStats() }
  async resolveLinkMetadata(
    url: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeLinkMetadata | null> {
    return await this.linkMetadata.resolve(url, options)
  }
  async cachedProfile(): Promise<ArkmeUserProfileSnapshot> { return await this.profile.cachedProfile() }
  /** @internal Team presentation adapter; public identity remains owned by Backend. */
  async publicAvatarPresentationsByArkmeIds(
    arkmeIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<Map<string, ArkmePublicAvatarPresentation>> {
    return await this.profile.publicAvatarPresentationsByArkmeIds(arkmeIds, signal)
  }
  async searchContact(identifier: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeContactSearchResult> { return await this.contact.search(identifier, options) }

  async listDirectory(section: ArkmeDirectorySectionKind, options: { limit?: number; cursor?: string; countOnly?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeDirectoryPage> {
    return section === 'unmarked-speakers' ? await this.unmarkedSpeaker.list(options) : await this.contactDirectory.list(section, options)
  }
  async directoryContactProfile(contactRef: string, signal?: AbortSignal): Promise<ArkmeDirectoryContactProfile> { return await this.contactDirectory.contactProfile(contactRef, signal) }
  async directoryContactWorld(contactRef: string, options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<ArkmeWorldFeedPage> { return await this.contactDirectory.contactWorld(contactRef, options) }
  async openDirectoryContactChat(contactRef: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> { const result = await this.contactDirectory.openContactChat(contactRef, signal); void this.conversationDirectoryVisibility.restoreSource(result.source).catch(() => undefined); return result }
  async openDirectoryGroupChat(sourceRef: string, signal?: AbortSignal): Promise<ArkmeSourceItem> { const source = await this.contactDirectory.openGroupChat(sourceRef, signal); void this.conversationDirectoryVisibility.restoreSource(source).catch(() => undefined); return source }
  async unmarkedSpeakerOptions(candidateRef: string, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerOptions> { return await this.unmarkedSpeaker.markOptions(candidateRef, signal) }
  async retryUnmarkedSpeakerInference(candidateRef: string, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerInferenceRetry> { return await this.unmarkedSpeaker.retryInference(candidateRef, signal) }
  async unmarkedSpeakerSegments(candidateRef: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<ArkmeUnmarkedSpeakerSegmentPage> { return await this.unmarkedSpeaker.segments(candidateRef, options) }
  async markUnmarkedSpeaker(input: { candidateRef: string; candidateVersion: string; speakerRef?: string; newSpeakerName?: string }, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerMarkResult> { return await this.unmarkedSpeaker.mark(input, signal) }

  async addContact(contactRef: string, options: { remark?: string; requestUid?: string; signal?: AbortSignal } = {}): Promise<ArkmeContactAddResult> { return await this.contact.add(contactRef, options) }
  async extensionAuthors(userIds: readonly number[], signal?: AbortSignal): Promise<Map<number, ArkmeExtensionAuthorProjection>> { return await this.extensionReview.extensionAuthors(userIds, signal) }
  async listExtensionReviews(extensionIdValue: string, options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<ArkmeExtensionReviewPage> { return await this.extensionReview.listExtensionReviews(extensionIdValue, options) }
  async createExtensionReview(input: ArkmeExtensionReviewCreateInput, signal?: AbortSignal): Promise<ArkmeExtensionReviewCreateResult> { return await this.extensionReview.createExtensionReview(input, signal) }

  async recordingCalendar(fromStamp: number, toStamp: number, signal?: AbortSignal): Promise<ArkmeRecordingCalendarMonth> { return await this.recording.recordingCalendar(fromStamp, toStamp, signal) }
  async recordingTranscript(dateStamp: number, signal?: AbortSignal): Promise<ArkmeRecordingTranscriptSection> { return await this.recording.recordingTranscript(dateStamp, signal) }
  async recordingProjection(dateStamp: number, kind: ArkmeRecordingProjectionKind, signal?: AbortSignal): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> { return await this.recording.recordingProjection(dateStamp, kind, signal) }
  /** @internal Built-in loopback UI only. */ async recordingSummaryModelConfig(signal?: AbortSignal): Promise<ArkmeRecordingSummaryModelConfig> { return await this.recording.recordingSummaryModelConfig(signal) }
  /** @internal Built-in loopback UI only. */ async setRecordingSummaryModelRoute(routeKey: string, signal?: AbortSignal): Promise<ArkmeRecordingSummaryModelRouteUpdate> { return await this.recording.setRecordingSummaryModelRoute(routeKey, signal) }
  /** @internal Built-in loopback UI only. */ async generateRecordingProjection(dateStamp: number, kind: ArkmeRecordingProjectionKind, routeKey = '', signal?: AbortSignal): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> { return await this.recording.generateRecordingProjection(dateStamp, kind, routeKey, signal) }
  async sealRecordingCursor(payload: ArkmeRecordingCursorPayload): Promise<string> { return await this.recording.sealRecordingCursor(payload) }
  async openRecordingCursor(cursor: string): Promise<ArkmeRecordingCursorPayload> { return await this.recording.openRecordingCursor(cursor) }
  async recordingComparison(dateStamp: number, signal?: AbortSignal) { return await this.recording.recordingComparison(dateStamp, signal) }
  async recordingForwardCapabilities(signal?: AbortSignal) { return await this.recording.recordingForwardCapabilities(signal) }
  async forwardRecording(input: RecordingForwardInput, signal?: AbortSignal) { return await this.recording.forwardRecording(input, signal) }
  async startRecordingComparison(dateStamp: number, signal?: AbortSignal) { return await this.recording.startRecordingComparison(dateStamp, signal) }
  async recordingDay(dateStamp: number, signal?: AbortSignal): Promise<ArkmeRecordingDay> { return await this.recording.recordingDay(dateStamp, signal) }
  async recordingPlayback(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingPlayback> { return await this.recording.recordingPlayback(itemRef, signal) }
  async recordingSpeakerOptions(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerOption[]> { return await this.recording.recordingSpeakerOptions(itemRef, signal) }
  async assignRecordingSpeaker(input: { itemRef: string; speakerRef?: string; newSpeakerName?: string; scope: 'item' | 'speaker' }, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerMutationResult> { return await this.recording.assignRecordingSpeaker(input, signal) }
  /** @internal Built-in loopback UI only. */ async recordingImportUserId(): Promise<number> { return await this.recording.recordingImportUserId() }
  /** @internal Built-in loopback UI only. */ async recordingImportPreflight(fileNames: string[], signal?: AbortSignal): Promise<{ duplicateFileNames: string[] }> { return await this.recording.recordingImportPreflight(fileNames, signal) }
  /** @internal Built-in loopback UI only. */ async acceptRecordingImport(sourceHandle: string, metadata: { fileName: string; mimeType: string; fileSize: number; sha256: string; startAtMillis: number; belongUserId: number }, expectedUserId: number): Promise<PublicRecordingImportJob> { return await this.recording.acceptRecordingImport(sourceHandle, metadata, expectedUserId) }
  /** @internal Built-in loopback UI only. */ async recordingImportStatus(importRef: string): Promise<PublicRecordingImportJob> { return await this.recording.recordingImportStatus(importRef) }
  /** @internal Built-in loopback UI only. */ async recordingImportList(signal?: AbortSignal): Promise<PublicRecordingImportCurrentSnapshot> { return await this.recording.recordingImportList(signal) }
  /** @internal Built-in loopback UI only. */ async recordingImportHistory(input: { toMillis: number; limit: number; offset: number }, signal?: AbortSignal): Promise<PublicRecordingImportHistoryPage> { return await this.recording.recordingImportHistory(input, signal) }
  /** @internal Built-in loopback UI only. */ async retryRecordingImport(importRef: string, expectedRevision: number): Promise<PublicRecordingImportJob> { return await this.recording.retryRecordingImport(importRef, expectedRevision) }
  /** @internal Built-in loopback UI only. */ async cancelRecordingImport(importRef: string, expectedRevision: number): Promise<PublicRecordingImportJob> { return await this.recording.cancelRecordingImport(importRef, expectedRevision) }
  /** @internal Built-in loopback UI only. */ async updateRecordingImportSessionStart(sessionRef: string, startAtMillis: number, signal?: AbortSignal): Promise<void> { await this.recording.updateRecordingImportSessionStart(sessionRef, startAtMillis, signal) }
  /** @internal Built-in loopback UI only. */ async updateRecordingImportSessionOwnership(sessionRef: string, ownership: 'self' | 'other', signal?: AbortSignal): Promise<void> { await this.recording.updateRecordingImportSessionOwnership(sessionRef, ownership, signal) }
  /** @internal Built-in loopback UI only. */ async deleteRecordingImportSession(sessionRef: string, signal?: AbortSignal): Promise<void> { await this.recording.deleteRecordingImportSession(sessionRef, signal) }
  async resumeRecordingImports(): Promise<void> { await this.recording.resumeRecordingImports() }

  async refreshProfile(): Promise<ArkmeUserProfileSnapshot> {
    return await this.profile.refreshProfile()
  }

  async arkoProfile(signal?: AbortSignal): Promise<ArkmeArkoProfile> {
    return await this.arko.arkoProfile(signal)
  }

  async arkoEnsureSession(signal?: AbortSignal): Promise<ArkmeArkoSession> {
    return await this.arko.arkoEnsureSession(signal)
  }

  async arkoCreateSession(signal?: AbortSignal): Promise<ArkmeArkoSession> {
    return await this.arko.arkoCreateSession(signal)
  }

  async arkoModelCatalog(signal?: AbortSignal): Promise<ArkmeArkoModelCatalog> {
    return await this.arko.arkoModelCatalog(signal)
  }

  async arkoActivateModel(routeKey: string, signal?: AbortSignal): Promise<ArkmeArkoModelCatalog> {
    return await this.arko.arkoActivateModel(routeKey, signal)
  }

  async arkoHistoryPage(
    limit = 50,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<ArkmeArkoHistoryPage> {
    return await this.arko.arkoHistoryPage(limit, offset, signal)
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
    return await this.arko.arkoAsk(text, options)
  }

  async arkoRunStatus(sessionId: number, runUid: string, signal?: AbortSignal): Promise<ArkmeArkoRunStatus> {
    return await this.arko.arkoRunStatus(sessionId, runUid, signal)
  }

  async arkoCancel(
    sessionId: number,
    assistantMsgId: number,
    runUid: string,
    signal?: AbortSignal,
  ): Promise<ArkmeArkoCancelResult> {
    return await this.arko.arkoCancel(sessionId, assistantMsgId, runUid, signal)
  }

  async aiVideoPreflight(
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoPreflightResult> {
    return await this.aiVideo.aiVideoPreflight(sessionId, segments, signal)
  }

  async aiVideoCreate(
    clientRequestId: string,
    sessionId: string,
    segments: readonly ArkmeAiVideoSegmentSelector[],
    preflightProof: string,
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoJob> {
    return await this.aiVideo.aiVideoCreate(clientRequestId, sessionId, segments, preflightProof, signal)
  }

  async aiVideoStatus(jobId: string, signal?: AbortSignal): Promise<ArkmeAiVideoJob> {
    return await this.aiVideo.aiVideoStatus(jobId, signal)
  }

  async aiVideoList(options: {
    limit: number
    cursor?: string
    statuses?: readonly ArkmeAiVideoJobStatus[]
    signal?: AbortSignal
  }): Promise<ArkmeAiVideoListResult> {
    return await this.aiVideo.aiVideoList(options)
  }

  async queryFileAssets(fileAssetUids: readonly string[], signal?: AbortSignal): Promise<ArkmeFileAssetDisplayItem[]> {
    return await this.media.queryFileAssets(fileAssetUids, signal)
  }

  async textAiVideoPreflight(
    title: string,
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoPreflightResult> {
    return await this.aiVideo.textAiVideoPreflight(title, texts, signal)
  }

  async textAiVideoCreate(
    clientRequestId: string,
    title: string,
    texts: readonly string[],
    preflightProof: string,
    signal?: AbortSignal,
  ): Promise<ArkmeAiVideoJob> {
    return await this.aiVideo.textAiVideoCreate(clientRequestId, title, texts, preflightProof, signal)
  }

  async checkArkmeIdAvailability(name: string): Promise<ArkmeIdAvailabilitySnapshot> {
    return await this.profile.checkArkmeIdAvailability(name)
  }

  async setArkmeIdOnce(name: string): Promise<ArkmeIdMutationResult> {
    return await this.profile.setArkmeIdOnce(name)
  }

  async createTopic(titleInput: string, parentSourceRef?: string): Promise<ArkmeTopicCreateResult> {
    return await this.source.createTopic(titleInput, parentSourceRef)
  }

  async renameTopic(sourceRef: string, title: string): Promise<ArkmeTopicRenameResult> {
    return await this.source.renameTopic(sourceRef, title)
  }

  async dissolveTopic(
    sourceRef: string,
    parentSourceRef: string | undefined,
    childSourceRefs: readonly string[],
    requestId?: string,
    expectedRecordCount?: number,
  ): Promise<ArkmeTopicDissolveResult> {
    return await this.source.dissolveTopic(sourceRef, parentSourceRef, childSourceRefs, requestId, expectedRecordCount)
  }

  async topicDissolveStatus(requestId: string): Promise<ArkmeTopicDissolveTask | undefined> {
    return await this.source.topicDissolveStatus(requestId)
  }

  async activeTopicDissolve(): Promise<ArkmeTopicDissolveTask | undefined> {
    return await this.source.activeTopicDissolve()
  }

  async moveTopicHierarchy(
    sourceRef: string,
    currentParentSourceRef?: string,
    nextParentSourceRef?: string,
    insertBeforeSourceRef?: string,
  ): Promise<ArkmeTopicHierarchyMoveResult> {
    return await this.source.moveTopicHierarchy(sourceRef, currentParentSourceRef, nextParentSourceRef, insertBeforeSourceRef)
  }

  async listSources(
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal; refresh?: boolean } = {},
  ): Promise<ArkmeSourceList> {
    return await this.source.listSources(directory, options)
  }

  async setChatDirectoryPin(sourceRef: string, pinned: boolean, signal?: AbortSignal): Promise<ArkmeSourceDirectoryPinResult> { return await this.source.setChatDirectoryPin(sourceRef, pinned, signal) }
  async conversationDirectoryVisibilitySnapshot(sourceRefs: readonly string[], botRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeConversationDirectoryVisibility> { return await this.conversationDirectoryVisibility.query(sourceRefs, botRefs, signal) }
  async setConversationDirectoryVisibility(entryKind: 'source' | 'bot', entryRef: string, hidden: boolean, signal?: AbortSignal): Promise<void> { await this.conversationDirectoryVisibility.setVisibility(entryKind, entryRef, hidden, signal) }

  async dshBetaCommunityEntryState(signal?: AbortSignal): Promise<ArkmeDSHBetaCommunityEntryState> {
    return await this.community.dshBetaCommunityEntryState(signal)
  }

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async interwovenMoments(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeInterwovenBootstrap> {
    return await this.interwoven.interwovenMoments(sourceRef, signal)
  }

  /** @internal Built-in loopback UI only; excluded from the published Provider declaration. */
  async interwovenMomentDetail(sourceRef: string, momentRef: string, signal?: AbortSignal): Promise<ArkmeInterwovenDetail> { return await this.interwoven.interwovenMomentDetail(sourceRef, momentRef, signal) }

  async relatedQuickNotesFromMessage(sourceRef: string, messageActionRef: string, signal?: AbortSignal): Promise<ArkmeRelatedQuickNoteList> { return await this.relatedQuickNote.list(await this.chat.relatedQuickNoteLocator(sourceRef, messageActionRef), signal) }
  async relatedQuickNotesFromMoment(sourceRef: string, momentRef: string, signal?: AbortSignal): Promise<ArkmeRelatedQuickNoteList> { return await this.relatedQuickNote.list(await this.interwoven.relatedQuickNoteLocator(sourceRef, momentRef, signal), signal) }
  async relatedQuickNoteDetail(sourceRef: string, relatedRef: string, signal?: AbortSignal): Promise<ArkmeRelatedQuickNoteDetail> { return await this.relatedQuickNote.detail(sourceRef, relatedRef, signal) }

  async joinDSHBetaCommunity(signal?: AbortSignal): Promise<ArkmeDSHBetaCommunityJoinResult> {
    return await this.community.joinDSHBetaCommunity(signal)
  }

  async inspectGroupAiPolish(
    sourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishSnapshot> {
    return await this.aiPolish.inspectGroupAiPolish(sourceRef, options)
  }

  async inspectGroupAiPolishByName(
    groupName: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishSnapshot> {
    return await this.aiPolish.inspectGroupAiPolishByName(groupName, options)
  }

  async readGroupAiPolishNotices(
    sourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishNotice[]> {
    return await this.aiPolish.readGroupAiPolishNotices(sourceRef, options)
  }

  async generateGroupAiPolishRuleForSource(
    sourceRef: string,
    requirement: string,
    options: { signal?: AbortSignal; threadMessages?: readonly ArkmeGroupAiPolishThreadMessage[]; targetRuleRef?: string } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    return await this.aiPolish.generateGroupAiPolishRuleForSource(sourceRef, requirement, options)
  }

  async generateGroupAiPolishRule(
    groupName: string,
    requirement: string,
    options: { signal?: AbortSignal; threadMessages?: readonly ArkmeGroupAiPolishThreadMessage[]; targetRuleRef?: string } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    return await this.aiPolish.generateGroupAiPolishRule(groupName, requirement, options)
  }

  prepareEnableGroupAiPolish(groupName: string, ruleName = '', options: { signal?: AbortSignal } = {}): Promise<ArkmeGroupAiPolishRuleCandidate> {
    return this.aiPolish.prepareEnableGroupAiPolish(groupName, ruleName, options)
  }

  prepareEnableGroupAiPolishRuleForSource(sourceRef: string, ruleRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeGroupAiPolishRuleCandidate> {
    return this.aiPolish.prepareEnableGroupAiPolishRuleForSource(sourceRef, ruleRef, options)
  }

  async confirmEnableGroupAiPolish(
    confirmationRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishMutationResult> {
    return await this.aiPolish.confirmEnableGroupAiPolish(confirmationRef, options)
  }

  async prepareDisableGroupAiPolishForSource(
    sourceRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    return await this.aiPolish.prepareDisableGroupAiPolishForSource(sourceRef, options)
  }

  async prepareDisableGroupAiPolish(
    groupName: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishRuleCandidate> {
    return await this.aiPolish.prepareDisableGroupAiPolish(groupName, options)
  }

  async confirmDisableGroupAiPolish(
    confirmationRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupAiPolishMutationResult> {
    return await this.aiPolish.confirmDisableGroupAiPolish(confirmationRef, options)
  }

  async listGroupMembers(
    sourceRef: string,
    options: { activeOnly?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupMemberList> {
    return await this.group.listGroupMembers(sourceRef, options)
  }

  async listSourceMembers(
    sourceRef: string,
    options: { activeOnly?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeConversationMemberList> {
    return await this.chat.listSourceMembers(sourceRef, options)
  }

  async sourceMemberRecords(
    sourceRef: string,
    memberRef: string,
    mode: ArkmeConversationMemberRecordMode,
    options: { limit?: number; beforeSequence?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeConversationMemberRecordPage> {
    return await this.chat.sourceMemberRecords(sourceRef, memberRef, mode, options)
  }

  async listGroupMemberCandidates(
    sourceRef: string,
    options: { query?: string; limit?: number; groupSourceRefs?: readonly string[]; signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupMemberCandidateList> {
    return await this.group.listGroupMemberCandidates(sourceRef, options)
  }

  async groupInvitePreview(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupInvitePreview> {
    return await this.group.groupInvitePreview(sourceRef, signal)
  }

  async addGroupMembers(
    sourceRef: string,
    candidateRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeGroupMemberAddResult> {
    return await this.group.addGroupMembers(sourceRef, candidateRefs, signal)
  }

  async createGroup(
    title: string,
    clientMutationId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceItem> {
    return await this.group.createGroup(title, clientMutationId, options)
  }

  async groupSettings(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupSettingsSnapshot> {
    return await this.group.groupSettings(sourceRef, signal)
  }

  async setGroupMessageDnd(
    sourceRef: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeGroupNotificationResult> {
    return await this.group.setGroupMessageDnd(sourceRef, enabled, signal)
  }

  async renameGroup(sourceRef: string, title: string, signal?: AbortSignal): Promise<ArkmeGroupProjectionResult> {
    const result = await this.group.renameGroup(sourceRef, title, signal)
    this.realtime.emitChatClientEvent({
      type: 'sessions-delta',
      revision: this.realtime.nextChatClientRevision(),
      updates: [{
        ...(result.source.sourceKey === undefined ? {} : { sourceKey: result.source.sourceKey }),
        source: result.source,
        timelineItems: [],
      }],
    })
    return result
  }

  async leaveGroup(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupCommandResult> {
    return await this.group.leaveGroup(sourceRef, signal)
  }

  async dissolveGroup(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupCommandResult> {
    return await this.group.dissolveGroup(sourceRef, signal)
  }

  async reportGroup(sourceRef: string, reason: string, signal?: AbortSignal): Promise<ArkmeGroupCommandResult> {
    return await this.group.reportGroup(sourceRef, reason, signal)
  }

  async userCard(userId: number, signal?: AbortSignal): Promise<ArkmeUserCardSnapshot> {
    return await this.profile.userCard(userId, signal)
  }

  async userBanStatus(sourceRef: string, signal?: AbortSignal): Promise<ArkmeUserBanOwnerSnapshot> {
    return await this.userBan.status(sourceRef, signal)
  }

  async banPrivateChatUser(sourceRef: string, remark = '', signal?: AbortSignal): Promise<ArkmeUserBanOwnerRecord> {
    return await this.userBan.ban(sourceRef, remark, signal)
  }

  async unbanPrivateChatUser(sourceRef: string, remark = '', signal?: AbortSignal): Promise<ArkmeUserBanOwnerRecord> {
    return await this.userBan.unban(sourceRef, remark, signal)
  }

  async openPrivateChatFromUser(
    peerUserId: number,
    options: { presentationDisplayName?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    return await this.chat.openPrivateChatFromUser(peerUserId, options)
  }

  async openPrivateChatFromContact(
    contactRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    const session = await this.runtime.requireSession()
    const peerUserId = await this.contact.resolveRegisteredContactUserId(contactRef, session, options.signal)
    const result = await this.chat.openPrivateChatFromUser(peerUserId, options)
    void this.conversationDirectoryVisibility.restoreSource(result.source).catch(() => undefined)
    return result
  }

  async officialAuthorProfile(signal?: AbortSignal): Promise<ArkmeOfficialAuthorProfile> {
    return await this.chat.officialAuthorProfile(signal === undefined ? {} : { signal })
  }

  async openOfficialAuthorPrivateChat(signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> {
    return await this.chat.openOfficialAuthorPrivateChat(signal === undefined ? {} : { signal })
  }

  async openPrivateChatFromWorldAuthor(recordRef: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> {
    const author = await this.world.worldAuthorFromRef(recordRef)
    return await this.chat.openPrivateChatFromUser(author.userId, {
      presentationDisplayName: author.displayName,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async worldAuthorLabels(recordRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeWorldAuthorLabel[]> { return await this.world.worldAuthorLabels(recordRefs, signal) }

  async openPrivateChatFromMember(
    sourceRef: string,
    memberRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeOpenPrivateChatResult> {
    return await this.chat.openPrivateChatFromMember(sourceRef, memberRef, options)
  }

  async readSource(sourceRef: string, options: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal } = {}): Promise<ArkmeTimelinePage> { return await this.chat.readSource(sourceRef, options) }
  async readSourceAround(sourceRef: string, itemUid: string, recordOwnerUserId: number, options: { beforeLimit?: number; afterLimit?: number; signal?: AbortSignal } = {}): Promise<ArkmeTimelineAroundPage> { return await this.chat.readSourceAround(sourceRef, itemUid, recordOwnerUserId, options) }
  async sharedRecordingDetail(detailRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeSharedRecordingPreview> {
    return await this.chat.sharedRecordingDetail(detailRef, options)
  }

  async messageSnapshotDetail(sourceRef: string, actionRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageSnapshotDetail> { return await this.chat.messageSnapshotDetail(sourceRef, actionRef, options) }
  async saveMessageLocation(sourceRef: string, itemUid: string, location: ArkmeRecordLocationCapture, recordVersion?: number, options: { signal?: AbortSignal } = {}): Promise<void> { await this.chat.saveMessageLocation(sourceRef, itemUid, location, recordVersion, options) }

  async messageReadReceiptSummaries(sourceRef: string, items: readonly ArkmeMessageReadReceiptQueryItem[], options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageReadReceiptSummaryList> { return await this.chat.messageReadReceiptSummaries(sourceRef, items, options) }
  async messageReadReceiptDetail(sourceRef: string, itemUid: string, sequence: number, options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageReadReceiptDetail> { return await this.chat.messageReadReceiptDetail(sourceRef, itemUid, sequence, options) }

  async relatedRecordingEligibility(sourceRef: string, signal?: AbortSignal): Promise<ArkmeRelatedRecordingEligibility> { return await this.relatedRecording.relatedRecordingEligibility(sourceRef, signal) }
  async relatedRecordings(sourceRef: string, options: ArkmeRelatedRecordingPageOptions = {}): Promise<ArkmeRelatedRecordingPage> { return await this.relatedRecording.relatedRecordings(sourceRef, options) }

  recordRelatedRecordingsToolEvent(event: {
    result: 'success' | 'error'
    durationMs: number
    itemCount?: number
    cursorPresent?: boolean
    transcriptRequested?: boolean
    transcriptTruncated?: boolean
  }): void {
    this.relatedRecording.recordRelatedRecordingsToolEvent(event)
  }
  async reportMessage(messageRef: string, reportType: 1 | 2 | 3 | 4, options: { reason?: string; requestUid?: string; signal?: AbortSignal } = {}): Promise<ArkmeMessageReportResult> { return await this.chat.reportMessage(messageRef, reportType, options) }
  async withdrawGroupMessage(messageWithdrawalRef: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageWithdrawalResult> { return await this.chat.withdrawGroupMessage(messageWithdrawalRef, options) }
  async removeGroupMember(sourceRef: string, memberRef: string, options: { preventRejoin?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeGroupMemberRemoveResult> { return await this.chat.removeGroupMember(sourceRef, memberRef, options) }
  async listGroupJoinRestrictions(sourceRef: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<ArkmeGroupJoinRestrictionPage> { return await this.chat.listGroupJoinRestrictions(sourceRef, options) }
  async setGroupJoinRestriction(sourceRef: string, memberRef: string, restricted: boolean, options: { signal?: AbortSignal } = {}): Promise<ArkmeGroupJoinRestrictionMutationResult> { return await this.chat.setGroupJoinRestriction(sourceRef, memberRef, restricted, options) }
  async copySourceMessageLink(sourceRef: string, actionRefs: readonly string[], options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageCopyLinkResult> { return await this.chat.copySourceMessageLink(sourceRef, actionRefs, options) }
  async copyMessageActionsLink(conversationRef: string, actionRefs: readonly string[], options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageCopyLinkResult> { return await this.messageActions.copyLink(conversationRef, actionRefs, options.signal) }
  async resolveMessageCopyLink(sid: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageCopyLinkResolveResult> { return await this.chat.resolveMessageCopyLink(sid, options) }
  async extendMessageCopyLink(sid: string, itemIndex: number, textContent: string, recordUid: string, options: { signal?: AbortSignal } = {}): Promise<ArkmeMessageCopyLinkExtendResult> { return await this.chat.extendMessageCopyLink(sid, itemIndex, textContent, recordUid, options) }
  async sourceMessageExtensionContext(sourceRef: string, messageActionRef: string, options: { signal?: AbortSignal } = {}) { return await this.chat.sourceMessageExtensionContext(sourceRef, messageActionRef, options) }
  async extendSourceMessage(sourceRef: string, messageActionRef: string, textContent: string, recordUid: string, fileRefs: readonly string[] = [], options: { relationUid?: string; parentRecordUid?: string; signal?: AbortSignal } = {}) { const context = await this.chat.sourceMessageExtensionContext(sourceRef, messageActionRef, options); const requestedParentRecordUid = options.parentRecordUid?.trim() ?? ''; if (requestedParentRecordUid !== '' && requestedParentRecordUid !== context.parentRecordUid && !context.extensions.some(extension => extension.recordUid === requestedParentRecordUid)) throw new ArkmePluginError('source-message-extension-target-invalid', '延展目标已变化，请刷新后重试', true, 409); const assets = fileRefs.length === 0 ? [] : await this.filesOwner().uploadRefs(fileRefs, options.signal); return await this.chat.extendSourceMessage(sourceRef, messageActionRef, textContent, recordUid, assets, options) }
  async forwardSourceMessages(sourceRef: string, actionRefs: readonly string[], options: { targetSourceRef?: string; recordUid?: string; relationUid?: string; commentText?: string; signal?: AbortSignal } = {}): Promise<ArkmeSourceSendResult> { return await this.chat.forwardSourceMessages(sourceRef, actionRefs, options) }
  async forwardMessageActions(conversationRef: string, actionRefs: readonly string[], options: MessageActionForwardOptions): Promise<ArkmeSourceSendResult> { return await this.messageActions.forward(conversationRef, actionRefs, options) }

  async sendSourceText(
    sourceRef: string,
    textContent: string,
    options: {
      recordUid?: string
      relationUid?: string
      recordDurationMillis?: number
      captureContext?: ArkmeRecordCaptureContext
      botRefs?: readonly string[]
      humanMentions?: readonly ArkmeHumanMentionInput[]
      botMentions?: readonly ArkmeBotMentionInput[]
      expectedUserId?: number
      signal?: AbortSignal
      agentAuthored?: boolean
    } = {},
  ): Promise<ArkmeSourceSendResult> {
    return await this.chat.sendSourceText(sourceRef, textContent, options)
  }
  async retryGroupAiPolish(
    retryRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceSendResult> {
    return await this.aiPolish.retryGroupAiPolish(retryRef, options)
  }
  async sendSourceRich(
    sourceRef: string,
    input: ArkmeRichSendInput,
    options: { recordUid?: string; relationUid?: string; expectedUserId?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceSendResult> {
    return await this.chat.sendSourceRich(sourceRef, input, options)
  }
  async favoriteStickers(signal?: AbortSignal): Promise<ArkmeFavoriteStickerList> { return await this.chat.favoriteStickers(signal) }
  async addFavoriteSticker(item: ArkmeFavoriteStickerAddInput, signal?: AbortSignal): Promise<ArkmeFavoriteStickerList> { return await this.chat.addFavoriteSticker(item, signal) }
  async sendFavoriteSticker(sourceRef: string, fileAssetUid: string, options: { recordUid?: string; relationUid?: string; signal?: AbortSignal } = {}): Promise<ArkmeSourceSendResult> { return await this.chat.sendFavoriteSticker(sourceRef, fileAssetUid, options) }
  async manageFavoriteSticker(fileAssetUid: string, action: ArkmeFavoriteStickerManageAction, signal?: AbortSignal): Promise<ArkmeFavoriteStickerList> { return await this.chat.manageFavoriteSticker(fileAssetUid, action, signal) }
  async longArticleDetail(sourceRef: string, itemUid: string, signal?: AbortSignal): Promise<ArkmeLongArticleDetail> {
    return await this.chat.longArticleDetail(sourceRef, itemUid, signal)
  }
  async updateLongArticle(
    sourceRef: string,
    itemUid: string,
    input: { title: string; textContent: string; version: number; editDurationMillis: number },
  ): Promise<ArkmeLongArticleDetail> {
    return await this.chat.updateLongArticle(sourceRef, itemUid, input)
  }

  async getLongArticleDraft(sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined> {
    return await this.chat.getLongArticleDraft(sourceRef, itemUid)
  }

  async putLongArticleDraft(draft: ArkmeLongArticleDraft): Promise<void> {
    return await this.chat.putLongArticleDraft(draft)
  }

  async removeLongArticleDraft(sourceRef: string, itemUid?: string): Promise<void> {
    return await this.chat.removeLongArticleDraft(sourceRef, itemUid)
  }

  async prepareRecordReedit(input: ArkmeRecordReeditPrepareInput, options: { expectedBaseVersion?: number } = {}): Promise<ArkmeRecordReeditPreparedContext> { return await this.record.prepareRecordReedit(input, options) }
  async recordReeditEditor(sourceRef: string, itemUid: string): Promise<ArkmeRecordReeditEditorSnapshot> { return await this.record.recordReeditEditor(sourceRef, itemUid) }
  async commitRecordReedit(context: ArkmeRecordReeditPreparedContext): Promise<ArkmeRecordReeditCommitResult> {
    const result = await this.record.commitRecordReedit(context)
    await this.realtime.invalidateRecordProjection().catch(() => undefined); return result
  }
  async prepareDiscardRecordReeditDraft(sourceRef: string, itemUid: string): Promise<ArkmeRecordReeditDiscardPreparedContext> { return await this.record.prepareDiscardRecordReeditDraft(sourceRef, itemUid) }
  async discardRecordReeditDraft(context: ArkmeRecordReeditDiscardPreparedContext): Promise<ArkmeRecordReeditDiscardResult> { return await this.record.discardRecordReeditDraft(context) }

  async uploadLocalFile(
    filePath: string,
    metadata: { size: number; sha256: string; mimeType: string; fileName: string; fileKind: 1 | 2 | 3 | 4 },
    options: { expectedUserId?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeUploadedAsset> {
    return await this.chat.uploadLocalFile(filePath, metadata, options)
  }

  async fetchMedia(
    mediaRef: string,
    range?: string,
    signal?: AbortSignal,
  ): Promise<{ response: Response; descriptor: ArkmeMediaDescriptor }> {
    return await this.chat.fetchMedia(mediaRef, range, signal)
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
    return await this.chat.sendDirectText(recipientArkmeId, textContent, options)
  }

  async markSourceRead(sourceRef: string, readSequence: number, options: { signal?: AbortSignal } = {}): Promise<ArkmeSourceReadResult> { return await this.chat.markSourceRead(sourceRef, readSequence, options) }
  async reportMessagePreparing(sourceRef: string, prepareAtMillis: number, options: { signal?: AbortSignal } = {}): Promise<void> { await this.chat.reportMessagePreparing(sourceRef, prepareAtMillis, options) }
  async cancelMessagePreparing(sourceRef: string, cancelAtMillis: number, options: { signal?: AbortSignal } = {}): Promise<void> { await this.chat.cancelMessagePreparing(sourceRef, cancelAtMillis, options) }

  async listWechatConversations(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatConversationPage> {
    return await this.wechat.listWechatConversations(options)
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
    return await this.wechat.readWechatMessages(conversationRef, options)
  }

  async getWechatConversationDetail(
    conversationRef: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatConversationDetail> {
    return await this.wechat.getWechatConversationDetail(conversationRef, options)
  }

  async listWechatGroupMembers(
    conversationRef: string,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatGroupMemberPage> {
    return await this.wechat.listWechatGroupMembers(conversationRef, options)
  }

  async listWechatPhones(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatPhonePage> {
    return await this.wechat.listWechatPhones(options)
  }

  async listWechatCommonGroups(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatCommonGroupPage> {
    return await this.wechat.listWechatCommonGroups(options)
  }

  async listWechatMoneyFlows(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatMoneyFlowPage> {
    return await this.wechat.listWechatMoneyFlows(options)
  }

  async listWechatLocations(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeWechatLocationPage> {
    return await this.wechat.listWechatLocations(options)
  }

  /** Resolve and download one Provider-authorized Arkme image without exposing OSS credentials or signed URLs. */
  async readImage(
    imageRef: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeImageBytes> {
    return await this.media.readImage(imageRef, options)
  }

  async beginWechatLogin(): Promise<ArkmeAuthSnapshot> { return await this.auth.beginWechatLogin() }
  async pollWechatLogin(attemptId: string): Promise<ArkmeAuthSnapshot> { return await this.auth.pollWechatLogin(attemptId) }
  async beginJiwoLogin(): Promise<ArkmeAuthSnapshot> { return await this.auth.beginJiwoLogin() }
  async pollJiwoLogin(attemptId: string): Promise<ArkmeAuthSnapshot> { return await this.auth.pollJiwoLogin(attemptId) }
  async cancelJiwoLogin(attemptId: string): Promise<{ canceled: true }> { return await this.auth.cancelJiwoLogin(attemptId) }

  async testLogin(userId: number): Promise<ArkmeAuthSnapshot> {
    return await this.auth.testLogin(userId)
  }

  async sendPhoneCode(phone: string, captcha: ArkmeCaptchaResult): Promise<{ sent: true }> {
    return await this.auth.sendPhoneCode(phone, captcha)
  }

  async verifyPhoneCode(phone: string, code: string): Promise<ArkmeAuthSnapshot> {
    return await this.auth.verifyPhoneCode(phone, code)
  }

  async logout(): Promise<ArkmeAuthSnapshot> {
    return await this.auth.logout()
  }

  async cachedSnapshot(): Promise<ArkmeCachedSnapshot> {
    return await this.record.cachedSnapshot()
  }

  async queryCached(options: {
    query?: string
    limit: number
    beforeMillis?: number
  }): Promise<ArkmeCachedQueryResult> {
    return await this.record.queryCached(options)
  }

  async refreshLatest(): Promise<void> {
    return await this.record.refreshLatest()
  }

  async refreshSnapshot(): Promise<ArkmeCachedSnapshot> {
    return await this.record.refreshSnapshot()
  }

  async searchRecords(options: {
    query: string
    limit: number
    beforeMillis?: number
    syncAll?: boolean
    signal?: AbortSignal
  }): Promise<ArkmeCachedQueryResult> {
    return await this.search.searchRecords(options)
  }

  async searchRemote(options: {
    query: string
    limit: number
    cursor?: string
    searchScope?: 'global' | 'topic' | 'chat_session'
    sourceUid?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult> {
    return await this.search.searchRemote(options)
  }

  async searchTagRecords(options: { normalizedTag: string; limit: number; cursorSendAt?: number; cursorRecordUid?: string; signal?: AbortSignal }): Promise<ArkmeRecordSearchResult> { return await this.search.searchTagRecords(options) }

  async searchHistory(limit = 10): Promise<ArkmeSearchHistoryResult> {
    return await this.search.searchHistory(limit)
  }

  async createSearchHistory(keyword: string): Promise<void> {
    return await this.search.createSearchHistory(keyword)
  }

  async searchScene(options: {
    scene: ArkmeSearchSceneKind
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordSearchResult> {
    return await this.search.searchScene(options)
  }

  /**
   * Build the desktop image library from the owner's mixed image/video scene.
   * Signed storage URLs stay inside the Provider and are replaced by account-bound media refs.
   */
  async searchImages(options: {
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeImageSearchResult> {
    return await this.search.searchImages(options)
  }

  async searchRecordings(options: {
    query: string
    limit: number
    cursor?: string
    signal?: AbortSignal
  }): Promise<ArkmeRecordingSearchResult> {
    return await this.search.searchRecordings(options)
  }

  async syncHistory(maxPages = 20, signal?: AbortSignal): Promise<{ pages: number; complete: boolean }> {
    return await this.record.syncHistory(maxPages, signal)
  }

  async summary(): Promise<ArkmeSelfSummary> {
    return await this.record.summary()
  }

  async list(limit: number, cursor?: ArkmeRecordCursor): Promise<ArkmeSelfRecordList> {
    return await this.record.list(limit, cursor)
  }

  async calendarBuckets(
    options: { startDate: string; endDate: string; timezone?: string; signal?: AbortSignal },
  ): Promise<ArkmeCalendarBucketPage> {
    return await this.calendar.bucketPage(options)
  }

  async calendarRecords(
    options: {
      bucketDate: string
      timezone?: string
      limit?: number
      cursor?: ArkmeRecordCursor
      signal?: AbortSignal
    },
  ): Promise<ArkmeCalendarDayRecordPage> {
    return await this.calendar.dayRecords(options)
  }

  async listWorldRecords(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldRecordList> {
    return await this.world.listWorldRecords(options)
  }

  /** Read a bounded Arrangement page while keeping stable owner UIDs inside the Provider. */
  async listArrangements(
    options: { status?: ArkmeArrangementListStatus; limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeArrangementPage> {
    return await this.arrangement.listArrangements(options)
  }

  /** Resolve one Provider-issued Arrangement reference and return the current owner fact. */
  async arrangementDetail(arrangementRef: string, signal?: AbortSignal): Promise<ArkmeArrangementDetail> {
    return await this.arrangement.arrangementDetail(arrangementRef, signal)
  }

  /** Read reminder events as their own projection; reminder identity never doubles as Arrangement identity. */
  async listArrangementReminders(
    options: { unreadOnly?: boolean; limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeArrangementReminderPage> {
    return await this.arrangement.listArrangementReminders(options)
  }

  async arrangementReminderSummary(signal?: AbortSignal): Promise<ArkmeArrangementReminderSummary> {
    return await this.arrangement.arrangementReminderSummary(signal)
  }

  /** Execute one owner lifecycle intent. Provider locking prevents duplicate writes, not business transitions. */
  async mutateArrangement(
    arrangementRef: string,
    intent: ArkmeArrangementMutationIntent,
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementMutationResult> {
    return await this.arrangement.mutateArrangement(arrangementRef, intent, signal)
  }

  /** Toggle only the reminder fact; Arrangement lifecycle remains owner-controlled and independently projected. */
  async setArrangementReminderEnabled(
    arrangementRef: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementReminderToggleResult> {
    return await this.arrangement.setArrangementReminderEnabled(arrangementRef, enabled, signal)
  }

  async markArrangementRemindersRead(
    eventRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementReminderWriteResult> {
    return await this.arrangement.markArrangementRemindersRead(eventRefs, signal)
  }

  async markAllArrangementRemindersRead(signal?: AbortSignal): Promise<ArkmeArrangementReminderWriteResult> {
    return await this.arrangement.markAllArrangementRemindersRead(signal)
  }

  async clearArrangementReminders(signal?: AbortSignal): Promise<ArkmeArrangementReminderWriteResult> {
    return await this.arrangement.clearArrangementReminders(signal)
  }

  /** Build the authenticated browser projection without exposing World IDs or signed media URLs. */
  async listWorldFeed(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    return await this.world.listWorldFeed(options)
  }

  /** Build the signed-in account's World projection without exposing owner IDs. */
  async listMyWorldFeed(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    return await this.world.listMyWorldFeed(options)
  }

  async listUserWorldFeed(
    userId: number,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    return await this.world.listUserWorldFeed(userId, options)
  }

  async worldVoiceprintPlaybackAvailability(
    recordRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintAvailability> {
    return await this.world.worldVoiceprintPlaybackAvailability(recordRefs, signal)
  }

  async generateWorldVoiceprintPlayback(input: {
    recordRef: string
    chunkIndex?: number
    signal?: AbortSignal
  }): Promise<ArkmeWorldVoiceprintPlaybackChunk> {
    return await this.world.generateWorldVoiceprintPlayback(input)
  }

  async worldVoiceprintSocialContext(recordRef: string, options: { forceRefresh?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeWorldVoiceprintSocialContext> { return await this.world.worldVoiceprintSocialContext(recordRef, options) }
  async inviteWorldVoiceprint(
    recordRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintInviteResult> {
    try {
      const intent = await this.world.createWorldVoiceprintInviteIntent(recordRef, signal)
      const variantIndex = this.worldVoiceprintInviteVariantIndex
      this.worldVoiceprintInviteVariantIndex = (variantIndex + 1) % WORLD_VOICEPRINT_INVITE_VARIANT_COUNT
      const privateChat = await this.chat.openPrivateChatFromUser(intent.peerUserId, {
        presentationDisplayName: intent.peerDisplayName,
        ...(signal === undefined ? {} : { signal }),
      })
      const sent = await this.chat.sendSourceText(
        privateChat.source.sourceRef,
        buildWorldVoiceprintInviteMessage({ ...intent, variantIndex }),
        signal === undefined ? {} : { signal },
      )
      if (sent.localState !== 'synced') {
        throw new ArkmePluginError(
          'world-voiceprint-invite-send-pending',
          sent.error ?? '声纹邀请已进入发送队列，请稍后在私聊中确认',
          true,
        )
      }
      return {
        sent: true,
        peerDisplayName: intent.peerDisplayName,
        messageItemUid: sent.itemUid,
        expiresAtMillis: intent.expiresAtMillis,
      }
    } catch (error) {
      const message = voiceprintInviteRateLimitMessage(error)
      if (message !== undefined) {
        throw new ArkmePluginError(
          'world-voiceprint-invite-rate-limited',
          message,
          true,
          429,
          {
            cause: error,
            upstreamStatus: 429,
            ...(!(error instanceof ArkmePluginError) || error.retryAfterMillis === undefined
              ? {}
              : { retryAfterMillis: error.retryAfterMillis }),
          },
        )
      }
      throw error
    }
  }

  async myVoiceprint(options: { signal?: AbortSignal } = {}) { return await this.voiceprint.myVoiceprint(options) }
  async outboundVoiceprintGrants(input: { cursor: string; limit: number }, options: { signal?: AbortSignal } = {}) { return await this.voiceprint.outboundGrants(input, options) }
  async recognizedVoiceprintPeople(input: { cursor: string; limit: number }, options: { signal?: AbortSignal } = {}) { return await this.voiceprint.recognizedPeople(input, options) }
  async recognizedVoiceprintPerson(personRef: string, options: { signal?: AbortSignal } = {}) { return await this.voiceprint.recognizedPerson(personRef, options) }
  async recognizedPersonVoiceprints(personRef: string, options: { signal?: AbortSignal } = {}) { return await this.voiceprint.recognizedPersonVoiceprints(personRef, options) }
  async createVoiceprintInvitation(options: { signal?: AbortSignal } = {}) { return await this.voiceprint.createInvitation(options) }
  async createRecognizedPersonVoiceprintInvitation(personRef: string, targetContactRef: string | undefined, options: { signal?: AbortSignal } = {}) { return await this.voiceprint.createRecognizedPersonInvitation(personRef, targetContactRef, options) }
  async revokeVoiceprintPlaybackGrant(grantRef: string, options: { signal?: AbortSignal } = {}) { return await this.voiceprint.revokePlaybackGrant(grantRef, options) }
  async restoreVoiceprintPlayback(options: { signal?: AbortSignal } = {}) { return await this.voiceprint.restorePlayback(options) }
  async bindVoiceprintEnrollment() { return await this.voiceprint.bindEnrollment() }

  /** Read the authenticated comment/reply tree behind one account-bound World reference. */
  async listWorldInteractions(
    recordRef: string,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldInteractionPage> {
    return await this.world.listWorldInteractions(recordRef, options)
  }

  /** Publish a text-only comment or reply while keeping its stable record UID inside the Provider. */
  async createWorldTextInteraction(input: {
    targetRef: string
    textContent: string
    clientMutationId: string
    signal?: AbortSignal
  }): Promise<ArkmeWorldInteractionCreateResult> {
    return await this.world.createWorldTextInteraction(input)
  }

  /** Download one short-lived Provider-authorized World image for the current account. */
  async readWorldImage(
    imageRef: string,
    options: { maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeImageBytes> {
    return await this.world.readWorldImage(imageRef, options)
  }

  async publishWorldTextForConversation(recordUid: string, textContent: string, signal?: AbortSignal): Promise<ArkmeWorldPublishResult> { return await this.world.publishWorldTextForConversation(recordUid, textContent, signal) }
  async publishWorldText(input: ArkmeWorldPublishTextInput): Promise<ArkmeWorldPublishResult> { return await this.world.publishWorldText(input) }
  async publishWorldFileAssets(input: ArkmeWorldPublishFileAssetsInput): Promise<ArkmeWorldPublishResult> { return await this.world.publishWorldFileAssets(input) }

  async createText(recordUid: string, textContent: string): Promise<ArkmeCreateTextResult> {
    const result = await this.record.createText(recordUid, textContent)
    await this.realtime.invalidateRecordProjection(); return result
  }

  async listRecordTags(limit = 100, signal?: AbortSignal): Promise<ArkmeRecordTagList> {
    return await this.record.listTags(limit, signal)
  }

  async createTextForConversation(
    recordUid: string,
    textContent: string,
  ): Promise<ArkmeConversationWriteResult> {
    const result = await this.record.createTextForConversation(recordUid, textContent)
    if (result.localState !== 'failed') await this.realtime.invalidateRecordProjection(); return result
  }

  async createDSHAgentInputText(recordUid: string, textContent: string, sendAtMillis: number): Promise<ArkmeCreateTextResult> {
    const result = await this.record.createDSHAgentInputText(recordUid, textContent, sendAtMillis)
    await this.realtime.invalidateRecordProjection()
    return result
  }

  async pendingWrites(): Promise<ArkmePendingWrite[]> {
    return await this.record.pendingWrites()
  }

  async retryPending(recordUid: string): Promise<ArkmeCreateTextResult> {
    const result = await this.record.retryPending(recordUid)
    await this.realtime.invalidateRecordProjection(); return result
  }

  private recordUid(raw: unknown): string {
    return this.record.recordUid(raw)
  }

  private async withImageDownloadPermit<T>(operation: () => Promise<T>): Promise<T> {
    return await this.media.withImageDownloadPermit(operation)
  }

  private recordItem(
    raw: unknown,
    userId?: number,
    options: { displayItems?: unknown[]; mediaUnavailable?: boolean } = {},
  ): ArkmeSelfRecordItem | undefined {
    return this.record.recordItem(raw, userId, options)
  }

  private async openWorldImageRef(imageRef: string, viewerUserId: number): Promise<ArkmeWorldImageEntry> {
    return await this.world.openWorldImageRef(imageRef, viewerUserId)
  }

  /** Authenticated transport owned by the Arkme Host for the extension registry client. */
  async extensionPost<T>(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    return await this.runtime.extensionPost<T>(path, body, signal, options)
  }
}
