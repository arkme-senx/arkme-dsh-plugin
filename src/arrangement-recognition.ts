export type ArrangementRecognitionSource =
  | 'default'
  | 'note'
  | 'private'
  | 'group'
  | 'audio'
  | 'call'
  | 'manual'
  | 'other'
export interface ArrangementRecognitionSettings {
  accountScope: string
  contract_version: 1
  policy_version: string
  revision: string
  models: { route_key: string; provider: string; model_key: string; display_name: string }[]
  sources: {
    source: ArrangementRecognitionSource
    label: string
    personal_route_key: string
    effective_route_key: string
    inherited: boolean
    fallback_reason?: string
    prompts: { name: string; template: string; hash: string }[]
    rules: string[]
    pipeline: string[]
  }[]
}
export interface ArrangementRecognitionTrace {
  match_trace_ids?: string[]
  occurrence_decision?: { state: string; reason: string }
  finish_reason?: string
  actual_model?: string
  provider_request_uid?: string
  prompt_tokens: number
  completion_tokens: number
  events?: { rule: string; before: string; after: string }[]
  inputs?: {
    original_runes: number
    candidate_runes: number
    prompt_runes: number
    limit: number
  }[]
  id: string
  source: string
  started_at: number
  finished_at?: number
  status: string
  route_key: string
  requested_route_key?: string
  provider: string
  model_key: string
  display_name: string
  settings_revision: string
  policy_version: string
  prompt_hash: string
  prompt?: string
  raw_output?: string
  max_tokens: number
  rules: string[]
  pipeline: string[]
  outcomes?: { uid?: string; title: string; description: string; due_at: number }[]
  redacted?: boolean
  purpose: string
  expected_version?: number
}
export interface ArrangementRecognitionInspection {
  accountScope: string
  state: 'ready' | 'not-recorded' | 'preview' | 'applied' | 'conflict' | 'unavailable'
  reason?: string
  trace?: ArrangementRecognitionTrace
  item?: import('./types.js').ArkmeArrangementItem
}
