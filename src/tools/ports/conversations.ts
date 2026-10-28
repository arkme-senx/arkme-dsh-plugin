import type {
  ArkmeConversationMemberPresentation, ArkmeConversationMemberPage, ArkmeConversationMemberCache, ArkmeConversationMemberList, ArkmeConversationMemberRecordMode, ArkmeConversationMemberRecordPage,
  ArkmeDirectTextSendResult, ArkmeGroupAiPolishMutationResult, ArkmeGroupAiPolishRuleCandidate,
  ArkmeMessageCopyLinkExtendResult,
  ArkmeGroupAiPolishSnapshot, ArkmeMessageReportResult, ArkmeSourceDirectory, ArkmeSourceList, ArkmeSourceReadResult, ArkmeSourceSendResult,
  ArkmeMessageWithdrawalResult,
  ArkmeMessageReadReceiptDetail, ArkmeMessageReadReceiptQueryItem, ArkmeMessageReadReceiptSummaryList,
  ArkmeRelatedRecordingPage, ArkmeRelatedRecordingPageOptions, ArkmeTimelineCursor, ArkmeTimelinePage,
  ArkmeFavoriteStickerAddInput, ArkmeFavoriteStickerList,
  ArkmeFavoriteStickerManageAction,
} from '../../types.js'

export interface ArkmeConversationToolPort {
  personRecordsPage(sourceRef: string, memberRef: string, options?: { cursor?: string; limit?: number; knownEventRefs?: readonly string[]; validateOnly?: boolean; signal?: AbortSignal }): Promise<import('../../person-records.js').PersonRecordsPage>
  sourceUnderlineCapabilities(sourceRef: string, signal?: AbortSignal): Promise<import('../../message-annotations.js').MessageUnderlineCapabilities>
  sourceUnderlines(sourceRef: string, actionRefs: readonly string[], signal?: AbortSignal): Promise<{ actionRef: string; snapshot: import('../../message-annotations.js').MessageUnderlineSnapshot }[]>
  changeSourceUnderline(sourceRef: string, actionRef: string, change: import('../../message-annotations.js').MessageUnderlineChange, signal?: AbortSignal): Promise<import('../../message-annotations.js').MessageUnderlineSnapshot>
  captureSourceMessageAnchor(sourceRef: string, actionRef: string, start: number, end: number): Promise<import('../../message-quote.js').ArkmeMessageQuote>
  extendSourceMessage(sourceRef: string, actionRef: string, text: string, recordUid: string, fileRefs?: readonly string[], options?: { relationUid?: string; quote?: import('../../message-quote.js').ArkmeMessageQuote; signal?: AbortSignal }): Promise<import('../../types.js').ArkmeSourceMessageExtendResult>

  analyticsRead(input: import('../../analytics-contract.js').AnalyticsReadInput, signal?: AbortSignal): Promise<unknown>
  conversationWordsCreate(input: import('../../conversation-word-frequency.js').ConversationWordsQuery & { requestId: string }, signal?: AbortSignal): Promise<import('../../conversation-word-frequency.js').ConversationWordsState>
  nativeAnnotations(request: import('../../native-annotations.js').NativeAnnotationRequest, signal?: AbortSignal): Promise<unknown>
  messageSyncStatus(signal?: AbortSignal): Promise<import('../../chat-message-sync.js').ArkmeMessageSyncProgress>
  retryMessageSync(signal?: AbortSignal): Promise<import('../../chat-message-sync.js').ArkmeMessageSyncProgress>
  sharedRecordingDetail(detailRef: string, options?: { signal?: AbortSignal }): Promise<import('../../types.js').ArkmeSharedRecordingPreview>
  reactions(input: import('../../reaction-contract.js').ReactionRequest, signal?: AbortSignal): Promise<unknown>
  privateInteractionSummary(sourceRef: string, options?: Pick<import('../../types.js').ArkmePrivateInteractionQueryOptions, 'expectedVersion' | 'signal'>): Promise<import('../../types.js').ArkmePrivateInteractionSummary>
  queryPrivateInteractions(options?: import('../../types.js').ArkmePrivateInteractionQueryOptions): Promise<import('../../types.js').ArkmePrivateInteractionPage>

