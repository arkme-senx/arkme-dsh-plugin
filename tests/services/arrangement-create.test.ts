import { expect, it, vi } from 'vitest'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../../src/services/service.js'
function setup() {
 let user=42
 const post=vi.fn(async(..._args: unknown[])=>({items:[{uid:'root',title:'原文',status:2,recognition_state:'recognizing'}]}))
 const service=new ArrangementService({requireSession:async()=>({userId:user}),stateStore:{uniqueCode:async()=> 'device'},authenticatedIntelligentPost:post} as unknown as ServiceRuntime)
 return {service,post,switchUser:()=>{user=43}}
}
it('returns the saved root immediately and forwards the idempotent request identity',async()=>{
 const {service,post}=setup()
 const result=await service.createArrangement({requestId:'create-1',texts:[' 明天开会 ']})
 expect(post.mock.calls[0]).toEqual(expect.arrayContaining(['/api/v1/arrangements/fast-create-async',{uid:'create-1',scene_type:'private',topic_uid:'',sent_messages:[{type:'text',text:'明天开会'}]}]))
 expect(result.items[0]).toMatchObject({status:'following',recognitionState:'recognizing'})
 expect(result.items[0]).not.toHaveProperty('uid')
})

const context = {defaultDate:'2026-10-20',timezone:'Asia/Shanghai'}
const dateContext = {default_date:'2026-10-20',timezone:'Asia/Shanghai'}

it('uses the same async creation endpoint, preserves original messages, and carries the date separately', async () => {
 const {service,post}=setup()
 post.mockResolvedValueOnce({contract_version:1,date_context:true} as never)
 post.mockResolvedValueOnce({contract_version:1,date_context:dateContext,items:[{uid:'dated-1',title:'原文',status:2,recognition_state:'recognizing'}]} as never)
 const result=await service.createArrangement({requestId:'dated-1',texts:['准备项目会议','10月21日晚上再讨论'],dateContext:context})
 expect(post.mock.calls[0]?.[0]).toBe('/api/v1/arrangements/creation-options')
 expect(post.mock.calls[1]?.slice(0,2)).toEqual(['/api/v1/arrangements/fast-create-async',{uid:'dated-1',scene_type:'private',topic_uid:'',sent_messages:[{type:'text',text:'准备项目会议'},{type:'text',text:'10月21日晚上再讨论'}],required_contract_version:1,date_context:dateContext}])
 expect(result.items[0]).toMatchObject({title:'原文',recognitionState:'recognizing'})
 expect(result.items[0]?.dueAtMillis).toBeUndefined()
})

it.each([null, {}, {contract_version:1,date_context:false}, {contract_version:2,date_context:true}])('does not write when the server cannot preserve context: %j', async capabilities => {
 const {service,post}=setup()
 post.mockResolvedValueOnce(capabilities as never)
 await expect(service.createArrangement({requestId:'dated-1',texts:['开会'],dateContext:context})).rejects.toMatchObject({code:'arrangement-date-context-unavailable'})
 expect(post).toHaveBeenCalledTimes(1)
 expect(post.mock.calls[0]?.[0]).toBe('/api/v1/arrangements/creation-options')
})

it.each([new ArkmePluginError('arkme-http-error','404',false,502,{upstreamStatus:404}),new ArkmePluginError('arkme-response-invalid','non JSON',false,502)])('does not fall back to a date-less write after a missing capability', async failure => {
 const {service,post}=setup();post.mockRejectedValueOnce(failure)
 await expect(service.createArrangement({requestId:'dated-1',texts:['开会'],dateContext:context})).rejects.toMatchObject({code:'arrangement-date-context-unavailable'})
 expect(post).toHaveBeenCalledTimes(1)
})

it.each([{}, {contract_version:1,date_context:{...dateContext,default_date:'2026-10-21'}}, {contract_version:1,date_context:{...dateContext,timezone:'UTC'}}])('does not claim success if the server fails to acknowledge the persisted context: %j', async acknowledgement => {
 const {service,post}=setup()
 post.mockResolvedValueOnce({contract_version:1,date_context:true} as never)
 post.mockResolvedValueOnce({...acknowledgement,items:[{uid:'dated-1',status:2}]} as never)
 await expect(service.createArrangement({requestId:'dated-1',texts:['开会'],dateContext:context})).rejects.toMatchObject({code:'arrangement-create-uncertain'})
 expect(post).toHaveBeenCalledTimes(2)
})

it.each([null, [], {defaultDate:'2026-02-30',timezone:'Asia/Shanghai'},{defaultDate:'2026-10-20',timezone:'invalid-zone'}])('validates date context before any network calls: %j', async dateContext => {
 const {service,post}=setup()
 await expect(service.createArrangement({requestId:'dated-1',texts:['开会'],dateContext:dateContext as never})).rejects.toMatchObject({code:'arrangement-create-invalid'})
 expect(post).not.toHaveBeenCalled()
})

it('forwards a bounded inclusive date filter and rejects an unfiltered old-server response', async () => {
 const {service,post}=setup()
 const start=Date.parse('2026-10-19T16:00:00Z'),end=Date.parse('2026-10-20T16:00:00Z')-1
 post.mockResolvedValueOnce({list:[],total:0} as never)
 await service.listArrangements({dueStartAtMillis:start,dueEndAtMillis:end})
 expect(post.mock.calls[0]?.[1]).toMatchObject({due_start_at:start,due_end_at:end,status:-1})
 post.mockResolvedValueOnce({list:[{uid:'old',status:2,due_at:start-1}],total:30000} as never)
 await expect(service.listArrangements({dueStartAtMillis:start,dueEndAtMillis:end})).rejects.toMatchObject({code:'arrangement-contract-invalid'})
})
it('reads recognition results through account-bound opaque references',async()=>{
 const {service,post,switchUser}=setup()
 const root=(await service.createArrangement({requestId:'create-1',texts:['原文']})).items[0]!
 post.mockResolvedValueOnce({list:[{uid:'root',status:2,recognition_state:'succeeded',recognition_result_uids:['root','child']}]} as never)
 post.mockResolvedValueOnce({list:[{uid:'child',status:2,title:'结果'}]} as never)
 const result=await service.arrangementRecognition([root.arrangementRef])
 expect(result.items).toHaveLength(2)
 expect(post.mock.calls.at(-1)?.[1]).toMatchObject({uids:['child']})
 switchUser()
 await expect(service.arrangementRecognition([root.arrangementRef])).rejects.toThrow()
})
it('rejects invalid or oversized input before writing and never retries an uncertain create',async()=>{
 const {service,post}=setup()
 await expect(service.createArrangement({requestId:'create-1',texts:[' ']})).rejects.toThrow()
 await expect(service.createArrangement({requestId:'create-1',texts:['a'.repeat(501)]})).rejects.toThrow()
 expect(post).not.toHaveBeenCalled()
 post.mockRejectedValueOnce(Error('timeout'))
 await expect(service.createArrangement({requestId:'create-1',texts:['开会']})).rejects.toThrow('timeout')
 expect(post).toHaveBeenCalledTimes(1)
})
