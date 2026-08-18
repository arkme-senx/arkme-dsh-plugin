import type {
  ArkmeWechatCallFilter, ArkmeWechatCommonGroupPage, ArkmeWechatConversationDetail,
  ArkmeWechatConversationPage, ArkmeWechatGroupMemberPage, ArkmeWechatLocationPage,
  ArkmeWechatMessageFilter, ArkmeWechatMessagePage, ArkmeWechatMoneyFlowPage, ArkmeWechatPhonePage,
} from '../../types.js'

export interface ArkmeWechatToolPort {
  listWechatConversations(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeWechatConversationPage>
  readWechatMessages(conversationRef: string, options?: {
    limit?: number; cursor?: string; messageType?: ArkmeWechatMessageFilter; callType?: ArkmeWechatCallFilter; signal?: AbortSignal
  }): Promise<ArkmeWechatMessagePage>
  getWechatConversationDetail(conversationRef: string, options?: { signal?: AbortSignal }): Promise<ArkmeWechatConversationDetail>
  listWechatGroupMembers(conversationRef: string, options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeWechatGroupMemberPage>
  listWechatPhones(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeWechatPhonePage>
  listWechatCommonGroups(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeWechatCommonGroupPage>
  listWechatMoneyFlows(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeWechatMoneyFlowPage>
  listWechatLocations(options?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<ArkmeWechatLocationPage>
}
