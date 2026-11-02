import {it,expect,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
it('uses one Host owner and requires the public capability before any member operation',async()=>{
 const request={teamRef:'opaque-profile-ref',action:'add' as const,candidateRefs:['opaque-person'],requestUid:'batch'}
 const owner=vi.fn(async()=>({state:'completed',requestUid:'batch',memberCount:2,membershipRevision:1,items:[{key:'opaque',status:'added'}]}))
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMemberManagementV1:true}}),teamMemberManagement:owner}
 const sdk=new ArkmeSdk({fetchImpl:async(_url,init)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}})
 expect(await sdk.teamMemberManagement(request)).toMatchObject({state:'completed'});expect(owner).toHaveBeenCalledWith(request,undefined)
 const missing=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}})))
 await expect(new ArkmeSdk({fetchImpl:missing}).teamMemberManagement(request)).rejects.toThrow('不支持');expect(missing).toHaveBeenCalledOnce()
})
