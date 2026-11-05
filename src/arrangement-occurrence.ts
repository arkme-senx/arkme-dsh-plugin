import type { ArkmeArrangementItem } from './types.js'
import type { ArrangementRecognitionTrace } from './arrangement-recognition.js'
export interface ArrangementOccurrenceEvent {
  id: string
  trace_id?: string
  recognized_at?: number
  attached_at: number
  source: string
  evidence_ids: string[]
  reason: string
  disposition: string
}
export interface ArrangementOccurrenceComparison {
  arrangementRef?: string
  relation: string
  confidence: number
  same_event: boolean
  same_people: boolean
  same_occurrence: boolean
  time_conflict: boolean
  place_conflict: boolean
  reason: string
}
export interface ArrangementOccurrenceReview {
  id: string
  state: string
  kind: string
  created_at: number
  recognized_at?: number
  source: string
  reason: string
  model?: string
  match_trace_id?: string
  candidate: { title: string; description: string; due_at: number }
  peers: (ArkmeArrangementItem & { version: number })[]
  comparisons: ArrangementOccurrenceComparison[]
}
export interface ArrangementOccurrenceResponse {
  accountScope: string
  state: 'ready' | 'preview' | 'applied' | 'conflict' | 'unavailable'
  count?: number
  reason?: string
  events?: ArrangementOccurrenceEvent[]
  items?: ArrangementOccurrenceReview[]
  review?: ArrangementOccurrenceReview
  item?: ArkmeArrangementItem
  trace?: ArrangementRecognitionTrace
}
export const ARRANGEMENT_OCCURRENCE_ACTIONS = {
  'arrangements.occurrences.events': 'events',
  'arrangements.occurrences.reviews.summary': 'reviews/summary',
  'arrangements.occurrences.reviews.list': 'reviews/list',
  'arrangements.occurrences.reviews.decide': 'reviews/decide',
  'arrangements.occurrences.history.preview': 'history/preview',
  'arrangements.occurrences.history.apply': 'history/apply',
} as const

export type ArrangementOccurrenceAction =
  (typeof ARRANGEMENT_OCCURRENCE_ACTIONS)[keyof typeof ARRANGEMENT_OCCURRENCE_ACTIONS]
export interface ArrangementOccurrenceInput {
  arrangementRef?: string
  reviewId?: string
  action?: 'merge' | 'create' | 'ignore'
  targetRef?: string
  targetVersion?: number
  selectedRefs?: string[]
  expectedRouteKey?: string
}
