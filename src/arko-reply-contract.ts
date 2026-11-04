import type { ArkmeSourceItem, ArkmeTimelineItem } from './types.js'
import type { ArkmeRecordThought } from './record-thought-contract.js'
export const configurableReplyScenes = ['record_auto', 'record_mention', 'direct_receive', 'direct_sent', 'direct_mention', 'group_mention', 'group_auto'] as const
export type ConfigurableReplyScene = typeof configurableReplyScenes[number]
export interface ArkoReplyPromptView {
  scene: ConfigurableReplyScene
  title: string
  officialBody: string
  officialRevision: string
  revision: number
  userBody: string | null
  effectiveBody: string
  protectedInstructions: string
  maxBodyRunes: number
}
export interface ArkoReplyPromptBook { accountScope: string; items: ArkoReplyPromptView[] }
export interface ArkoReplyPromptWrite {
  scene: ConfigurableReplyScene
  expectedRevision: number
  baseOfficialRevision: string
  body?: string
}
export interface ArkoReplyPromptResult { accountScope: string; conflict: boolean; current: ArkoReplyPromptView }
export type ArkoReplyHistoryItem = Pick<ArkmeTimelineItem, 'itemUid' | 'sendAtMillis' | 'isMe' | 'recordVersion' | 'version' | 'messageActionRef' | 'timelineItemKey' | 'recordOwnerUserId'>
export interface ArkoReplyHistoryEntry { sourceOrderAtMillis: number; key: string; scene: ConfigurableReplyScene; resultKind: 'root' | 'continuation'; source: ArkmeSourceItem; item: ArkoReplyHistoryItem; thought: ArkmeRecordThought }
export interface ArkoReplyHistoryQuery { scene?: ConfigurableReplyScene | 'all'; cursor?: string; limit?: number }
export interface ArkoReplyHistoryPage { accountScope: string; items: ArkoReplyHistoryEntry[]; nextCursor?: string }
export interface ArkoReplyManagementPort {
  arkoReplyPrompts(expectedScope?: string, signal?: AbortSignal): Promise<ArkoReplyPromptBook>
  saveArkoReplyPrompt(input: ArkoReplyPromptWrite, expectedScope: string, signal?: AbortSignal): Promise<ArkoReplyPromptResult>
  resetArkoReplyPrompt(input: ArkoReplyPromptWrite, expectedScope: string, signal?: AbortSignal): Promise<ArkoReplyPromptResult>
  arkoRepliesPage(query: ArkoReplyHistoryQuery, expectedScope?: string, signal?: AbortSignal): Promise<ArkoReplyHistoryPage>
}
