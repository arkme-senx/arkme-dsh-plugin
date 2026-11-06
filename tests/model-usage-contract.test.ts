import { expect, it } from 'vitest'
import { parseModelUsagePage } from '../src/services/model-usage-contract.js'
const totals = { calls: 1, failed_calls: 0, unknown_calls: 1, invalid_calls: 0, input_known_calls: 0, output_known_calls: 0, cache_known_calls: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, cache_creation_tokens: 0 }
const value = () => ({ start: '2026-11-01', end: '2026-11-06', grain: 'day', before: 1793865600000, earliest_at: 1770000000000, retention_days: 180, totals, timeline: [], scenes: [], models: [], operations: [], calls: [], api_key: 'must-not-cross-host' })
it('preserves unknown observations and whitelists the account-scoped projection', () => {
  const result = parseModelUsagePage(value(), 'test:42')
  expect(result.totals.input_known_calls).toBe(0); expect(result.totals.unknown_calls).toBe(1)
  expect(result.accountScope).toBe('test:42'); expect(JSON.stringify(result)).not.toContain('must-not-cross-host')
})
it('rejects missing, negative, unsafe and inconsistent numeric facts', () => {
  for (const patch of [{ calls: -1 }, { calls: Number.MAX_SAFE_INTEGER + 1 }, { calls: undefined }, { input_known_calls: 2 }]) expect(() => parseModelUsagePage({ ...value(), totals: { ...totals, ...patch } }, 'test:42')).toThrow()
  expect(() => parseModelUsagePage({ ...value(), operations: null }, 'test:42')).toThrow()
})

it('accepts a standalone Host call with unavailable usage and no optional display name', () => {
  const call = { event_uid: 'observation', operation_uid: '', created_at: 1793865600000, model_key: 'host-model', model_source: 'host-local', scene_key: 'dsh', call_status: 1, usage_status: 1, usage_field_mask: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, cache_creation_input_tokens: 0, duration_ms: 5, error_type: '', api_key: 'private' }
  const result = parseModelUsagePage({ ...value(), calls: [call] }, 'test:42')
  expect(result.calls[0]).toMatchObject({ operation_uid: '', model_display_name: '', usage_status: 1, usage_field_mask: 0 })
  expect(JSON.stringify(result)).not.toContain('private')
  for (const patch of [{ prompt_tokens: undefined }, { prompt_tokens: 0.2 }, { usage_field_mask: 32 }, { call_status: 0 }]) expect(() => parseModelUsagePage({ ...value(), calls: [{ ...call, ...patch }] }, 'test:42')).toThrow()
})
