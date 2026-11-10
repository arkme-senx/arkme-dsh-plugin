import {expect,it,vi} from 'vitest'
import {AccountModelService} from '../src/services/account-model-service.js'
import {accountModelEffectiveRoute,accountModelSupportsScene} from '../src/account-models.js'
export const model={uid:'a',route:'user-api/a',version_route:'user-api/a/v1',name:'Own model',execution:'cloud' as const,protocol:'openai-chat' as const,base_url:'https://example.com/v1',model_key:'owned',key_configured:true,disabled:false,capabilities:{text:true,images:false,tools:true,json:false,stream:true,context_tokens:16384,output_tokens:4096}}
const data=()=>({revision:1,enabled:true,models:[{...model,api_key:'never-leak',credential:{data:'never-leak'}}],connectors:[{uid:'host',name:'Host',revoked:false,secret:'never-leak'}],scenes:[],preferences:{default_route:model.route,scenes:{dsh:'system-default'},points_fallback:false},api_key:'never-leak'})
function fixture(){const session={userId:11,refreshToken:'session-a'},post=vi.fn(async()=>data()),runtime={config:{environment:'production'},requireSession:async()=>session,authenticatedIntelligentPost:post};return {session,post,service:new AccountModelService(runtime as never)}}
it('never exposes secret or retained-version fields to Web, even in an overbroad owner response',async()=>{const f=fixture(),value=await f.service.settings('production:11');expect(JSON.stringify(value)).not.toContain('never-leak');expect(value.models[0]).toEqual(model);expect(value.accountScope).toBe('production:11')})
it('fences both account changes and same-account session replacement across in-flight requests',async()=>{const f=fixture();await expect(f.service.settings('production:12')).rejects.toMatchObject({code:'model-account-changed'});expect(f.post).not.toHaveBeenCalled();f.post.mockImplementation(async()=>{f.session.refreshToken='new-session';return data()});await expect(f.service.settings('production:11')).rejects.toMatchObject({code:'model-account-changed'})})
it('keeps an explicit system default separate from global inheritance and excludes incompatible capabilities',async()=>{const f=fixture(),settings=await f.service.settings('production:11');expect(accountModelEffectiveRoute(settings,'dsh')).toBe('system-default');expect(accountModelEffectiveRoute(settings,'arko')).toBe(model.route);expect(accountModelSupportsScene(model,{key:'arrangement',name:'安排',group:'arrangement',biz_code:217,tools:false,images:false,json:true})).toBe(false)})
it('never dispatches an already canceled save or query',async()=>{const f=fixture(),controller=new AbortController();controller.abort();await expect(f.service.settings('production:11',controller.signal)).rejects.toThrow();expect(f.post).not.toHaveBeenCalled()})


it('uses the DSH tools and stream requirements even with an older settings payload', () => {
  const scene = { key: 'dsh', name: 'DSH', group: 'dsh', biz_code: 0, tools: true, images: false, json: false }
  const withoutStream = { ...model, capabilities: { ...model.capabilities, stream: false } }
  const withoutTools = { ...model, capabilities: { ...model.capabilities, tools: false } }
  expect(accountModelSupportsScene(withoutStream, scene)).toBe(false)
  expect(accountModelSupportsScene(withoutTools, scene)).toBe(false)
  expect(accountModelSupportsScene(model, scene)).toBe(true)
  expect(accountModelSupportsScene(withoutStream, { ...scene, key: 'arko' })).toBe(true)
})

it('validates inherited capabilities before writing global preferences', async () => {
  const f = fixture()
  const plain = { ...model, capabilities: { ...model.capabilities, tools: false, stream: false } }
  const settings = { ...data(), models: [plain], preferences: { default_route: 'system-default', scenes: {}, points_fallback: false }, scenes: [
    { key: 'dsh', name: 'DSH 对话', group: 'dsh', biz_code: 0, tools: true, stream: true, images: false, json: false },
  ] }
  f.post.mockResolvedValue(settings as never)
  await expect(f.service.preferences('production:11', 1, { default_route: model.route, scenes: {}, points_fallback: false })).rejects.toMatchObject({ code: 'model-capability-mismatch' })
  expect(f.post.mock.calls.every(args => args[0].endsWith('settings/query'))).toBe(true)
  await f.service.preferences('production:11', 1, { default_route: model.route, scenes: { dsh: 'system-default' }, points_fallback: false })
  expect(f.post.mock.calls.some(args => args[0].endsWith('preferences/save'))).toBe(true)
})

