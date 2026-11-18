// Shared by settings navigation, execution labels and the host write boundary.
export const arrangementRecognitionSourceNames = {
  default: '默认模型',
  note: '个人快记',
  private: '私聊',
  group: '群聊',
  audio: '录音',
  call: '通话',
  manual: '手动创建',
  other: '其他来源',
  team: '团队对话',
} as const

export type ArrangementRecognitionSource = keyof typeof arrangementRecognitionSourceNames

export function isArrangementRecognitionSource(value: unknown): value is ArrangementRecognitionSource {
  return typeof value === 'string' && Object.hasOwn(arrangementRecognitionSourceNames, value)
}
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
