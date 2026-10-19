import type { ArkmeArkoHistoryItem } from './types.js'

/** Opaque cursors and message references are account/Profile scoped and expiring. */
export interface ArkmeArkoHistoryQuery {
  cursor?: string
  limit?: number
  direction?: 'asc' | 'desc'
  role?: 'user' | 'assistant'
  startAtMillis?: number
  endAtMillis?: number
}
export interface ArkmeArkoSearchQuery extends ArkmeArkoHistoryQuery { keyword: string }
export interface ArkmeArkoMessagePage {
  beforeCursor?: string
  afterCursor?: string
  items: ArkmeArkoHistoryItem[]
  hasMore: boolean
  nextCursor?: string
  scanned: number
  consistency: 'live'
}
export interface ArkmeArkoSearchMatch {
  messageRef: string
  role: 'user' | 'assistant'
  snippet: string
  createdAtMillis: number
  orderAtMillis: number
  status: number
}
export interface ArkmeArkoSearchPage {
  items: ArkmeArkoSearchMatch[]
  hasMore: boolean
  nextCursor?: string
  scanned: number
  consistency: 'live'
}
export interface ArkmeArkoContextQuery { messageRef: string; before?: number; after?: number }
export interface ArkmeArkoContextWindow {
  items: ArkmeArkoHistoryItem[]
  anchorMessageRef: string
  beforeCursor?: string
  afterCursor?: string
  hasBefore: boolean
  hasAfter: boolean
}
export interface ArkmeArkoExport {
  fileRef: string
  fileName: string
  size: number
  count: number
  expiresAtMillis: number
}
export interface ArkmeArkoHistoryPort {
  arkoMessages(query?: ArkmeArkoHistoryQuery, signal?: AbortSignal): Promise<ArkmeArkoMessagePage>
  arkoSearch(query: ArkmeArkoSearchQuery, signal?: AbortSignal): Promise<ArkmeArkoSearchPage>
  arkoContext(query: ArkmeArkoContextQuery, signal?: AbortSignal): Promise<ArkmeArkoContextWindow>
  arkoExport(signal?: AbortSignal): Promise<ArkmeArkoExport>
}