it('explains the Responses minimum before sending a credential binding', async () => {
  const f = fixture()
  await expect(f.service.save('production:11', {
    ...model, uid: '', expected_revision: 1, api_key: 'fixture-only',
    execution: 'cloud', protocol: 'openai-responses', base_url: 'https://api.openai.com/v1',
    capabilities: { ...model.capabilities, output_tokens: 8 },
  })).rejects.toMatchObject({ code: 'model-output-limit' })
  expect(f.post).not.toHaveBeenCalled()
})

it('saves official preferences without adding a settings-query dependency', async () => {
  const f = fixture()
  const preferences = { default_route: 'system-default', scenes: { arko: 'managed-ai/official' }, points_fallback: false }
  f.post.mockImplementation(async (path: string) => {
    if (!path.endsWith('preferences/save')) throw new Error('unexpected settings dependency')
    return data()
  })
  await f.service.preferences('production:11', 1, preferences)
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.post).toHaveBeenCalledWith('/api/v1/user-models/preferences/save', { expected_revision: 1, preferences }, f.session, undefined)
})

const sharedScenes = [
  { key: 'dsh', name: 'DSH 对话', group: 'dsh', biz_code: 0, tools: true, images: false, json: false },
  { key: 'arko', name: 'Arko 对话', group: 'arko', biz_code: 1, tools: true, images: false, json: false },
  { key: 'summary', name: '普通总结', group: 'summary', biz_code: 2, tools: false, images: false, json: false },
  { key: 'official', name: '官方场景', group: 'official', biz_code: 3, tools: true, images: false, json: false },
  { key: 'images', name: '已有图片限制的场景', group: 'images', biz_code: 4, tools: false, images: true, json: false },
]
const sharedPreferences = { default_route: model.route, scenes: { dsh: model.route, official: 'system-default' }, points_fallback: false }
const saveInput = () => ({ ...model, expected_revision: 1, api_key: '', connector_id: '', host_provider: '' })

it('reports all newly affected functions for a shared model, including explicit and inherited bindings', async () => {
  const f = fixture()
  f.post.mockResolvedValue({ ...data(), scenes: sharedScenes, preferences: sharedPreferences } as never)
  await expect(f.service.save('production:11', { ...saveInput(), capabilities: { ...model.capabilities, tools: false } })).rejects.toMatchObject({
    code: 'model-capability-mismatch',
    message: '此次能力修改会影响：DSH 对话、Arko 对话。请保留所需能力，或在「使用偏好」中为这些功能更换模型。',
  })
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.post.mock.calls[0]![0]).toBe('/api/v1/user-models/settings/query')
})

it('allows the same model to remain selected by multiple functions when capabilities still satisfy them', async () => {
  const f = fixture()
  f.post.mockResolvedValue({ ...data(), scenes: sharedScenes, preferences: sharedPreferences } as never)
  const input = { ...saveInput(), name: 'Renamed shared model' }
  await f.service.save('production:11', input)
  expect(f.post).toHaveBeenLastCalledWith('/api/v1/user-models/settings/save', input, f.session, undefined)
})

it('reports every incompatible changed preference without including official overrides or unchanged effective choices', async () => {
  const f = fixture()
  const plain = { ...model, capabilities: { ...model.capabilities, tools: false } }
  f.post.mockResolvedValue({ ...data(), models: [plain], scenes: sharedScenes, preferences: { default_route: 'system-default', scenes: { images: model.route }, points_fallback: false } } as never)
  await expect(f.service.preferences('production:11', 1, { ...sharedPreferences, scenes: { ...sharedPreferences.scenes, images: model.route } })).rejects.toMatchObject({
    code: 'model-capability-mismatch',
    message: '当前模型选择不满足以下功能的要求：DSH 对话、Arko 对话。请为这些功能选择合适的模型。',
  })
  expect(f.post).toHaveBeenCalledTimes(1)
})
