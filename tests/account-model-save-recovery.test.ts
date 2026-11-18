import { expect, it } from 'vitest'
import type { AccountModelSave, AccountModelSettings } from '../src/account-models.js'
import { accountModelRetryParams, isAccountModelConflict } from '../src/client/account-model-save-recovery.js'

const model = { uid: 'a', route: 'user-api/a', version_route: 'user-api/a/v1', name: 'Own', execution: 'cloud' as const, protocol: 'openai-chat' as const, base_url: 'https://example.com/v1', model_key: 'own', key_configured: true, disabled: false, capabilities: { text: true, images: false, tools: true, json: true, stream: true, context_tokens: 16000, output_tokens: 4000 } }
const settings = (): AccountModelSettings => ({ accountScope: 'prod:11', revision: 1, enabled: true, models: [structuredClone(model)], connectors: [], scenes: [], preferences: { default_route: 'system-default', scenes: {}, points_fallback: false } })
const input = (): AccountModelSave => ({ ...structuredClone(model), expected_revision: 1, api_key: '', connector_id: '', host_provider: '' })

it('only retries definite configuration rejections, never ambiguous writes or HTTP status alone', () => {
  for (const code of ['model-settings-conflict', 'arkme-code-1201']) {
    expect(isAccountModelConflict({ body: { code } })).toBe(true)
    expect(isAccountModelConflict({ body: { code, writeOutcomeUnknown: true } })).toBe(false)
  }
  for (const error of [null, new Error('配置已更新'), { body: { code: 'arkme-timeout' } }, { status: 409 }]) expect(isAccountModelConflict(error)).toBe(false)
})

it('rebases an unchanged target after another model is added without changing limits, routes or credentials', () => {
  const before = settings(), after = settings()
  after.revision = 2
  after.models.push({ ...model, uid: 'b', route: 'user-api/b', version_route: 'user-api/b/v1' })
  const command = { input: { ...input(), api_key: 'fixture-only', capabilities: { ...model.capabilities, output_tokens: 3000 } } }
  expect(accountModelRetryParams('models.account.save', command, before, after)).toEqual({ input: { ...command.input, expected_revision: 2 } })
  expect(command.input.expected_revision).toBe(1)
  const preferences = { default_route: model.route, scenes: { dsh: 'system-default' }, points_fallback: false }
  expect(accountModelRetryParams('models.preferences.save', { revision: 1, preferences }, before, after)).toEqual({ revision: 2, preferences })
})

it.each(['credentials', 'disabled', 'removed', 'preferences', 'scene', 'account', 'disabled-service', 'stale-baseline'] as const)('does not rebase preferences after %s changes', kind => {
  const before = settings(), after = settings()
  after.revision = 2
  if (kind === 'credentials') after.models[0]!.version_route = 'user-api/a/v2'
  if (kind === 'disabled') after.models[0]!.disabled = true
  if (kind === 'removed') after.models = []
  if (kind === 'preferences') after.preferences.scenes.arko = 'managed-ai/new'
  if (kind === 'scene') after.scenes.push({ key: 'arko', name: 'Arko', group: 'arko', biz_code: 0, tools: true, images: false, json: false })
  if (kind === 'account') after.accountScope = 'prod:12'
  if (kind === 'disabled-service') after.enabled = false
  const params = { revision: kind === 'stale-baseline' ? 0 : 1, preferences: { ...before.preferences, default_route: model.route } }
  expect(accountModelRetryParams('models.preferences.save', params, before, after)).toBeUndefined()
})

it('never overwrites a concurrently edited model or a rotated credential', () => {
  const before = settings(), after = settings()
  after.revision = 2
  after.models[0]!.version_route = 'user-api/a/v2'
  expect(accountModelRetryParams('models.account.save', { input: input() }, before, after)).toBeUndefined()
  after.models = []
  expect(accountModelRetryParams('models.account.save', { input: input() }, before, after)).toBeUndefined()
})

it('does not retry against a changed local connector or enroll another connector automatically', () => {
  const before = settings(), after = settings()
  before.models[0]!.execution = after.models[0]!.execution = 'connector'
  before.models[0]!.connector_id = after.models[0]!.connector_id = 'host'
  before.connectors = [{ uid: 'host', name: 'Host', revoked: false }]
  after.connectors = [{ uid: 'host', name: 'Host', revoked: true }]
  after.revision = 2
  expect(accountModelRetryParams('models.account.save', { input: { ...input(), execution: 'connector', connector_id: 'host' } }, before, after)).toBeUndefined()
  expect(accountModelRetryParams('models.preferences.save', { revision: 1, preferences: { ...before.preferences, default_route: model.route } }, before, after)).toBeUndefined()
  expect(accountModelRetryParams('models.connector.enroll', {}, before, after)).toBeUndefined()
})
