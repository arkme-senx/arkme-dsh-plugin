import type {
  ArkmeWorldFeedPage,
  ArkmeWorldPublishResult,
  ArkmeWorldRecordList,
  ArkmeWorldVoiceprintInviteResult,
} from '../../types.js'

export interface ArkmeWorldToolPort {
  listWorldRecords(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldRecordList>
  listWorldFeed(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldFeedPage>
  listMyWorldFeed(options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldFeedPage>
  listUserWorldFeed(userId: number, options?: { limit?: number; offset?: number; signal?: AbortSignal }): Promise<ArkmeWorldFeedPage>
  inviteWorldVoiceprint(recordRef: string, signal?: AbortSignal): Promise<ArkmeWorldVoiceprintInviteResult>
  publishWorldTextForConversation(recordUid: string, textContent: string, signal?: AbortSignal): Promise<ArkmeWorldPublishResult>
}
