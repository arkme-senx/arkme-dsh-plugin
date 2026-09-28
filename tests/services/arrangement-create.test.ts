import { expect, it, vi } from 'vitest'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
function setup() {
 let user=42
 const post=vi.fn(async()=>({items:[{uid:'root',title:'原文',status:2,recognition_state:'recognizing'}]}))
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
