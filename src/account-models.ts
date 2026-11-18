export interface AccountModelCapabilities { text: boolean; images: boolean; tools: boolean; json: boolean; stream: boolean; context_tokens: number; output_tokens: number }
export interface AccountModel {
  uid: string; route: string; version_route: string; name: string; disabled: boolean
  execution: 'cloud' | 'connector'; protocol: 'openai-chat' | 'openai-responses' | 'anthropic-messages'
  base_url: string; model_key: string; connector_id?: string; host_provider?: string; key_configured: boolean
  capabilities: AccountModelCapabilities
}
export interface AccountModelPreferences { default_route: string; scenes: Record<string, string>; points_fallback: false }
export interface AccountModelScene { key: string; name: string; group: string; biz_code: number; tools: boolean; images: boolean; json: boolean; stream?: boolean; min_output_tokens?: number; min_input_tokens?: number }
export interface AccountModelSettings {
  accountScope: string; revision: number; enabled: boolean; models: AccountModel[]; preferences: AccountModelPreferences
  connectors: { uid: string; name: string; revoked: boolean }[]; scenes: AccountModelScene[]
}
export interface AccountModelSave {
  uid: string; expected_revision: number; name: string; execution: AccountModel['execution']; protocol: AccountModel['protocol']
  base_url: string; model_key: string; connector_id: string; host_provider: string; capabilities: AccountModelCapabilities; api_key: string
}
export interface ModelUsageTotals {
  calls: number; failed_calls: number; unknown_calls: number; invalid_calls: number; input_known_calls: number; output_known_calls: number; cache_known_calls: number
  input_tokens: number; output_tokens: number; cached_tokens: number; cache_creation_tokens: number
}
export interface ModelUsageQuery { start?: string; end?: string; grain?: 'day' | 'week' | 'month'; source?: 'all' | 'user-api' | 'host-local'; model_uid?: string; scene?: string; mode?: 'statistics' | 'operations' | 'calls'; operation_uid?: string; cursor?: string; limit?: number }
export interface ModelUsageGroup extends ModelUsageTotals { key: string; name?: string }
export interface ModelUsageOperation extends ModelUsageTotals { calls_cursor: string; key: { operation: string; scene: string; model: string }; name: string; source: string; at: number }
export interface ModelUsageCall { event_uid: string; operation_uid: string; created_at: number; model_display_name: string; model_key: string; model_source: string; scene_key: string; call_status: number; usage_status: number; usage_field_mask: number; prompt_tokens: number; completion_tokens: number; cached_tokens: number; cache_creation_input_tokens: number; duration_ms: number; error_type: string }
export interface ModelUsagePage { accountScope: string; start: string; end: string; grain: string; before: number; retention_days: number; earliest_at: number; totals: ModelUsageTotals; timeline: ModelUsageGroup[]; scenes: ModelUsageGroup[]; models: ModelUsageGroup[]; operations: ModelUsageOperation[]; calls: ModelUsageCall[]; next_cursor?: string }
const dshModelRequirements = { tools: true, stream: true, images: false, json: false }

type ModelRequirements = Pick<AccountModelScene, 'tools' | 'stream' | 'images' | 'json' | 'min_output_tokens' | 'min_input_tokens'>
type ModelCapabilityView = Pick<AccountModel, 'capabilities'> & { disabled?: boolean }
const capabilityLabels = { text: '文本', tools: '工具调用', stream: '流式输出', images: '图片', json: 'JSON 输出' } as const

function requirements(scene: AccountModelScene): ModelRequirements {
  return scene.key === 'dsh' ? { ...scene, tools: true, stream: true } : scene
}

function missingRequirements(model: ModelCapabilityView, required: ModelRequirements): string[] {
  if (model.disabled) return ['模型已停用']
  const c = model.capabilities
  const missing: string[] = []
  for (const key of Object.keys(capabilityLabels) as (keyof typeof capabilityLabels)[]) {
    if ((key === 'text' || required[key]) && !c[key]) missing.push(`缺少${capabilityLabels[key]}`)
  }
  if (required.min_output_tokens && c.output_tokens < required.min_output_tokens) missing.push(`输出上限需至少 ${required.min_output_tokens} Token`)
  if (required.min_input_tokens && c.context_tokens - c.output_tokens < required.min_input_tokens) missing.push(`上下文上限减去输出上限需至少 ${required.min_input_tokens} Token`)
  return missing
}

export function accountModelSceneIssues(model: ModelCapabilityView, scene: AccountModelScene): string[] {
  return missingRequirements(model, requirements(scene))
}

export function accountModelSceneRequirements(scene: AccountModelScene): string {
  const required = requirements(scene)
  const labels: string[] = ['文本']
  for (const key of ['tools', 'stream', 'images', 'json'] as const) if (required[key]) labels.push(capabilityLabels[key])
  if (required.min_output_tokens) labels.push(`输出上限至少 ${required.min_output_tokens} Token`)
  if (required.min_input_tokens) labels.push(`上下文上限减去输出上限至少 ${required.min_input_tokens} Token`)
  return labels.join('、')
}

export function accountModelSupportsScene(model: ModelCapabilityView, scene: AccountModelScene): boolean {
  return accountModelSceneIssues(model, scene).length === 0
}

export function accountModelDshIssues(model: AccountModel): string[] {
  return missingRequirements(model, dshModelRequirements)
}
export function accountModelSupportsDsh(model: AccountModel): boolean {
  return accountModelDshIssues(model).length === 0
}
export function accountModelEffectiveRoute(settings: AccountModelSettings, scene: string): string { return settings.preferences.scenes[scene] || settings.preferences.default_route || 'system-default' }