  setBotDirectoryPin(botRef: string, pinned: boolean): Promise<void>
  cachedSourceMembers(sourceRef: string, signal?: AbortSignal): Promise<ArkmeConversationMemberCache | undefined>
  pageSourceMembers(sourceRef: string, options?: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<ArkmeConversationMemberPage>
  sourceMembersPresentation(sourceRef: string, memberRefs: readonly string[], options?: { signal?: AbortSignal }): Promise<ArkmeConversationMemberPresentation>
  topicHomeVisibility(sourceRef: string, showInHome?: boolean): Promise<{ showInHome: boolean }>
  listSources(
    directory: ArkmeSourceDirectory,
    options?: { limit?: number; cursor?: string; signal?: AbortSignal; localFirst?: boolean },
  ): Promise<ArkmeSourceList>
  readSource(
    sourceRef: string,
    options?: { limit?: number; cursor?: ArkmeTimelineCursor; signal?: AbortSignal },
  ): Promise<ArkmeTimelinePage>
  messageReadReceiptSummaries(
    sourceRef: string,
    items: readonly ArkmeMessageReadReceiptQueryItem[],
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeMessageReadReceiptSummaryList>
  messageReadReceiptDetail(
    sourceRef: string,
    itemUid: string,
    sequence: number,
    options?: { signal?: AbortSignal; basicOnly?: boolean },
  ): Promise<ArkmeMessageReadReceiptDetail>
  markSourceRead(
    sourceRef: string,
    readSequence: number,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeSourceReadResult>
  listSourceMembers(sourceRef: string, options?: { activeOnly?: boolean; signal?: AbortSignal }): Promise<ArkmeConversationMemberList>
  sourceMemberRecords(
    sourceRef: string,
    memberRef: string,
    mode: ArkmeConversationMemberRecordMode,
    options?: { limit?: number; beforeSequence?: number; signal?: AbortSignal },
  ): Promise<ArkmeConversationMemberRecordPage>
  relatedRecordings(
    sourceRef: string,
    options?: ArkmeRelatedRecordingPageOptions,
  ): Promise<ArkmeRelatedRecordingPage>
  recordRelatedRecordingsToolEvent?(event: {
    result: 'success' | 'error'
    durationMs: number
    itemCount?: number
    cursorPresent?: boolean
    transcriptRequested?: boolean
    transcriptTruncated?: boolean
  }): void
  sendSourceText(
    sourceRef: string,
    textContent: string,
    options?: {
      recordUid?: string
      relationUid?: string
      botRefs?: readonly string[]
      signal?: AbortSignal
      agentAuthored?: boolean
    },
  ): Promise<ArkmeSourceSendResult>
  extendMessageCopyLink(
    sid: string,
    itemIndex: number,
    textContent: string,
    recordUid: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeMessageCopyLinkExtendResult>
  favoriteStickers(signal?: AbortSignal): Promise<ArkmeFavoriteStickerList>
  addFavoriteSticker(item: ArkmeFavoriteStickerAddInput, signal?: AbortSignal): Promise<ArkmeFavoriteStickerList>
  sendFavoriteSticker(
    sourceRef: string,
    fileAssetUid: string,
    options?: { recordUid?: string; relationUid?: string; signal?: AbortSignal },
  ): Promise<ArkmeSourceSendResult>
  manageFavoriteSticker(
    fileAssetUid: string,
    action: ArkmeFavoriteStickerManageAction,
    signal?: AbortSignal,
  ): Promise<ArkmeFavoriteStickerList>
  sendDirectText(
    recipientArkmeId: string,
    textContent: string,
    options?: {
      recordUid?: string
      relationUid?: string
      sendAtMillis?: number
      signal?: AbortSignal
    },
  ): Promise<ArkmeDirectTextSendResult>
  /** Report one concrete group-chat message selected from readSource output. */
  reportMessage(
    messageRef: string,
    reportType: 1 | 2 | 3 | 4,
    options?: { reason?: string; requestUid?: string; signal?: AbortSignal },
  ): Promise<ArkmeMessageReportResult>
  /** Withdraw one other member's group message after an explicit owner request. */
  withdrawGroupMessage(
    messageWithdrawalRef: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeMessageWithdrawalResult>
  inspectGroupAiPolishByName(
    groupName: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupAiPolishSnapshot>
  generateGroupAiPolishRule(
    groupName: string,
    requirement: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupAiPolishRuleCandidate>
  prepareEnableGroupAiPolish(
    groupName: string,
    ruleName?: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupAiPolishRuleCandidate>
  confirmEnableGroupAiPolish(
    confirmationRef: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupAiPolishMutationResult>
  prepareDisableGroupAiPolish(
    groupName: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupAiPolishRuleCandidate>
  confirmDisableGroupAiPolish(
    confirmationRef: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupAiPolishMutationResult>
}
