import { ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS, ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'
import { isArkmeBotAvatarRef } from '../bot-avatar-ref.js'
import type {
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
  ArkmeBotProvider,
  ArkmeBotSummary,
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordCursor,
  ArkmeCallDetail,
  ArkmeCallHistoryOptions,
  ArkmeCallHistoryPage,
  ArkmeCallSummaryRetryResult,
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeContactAddResult,
  ArkmeContactSearchResult,
  ArkmeContentBlock,
  ArkmeConversationMemberList,
  ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberRecordPage,
  ArkmeCreateTextResult,
  ArkmeGroupMemberAddResult,
  ArkmeGroupMemberCandidateList,
  ArkmeGroupInvitePreview,
  ArkmeGroupMemberList,
  ArkmeGroupBotAddResult,
  ArkmeGroupBotCandidateList,
  ArkmeImagePayload,
  ArkmeImageSearchResult,
  ArkmeHumanMentionInput,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptQueryItem,
  ArkmeMessageReadReceiptSummaryList,
  ArkmeOfficialAuthorProfile,
  ArkmeOpenPrivateChatResult,
  ArkmePendingWrite,
  ArkmeRelatedRecordingEligibility,
  ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageOptions,
  ArkmePluginErrorBody,
  ArkmePluginOperation,
  ArkmePluginResponse,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmeRichSendInput,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelinePage,
  ArkmeUserProfileSnapshot,
  ArkmeUploadedAsset,
  ArkmeWorldAuthorLabel,
  ArkmeWorldFeedPage,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintInviteResult,
  ArkmeWorldVoiceprintPlaybackChunk,
  ArkmeWorldVoiceprintSocialContext,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionPage,
  ArkmeWorldPublishFileAssetsInput,
  ArkmeWorldPublishResult,
  ArkmeWorldPublishTextInput,
} from '../types.js'
import type {
  ArkmeExtensionCatalogItem, ArkmeExtensionCatalogPage, ArkmeExtensionCatalogSort,
  ArkmeExtensionClassificationPage, ArkmeExtensionClassificationTree,
  ArkmeExtensionCompleteDeleteResult, ArkmeExtensionEnabledResult, ArkmeExtensionEnabledState, ArkmeExtensionIconMediaType,
  ArkmeExtensionIconResult, ArkmeExtensionInstallPreview, ArkmeExtensionPublishResult, ArkmeInstalledExtensionView,
  ArkmeNativeCapability,
  ArkmeExtensionAuditResult,
  ArkmeExtensionMetadataUpdateInput,
  ArkmeExtensionPreviewGallery, ArkmeExtensionPreviewMediaType,
  ArkmeExtensionReviewCreateInput,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewItem,
  ArkmeExtensionReviewPage,
  ArkmeExtensionRatingSummary,
	ArkmeExtensionShare,
	ArkmeSharedExtensionDetail,
	ArkmeExtensionSource,
} from '../extensions/types.js'
import type { ArkmeMyExtensionPage, ArkmeMyExtensionPublishInput } from '../extensions/owned-types.js'
import { normalizeGitHubRepositoryURL } from '../extensions/source.js'

export type {
  ArkmeArrangementDetail,
  ArkmeArrangementItem,
  ArkmeArrangementListStatus,
  ArkmeArrangementMutationIntent,
  ArkmeArrangementMutationOutcome,
  ArkmeArrangementMutationResult,
  ArkmeArrangementPage,
  ArkmeArrangementReminderEvent,
  ArkmeArrangementReminderPage,
  ArkmeArrangementReminderSummary,
  ArkmeArrangementReminderToggleResult,
  ArkmeArrangementReminderWriteResult,
  ArkmeArrangementStatus,
  ArkmeAuthSnapshot,
  ArkmeBotProvider,
  ArkmeBotStatus,
  ArkmeBotSummary,
  ArkmeCalendarBucketDay,
  ArkmeCalendarBucketPage,
  ArkmeCalendarDayRecordPage,
  ArkmeCalendarRecordCursor,
  ArkmeCalendarRecordItem,
  ArkmeCallDetail,
  ArkmeCallHistoryItem,
  ArkmeCallHistoryOptions,
  ArkmeCallHistoryPage,
  ArkmeCallMediaType,
  ArkmeCallParticipant,
  ArkmeCallRecentContact,
  ArkmeCallSummaryRetryResult,
  ArkmeCallSummaryStatus,
  ArkmeCallTranscriptSegment,
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeContactAddResult,
  ArkmeContactIdentifierKind,
  ArkmeContactSearchResult,
  ArkmeContentBlock,
  ArkmeContentKind,
  ArkmeConversationMemberItem,
  ArkmeConversationMemberList,
  ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberRecordPage,
  ArkmeCreateTextResult,
  ArkmeGroupMemberAddItemResult,
  ArkmeGroupMemberAddResult,
  ArkmeGroupMemberAddStatus,
  ArkmeGroupMemberCandidate,
  ArkmeGroupMemberCandidateList,
  ArkmeGroupMemberItem,
  ArkmeGroupMemberList,
  ArkmeGroupBotAddResult,
  ArkmeGroupBotCandidate,
  ArkmeGroupBotCandidateList,
  ArkmeGroupAvatarFallback,
  ArkmeGroupAvatarPresentation,
  ArkmeGroupAvatarSlot,
  ArkmeImageMediaType,
  ArkmeImagePayload,
  ArkmeImageSearchItem,
  ArkmeImageSearchResult,
  ArkmeHumanMentionInput,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptMember,
  ArkmeMessageReadReceiptQueryItem,
  ArkmeMessageReadReceiptStatus,
  ArkmeMessageReadReceiptSummary,
  ArkmeMessageReadReceiptSummaryList,
  ArkmeOfficialAuthorProfile,
  ArkmePendingWrite,
  ArkmeRelatedRecordingEligibility,
  ArkmeRelatedRecordingItem,
  ArkmeRelatedRecordingMonthBucket,
  ArkmeRelatedRecordingPage,
  ArkmeRelatedRecordingPageOptions,
  ArkmeRelatedRecordingPageState,
  ArkmeRelatedRecordingParticipant,
  ArkmeRelatedRecordingSpeaker,
  ArkmeProviderCapabilities,
  ArkmeProviderState,
  ArkmeRichSendInput,
  ArkmeSourceDirectory,
  ArkmeSourceItem,
  ArkmeSourceKind,
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelineItem,
  ArkmeForwardRecordsPreview,
  ArkmeForwardRecordPreviewItem,
  ArkmeForwardTranscriptSegment,
  ArkmeTimelinePage,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
  ArkmeUploadedAsset,
  ArkmeWorldFeedItem,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionItem,
  ArkmeWorldInteractionPage,
  ArkmeWorldFeedPage,
  ArkmeWorldVoiceprintAvailability,
  ArkmeWorldVoiceprintAvailabilityItem,
  ArkmeWorldVoiceprintInviteResult,
  ArkmeWorldVoiceprintPlaybackChunk,
  ArkmeWorldVoiceprintSocialContext,
  ArkmeWorldVoiceprintSocialRelation,
  ArkmeWorldVoiceprintSocialRelationType,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
} from '../types.js'
export type { ArkmeMyExtensionItem, ArkmeMyExtensionPage, ArkmeMyExtensionPublishInput,
  ArkmeExtensionPublishArtifactKind, ArkmeExtensionPublishRoute, ArkmeMyExtensionPublishState,
  ArkmeMyExtensionState, ArkmeMyExtensionWarning,
} from '../extensions/owned-types.js'
export type {
  ArkmeExtensionCatalogItem,
  ArkmeExtensionCatalogPage,
  ArkmeExtensionAuditResult,
  ArkmeExtensionCompleteDeleteResult,
  ArkmeExtensionEnabledResult,
  ArkmeExtensionEnabledState,
  ArkmeExtensionIconMediaType,
  ArkmeExtensionIconResult,
  ArkmeExtensionInstallPreview,
  ArkmeExtensionUnavailableView,
  ArkmeExtensionMetadataUpdateInput,
  ArkmeExtensionPreviewGallery,
  ArkmeExtensionPreviewItem,
  ArkmeExtensionPreviewMediaType,
  ArkmeInstalledExtensionView,
  ArkmeNativeCapability,
  ArkmeExtensionRatingSummary,
  ArkmeExtensionReviewAvatarFallback,
  ArkmeExtensionReviewCreateInput,
  ArkmeExtensionReviewCreateResult,
  ArkmeExtensionReviewItem,
  ArkmeExtensionReviewPage,
	ArkmeExtensionPublishResult,
	ArkmeExtensionShare,
	ArkmeSharedExtensionDetail,
	ArkmeExtensionSource,
	ArkmeExtensionPublisherRole,
} from '../extensions/types.js'
export { ARKME_EXTENSION_RUNTIME_UNAVAILABLE_MESSAGE } from '../extensions/types.js'
export { ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'
export type {
  ArkmeOutgoingCallFailureCode,
  ArkmeOutgoingCallMediaType,
  ArkmeOutgoingCallToolResult,
} from '../outgoing-call-contract.js'

const DEFAULT_ROUTE = '/arkme-self/api'

export class ArkmeClientError extends Error {
  constructor(readonly body: ArkmePluginErrorBody) {
    super(body.message)
    this.name = 'ArkmeClientError'
  }
}

export interface ArkmeSdkOptions {
  route?: string
  fetchImpl?: typeof fetch
}

export interface ArkmeSearchOptions {
  limit?: number
  beforeMillis?: number
  syncAll?: boolean
}

export interface ArkmeImageListOptions {
  limit?: number
  cursor?: string
  signal?: AbortSignal
}

export interface ArkmeSubscribeOptions {
  intervalMs?: number
  immediate?: boolean
  onError?: (error: unknown) => void
}

function safeSdkCallDetail(detail: ArkmeCallDetail): ArkmeCallDetail {
  if (detail.videoRecord === undefined) return detail
  return {
    ...detail,
    videoRecord: {
      available: detail.videoRecord.available,
      source: detail.videoRecord.source,
    },
  }
}

export class ArkmeSdk {
  private readonly route: string
  private readonly fetchImpl: typeof fetch

  constructor(options: ArkmeSdkOptions = {}) {
    const route = options.route ?? DEFAULT_ROUTE
    if (!/^\/[A-Za-z0-9/_-]+$/.test(route) || route.startsWith('//')) {
      throw new TypeError('Arkme SDK route must be a same-origin absolute path')
    }
    this.route = route
    // Browser fetch is a Web IDL method whose receiver must remain the global object.
    // Storing it unbound and later calling this.fetchImpl(...) makes the SDK instance
    // the receiver and Chrome rejects the call with "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async capabilities(signal?: AbortSignal): Promise<ArkmeProviderCapabilities> {
    const capabilities = await this.call<ArkmeProviderCapabilities>('provider.capabilities', undefined, signal)
    if (capabilities.contractVersion !== ARKME_PROVIDER_CONTRACT_VERSION) {
      throw new Error(`Unsupported Arkme provider contract version ${String(capabilities.contractVersion)}`)
    }
    return capabilities
  }

  async state(signal?: AbortSignal): Promise<ArkmeProviderState> {
    return await this.call<ArkmeProviderState>('provider.state', undefined, signal)
  }

  /** Read Browser-safe installed extension projections without Host filesystem paths or runtime IDs. */
  async installedExtensions(signal?: AbortSignal): Promise<ArkmeInstalledExtensionView[]> {
    return await this.call<ArkmeInstalledExtensionView[]>('extensions.installed-list', undefined, signal)
  }

  /** Search the market through the same Host owner used by Arkme UI and Tools. */
  async searchExtensions(query = '', limit = 20, signal?: AbortSignal): Promise<ArkmeExtensionCatalogPage> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 50) throw new TypeError('Arkme extension search limit must be 1-50')
    return await this.call<ArkmeExtensionCatalogPage>('extensions.catalog.list', { query: query.trim(), limit }, signal)
  }

  async extensionDetail(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionCatalogItem> {
    if (extensionId.trim() === '') throw new TypeError('Arkme extension ID must not be empty')
    return await this.call<ArkmeExtensionCatalogItem>('extensions.catalog.detail', { extensionId: extensionId.trim() }, signal)
  }

  /** Query V1/V2/V3 install authority before asking the user to approve installation. */
  async extensionInstallPreview(extensionId: string, version?: string, signal?: AbortSignal): Promise<ArkmeExtensionInstallPreview> {
    if (extensionId.trim() === '') throw new TypeError('Arkme extension ID must not be empty')
    return await this.call<ArkmeExtensionInstallPreview>('extensions.install.preview', {
      extensionId: extensionId.trim(),
      ...(version === undefined || version.trim() === '' ? {} : { version: version.trim() }),
    }, signal)
  }

  async extensionEnabledState(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionEnabledState> {
    if (extensionId.trim() === '') throw new TypeError('Arkme extension ID must not be empty')
    return await this.call<ArkmeExtensionEnabledState>('extensions.enabled-state', { extensionId }, signal)
  }

  /** Change desired activation without uninstalling the verified extension artifact. */
  async setExtensionEnabled(
    extensionId: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionEnabledResult> {
    if (extensionId.trim() === '') throw new TypeError('Arkme extension ID must not be empty')
    return await this.call<ArkmeExtensionEnabledResult>('extensions.enabled.set', { extensionId, enabled }, signal)
  }

  /**
   * Delete an owned marketplace extension and remove its current local runtime/Profile/source references.
   * Consumers must call this only from an explicit current human delete action.
   */
  async deleteExtension(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionCompleteDeleteResult> {
    const normalized = extensionId.trim()
    if (normalized === '') throw new TypeError('Arkme extension ID must not be empty')
    return await this.call<ArkmeExtensionCompleteDeleteResult>('extensions.delete', { extensionId: normalized }, signal)
  }

  /** Build the same-origin URL used by every extension list/detail avatar surface. */
  extensionIconUrl(extensionId: string, iconRef: string): string {
    if (extensionId.trim() === '' || !/^icon_v1_[a-f0-9]{64}$/.test(iconRef.trim())) {
      throw new TypeError('Arkme extension icon identity is invalid')
    }
    return `${this.route}/extension-icon?extension_id=${encodeURIComponent(extensionId.trim())}&icon_ref=${encodeURIComponent(iconRef.trim())}`
  }

  /** Upload or replace an owned extension icon without exposing registry signed transport. */
  async setExtensionIcon(
    extensionId: string,
    file: Blob,
    options: { clientMutationId?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeExtensionIconResult> {
    const mediaType = file.type.toLowerCase() as ArkmeExtensionIconMediaType
    if (extensionId.trim() === '' || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
      throw new TypeError('Arkme extension icon must be PNG, JPEG, or WebP')
    }
    if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new TypeError('Arkme extension icon must be smaller than 2 MiB')
    const mutationId = options.clientMutationId ?? crypto.randomUUID()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mutationId)) {
      throw new TypeError('Arkme extension icon mutation id must be a UUID')
    }
    const response = await this.fetchImpl(`${this.route}/extension-icon/upload`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': mediaType,
        'X-Arkme-Extension-Id': extensionId.trim(),
        'X-Arkme-Idempotency-Key': mutationId,
      },
      body: file,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    let body: ArkmePluginResponse<ArkmeExtensionIconResult>
    try { body = await response.json() as ArkmePluginResponse<ArkmeExtensionIconResult> } catch {
      throw new ArkmeClientError({ code: 'local-response-invalid', message: 'Arkme 插件返回了无效响应', retryable: true })
    }
    if (!body.ok) throw new ArkmeClientError(body.error)
    return body.value
  }

  extensionPreviewUrl(extensionId: string, previewRef: string): string {
    if (extensionId.trim() === '' || !/^preview_v1_[a-f0-9]{64}$/.test(previewRef.trim())) {
      throw new TypeError('Arkme extension preview identity is invalid')
    }
    return `${this.route}/extension-preview?extension_id=${encodeURIComponent(extensionId.trim())}&preview_ref=${encodeURIComponent(previewRef.trim())}`
  }

  async addExtensionPreview(
    extensionId: string,
    file: Blob,
    options: { clientMutationId?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeExtensionPreviewGallery> {
    const mediaType = file.type.toLowerCase() as ArkmeExtensionPreviewMediaType
    if (extensionId.trim() === '' || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) {
      throw new TypeError('Arkme extension preview must be PNG, JPEG, or WebP')
    }
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new TypeError('Arkme extension preview must be smaller than 5 MiB')
    const mutationId = options.clientMutationId ?? crypto.randomUUID()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mutationId)) {
      throw new TypeError('Arkme extension preview mutation id must be a UUID')
    }
    const response = await this.fetchImpl(`${this.route}/extension-preview/upload`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': mediaType,
        'X-Arkme-Extension-Id': extensionId.trim(),
        'X-Arkme-Idempotency-Key': mutationId,
      },
      body: file,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    let body: ArkmePluginResponse<ArkmeExtensionPreviewGallery>
    try { body = await response.json() as ArkmePluginResponse<ArkmeExtensionPreviewGallery> } catch {
      throw new ArkmeClientError({ code: 'local-response-invalid', message: 'Arkme 插件返回了无效响应', retryable: true })
    }
    if (!body.ok) throw new ArkmeClientError(body.error)
    return body.value
  }

  async deleteExtensionPreview(
    extensionId: string,
    previewRef: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionPreviewGallery> {
    if (extensionId.trim() === '' || !/^preview_v1_[a-f0-9]{64}$/.test(previewRef.trim())
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError('Arkme extension preview delete parameters are invalid')
    }
    return await this.call<ArkmeExtensionPreviewGallery>('extensions.preview.delete', {
      extensionId: extensionId.trim(), previewRef: previewRef.trim(), expectedRevision,
    }, signal)
  }

  async reorderExtensionPreviews(
    extensionId: string,
    orderedPreviewRefs: string[],
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionPreviewGallery> {
    const refs = orderedPreviewRefs.map(value => value.trim())
    if (extensionId.trim() === '' || refs.length <= 0 || refs.length > 20
      || refs.some(value => !/^preview_v1_[a-f0-9]{64}$/.test(value)) || new Set(refs).size !== refs.length
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError('Arkme extension preview reorder parameters are invalid')
    }
    return await this.call<ArkmeExtensionPreviewGallery>('extensions.preview.reorder', {
      extensionId: extensionId.trim(), orderedPreviewRefs: refs, expectedRevision,
    }, signal)
  }

  /** Run a user-triggered AI audit for one marketplace extension without installing it. */
  async auditExtension(extensionId: string, signal?: AbortSignal): Promise<ArkmeExtensionAuditResult> {
    if (extensionId.trim() === '') throw new TypeError('Arkme extension ID must not be empty')
    return await this.call<ArkmeExtensionAuditResult>('extensions.audit.check', { extensionId: extensionId.trim() }, signal)
  }

  async authStatus(signal?: AbortSignal): Promise<ArkmeAuthSnapshot> {
    return await this.call<ArkmeAuthSnapshot>('auth.status', undefined, signal)
  }

  /** Read recent call history through Browser-safe opaque call references. */
  async callHistory(options: ArkmeCallHistoryOptions = {}, signal?: AbortSignal): Promise<ArkmeCallHistoryPage> {
    const limit = options.limit === undefined ? undefined : Math.trunc(options.limit)
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0 || limit > 50)) {
      throw new TypeError('Arkme call history limit must be 1-50')
    }
    const cursor = options.cursor?.trim() ?? ''
    return await this.call<ArkmeCallHistoryPage>('calls.history.list', {
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === '' ? {} : { cursor }),
      ...(options.includeRecentContacts === undefined ? {} : { includeRecentContacts: options.includeRecentContacts }),
    }, signal)
  }

  /** Read one call detail using an unchanged callRef returned by callHistory(). */
  async callDetail(callRef: string, signal?: AbortSignal): Promise<ArkmeCallDetail> {
    const normalized = callRef.trim()
    if (normalized === '') throw new TypeError('Arkme call reference must not be empty')
    return safeSdkCallDetail(await this.call<ArkmeCallDetail>('calls.history.detail', { callRef: normalized }, signal))
  }

  /** Retry call summary generation only from an explicit current human action. */
  async retryCallSummary(callRef: string, signal?: AbortSignal): Promise<ArkmeCallSummaryRetryResult> {
    const normalized = callRef.trim()
    if (normalized === '') throw new TypeError('Arkme call reference must not be empty')
    return await this.call<ArkmeCallSummaryRetryResult>('calls.history.summary.retry', { callRef: normalized }, signal)
  }

  async profile(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeUserProfileSnapshot> {
    return await this.call<ArkmeUserProfileSnapshot>(
      options.refresh === true ? 'user.profile.refresh' : 'user.profile',
      undefined,
      options.signal,
    )
  }

  /** Search by an exact phone number or Arkme ID without exposing internal account identifiers. */
  async searchContact(identifier: string, signal?: AbortSignal): Promise<ArkmeContactSearchResult> {
    const value = identifier.trim()
    if (value === '' || value.length > 64) throw new TypeError('Arkme contact identifier is invalid')
    return await this.call<ArkmeContactSearchResult>('contacts.search', { identifier: value }, signal)
  }

  /** Add the exact candidate returned by searchContact and open its idempotent private/pending chat. */
  async addContact(
    contactRef: string,
    options: { remark?: string; requestUid?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeContactAddResult> {
    const ref = contactRef.trim()
    if (!/^arkme-contact-v1\.[0-9a-f-]{36}$/i.test(ref)) throw new TypeError('Arkme contact reference is invalid')
    const remark = options.remark?.trim() ?? ''
    if (Array.from(remark).length > 100) throw new TypeError('Arkme contact remark is too long')
    const requestUid = options.requestUid ?? crypto.randomUUID()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestUid)) {
      throw new TypeError('Arkme contact request id must be a UUID')
    }
    return await this.call<ArkmeContactAddResult>('contacts.add', {
      contactRef: ref,
      ...(remark === '' ? {} : { remark }),
      requestUid,
    }, options.signal)
  }

  /** Open a private chat for a registered candidate returned by searchContact without adding it as a contact. */
  async openPrivateChatFromContact(contactRef: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> {
    const ref = contactRef.trim()
    if (!/^arkme-contact-v1\.[0-9a-f-]{36}$/i.test(ref)) throw new TypeError('Arkme contact reference is invalid')
    return await this.call<ArkmeOpenPrivateChatResult>('chat.private.open-from-contact', { contactRef: ref }, signal)
  }

  /** Create an initially owner-only group chat with an idempotent client mutation id. */
  async createGroup(
    title: string,
    options: { clientMutationId?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceItem> {
    const normalizedTitle = title.trim()
    if (normalizedTitle === '' || Array.from(normalizedTitle).length > 80) {
      throw new TypeError('Arkme group title is invalid')
    }
    const clientMutationId = options.clientMutationId ?? crypto.randomUUID()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMutationId)) {
      throw new TypeError('Arkme group mutation id must be a UUID')
    }
    return await this.call<ArkmeSourceItem>('group.create', {
      title: normalizedTitle,
      clientMutationId,
    }, options.signal)
  }

  /** Create a Bot without exposing the Host-owned one-time credential to the Consumer. */
  async createBot(
    input: { name: string; provider: ArkmeBotProvider; description?: string; avatar?: string },
    signal?: AbortSignal,
  ): Promise<ArkmeBotSummary> {
    const name = input.name.trim()
    if (name === '') throw new TypeError('Arkme Bot name must not be empty')
    if (input.provider !== 'openclaw' && input.provider !== 'webhook') {
      throw new TypeError('Arkme Bot provider is unsupported')
    }
    const description = input.description?.trim() ?? ''
    const avatar = input.avatar?.trim() ?? ''
    if (avatar !== '' && !isArkmeBotAvatarRef(avatar)) {
      throw new TypeError('Arkme Bot avatar must be a file_asset reference')
    }
    return await this.call<ArkmeBotSummary>('bots.create', {
      name,
      provider: input.provider,
      ...(description === '' ? {} : { description }),
      ...(avatar === '' ? {} : { avatar }),
    }, signal)
  }

  /** Browse public marketplace extensions with server-owned query, ordering and cursor semantics. */
  async extensionCatalog(options: {
    query?: string
    sort?: ArkmeExtensionCatalogSort
    cursor?: string
    limit?: number
    ownerUserId?: number
    excludeExtensionId?: string
    signal?: AbortSignal
  } = {}): Promise<ArkmeExtensionCatalogPage> {
    if (options.ownerUserId !== undefined && (!Number.isSafeInteger(options.ownerUserId) || options.ownerUserId <= 0)) {
      throw new TypeError('Arkme extension owner user id must be a positive safe integer')
    }
    return await this.call<ArkmeExtensionCatalogPage>('extensions.catalog.list', {
      ...(options.query === undefined || options.query.trim() === '' ? {} : { query: options.query.trim() }),
      ...(options.sort === undefined ? {} : { sort: options.sort }),
      ...(options.cursor === undefined || options.cursor.trim() === '' ? {} : { cursor: options.cursor.trim() }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.ownerUserId === undefined ? {} : { ownerUserId: options.ownerUserId }),
      ...(options.excludeExtensionId === undefined || options.excludeExtensionId.trim() === ''
        ? {}
        : { excludeExtensionId: options.excludeExtensionId.trim() }),
    }, options.signal)
  }

  /** Read the AI-generated marketplace category tree. */
  async extensionCategories(options: { limit?: number; signal?: AbortSignal } = {}): Promise<ArkmeExtensionClassificationTree> {
    return await this.call<ArkmeExtensionClassificationTree>('extensions.classification.tree', {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }, options.signal)
  }

  /** Browse one AI category while retaining the same server-side ordering contract. */
  async extensionCategoryItems(categoryId: string, options: {
    query?: string
    sort?: ArkmeExtensionCatalogSort
    cursor?: string
    limit?: number
    signal?: AbortSignal
  } = {}): Promise<ArkmeExtensionClassificationPage> {
    if (categoryId.trim() === '') throw new TypeError('Arkme extension category id must not be empty')
    return await this.call<ArkmeExtensionClassificationPage>('extensions.classification.items', {
      categoryId: categoryId.trim(),
      ...(options.query === undefined || options.query.trim() === '' ? {} : { query: options.query.trim() }),
      ...(options.sort === undefined ? {} : { sort: options.sort }),
      ...(options.cursor === undefined || options.cursor.trim() === '' ? {} : { cursor: options.cursor.trim() }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }, options.signal)
  }

  /** List current-account sources with their Host-derived dynamic-cordis-v2 or profile-native-v3 publication route. */
  async myExtensions(options: { currentSessionId?: string; signal?: AbortSignal } = {}): Promise<ArkmeMyExtensionPage> {
    return await this.call<ArkmeMyExtensionPage>('extensions.mine.list', {
      ...(options.currentSessionId === undefined || options.currentSessionId.trim() === ''
        ? {}
        : { currentSessionId: options.currentSessionId.trim() }),
    }, options.signal)
  }

  /** Publish one exact owned source through its Host-derived V2 or V3 route after explicit current-user intent. */
  publishMyExtension(input: ArkmeMyExtensionPublishInput, signal?: AbortSignal): Promise<ArkmeExtensionPublishResult> {
    if (input.ownedRef.trim() === '') throw new TypeError('Arkme extension reference must not be empty')
    if (input.name.trim() === '' || input.name.trim().length > 120) throw new TypeError('Arkme extension name is invalid')
    if (input.description.length > 2_000) throw new TypeError('Arkme extension description is too long')
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version.trim())) {
      throw new TypeError('Arkme extension version must be SemVer')
    }
    if (!['private', 'unlisted', 'public'].includes(input.visibility)) throw new TypeError('Arkme extension visibility is invalid')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientMutationId)) {
      throw new TypeError('Arkme extension client mutation id must be a UUID')
    }
		let githubRepositoryUrl: string | undefined
		try { githubRepositoryUrl = normalizeGitHubRepositoryURL(input.githubRepositoryUrl) } catch {
			throw new TypeError('Arkme extension GitHub repository URL is invalid')
		}
    return this.call<ArkmeExtensionPublishResult>('extensions.mine.publish', {
      ownedRef: input.ownedRef,
      name: input.name,
      description: input.description,
      version: input.version,
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog }),
		...(githubRepositoryUrl === undefined ? {} : { githubRepositoryUrl }),
      clientMutationId: input.clientMutationId,
    }, signal)
  }

  async updateExtensionMetadata(
    extensionId: string,
    input: ArkmeExtensionMetadataUpdateInput,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionCatalogItem> {
    const name = input.name.trim()
    const description = input.description.trim()
    if (extensionId.trim() === '' || name === '' || [...name].length > 120 || [...description].length > 2_000
      || (input.visibility !== 'private' && input.visibility !== 'public')) {
      throw new TypeError('Arkme extension metadata or visibility is invalid')
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientMutationId)) {
      throw new TypeError('Arkme extension metadata mutation id must be a UUID')
    }
    return await this.call<ArkmeExtensionCatalogItem>('extensions.metadata.update', {
      extensionId: extensionId.trim(), name, description, visibility: input.visibility,
      clientMutationId: input.clientMutationId,
    }, signal)
  }

	async rotateExtensionShare(extensionId: string, clientMutationId: string, signal?: AbortSignal): Promise<ArkmeExtensionShare> {
		if (extensionId.trim() === '' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientMutationId)) {
			throw new TypeError('Arkme extension share rotation input is invalid')
		}
		return await this.call<ArkmeExtensionShare>('extensions.share.rotate', {
			extensionId: extensionId.trim(), clientMutationId,
		}, signal)
	}

	async extensionShareDetail(shareRef: string, signal?: AbortSignal): Promise<ArkmeSharedExtensionDetail> {
		const normalized = shareRef.trim()
		if (!/^extshare_[0-9a-f]{32}$/.test(normalized)) {
			throw new TypeError('Arkme extension share reference is invalid')
		}
		return await this.call<ArkmeSharedExtensionDetail>('extensions.share.detail', { shareRef: normalized }, signal)
	}

  /** Read one current-user Arkme image through the authenticated Provider without exposing a signed OSS URL. */
  async readImage(imageRef: string, signal?: AbortSignal): Promise<ArkmeImagePayload> {
    if (imageRef.trim() === '') throw new TypeError('Arkme image reference must not be empty')
    return await this.call<ArkmeImagePayload>('image.read', { imageRef }, signal)
  }

  /** Convert a Provider image payload into a browser-renderable data URL. */
  imageDataUrl(image: ArkmeImagePayload): string {
    return `data:${image.mediaType};base64,${image.dataBase64}`
  }

  /** Read the public World feed through the authenticated Provider boundary. */
  async worldFeed(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    return await this.call<ArkmeWorldFeedPage>('world.feed', {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    }, options.signal)
  }

  /** Read the current account's public World posts through the authenticated Provider boundary. */
  async myWorldFeed(
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    return await this.call<ArkmeWorldFeedPage>('world.mine', {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    }, options.signal)
  }

  /** Read one user's public World homepage through the authenticated Provider boundary. */
  async userWorldFeed(
    userId: number,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldFeedPage> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new TypeError('Arkme World userId must be a positive integer')
    return await this.call<ArkmeWorldFeedPage>('world.user', {
      userId,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    }, options.signal)
  }

  /** Open or reuse a private chat with a non-self World author from an unchanged authorRef. */
  async openWorldAuthorPrivateChat(authorRef: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> {
    if (authorRef.trim() === '') throw new TypeError('Arkme World author reference must not be empty')
    return await this.call<ArkmeOpenPrivateChatResult>('chat.world.private.open', { authorRef }, signal)
  }

  /** Open or reuse the same private chat used by the mobile "联系作者" entry. */
  async openOfficialAuthorPrivateChat(signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult> {
    return await this.call<ArkmeOpenPrivateChatResult>('chat.official-author.private.open', {}, signal)
  }

  /** Read the browser-safe public profile for the mobile "联系作者" entry without creating a chat. */
  async officialAuthorProfile(signal?: AbortSignal): Promise<ArkmeOfficialAuthorProfile> {
    return await this.call<ArkmeOfficialAuthorProfile>('chat.official-author.profile', {}, signal)
  }

  /** Resolve viewer-local labels for visible World authors without exposing their user IDs. */
  async worldAuthorLabels(authorRefs: readonly string[], signal?: AbortSignal): Promise<ArkmeWorldAuthorLabel[]> {
    const normalized = [...new Set(authorRefs.map(value => value.trim()).filter(value => value !== ''))]
    if (normalized.length === 0) return []
    return await this.call<ArkmeWorldAuthorLabel[]>('world.author-labels', { authorRefs: normalized.slice(0, 20) }, signal)
  }

  async worldVoiceprintPlaybackAvailability(
    recordRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintAvailability> {
    const normalized = [...new Set(recordRefs.map(value => value.trim()).filter(value => value !== ''))]
    if (normalized.length === 0) return { items: [] }
    return await this.call<ArkmeWorldVoiceprintAvailability>(
      'world.voiceprint.availability',
      { recordRefs: normalized.slice(0, 20) },
      signal,
    )
  }

  async generateWorldVoiceprintPlayback(
    input: { recordRef: string; chunkIndex?: number },
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintPlaybackChunk> {
    if (input.recordRef.trim() === '') throw new TypeError('Arkme World record reference must not be empty')
    return await this.call<ArkmeWorldVoiceprintPlaybackChunk>('world.voiceprint.playback.generate', {
      recordRef: input.recordRef,
      ...(input.chunkIndex === undefined ? {} : { chunkIndex: input.chunkIndex }),
    }, signal)
  }

  async inviteWorldVoiceprint(
    recordRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldVoiceprintInviteResult> {
    if (recordRef.trim() === '') throw new TypeError('Arkme World record reference must not be empty')
    return await this.call<ArkmeWorldVoiceprintInviteResult>('world.voiceprint.invite', { recordRef }, signal)
  }

  async worldVoiceprintSocialContext(
    recordRef: string,
    options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldVoiceprintSocialContext> {
    if (recordRef.trim() === '') throw new TypeError('Arkme World record reference must not be empty')
    return await this.call<ArkmeWorldVoiceprintSocialContext>('world.voiceprint.social-context', {
      recordRef,
      ...(options.forceRefresh === undefined ? {} : { forceRefresh: options.forceRefresh }),
    }, options.signal)
  }

  /** Read comments and replies for one Provider-issued World record reference. */
  async worldInteractions(
    recordRef: string,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeWorldInteractionPage> {
    if (recordRef.trim() === '') throw new TypeError('Arkme World record reference must not be empty')
    return await this.call<ArkmeWorldInteractionPage>('world.interactions.list', {
      recordRef,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    }, options.signal)
  }

  /** Publish a text comment or reply using a caller-stable mutation id. */
  async createWorldTextInteraction(
    input: { targetRef: string; textContent: string; clientMutationId: string },
    signal?: AbortSignal,
  ): Promise<ArkmeWorldInteractionCreateResult> {
    if (input.targetRef.trim() === '' || input.textContent.trim() === '' || input.clientMutationId.trim() === '') {
      throw new TypeError('Arkme World interaction target, text, and mutation id must not be empty')
    }
    return await this.call<ArkmeWorldInteractionCreateResult>('world.interactions.create-text', {
      targetRef: input.targetRef,
      textContent: input.textContent,
      clientMutationId: input.clientMutationId,
    }, signal)
  }

  async publishWorldText(
    input: ArkmeWorldPublishTextInput,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldPublishResult> {
    if (input.clientMutationId.trim() === '' || input.textContent.trim() === '') {
      throw new TypeError('Arkme World publish text and mutation id must not be empty')
    }
    return await this.call<ArkmeWorldPublishResult>('world.publish-text', {
      clientMutationId: input.clientMutationId,
      textContent: input.textContent,
    }, signal)
  }

  async publishWorldFileAssets(
    input: ArkmeWorldPublishFileAssetsInput,
    signal?: AbortSignal,
  ): Promise<ArkmeWorldPublishResult> {
    if (input.clientMutationId.trim() === '' || input.textContent.trim() === '' || input.fileAssets.length === 0) {
      throw new TypeError('Arkme World publish text, mutation id, and file assets must not be empty')
    }
    return await this.call<ArkmeWorldPublishResult>('world.publish-file-assets', {
      clientMutationId: input.clientMutationId,
      textContent: input.textContent,
      fileAssets: input.fileAssets,
    }, signal)
  }

  /** Resolve one Provider-issued World image ref without exposing its signed source URL. */
  async readWorldImage(imageRef: string, signal?: AbortSignal): Promise<ArkmeImagePayload> {
    if (imageRef.trim() === '') throw new TypeError('Arkme World image reference must not be empty')
    return await this.call<ArkmeImagePayload>('world.image.read', { imageRef }, signal)
  }

  /** Read the current account's Arrangement owner projection. */
  async arrangements(
    options: { status?: ArkmeArrangementListStatus; limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeArrangementPage> {
    return await this.call<ArkmeArrangementPage>('arrangements.list', {
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    }, options.signal)
  }

  /** Read public reviews and rating summary for one extension. */
  async extensionReviews(
    extensionId: string,
    options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeExtensionReviewPage> {
    if (extensionId.trim() === '') throw new TypeError('Arkme extension id must not be empty')
    return await this.call<ArkmeExtensionReviewPage>('extensions.reviews.list', {
      extensionId,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    }, options.signal)
  }

  /** Read one Arrangement through a Provider-issued, account-bound reference. */
  async arrangementDetail(arrangementRef: string, signal?: AbortSignal): Promise<ArkmeArrangementDetail> {
    if (arrangementRef.trim() === '') throw new TypeError('Arrangement reference must not be empty')
    return await this.call<ArkmeArrangementDetail>('arrangements.detail', { arrangementRef }, signal)
  }

  async arrangementReminders(
    options: { unreadOnly?: boolean; limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeArrangementReminderPage> {
    return await this.call<ArkmeArrangementReminderPage>('arrangements.reminders.list', {
      ...(options.unreadOnly === undefined ? {} : { unreadOnly: options.unreadOnly }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.offset === undefined ? {} : { offset: options.offset }),
    }, options.signal)
  }

  async arrangementReminderSummary(signal?: AbortSignal): Promise<ArkmeArrangementReminderSummary> {
    return await this.call<ArkmeArrangementReminderSummary>('arrangements.reminders.summary', undefined, signal)
  }

  async mutateArrangement(
    arrangementRef: string,
    intent: ArkmeArrangementMutationIntent,
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementMutationResult> {
    const normalizedRef = arrangementRef.trim()
    if (normalizedRef === '') throw new TypeError('Arrangement reference must not be empty')
    if (!['start-follow', 'cancel-follow', 'complete', 'cancel-complete', 'delete'].includes(intent)) {
      throw new TypeError('Arrangement mutation intent is invalid')
    }
    return await this.call<ArkmeArrangementMutationResult>(
      'arrangements.mutate',
      { arrangementRef: normalizedRef, intent },
      signal,
    )
  }

  async setArrangementReminderEnabled(
    arrangementRef: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementReminderToggleResult> {
    const normalizedRef = arrangementRef.trim()
    if (normalizedRef === '') throw new TypeError('Arrangement reference must not be empty')
    return await this.call<ArkmeArrangementReminderToggleResult>(
      'arrangements.reminder-enabled',
      { arrangementRef: normalizedRef, enabled },
      signal,
    )
  }

  async markArrangementRemindersRead(
    eventRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeArrangementReminderWriteResult> {
    const normalizedRefs = eventRefs.map(eventRef => eventRef.trim())
    if (normalizedRefs.length === 0 || normalizedRefs.some(eventRef => eventRef === '')) {
      throw new TypeError('Reminder references must not be empty')
    }
    if (new Set(normalizedRefs).size !== normalizedRefs.length) {
      throw new TypeError('Reminder references must be unique')
    }
    if (normalizedRefs.length > 50) throw new TypeError('At most 50 reminder references are allowed')
    return await this.call<ArkmeArrangementReminderWriteResult>(
      'arrangements.reminders.mark-read',
      { eventRefs: normalizedRefs },
      signal,
    )
  }

  async markAllArrangementRemindersRead(signal?: AbortSignal): Promise<ArkmeArrangementReminderWriteResult> {
    return await this.call<ArkmeArrangementReminderWriteResult>(
      'arrangements.reminders.mark-all-read',
      undefined,
      signal,
    )
  }

  async clearArrangementReminders(signal?: AbortSignal): Promise<ArkmeArrangementReminderWriteResult> {
    return await this.call<ArkmeArrangementReminderWriteResult>('arrangements.reminders.clear', undefined, signal)
  }

  /** Create a top-level review or reply through the account-bound Host owner. */
  async createExtensionReview(
    input: ArkmeExtensionReviewCreateInput,
    signal?: AbortSignal,
  ): Promise<ArkmeExtensionReviewCreateResult> {
    if (input.extensionId.trim() === '' || input.textContent.trim() === '' || input.clientMutationId.trim() === '') {
      throw new TypeError('Arkme extension review id, text, and mutation id must not be empty')
    }
    return await this.call<ArkmeExtensionReviewCreateResult>('extensions.reviews.create', {
      extensionId: input.extensionId,
      textContent: input.textContent,
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      ...(input.parentReviewRef === undefined ? {} : { parentReviewRef: input.parentReviewRef }),
      clientMutationId: input.clientMutationId,
    }, signal)
  }

  async listSources(
    directory: ArkmeSourceDirectory,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceList> {
    return await this.call<ArkmeSourceList>('sources.list', {
      directory,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async listGroupMembers(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupMemberList> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme group source reference must not be empty')
    return await this.call<ArkmeGroupMemberList>('group.members', { sourceRef, activeOnly: true }, signal)
  }

  async listSourceMembers(sourceRef: string, signal?: AbortSignal): Promise<ArkmeConversationMemberList> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme chat source reference must not be empty')
    return await this.call<ArkmeConversationMemberList>('source.members', { sourceRef, activeOnly: true }, signal)
  }

  async sourceMemberRecords(
    sourceRef: string,
    memberRef: string,
    mode: ArkmeConversationMemberRecordMode,
    options: { limit?: number; beforeSequence?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeConversationMemberRecordPage> {
    if (sourceRef.trim() === '' || memberRef.trim() === '' || !['owner', 'mentioned'].includes(mode)) {
      throw new TypeError('Arkme source, member reference, and member-record mode must be valid')
    }
    return await this.call<ArkmeConversationMemberRecordPage>('source.member-records', {
      sourceRef,
      memberRef,
      mode,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.beforeSequence === undefined ? {} : { beforeSequence: options.beforeSequence }),
    }, options.signal)
  }

  async listGroupMemberCandidates(
    sourceRef: string,
    options: { query?: string; limit?: number; groupSourceRefs?: readonly string[]; signal?: AbortSignal } = {},
  ): Promise<ArkmeGroupMemberCandidateList> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme group source reference must not be empty')
    return await this.call<ArkmeGroupMemberCandidateList>('group.member-candidates', {
      sourceRef,
      ...(options.query === undefined ? {} : { query: options.query }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.groupSourceRefs === undefined ? {} : { groupSourceRefs: options.groupSourceRefs.map(value => value.trim()).filter(value => value !== '') }),
    }, options.signal)
  }

  async groupInvitePreview(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupInvitePreview> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme group source reference must not be empty')
    return await this.call<ArkmeGroupInvitePreview>('group.invite-preview', { sourceRef }, signal)
  }

  async addGroupMembers(
    sourceRef: string,
    candidateRefs: readonly string[],
    signal?: AbortSignal,
  ): Promise<ArkmeGroupMemberAddResult> {
    const refs = candidateRefs.map(value => value.trim())
    if (sourceRef.trim() === '' || refs.length === 0 || refs.some(value => value === '')) {
      throw new TypeError('Arkme group source and candidate references must not be empty')
    }
    return await this.call<ArkmeGroupMemberAddResult>('group.members.add', { sourceRef, candidateRefs: refs }, signal)
  }

  async listGroupBots(sourceRef: string, signal?: AbortSignal): Promise<ArkmeGroupBotCandidateList> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme group source reference must not be empty')
    return await this.call<ArkmeGroupBotCandidateList>('group.bots', { sourceRef }, signal)
  }

  async addGroupBot(sourceRef: string, botRef: string, signal?: AbortSignal): Promise<ArkmeGroupBotAddResult> {
    if (sourceRef.trim() === '' || botRef.trim() === '') {
      throw new TypeError('Arkme group source and Bot references must not be empty')
    }
    return await this.call<ArkmeGroupBotAddResult>('group.bot.add', { sourceRef, botRef }, signal)
  }

  async readSource(
    sourceRef: string,
    options: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal } = {},
  ): Promise<ArkmeTimelinePage> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme source reference must not be empty')
    return await this.call<ArkmeTimelinePage>('source.timeline', {
      sourceRef,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async messageReadReceiptSummaries(
    sourceRef: string,
    items: readonly ArkmeMessageReadReceiptQueryItem[],
    signal?: AbortSignal,
  ): Promise<ArkmeMessageReadReceiptSummaryList> {
    const normalizedSourceRef = sourceRef.trim()
    if (normalizedSourceRef === '' || items.length < 1 || items.length > ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS) {
      throw new TypeError(`Arkme message read receipts require one source and 1-${String(ARKME_MESSAGE_READ_RECEIPT_MAX_ITEMS)} messages`)
    }
    const seen = new Set<string>()
    const normalizedItems = items.map(item => {
      const itemUid = item.itemUid.trim()
      const sequence = Math.trunc(item.sequence)
      const key = `${itemUid}\u0000${String(sequence)}`
      if (itemUid === '' || !Number.isSafeInteger(item.sequence) || sequence <= 0 || seen.has(key)) {
        throw new TypeError('Arkme message read receipt item identity is invalid or duplicated')
      }
      seen.add(key)
      return { itemUid, sequence }
    })
    return await this.call<ArkmeMessageReadReceiptSummaryList>(
      'source.read-receipts.summary-list',
      { sourceRef: normalizedSourceRef, items: normalizedItems },
      signal,
    )
  }

  async messageReadReceiptDetail(
    sourceRef: string,
    itemUid: string,
    sequence: number,
    signal?: AbortSignal,
  ): Promise<ArkmeMessageReadReceiptDetail> {
    const normalizedSourceRef = sourceRef.trim()
    const normalizedItemUid = itemUid.trim()
    if (normalizedSourceRef === '' || normalizedItemUid === '' || !Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new TypeError('Arkme group message read receipt identity is invalid')
    }
    return await this.call<ArkmeMessageReadReceiptDetail>(
      'source.read-receipts.detail',
      { sourceRef: normalizedSourceRef, itemUid: normalizedItemUid, sequence },
      signal,
    )
  }

  async sendText(
    sourceRef: string,
    textContent: string,
    options: {
      recordUid?: string
      relationUid?: string
      agentAuthored?: boolean
      humanMentions?: readonly ArkmeHumanMentionInput[]
      signal?: AbortSignal
    } = {},
  ): Promise<ArkmeSourceSendResult> {
    if (sourceRef.trim() === '' || textContent.trim() === '') {
      throw new TypeError('Arkme source reference and text must not be empty')
    }
    return await this.call<ArkmeSourceSendResult>('source.send-text', {
      sourceRef,
      textContent,
      recordUid: options.recordUid ?? crypto.randomUUID(),
      relationUid: options.relationUid ?? crypto.randomUUID(),
      ...(options.agentAuthored === true ? { agentAuthored: true } : {}),
      ...(options.humanMentions === undefined ? {} : { humanMentions: options.humanMentions }),
    }, options.signal)
  }

  async relatedRecordingEligibility(
    sourceRef: string,
    signal?: AbortSignal,
  ): Promise<ArkmeRelatedRecordingEligibility> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme private-chat source reference must not be empty')
    return await this.call<ArkmeRelatedRecordingEligibility>(
      'related-recordings.eligibility', { sourceRef }, signal,
    )
  }

  async relatedRecordings(
    sourceRef: string,
    options: ArkmeRelatedRecordingPageOptions = {},
  ): Promise<ArkmeRelatedRecordingPage> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme private-chat source reference must not be empty')
    return await this.call<ArkmeRelatedRecordingPage>('related-recordings.page', {
      sourceRef,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.monthKey === undefined ? {} : { monthKey: options.monthKey }),
      ...(options.timezoneOffsetMillis === undefined ? {} : { timezoneOffsetMillis: options.timezoneOffsetMillis }),
      ...(options.includeTimeIndex === undefined ? {} : { includeTimeIndex: options.includeTimeIndex }),
    }, options.signal)
  }

  async sendRich(
    sourceRef: string,
    input: ArkmeRichSendInput,
    options: { recordUid?: string; relationUid?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeSourceSendResult> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme source reference must not be empty')
    return await this.call<ArkmeSourceSendResult>('source.send-rich', {
      sourceRef,
      ...input,
      recordUid: options.recordUid ?? crypto.randomUUID(),
      relationUid: options.relationUid ?? crypto.randomUUID(),
    }, options.signal)
  }

  async longArticleDetail(sourceRef: string, itemUid: string, signal?: AbortSignal): Promise<ArkmeLongArticleDetail> {
    if (sourceRef.trim() === '' || itemUid.trim() === '') throw new TypeError('Arkme source and article references must not be empty')
    return await this.call<ArkmeLongArticleDetail>('source.long-article.detail', { sourceRef, itemUid }, signal)
  }

  async updateLongArticle(
    sourceRef: string,
    itemUid: string,
    input: { title: string; textContent: string; version: number; editDurationMillis: number },
    signal?: AbortSignal,
  ): Promise<ArkmeLongArticleDetail> {
    if (sourceRef.trim() === '' || itemUid.trim() === '') throw new TypeError('Arkme source and article references must not be empty')
    return await this.call<ArkmeLongArticleDetail>('source.long-article.update', { sourceRef, itemUid, ...input }, signal)
  }

  async longArticleDraft(
    sourceRef: string,
    itemUid?: string,
    signal?: AbortSignal,
  ): Promise<ArkmeLongArticleDraft | undefined> {
    return await this.call<ArkmeLongArticleDraft | undefined>('source.long-article.draft.get', {
      sourceRef, ...(itemUid === undefined ? {} : { itemUid }),
    }, signal)
  }

  async saveLongArticleDraft(draft: Omit<ArkmeLongArticleDraft, 'updatedAtMillis'>, signal?: AbortSignal): Promise<void> {
    if (draft.sourceRef.trim() === '') throw new TypeError('Arkme source reference must not be empty')
    await this.call<void>('source.long-article.draft.put', draft, signal)
  }

  async deleteLongArticleDraft(sourceRef: string, itemUid?: string, signal?: AbortSignal): Promise<void> {
    if (sourceRef.trim() === '') throw new TypeError('Arkme source reference must not be empty')
    await this.call<void>('source.long-article.draft.delete', {
      sourceRef, ...(itemUid === undefined ? {} : { itemUid }),
    }, signal)
  }

  async upload(
    file: Blob & { name?: string },
    options: { fileName?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeUploadedAsset> {
    const fileName = (options.fileName ?? file.name ?? 'attachment').trim()
    const response = await this.fetchImpl(`${this.route}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Arkme-File-Name': encodeURIComponent(fileName),
      },
      body: file,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const payload = await response.json() as ArkmePluginResponse<ArkmeUploadedAsset>
    if (!payload.ok) throw new ArkmeClientError(payload.error)
    return payload.value
  }

  mediaUrl(mediaRef: string): string {
    if (mediaRef.trim() === '') throw new TypeError('Arkme media reference must not be empty')
    return `${this.route}/media?ref=${encodeURIComponent(mediaRef)}`
  }

  async snapshot(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeCachedSnapshot> {
    return await this.call<ArkmeCachedSnapshot>(
      options.refresh === true ? 'records.refresh' : 'records.cache',
      undefined,
      options.signal,
    )
  }

  async calendarBuckets(options: {
    startDate: string
    endDate: string
    timezone?: string
    signal?: AbortSignal
  }): Promise<ArkmeCalendarBucketPage> {
    return await this.call<ArkmeCalendarBucketPage>('calendar.buckets', {
      startDate: options.startDate,
      endDate: options.endDate,
      ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
    }, options.signal)
  }

  async calendarRecords(options: {
    bucketDate: string
    timezone?: string
    limit?: number
    cursor?: ArkmeCalendarRecordCursor
    signal?: AbortSignal
  }): Promise<ArkmeCalendarDayRecordPage> {
    return await this.call<ArkmeCalendarDayRecordPage>('calendar.records', {
      bucketDate: options.bucketDate,
      ...(options.timezone === undefined ? {} : { timezone: options.timezone }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }, options.signal)
  }

  async search(query: string, options: ArkmeSearchOptions & { signal?: AbortSignal } = {}): Promise<ArkmeCachedQueryResult> {
    return await this.call<ArkmeCachedQueryResult>('records.search', {
      query,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.beforeMillis === undefined ? {} : { beforeMillis: options.beforeMillis }),
      ...(options.syncAll === undefined ? {} : { syncAll: options.syncAll }),
    }, options.signal)
  }

  /** List the signed-in user's image library without exposing storage URLs. */
  async images(options: ArkmeImageListOptions = {}): Promise<ArkmeImageSearchResult> {
    return await this.call<ArkmeImageSearchResult>('images.list', {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor?.trim() ? { cursor: options.cursor.trim() } : {}),
    }, options.signal)
  }

  async createText(
    textContent: string,
    options: { recordUid?: string; signal?: AbortSignal } = {},
  ): Promise<ArkmeCreateTextResult> {
    return await this.call<ArkmeCreateTextResult>('records.create', {
      recordUid: options.recordUid ?? crypto.randomUUID(),
      textContent,
    }, options.signal)
  }

  async outbox(signal?: AbortSignal): Promise<ArkmePendingWrite[]> {
    return await this.call<ArkmePendingWrite[]>('records.outbox', undefined, signal)
  }

  async retry(recordUid: string, signal?: AbortSignal): Promise<ArkmeCreateTextResult> {
    return await this.call<ArkmeCreateTextResult>('records.retry', { recordUid }, signal)
  }

  subscribe(listener: (state: ArkmeProviderState) => void, options: ArkmeSubscribeOptions = {}): () => void {
    const intervalMs = Math.min(60_000, Math.max(500, Math.trunc(options.intervalMs ?? 1_000)))
    let stopped = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let previousKey = ''
    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const state = await this.state()
        if (stopped) return
        const key = `${state.authStatus}:${String(state.userId ?? '')}:${String(state.revision)}`
        if (key !== previousKey) {
          previousKey = key
          listener(state)
        }
      } catch (error) {
        options.onError?.(error)
      } finally {
        if (!stopped) timeout = setTimeout(() => { void poll() }, intervalMs)
      }
    }
    if (options.immediate === false) timeout = setTimeout(() => { void poll() }, intervalMs)
    else void poll()
    return () => {
      stopped = true
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  async call<T>(
    operation: ArkmePluginOperation,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetchImpl(this.route, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, ...(params === undefined ? {} : { params }) }),
      ...(signal === undefined ? {} : { signal }),
    })
    let body: ArkmePluginResponse<T>
    try {
      body = await response.json() as ArkmePluginResponse<T>
    } catch {
      throw new ArkmeClientError({
        code: 'local-response-invalid',
        message: 'Arkme 插件返回了无效响应',
        retryable: true,
      })
    }
    if (!body.ok) throw new ArkmeClientError(body.error)
    return body.value
  }
}

export function createArkmeSdk(options?: ArkmeSdkOptions): ArkmeSdk {
  return new ArkmeSdk(options)
}

const defaultSdk = createArkmeSdk()

export async function callArkme<T>(
  operation: ArkmePluginOperation,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return await defaultSdk.call<T>(operation, params, signal)
}
