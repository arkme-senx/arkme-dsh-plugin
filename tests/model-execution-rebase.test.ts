import { expect, it } from 'vitest'
import { executionMetadata } from '../src/model-execution.js'
import { projectRecordingSummaryModelConfig } from '../src/recording-presentation.js'
import { arkoModelChoices, mergeModelChoices, modelAvailable, modelSceneBilling, recordingModelChoices } from '../src/model-directory.js'
import { exploreModelChoices } from '../src/explore-models.js'
import { catalogModelScenes, filterCatalogModels, officialCatalogModels } from '../src/client/model-catalog.js'

const route = 'user-api/019a4c10-0000-7000-8000-000000000001'

it('keeps account-model execution distinct from a published points offering', () => {
  const config = projectRecordingSummaryModelConfig({ allowed_route_options: [
    { route_key: route, provider: 'user-api', model_key: 'own', display_name: '自己的模型' },
    { route_key: 'dashscope/unpriced', provider: 'dashscope', model_key: 'unpriced' },
  ] })
  const [own, official] = recordingModelChoices(config, 'summary')
  expect(own).toMatchObject({ origin: 'user-provided' })
  expect(modelAvailable(own!, 'recording-summary')).toBe(true)
  expect(modelSceneBilling(own!, 'recording-summary')).toBe('provider-account')
  expect(modelAvailable(official!, 'recording-summary')).toBe(false)
  expect(executionMetadata({ provider: 'user-api', available: false, unavailable_reason: 'adapter_unavailable' }))
    .toMatchObject({ available: false, unavailableReason: 'adapter_unavailable' })
  expect(executionMetadata({ provider: 'dashscope', available: true }).available).toBe(false)
  expect(executionMetadata({ provider: 'user-api', available: 'true' }).available).toBe(false)
})

it('reconciles exact account routes while keeping scene authorization and billing separate', () => {
  const config = projectRecordingSummaryModelConfig({ allowed_route_options: [{ route_key: route, provider: 'user-api' }] })
  const recording = recordingModelChoices(config, 'summary')
  const arko = arkoModelChoices({ options: [{ routeKey: route, provider: 'user-api', displayName: '自己的模型' }] } as never)
  const explore = exploreModelChoices('goals', { ref: 'settings', sources: [], models: [
    { ref: 'sealed-goal-ref', routeKey: route, provider: 'user-api', label: '自己的模型', selected: true, available: true },
  ] })
  const models = mergeModelChoices(arko, recording, [{ id: 'account', origin: 'user-provided', name: '自己的模型', channel: '账号绑定 API', identifier: route,
    exploreRouteKey: route, dsh: { provider: 'arkme-user-api', model: route } }], explore)
  expect(models).toHaveLength(1)
  expect(modelAvailable(models[0]!, 'recording-summary')).toBe(true)
  expect(modelAvailable(models[0]!, 'recording-timeline')).toBe(false)
  expect(modelAvailable(models[0]!, 'explore-goal')).toBe(true)
  expect(modelSceneBilling(models[0]!, 'explore-goal')).toBe('provider-account')
  expect(models[0]?.dsh).toEqual({ provider: 'arkme-user-api', model: route })
})

it('never uses an account route or a similar official route to join different published offerings', () => {
  const base = { origin: 'official' as const, name: '同名模型', channel: '官方', identifier: 'shared' }
  const one = { ...base, id: '["published","1","11","shared"]', arko: route }
  const two = { ...base, id: '["published","1","12","shared"]', exploreRouteKey: route }
  expect(mergeModelChoices([one, two], [{ ...base, id: 'own', origin: 'user-provided', exploreRouteKey: route }])).toHaveLength(3)
})

it('shows only scene-owned applicability in the read-only catalog and keeps different offering prices apart', () => {
  const one = { id: 'offering-one', origin: 'official' as const, name: '同名模型', channel: '官方', identifier: 'shared',
    dsh: { provider: 'arkme-managed', model: 'shared' }, catalogRevision: '1', offeringRevision: '11',
    availabilityByScene: { 'recording-summary': { available: true }, 'explore-event': { available: true } },
    billingByScene: { 'explore-event': 'arkme-points' as const } }
  const two = { ...one, id: 'offering-two', offeringRevision: '12' }
  expect(officialCatalogModels([one, two])).toHaveLength(2)
  expect(catalogModelScenes(one)).toEqual(['dsh', 'recording-summary', 'explore-event'])
  expect(filterCatalogModels(officialCatalogModels([one]), 'recording', '')).toHaveLength(1)
  expect(filterCatalogModels(officialCatalogModels([one]), 'analysis', '')).toHaveLength(1)
  expect(modelSceneBilling(one, 'explore-event')).toBe('arkme-points')
  expect(modelAvailable(one, 'explore-event')).toBe(false)
})
