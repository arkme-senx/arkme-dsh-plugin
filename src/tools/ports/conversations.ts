import type {
  ArkmeConversationMemberList, ArkmeConversationMemberRecordMode, ArkmeConversationMemberRecordPage,
  ArkmeDirectTextSendResult, ArkmeGroupAiPolishMutationResult, ArkmeGroupAiPolishRuleCandidate,
  ArkmeGroupAiPolishSnapshot, ArkmeMessageReportResult, ArkmeSourceDirectory, ArkmeSourceList, ArkmeSourceSendResult,
  ArkmeRelatedRecordingPage, ArkmeRelatedRecordingPageOptions, ArkmeTimelineCursor, ArkmeTimelinePage,
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
  inspectGroupAiPolishByName(
    groupName: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArkmeGroupAiPolishSnapshot>
  generateGroupAiPolishRule(
    groupName: string,
    requirement: string,
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
