import type { ArkmeTimelineItem } from './types.js'
export type ExternalChatOperation = 'list' | 'mine' | 'share' | 'unshare' | 'page'
export interface ExternalChatShare { ref: string; key: string; teamRef: string; teamKey: string; sharerKey: string; sharerName: string; peerName: string; own: boolean }
export interface ExternalChatDirectory { items: ExternalChatShare[]; hasMore: boolean; nextCursor?: string }
export interface ExternalChatTimeline { items: ArkmeTimelineItem[]; hasMore: boolean; beforeSeq: number; mediaUrls: Record<string,string> }
export interface ExternalChatParameters {
  list: { teamRef: string; cursor?: string }
  mine: { sourceRef: string }
  share: { teamRef: string; sourceRef: string }
  unshare: { shareRef: string }
  page: { shareRef: string; beforeSeq?: number }
}
export interface ExternalChatResults {
  list: ExternalChatDirectory
  mine: ExternalChatDirectory
  share: ExternalChatDirectory
  unshare: null
  page: ExternalChatTimeline
}
