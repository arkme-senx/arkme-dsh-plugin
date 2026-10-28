import { afterEach, expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog } from '../src/tools/index.js'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const query = { accountScope: 'prod:7', bucketDate: '2026-10-15', timezone: 'Asia/Shanghai' }
it('SDK and Tools route through the same Host owner and preserve cancellation', async () => {
 const result = { supported: true, job: null, result: null, freshness: 'unknown', versions: [] }
 const owner = { dayReviewState: vi.fn(async () => result), resumeDayReview: vi.fn(async () => result) }
 const signal = new AbortController().signal
 const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
  expect(init?.signal).toBe(signal)
  const body = JSON.parse(String(init?.body))
  const value = body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { calendarDayReview: true, calendarDayReviewHumanConfirmation: true } } : await dispatchArkmeHostOperation(owner as never, body.operation, body.params, undefined, undefined, undefined, undefined, signal)
  return new Response(JSON.stringify({ ok: true, value }))
 } })
 expect(await sdk.dayReviewState(query, signal)).toEqual(result)
 const tools = createArkmeCoreToolDefinitions(owner as never)
 const read = tools.find(t => t.name === 'arkme_day_review_read')!
 expect(await read.execute({ account_scope: query.accountScope, date: query.bucketDate, timezone: query.timezone, action: 'state' }, { signal } as never)).toContain('unknown')
 expect(owner.dayReviewState.mock.calls).toEqual([[query, signal], [query, signal]])
 await expect(read.execute({ account_scope: query.accountScope, date: query.bucketDate, timezone: query.timezone, action: 'create' } as never, { signal } as never)).rejects.toThrow()
 expect(arkmeToolCatalog.modules.find(t => t.meta.toolName === 'arkme_day_review_generate')?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
})
it('rejects unsupported providers before dispatching a billable operation', async () => {
 vi.stubGlobal('navigator', { userActivation: { isActive: true } }); vi.stubGlobal('window', { location: { href: 'http://localhost/' }, open: vi.fn(() => ({})) })
 const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })))
 const sdk = createArkmeSdk({ fetchImpl })
 await expect(sdk.createDayReview({ ...query, sourceKinds: ['self'], requestId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it('SDK and granted Tool preserve the same public model selection through the Host owner', async () => {
 const models={defaultCode:'deepseek-v4-flash',models:[{code:'deepseek-v4-flash',displayName:'DeepSeek V4.1 Flash（官方）'}]}
 const owner={dayReviewModels:vi.fn(async()=>models),createDayReview:vi.fn(async()=>({supported:true,job:null,result:null,freshness:'unknown',versions:[]}))}
 const signal=new AbortController().signal
 const sdk=createArkmeSdk({fetchImpl:async(_,init)=>{
  const b=JSON.parse(String(init?.body));const value=b.operation==='provider.capabilities'?{contractVersion:1,features:{calendarDayReview:true}}:await dispatchArkmeHostOperation(owner as never,b.operation,b.params,undefined,undefined,undefined,undefined,signal)
  return new Response(JSON.stringify({ok:true,value}))
 }})
 expect(await sdk.dayReviewModels(query,signal)).toEqual(models)
 const request={...query,requestId:'00000000-0000-4000-8000-000000000000',sourceKinds:['self'] as ['self'],modelCode:'deepseek-v4-flash'}
 await expect(sdk.createDayReview(request,signal)).rejects.toThrow('人类点击')
 const tools=createArkmeCoreToolDefinitions(owner as never)
 const read=tools.find(t=>t.name==='arkme_day_review_read')!
 expect(await read.execute({account_scope:query.accountScope,date:query.bucketDate,timezone:query.timezone,action:'models'},{signal} as never)).toContain('deepseek-v4-flash')
 await tools.find(t=>t.name==='arkme_day_review_generate')!.execute({account_scope:query.accountScope,date:query.bucketDate,timezone:query.timezone,action:'create',source_kinds:['self'],request_id:request.requestId,model_code:request.modelCode},{signal} as never)
 expect(owner.createDayReview.mock.calls).toEqual([[request,signal]])
})

it('opens the confirmation during the gesture and only polls its receipt, with cancellation', async () => {
 vi.useFakeTimers()
 vi.stubGlobal('navigator', { userActivation: { isActive: true } })
 const open = vi.fn(() => ({})); vi.stubGlobal('window', { location: { href: 'http://localhost/' }, open })
 const calls: string[] = []
 const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
  const b = JSON.parse(String(init?.body)); calls.push(b.operation)
  return new Response(JSON.stringify({ ok: true, value: b.operation === 'provider.capabilities' ? { contractVersion: 1, features: { calendarDayReview: true, calendarDayReviewHumanConfirmation: true } } : { status: 'pending' } }))
 } })
 const controller = new AbortController()
 const pending = sdk.createDayReview({ ...query, sourceKinds: ['chat'], requestId: 'persistent-request-id' }, controller.signal)
 expect(open).toHaveBeenCalledTimes(1)
 const url = new URL(open.mock.calls[0]![0] as string)
 expect(JSON.parse(url.searchParams.get('intent')!).requestId).toBe('persistent-request-id')
 const rejected = expect(pending).rejects.toThrow()
 await vi.advanceTimersByTimeAsync(1000)
 controller.abort(); await rejected
 expect(calls).toEqual(['provider.capabilities', 'calendar.day-review.confirmation'])
 expect(vi.getTimerCount()).toBe(0)
})
