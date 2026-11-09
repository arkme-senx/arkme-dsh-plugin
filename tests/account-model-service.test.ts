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
