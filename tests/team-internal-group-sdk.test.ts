import {it,expect,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
it('public SDK discovers capability, shares the Host command, and rejects use after dispose',async()=>{
 const teamInternalGroup=vi.fn(async()=>({state:'none'})),service={providerCapabilities:()=>({contractVersion:1,features:{teamInternalGroupsV1:true}}),teamInternalGroup}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl}),request={teamRef:'opaque',action:'recover' as const}
 expect(await sdk.teamInternalGroup(request)).toEqual({state:'none'});expect(teamInternalGroup.mock.calls[0]?.[0]).toEqual(request)
 sdk.dispose();const count=fetchImpl.mock.calls.length
 await expect(sdk.teamInternalGroup(request)).rejects.toThrow();expect(fetchImpl).toHaveBeenCalledTimes(count)
})
it('missing internal-group capability prevents every owner mutation',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))) as typeof fetch,sdk=new ArkmeSdk({fetchImpl})
 await expect(sdk.teamInternalGroup({teamRef:'opaque',action:'confirm',previewRef:'opaque-preview'})).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})
