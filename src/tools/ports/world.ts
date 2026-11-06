import type {
  ArkmeOpenPrivateChatResult,
  ArkmeWorldFeedPage,
  ArkmeWorldFeedItem,
  ArkmeWorldPublishResult,
  ArkmeWorldRecordList,
  ArkmeWorldVoiceprintInviteResult,
  ArkmeWorldVoiceprintSocialContext,
} from '../../types.js'

export interface ArkmeWorldToolPort {
 worldReport(input: import("../../world-report-contract.js").WorldReportRequest, signal?:AbortSignal):Promise<import("../../world-report-contract.js").WorldReportResult>
  worldSuggestions(input: import('../../world-suggestions-contract.js').WorldSuggestionsRequest, signal?: AbortSignal): Promise<unknown>
  worldSoundExcerpts(input:import('../../world-sound-contract.js').WorldSoundRequest,signal?:AbortSignal):Promise<unknown>
  worldCommentNotifications(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<import('../../types.js').ArkmeWorldCommentNotificationPage>
  createWorldTextInteraction(input: { targetRef: string; textContent: string; clientMutationId: string; signal?: AbortSignal }): Promise<import('../../types.js').ArkmeWorldInteractionCreateResult>
  listWorldReplies(recordRef: string, options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<import('../../types.js').ArkmeWorldRepliesPage>
  teamWorld(input: import('../../team-world-contract.js').TeamWorldRequest, signal?: AbortSignal): Promise<unknown>
  prepareNoteWorldReactions(accountKey: string, sourceRef: string, messageActionRef: string, signal?: AbortSignal): Promise<import('../../world-reaction-contract.js').WorldReactionContextPage>
  worldReactionVersions(input: import('../../world-reaction-contract.js').WorldReactionVersionsRequest, signal?: AbortSignal): Promise<import('../../world-reaction-contract.js').WorldReactionVersionsPage>
  prepareWorldReactions(accountKey: string, recordRefs: readonly string[], signal?: AbortSignal): Promise<import('../../world-reaction-contract.js').WorldReactionContextPage>
  worldReactions(input: import('../../world-reaction-contract.js').WorldReactionRequest, signal?: AbortSignal): Promise<unknown>
  worldReactionArchive(input: import('../../world-reaction-contract.js').WorldReactionArchiveRequest, signal?: AbortSignal): Promise<unknown>
  readWorldRecord(recordRef: string, signal?: AbortSignal): Promise<ArkmeWorldFeedItem>
  listWorldRecords(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldRecordList>
  listWorldFeed(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeWorldFeedPage>
  listMyWorldFeed(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldFeedPage>
  listUserWorldFeed(userId: number, options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldFeedPage>
  openPrivateChatFromWorldAuthor(authorRef: string, signal?: AbortSignal): Promise<ArkmeOpenPrivateChatResult>
  inviteWorldVoiceprint(recordRef: string, signal?: AbortSignal): Promise<ArkmeWorldVoiceprintInviteResult>
  worldVoiceprintSocialContext(
    recordRef: string,
    options?: { forceRefresh?: boolean; signal?: AbortSignal },
  ): Promise<ArkmeWorldVoiceprintSocialContext>
  publishWorldTextForConversation(recordUid: string, textContent: string, signal?: AbortSignal): Promise<ArkmeWorldPublishResult>
}
