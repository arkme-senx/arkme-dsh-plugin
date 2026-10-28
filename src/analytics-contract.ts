import type { StatisticsKeyword, StatisticsQuery } from './statistics-contract.js'
import type { ConversationWordsQuery, ConversationWordsState, ConversationWordParticipants, ConversationWordMessages } from './conversation-word-frequency.js'
import type { ConversationActivityState, ConversationActivityMessages } from './conversation-activity.js'
export type { StatisticsQuery, ConversationWordsQuery, ConversationWordsState, ConversationWordParticipants, ConversationWordMessages, ConversationActivityState, ConversationActivityMessages }
export interface PersonalKeywordSummary {
  keywords: StatisticsKeyword[] | null
  snapshotId: string | null
  algorithmVersion: string | null
  coverage: { complete: boolean; records: number; candidateLimit: number; returned: number } | null
}
export interface PersonalKeywordRecord {
  recordUid: string; title: string; textContent: string; sendAtMillis: number; occurrenceCount: number
}
export interface PersonalKeywordRecords { items: PersonalKeywordRecord[]; total: number; hasMore: boolean; nextCursor?: string }
export type PersonalKeywordRecordsQuery = StatisticsQuery & { snapshotId: string; keywordId: string; cursor?: string }
export type AnalyticsReadInput =
  | { kind: 'personal_keywords'; action: 'state'; query: StatisticsQuery }
  | { kind: 'personal_keywords'; action: 'messages'; query: PersonalKeywordRecordsQuery }
  | { kind: 'conversation_words' | 'conversation_activity'; action: 'state' | 'participants' | 'messages'; query: ConversationWordsQuery & { resultId?: string; wordKey?: string; hour?: number; weekday?: number | null; cursor?: string; search?: string } }
