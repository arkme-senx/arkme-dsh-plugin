import type {
  ArkmeConversationMemberList, ArkmeConversationMemberRecordMode, ArkmeConversationMemberRecordPage,
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
  listSources(
    directory: ArkmeSourceDirectory,
    options?: { limit?: number; cursor?: string; signal?: AbortSignal },
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
    options?: { signal?: AbortSignal },
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
    messageModerationRef: string,
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
