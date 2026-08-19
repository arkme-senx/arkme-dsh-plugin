import type {
  ArkmeDirectTextSendResult, ArkmeGroupAiPolishMutationResult, ArkmeGroupAiPolishRuleCandidate,
  ArkmeGroupAiPolishSnapshot, ArkmeSourceDirectory, ArkmeSourceList, ArkmeSourceSendResult,
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
    options?: { recordUid?: string; relationUid?: string },
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
