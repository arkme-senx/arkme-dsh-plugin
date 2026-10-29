import type { TeamIdentity, TeamMessage } from './team-app-contract.js'
import type { ConversationActivityResult } from './conversation-activity.js'

export const TEAM_HISTORY_ACTIONS = ['query','dates','participants','analysis/create','analysis/state','analysis/result','analysis/words','analysis/sources','exports/create','exports/state','exports/cancel','exports/link'] as const
export type TeamHistoryAction = typeof TEAM_HISTORY_ACTIONS[number]
export interface TeamHistoryOptions {
  keyword?: string; personRef?: string; sender?: 'all'|'self'; personMode?: 'owner'|'mentioned'
  fromAt?: number; untilAt?: number; timezone?: string; mediaKind?: 'text'|'image'|'video'|'audio'|'file'
  cursor?: string; limit?: number; requestId?: string; resultRef?: string; sourceRef?: string
  analysisKind?: 'words'|'activity'; hour?: number; weekday?: number
}
export interface TeamHistoryWord { word: string; count: number; messageCount: number; sourceRef: string }
export interface TeamHistoryDay { date: string; count: number; message: TeamMessage }
export interface TeamHistoryResponse {
  state: 'index_preparing'|'preparing'|'ready'|'failed'|'cancelled'
  resultRef?: string; reason?: string; kind?: string; expiresAt?: number
  messages: TeamMessage[]; words: TeamHistoryWord[]; days: TeamHistoryDay[]; participants: TeamIdentity[]
  cursor?: string; hasMore: boolean; throughSeq?: number; headSeq?: number; indexing?: boolean
  processedThroughSeq?: number; messageCount?: number; totalInSnapshot?: number
  activity?: ConversationActivityResult; unknownTime?: number
  bytes?: number; sha256?: string; fileName?: string; downloadUrl?: string
}
export interface TeamHistoryExportChunk {
  chunkBase64: string; chunkSha256: string; bytes: number; sha256: string
  offset: number; cursor?: string; complete: boolean; fileName: string
}
export interface TeamHistoryPort {
  teamHistory(conversationRef: string, action: TeamHistoryAction, options?: TeamHistoryOptions, signal?: AbortSignal): Promise<TeamHistoryResponse>
  readTeamHistoryExportChunk(resultRef: string, cursor?: string, signal?: AbortSignal): Promise<TeamHistoryExportChunk>
}
