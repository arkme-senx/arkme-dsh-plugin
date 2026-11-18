import type { ModelUsageCall, ModelUsageGroup, ModelUsageOperation, ModelUsagePage, ModelUsageTotals } from '../account-models.js'
import { ArkmePluginError } from './service-error.js'

const invalid = () => new ArkmePluginError('model-usage-invalid', '模型使用记录未完整返回，请刷新', true, 502)
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid()
  return value
}
function label(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.length > max) throw invalid()
  return value
}
function rows(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalid()
  return value
}
const totalFields = ['calls', 'failed_calls', 'unknown_calls', 'invalid_calls', 'input_known_calls', 'output_known_calls', 'cache_known_calls', 'input_tokens', 'output_tokens', 'cached_tokens', 'cache_creation_tokens'] as const
function totals(value: unknown): ModelUsageTotals {
  const data = record(value), result = Object.fromEntries(totalFields.map(key => [key, count(data[key])])) as unknown as ModelUsageTotals
  for (const key of ['failed_calls', 'unknown_calls', 'invalid_calls', 'input_known_calls', 'output_known_calls', 'cache_known_calls'] as const) if (result[key] > result.calls) throw invalid()
  return result
}
function group(value: unknown): ModelUsageGroup {
  const data = record(value)
  return { ...totals(data), key: label(data.key), ...(data.name === undefined ? {} : { name: label(data.name) }) }
}
function operation(value: unknown): ModelUsageOperation {
  const data = record(value), key = record(data.key), source = label(data.source)
  if (source !== 'user-api' && source !== 'host-local') throw invalid()
  return { ...totals(data), key: { operation: label(key.operation), scene: label(key.scene, 96), model: label(key.model) }, name: label(data.name), source, at: count(data.at), calls_cursor: label(data.calls_cursor, 8192) }
}
function call(value: unknown): ModelUsageCall {
  const data = record(value), status = count(data.call_status), usage = count(data.usage_status), mask = count(data.usage_field_mask), source = label(data.model_source)
  if (status < 1 || status > 4 || usage < 1 || usage > 4 || mask > 31 || (source !== 'user-api' && source !== 'host-local')) throw invalid()
  return { event_uid: label(data.event_uid, 128), operation_uid: label(data.operation_uid), created_at: count(data.created_at), model_display_name: label(data.model_display_name ?? ''), model_key: label(data.model_key), model_source: source, scene_key: label(data.scene_key, 96), call_status: status, usage_status: usage, usage_field_mask: mask, prompt_tokens: count(data.prompt_tokens), completion_tokens: count(data.completion_tokens), cached_tokens: count(data.cached_tokens), cache_creation_input_tokens: count(data.cache_creation_input_tokens), duration_ms: count(data.duration_ms), error_type: label(data.error_type, 128) }
}

// Preserve unknown counts/masks. No missing token field becomes a known zero,
// and no extra owner field (including diagnostics or credentials) crosses Host.
export function parseModelUsagePage(value: unknown, scope: string): ModelUsagePage {
  const data = record(value), grain = label(data.grain, 8)
  if (!['day', 'week', 'month'].includes(grain)) throw invalid()
  const retention = count(data.retention_days)
  if (retention < 1) throw invalid()
  return { accountScope: scope, start: label(data.start, 32), end: label(data.end, 32), grain, before: count(data.before), retention_days: retention, earliest_at: count(data.earliest_at), totals: totals(data.totals), timeline: rows(data.timeline, 400).map(group), scenes: rows(data.scenes, 128).map(group), models: rows(data.models, 5000).map(group), operations: rows(data.operations, 50).map(operation), calls: rows(data.calls, 50).map(call), ...(data.next_cursor === undefined ? {} : { next_cursor: label(data.next_cursor, 8192) }) }
}
