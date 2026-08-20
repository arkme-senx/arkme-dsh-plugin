import { ARKME_PROVIDER_CONTRACT_VERSION } from '../types.js'
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
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeContentBlock,
  ArkmeCreateTextResult,
  ArkmeImagePayload,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
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
  ArkmeSourceList,
  ArkmeSourceReadResult,
  ArkmeSourceSendResult,
  ArkmeTimelineCursor,
  ArkmeTimelinePage,
  ArkmeUserProfileSnapshot,
  ArkmeUploadedAsset,
  ArkmeWorldFeedPage,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionPage,
} from '../types.js'
import type {
  ArkmeExtensionEnabledResult, ArkmeExtensionEnabledState, ArkmeExtensionIconMediaType,
  ArkmeExtensionIconResult, ArkmeExtensionPublishResult, ArkmeInstalledExtensionView,
  ArkmeExtensionPreviewGallery, ArkmeExtensionPreviewMediaType,
} from '../extensions/types.js'
import type { ArkmeMyExtensionPage, ArkmeMyExtensionPublishInput } from '../extensions/owned-types.js'

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
  ArkmeCachedQueryResult,
  ArkmeCachedSnapshot,
  ArkmeContentBlock,
  ArkmeContentKind,
  ArkmeCreateTextResult,
  ArkmeGroupAvatarFallback,
  ArkmeGroupAvatarPresentation,
  ArkmeGroupAvatarSlot,
  ArkmeImageMediaType,
  ArkmeImagePayload,
  ArkmeLongArticleDetail,
  ArkmeLongArticleDraft,
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
  ArkmeTimelinePage,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
  ArkmeUploadedAsset,
  ArkmeWorldFeedItem,
  ArkmeWorldInteractionCreateResult,
  ArkmeWorldInteractionItem,
  ArkmeWorldInteractionPage,
  ArkmeWorldFeedPage,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
} from '../types.js'
export type { ArkmeMyExtensionItem, ArkmeMyExtensionPage, ArkmeMyExtensionPublishInput,
  ArkmeMyExtensionState, ArkmeMyExtensionWarning,
} from '../extensions/owned-types.js'
export type {
  ArkmeExtensionEnabledResult,
  ArkmeExtensionEnabledState,
  ArkmeExtensionIconMediaType,
  ArkmeExtensionIconResult,
  ArkmeExtensionPreviewGallery,
  ArkmeExtensionPreviewItem,
  ArkmeExtensionPreviewMediaType,
  ArkmeInstalledExtensionView,
} from '../extensions/types.js'
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

export interface ArkmeSubscribeOptions {
  intervalMs?: number
  immediate?: boolean
  onError?: (error: unknown) => void
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

  async authStatus(signal?: AbortSignal): Promise<ArkmeAuthSnapshot> {
    return await this.call<ArkmeAuthSnapshot>('auth.status', undefined, signal)
  }

  async profile(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<ArkmeUserProfileSnapshot> {
    return await this.call<ArkmeUserProfileSnapshot>(
      options.refresh === true ? 'user.profile.refresh' : 'user.profile',
      undefined,
      options.signal,
    )
  }

  /** List current-account Cordis, Profile-local and cloud-published extensions through one Host owner. */
  async myExtensions(options: { currentSessionId?: string; signal?: AbortSignal } = {}): Promise<ArkmeMyExtensionPage> {
    return await this.call<ArkmeMyExtensionPage>('extensions.mine.list', {
      ...(options.currentSessionId === undefined || options.currentSessionId.trim() === ''
        ? {}
        : { currentSessionId: options.currentSessionId.trim() }),
    }, options.signal)
  }

  /** Publish one exact live Cordis Package after the caller has obtained explicit current-user intent. */
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
    return this.call<ArkmeExtensionPublishResult>('extensions.mine.publish', {
      ownedRef: input.ownedRef,
      name: input.name,
      description: input.description,
      version: input.version,
      visibility: input.visibility,
      ...(input.changelog === undefined || input.changelog.trim() === '' ? {} : { changelog: input.changelog }),
      clientMutationId: input.clientMutationId,
    }, signal)
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

  async sendText(
    sourceRef: string,
    textContent: string,
    options: {
      recordUid?: string
      relationUid?: string
      agentAuthored?: boolean
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

  async search(query: string, options: ArkmeSearchOptions & { signal?: AbortSignal } = {}): Promise<ArkmeCachedQueryResult> {
    return await this.call<ArkmeCachedQueryResult>('records.search', {
      query,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.beforeMillis === undefined ? {} : { beforeMillis: options.beforeMillis }),
      ...(options.syncAll === undefined ? {} : { syncAll: options.syncAll }),
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
