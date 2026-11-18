import { describe, it, expect, vi } from 'vitest'
import { ModelDirectoryService } from '../../src/services/model-directory-service.js'
import { mergeModelChoices, dshModelChoices, arkoModelChoices, modelSceneBilling, modelAvailable, unavailableLabel } from '../../src/model-directory.js'
import { exploreModelChoices } from '../../src/explore-models.js'
import { publishedModelChoices } from '../../src/services/model-directory-contract.js'
import { createArkmeSdk } from '../../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../../src/host-api.js'
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
    expect(value.models).toHaveLength(5)
    expect(new Set(value.models.map(m => m.id)).size).toBe(5)
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
    expect(value.models).toHaveLength(2); expect(value.failures).toHaveLength(3)
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
  expect(value.models.filter(model => model.origin === 'official')).toHaveLength(4)
  const own = value.models.find(model => model.dsh?.provider === 'deepseek')!
  expect(own.origin).toBe('user-provided')
  expect(modelSceneBilling(own, 'dsh')).toBe('provider-account')
  expect(modelSceneBilling(value.models.find(model => model.arko)!, 'arko')).toBe('arkme-points')
  expect(modelSceneBilling(value.models.find(model => model.recording)!, 'recording-summary')).toBe('unknown')
})

it('preserves billing per scene and never reconciles user-provided models into official routes', async () => {
  const f = fixture(), arko = arkoModelChoices(await f.arko())
  const local = exploreModelChoices('events', { ref: 'settings', models: [{ ref: 'events/alias', label: 'DeepSeek', routeKey: 'managed-ai/alias', provider: 'managed-ai', selected: true }], sources: [] })
  expect(mergeModelChoices(arko,local)).toHaveLength(2)
  const [model] = mergeModelChoices(arko, local)
  expect(model?.origin).toBe('official')
  expect(modelSceneBilling(model!, 'arko')).toBe('arkme-points')
  expect(modelSceneBilling(model!, 'explore-event')).toBe('unknown')
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
  const value = { accountScope: 'production:42', observedAt: 1, models: [], failures: [] }, signal = new AbortController().signal
  const service = { modelDirectory: vi.fn(async () => value) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const result = await dispatchArkmeHostOperation(service as never, body.operation, { ...body.params, userId: 99 }, undefined, undefined, undefined, undefined, init?.signal as AbortSignal)
    return new Response(JSON.stringify({ ok: true, value: result }))
  } })
  await expect(sdk.modelDirectory('production:42', signal)).resolves.toEqual(value)
  expect(service.modelDirectory).toHaveBeenCalledExactlyOnceWith('production:42', signal)
  await sdk.modelDirectory('production:42',signal,{officialOnly:true})
  expect(service.modelDirectory).toHaveBeenLastCalledWith('production:42',signal,true)
})

const published = () => ({ provider:'arkme-managed',public_model_code:'official-v1',display_name:'Official One',supplier_code:'deepseek',catalog_release_id:'12',offering_revision_id:'34',
  capability:{input_modalities:['text','image']},reasoning:{efforts:['off','high'],default_effort:'high'},
  point_pricing:{cache_miss_input_per_thousand:'0.0000001',cache_hit_input_per_thousand:'0',output_per_thousand:'1.2345678'},api_key:'never-expose' })
it('reads the official published catalog without depending on a DSH connection or including user-provided keys',async()=>{
 const f=fixture(),read=vi.fn(async()=>({item_ls:[published()]}));Object.assign(f.runtime,{authenticatedIntelligentPost:read})
 const value=await f.service.read('production:42',undefined,true)
 expect(f.dsh).not.toHaveBeenCalled();expect(read).toHaveBeenCalledExactlyOnceWith('/api/v1/managed-ai/models/query',{},f.session,undefined)
 const model=value.models.find(item=>item.dsh)!
 expect(model).toMatchObject({origin:'official',supplierCode:'deepseek',images:true,pointPricing:{cacheMissInputPerThousand:'0.0000001',outputPerThousand:'1.2345678'},dsh:{provider:'arkme-managed',model:'official-v1'}})
 expect(model.reasoning?.efforts.map(item=>item.id)).toEqual(['off','high']);expect(value.models.every(item=>item.origin==='official')).toBe(true)
 expect(JSON.stringify(value)).not.toContain('never-expose')
})
it.each([
 {provider:'private'}, {point_pricing:{cache_miss_input_per_thousand:'-1'}}, {point_pricing:{cache_miss_input_per_thousand:0.1}},
 {capability:{input_modalities:[]}}, {reasoning:{efforts:['high','high'],default_effort:'high'}}, {reasoning:{efforts:['high'],default_effort:'off'}},
])('rejects invalid published catalog facts instead of estimating capabilities or prices: %j',patch=>{
 expect(()=>publishedModelChoices({item_ls:[{...published(),...patch}]})).toThrow('官方模型目录')
})
it('keeps partial scenes usable and reports published catalog failures explicitly',async()=>{
 const f=fixture();Object.assign(f.runtime,{authenticatedIntelligentPost:vi.fn(async()=>({item_ls:[published(),published()]}))})
 const value=await f.service.read('production:42',undefined,true)
 expect(value.failures).toHaveLength(1);expect(value.failures[0]?.source).toBe('DSH 对话');expect(value.models.every(item=>!item.dsh)).toBe(true)
})

