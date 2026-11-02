import type { LocationRecord } from './location-search.js'

/** A page of authorized messages, independent of the visible conversation scroll. */
export interface ConversationLocationQuery { sourceRef: string; cursor?: string }
export interface ConversationLocationPage {
  items: ConversationLocationRecord[]
  scanned: number
  hasMore: boolean
  nextCursor?: string
}
export interface ConversationLocationRecord extends LocationRecord {
  locationKind: 'snapshot' | 'message'
}
