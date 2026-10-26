import { expect, it, vi } from 'vitest'
import { ArkoLifecycle } from '../../src/services/arko-lifecycle.js'
import { EncryptedReferenceCodec } from '../../src/encrypted-reference.js'
import type { ServiceRuntime } from '../../src/services/service.js'
const op = '11111111-1111-4111-8111-111111111111'
const fact = (state='active', version=0, last='') => ({message_id:1,session_id:2,state,version,deleted_at_ms:state==='active'?0:100,purge_at_ms:state==='active'?0:999,last_operation_uid:last})
async function fixture(post: ReturnType<typeof vi.fn>) {
 const codec = new EncryptedReferenceCodec(async ()=>'synthetic-key',()=>new Error('bad ref'))
 const ref = async(userId:number,sessionId:number,messageId:number)=>codec.seal('arkme-arko-message-v1',{environment:'test',userId,sessionId,messageId,expiresAtMillis:Date.now()+60_000})
 const runtime = {config:{environment:'test'},requireSession:async()=>({userId:7}),authenticatedIntelligentPost:post} as unknown as ServiceRuntime
 return {owner:new ArkoLifecycle(runtime,codec,ref,async()=>[]),ref:await ref(7,2,1),foreign:await ref(8,2,1)}
}
it('keeps all mutation surfaces on versioned owner facts and rejects forged scope before IO',async()=>{
 const post=vi.fn(async(path:string)=>path.endsWith('/apply')?{protocol_version:1,items:[{...fact('deleted',1,op),result:'applied'}]}:{revision:0,items:[fact()]})
 const {owner,ref,foreign}=await fixture(post)
 expect((await owner.query([ref])).items[0]).toMatchObject({version:0,state:'active',messageRef:ref})
 const result=await owner.change({action:'delete',operationUid:op,targets:[{messageRef:ref,expectedVersion:0}]})
 expect(result.items[0]).toMatchObject({version:1,result:'applied',state:'deleted'})
 expect(post.mock.calls[1]?.[1]).toMatchObject({operation_uid:op,targets:[{message_id:1,session_id:2,expected_version:0}]})
 const count=post.mock.calls.length
 await expect(owner.query([foreign])).rejects.toThrow();await expect(owner.query([ref,ref])).rejects.toThrow()
 expect(post).toHaveBeenCalledTimes(count)
})
it.each([true,false])('reconciles uncertain commits without replay, receipt=%s',async(committed)=>{
 const post=vi.fn(async(path:string)=>{if(path.endsWith('/apply'))throw new Error('connection closed');return {revision:committed?1:0,items:[committed?fact('deleted',1,op):fact()]}})
 const {owner,ref}=await fixture(post)
 const result=await owner.change({action:'delete',operationUid:op,targets:[{messageRef:ref,expectedVersion:0}]})
 expect(result.items[0]?.result).toBe(committed?'already_applied':'unknown')
 expect(post.mock.calls.filter(([path])=>String(path).endsWith('/apply'))).toHaveLength(1)
})
it('never treats an old receipt after restoration as a successful delete',async()=>{
 const post=vi.fn(async(path:string)=>{if(path.endsWith('/apply'))throw new Error('offline');return {revision:2,items:[fact('active',2,op)]}})
 const {owner,ref}=await fixture(post)
 expect((await owner.change({action:'delete',operationUid:op,targets:[{messageRef:ref,expectedVersion:0}]})).items[0]?.result).toBe('unknown')
})