it('reports mixed official publications instead of fabricating a shared revision',async()=>{
 const f=fixture()
 const recording=async()=>({defaultRouteKey:'dashscope/qwen',effectiveRouteKey:'dashscope/qwen',options:[{routeKey:'dashscope/qwen',modelKey:'qwen',displayName:'Qwen',provider:'dashscope',binding:{catalogReleaseId:'13',offeringRevisionId:'35',publicModelCode:'qwen'},available:true}]})
 Object.assign(f.runtime,{authenticatedIntelligentPost:vi.fn(async()=>({item_ls:[{public_model_code:'version-a',catalog_release_id:'12',offering_revision_id:'34',supplier_code:'deepseek'}]}))})
 const value=await new ModelDirectoryService(f.runtime as never,{dsh:f.dsh,arko:f.arko,recording}).read('production:42')
 expect(value.failures).toContainEqual({source:'官方模型',message:'发布目录已变化，请刷新后确认模型'})
 expect(new Set(value.models.map(model=>model.catalogRevision).filter(Boolean))).toEqual(new Set(['12','13']))
})

it('explains account capability restrictions across picker scenes without granting business routes', async () => {
  const f = fixture()
  const model = { uid:'a', route:'user-api/a', version_route:'user-api/a/v1', name:'Own', disabled:false, execution:'cloud' as const, protocol:'openai-chat' as const, base_url:'https://example.com', model_key:'own', key_configured:true, capabilities:{ text:true, tools:false, json:false, images:false, stream:true, context_tokens:16000, output_tokens:128 } }
  const keys = ['dsh','arko','arrangement','profile','goals','recording-summary','recording-timeline','intelligent.calendar.day-review','intelligent.event.subscription.final','insight.anniversary.verify.final']
  const scenes = keys.map(key => ({ key, name:key, group:key, biz_code:0, tools:['dsh','arko'].includes(key), stream:key==='dsh', json:['arrangement','profile','goals','intelligent.calendar.day-review'].includes(key), images:false, ...(key.startsWith('recording-') ? {min_output_tokens:512,min_input_tokens:513} : {}) }))
  const account = vi.fn(async () => ({ accountScope:'production:42', revision:1, enabled:true, models:[model], connectors:[], scenes, preferences:{ default_route:'system-default', scenes:{}, points_fallback:false as const } }))
  const service = new ModelDirectoryService(f.runtime as never, { dsh:f.dsh, arko:f.arko, recording:f.recording, account })
  const value = await service.read('production:42'), own = value.models.find(item=>item.identifier===model.route)!
  for (const scene of ['dsh','arko','arrangement','explore-profile','explore-goal','dayReview','recording-summary','recording-timeline'] as const) {
    expect(modelAvailable(own,scene)).toBe(false)
    expect(unavailableLabel(own,scene)).not.toBe('此场景支持情况待确认')
  }
  expect(unavailableLabel(own,'arko')).toBe('缺少工具调用')
  expect(unavailableLabel(own,'explore-profile')).toBe('缺少JSON 输出')
  expect(unavailableLabel(own,'recording-timeline')).toBe('输出上限需至少 512 Token')
  expect(own.capabilityIssuesByScene?.['explore-event']).toEqual([])
  expect(modelAvailable(own,'explore-event')).toBe(false) // Capability match never grants an owner route.
  const [merged] = mergeModelChoices([own],[{ ...own, capabilityIssuesByScene:undefined, arko:model.route, availabilityByScene:{arko:{available:true}} }])
  expect(modelAvailable(merged!,'arko')).toBe(false) // A stale business list cannot erase the account restriction.
  const official = value.models.find(item=>item.origin==='official' && item.arko)!
  expect(modelAvailable(official,'arko')).toBe(true)
  expect(official.capabilityIssuesByScene).toBeUndefined()
})
