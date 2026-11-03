import { describe, it, expect, vi } from 'vitest'
import { ModelDirectoryService } from '../../src/services/model-directory-service.js'
import { mergeModelChoices, dshModelChoices, arkoModelChoices, modelSceneBilling } from '../../src/model-directory.js'
import { exploreModelChoices } from '../../src/explore-models.js'
function fixture() {
  const session = { userId: 42 }
  const runtime = { config: { environment: 'production' }, requireSession: async () => session }
  const dsh = vi.fn(async () => ({ items: [{ provider: 'arkme-managed', providerName: 'Arkme', model: 'version-a', displayName: 'DeepSeek', description: '输入 1 积分' },
    { provider: 'deepseek', providerName: 'DeepSeek', model: 'version-a', displayName: 'DeepSeek', description: '响应快' }], failedProviders: [], truncated: false }))
  const arko = vi.fn(async () => ({ defaultRouteKey: 'managed-ai/alias', effectiveRouteKey: 'managed-ai/alias', selectionSource: 'default' as const, options: [{ routeKey: 'managed-ai/alias', displayName: 'DeepSeek', provider: 'managed-ai', description: '', recommended: true, selected: true }] }))
  const recording = vi.fn(async () => ({ defaultRouteKey: 'dashscope/qwen', effectiveRouteKey: 'dashscope/qwen', options: [{ routeKey: 'dashscope/qwen', modelKey: 'qwen', displayName: 'Qwen', provider: 'dashscope' }] }))
  return { session, runtime, dsh, arko, recording, service: new ModelDirectoryService(runtime as never, { dsh, arko, recording }) }
}
describe('unified read-only model directory', () => {
  it('includes all source identities without guessing aliases, exact versions, pricing or cross-scene routes', async () => {
    const { service } = fixture(); const value = await service.read('production:42')
    expect(value.models).toHaveLength(4)
    expect(new Set(value.models.map(m => m.id)).size).toBe(4)
    expect(value.models.filter(m => m.dsh)).toHaveLength(2)
    expect(value.models.find(m => m.arko)?.dsh).toBeUndefined()
    expect(value.models.every(m => m.version === undefined)).toBe(true)
    expect(value.models.find(m => m.dsh?.provider === 'deepseek')?.pricing).toBeUndefined()
    expect(value.models.find(m => m.dsh?.provider === 'arkme-managed')?.pricing).toContain('积分')
  })
  it('preserves working sources and advertises source failures and truncation explicitly', async () => {
    const f = fixture(); f.arko.mockRejectedValue(new Error('目录不可用'))
    f.dsh.mockResolvedValue({ items: [], failedProviders: [{ provider: 'deepseek', providerName: 'DeepSeek' }], truncated: true })
    const value = await f.service.read('production:42')
    expect(value.models).toHaveLength(1); expect(value.failures).toHaveLength(3)
  })
  it('rejects an account change before reads and during an in-flight aggregate', async () => {
    const f = fixture()
    await expect(f.service.read('production:7')).rejects.toMatchObject({ code: 'model-directory-account-changed' }); expect(f.dsh).not.toHaveBeenCalled()
    f.arko.mockImplementation(async () => { f.session.userId = 7; throw new Error('changed') })
    await expect(f.service.read('production:42')).rejects.toMatchObject({ code: 'model-directory-account-changed' })
  })
  it('does not let a partial local decoration erase known capabilities', () => {
    const full = dshModelChoices({ items: [{ provider: 'arkme-managed', providerName: 'Arkme', model: 'one', displayName: 'One', supportsImages: true }], failedProviders: [], truncated: false })
    expect(mergeModelChoices(full, [{ ...full[0]!, name: 'Updated' }])[0]).toMatchObject({ name: 'Updated', images: true })
  })
  it('includes Explore-only models across selectors and retains partial Explore read failures',async()=>{
    const f=fixture(),explore=vi.fn(async()=>({models:[{id:'explore-only',origin:'official' as const,name:'Explore only',identifier:'route-c',channel:'分析模型',exploreRouteKey:'governed/route-c'}],failures:[{source:'目标',message:'暂时无法读取'}]}))
    const service=new ModelDirectoryService(f.runtime as never,{dsh:f.dsh,arko:f.arko,recording:f.recording,explore})
    const value=await service.read('production:42')
    expect(value.models.find(model=>model.id==='explore-only')).toMatchObject({exploreRouteKey:'governed/route-c'})
    expect(value.models.find(model=>model.id==='explore-only')?.explore).toBeUndefined()
    expect(value.failures).toEqual([{source:'目标',message:'暂时无法读取'}])
  })
})

