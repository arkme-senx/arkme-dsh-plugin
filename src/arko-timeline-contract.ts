import type { ArkmeArkoSession, ArkmeContentBlock, ArkmeSourceItem } from './types.js'
import type { ArkmeRecordThought } from './record-thought-contract.js'
import type { RecordOwnerId } from './record-owner-id.js'

export interface ArkoTimelineMessage {
  messageRef?: string; lifecycleVersion?: number; localMarkRef?: string
  id: string; messageId?: number; sessionId?: number
  role: 'user' | 'assistant' | 'divider'; text: string; contentBlocks?: ArkmeContentBlock[]
  reasoning?: string; status: 'sending' | 'done' | 'error'; createdAtMillis?: number; orderAtMillis?: number
  sourceType?: number; createdRecordUids?: string[]; assistantMsgId?: number; runUid?: string; runStatus?: string
  messageActionRef?: string; messageActionConversationRef?: string; copyLinkAvailable?: boolean; forwardAvailable?: boolean
}
export interface ArkmeArkoInteraction {
  interactionKey: string; interactionRef: string; occurredAtMillis: number
  sourceName: string; kind: 'self' | 'chat'; summary: string; suggestion: boolean
}
export interface ArkmeArkoInteractionQuery {
  cursor?: string; afterMillis?: number; beforeMillis?: number; limit?: number
  /** Select and verify up to 100 existing rows. */
  knownRefs?: string[]
  /** Conditional-read hints for a range page; never selectors or access grants. */
  observedRefs?: string[]
}
export interface ArkmeArkoInteractionPage {
  accountScope: string; items: ArkmeArkoInteraction[]; hasMore: boolean; nextCursor?: string; removedKeys: string[]
  /** Oldest physical candidate scanned, including rows denied by current access. */
  oldestScannedAtMillis?: number
}
export interface ArkmeArkoInteractionTarget {
  accountScope: string; source: ArkmeSourceItem; itemUid: string; occurredAtMillis: number; sourceAtMillis?: number; recordOwnerUserId: RecordOwnerId
  interactionKey: string; suggestion?: boolean; replyId?: string; thought?: ArkmeRecordThought
}
export interface ArkmeArkoTimelineCache {
  schemaVersion: 2; savedAtMillis: number; messages: ArkoTimelineMessage[]; interactions: ArkmeArkoInteraction[]
  session?: ArkmeArkoSession; historyCursor?: string; interactionCursor?: string
  /** Retained-window boundary. History cursors require this filter on every page. */
  historyBeforeMillis?: number
  /** First earlier interaction read after cache truncation; its cursor carries the filter. */
  interactionBeforeMillis?: number
  /** Lower bound of the retained physical window, independent of visible rows. */
  interactionStartMillis?: number
  viewport?: { scrollTop: number; followTail: boolean; anchorId?: string; anchorOffset?: number }
}
export interface ArkmeArkoTimelinePort {
  arkoInteractions(query?: ArkmeArkoInteractionQuery, signal?: AbortSignal): Promise<ArkmeArkoInteractionPage>
  arkoInteractionOpen(interactionRef: string, signal?: AbortSignal): Promise<ArkmeArkoInteractionTarget>
  arkoTimelineCache(expectedAccountScope: string, value?: ArkmeArkoTimelineCache): Promise<ArkmeArkoTimelineCache | undefined>
}
