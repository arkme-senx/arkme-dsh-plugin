import type { WorldPublishOrigin, WorldPublishSourceDraft } from './world-publish-source.js'

export interface WorldSuggestion {
  key: string
  ref: string
  title: string
  preview: string
  reason: string
  occurredAtMillis: number
}
export interface WorldSuggestionJob {
  ref: string
  requestId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  phase: string
  scanned: number
  processed: number
  matched: number
  failure?: string
  modelName: string
  createdAtMillis: number
}
export interface WorldSuggestionsState {
  supported: boolean
  candidateCount: number
  items: WorldSuggestion[]
  job?: WorldSuggestionJob
  unavailableCount: number
}
export interface WorldSuggestionModel { route: string; name: string; source: 'official' | 'account' }
export interface WorldSuggestionPrepared { origin: WorldPublishOrigin; draft: WorldPublishSourceDraft }
export type WorldSuggestionsRequest = { accountKey: string } & (
  | { action: 'capabilities' }
  | { action: 'state'; includeItems?: boolean }
  | { action: 'models' }
  | { action: 'create'; requestId: string; days: 7 | 30 | 90 | 365; modelRoute?: string; confirmed: true }
  | { action: 'cancel'; jobRef: string; confirmed: true }
  | { action: 'hide'; ref: string; confirmed: true }
  | { action: 'prepare'; ref: string }
)
export type WorldSuggestionsResponse<R extends WorldSuggestionsRequest> =
  R extends { action: 'capabilities' } ? { version: 1; supported: boolean } :
  R extends { action: 'state' } ? WorldSuggestionsState :
  R extends { action: 'models' } ? { items: WorldSuggestionModel[] } :
  R extends { action: 'create' } ? WorldSuggestionJob :
  R extends { action: 'prepare' } ? WorldSuggestionPrepared : { completed: true }