it('classifies native official catalogs independently of supplier and of confirmed scene billing', async () => {
  const f = fixture(), value = await f.service.read('production:42')
  expect(value.models.filter(model => model.origin === 'official')).toHaveLength(3)
  const own = value.models.find(model => model.dsh?.provider === 'deepseek')!
  expect(own.origin).toBe('user-provided')
  expect(modelSceneBilling(own, 'dsh')).toBe('provider-account')
  expect(modelSceneBilling(value.models.find(model => model.arko)!, 'arko')).toBe('arkme-points')
  expect(modelSceneBilling(value.models.find(model => model.recording)!, 'recording')).toBe('unknown')
})

it('preserves billing per scene and never reconciles user-provided models into official routes', async () => {
  const f = fixture(), arko = arkoModelChoices(await f.arko())
  const local = exploreModelChoices('events', { ref: 'settings', models: [{ ref: 'events/alias', label: 'DeepSeek', routeKey: 'managed-ai/alias', provider: 'managed-ai', selected: true }], sources: [] })
  const [model] = mergeModelChoices(arko, local)
  expect(model?.origin).toBe('official')
  expect(modelSceneBilling(model!, 'arko')).toBe('arkme-points')
  expect(modelSceneBilling(model!, 'explore')).toBe('unknown')
  expect(modelSceneBilling(model!, 'dsh')).toBe('unknown')
  const user = { ...arko[0]!, id: 'user-owned', origin: 'user-provided' as const }
  expect(mergeModelChoices([user], local)).toHaveLength(2)
})

it('projects existing managed catalog revisions and supplier identity without exposing private metadata or calling them model versions', async () => {
  const f = fixture()
  Object.assign(f.runtime, { authenticatedIntelligentPost: vi.fn(async () => ({ item_ls: [{ public_model_code: 'version-a', catalog_release_id: '12', offering_revision_id: '34', supplier_code: 'dashscope', api_key: 'never-expose' }] })) })
  const value = await f.service.read('production:42')
  const managed = value.models.find(model => model.dsh?.provider === 'arkme-managed')!
  expect(managed).toMatchObject({ catalogRevision: '12', offeringRevision: '34', supplierCode: 'dashscope' })
  expect(managed.version).toBeUndefined(); expect(JSON.stringify(value)).not.toContain('never-expose')
  expect(value.models.find(model => model.dsh?.provider === 'deepseek')?.catalogRevision).toBeUndefined()
})

it('forwards model directory reads and cancellation through the SDK and Host without accepting a caller user ID', async () => {
  const { createArkmeSdk } = await import('../../src/sdk/index.js'), { dispatchArkmeHostOperation } = await import('../../src/host-api.js')
  const value = { accountScope: 'production:42', observedAt: 1, models: [], failures: [] }, signal = new AbortController().signal
  const service = { modelDirectory: vi.fn(async () => value) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const result = await dispatchArkmeHostOperation(service as never, body.operation, { ...body.params, userId: 99 }, undefined, undefined, undefined, undefined, init?.signal as AbortSignal)
    return new Response(JSON.stringify({ ok: true, value: result }))
  } })
  await expect(sdk.modelDirectory('production:42', signal)).resolves.toEqual(value)
  expect(service.modelDirectory).toHaveBeenCalledExactlyOnceWith('production:42', signal)
})
