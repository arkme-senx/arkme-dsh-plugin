import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
it('exposes lifecycle through SDK capability and Host cancellation without leaking raw identities', async () => {
 const service={arkoLifecycle:vi.fn(async()=>({revision:1,items:[]})),arkoChangeLifecycle:vi.fn(async()=>({items:[]})),arkoRecentlyDeleted:vi.fn(async()=>({items:[],hasMore:false}))}
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
  init?.signal?.throwIfAborted()
  const {operation,params}=JSON.parse(String(init?.body))
  const value=operation==='provider.capabilities'?{contractVersion:1,features:{arkoLifecycleV1:true}}:await dispatchArkmeHostOperation(service as never,operation,params,undefined,undefined,undefined,undefined,init?.signal??undefined)
  return new Response(JSON.stringify({ok:true,value}))
 }})
 const signal=new AbortController().signal
 await sdk.arkoLifecycle(['opaque'],signal)
 await sdk.arkoRecentlyDeleted(undefined,signal)
 const command={action:'delete' as const,operationUid:'bd4549d6-886a-4cf0-a600-8702efb0d010',targets:[{messageRef:'opaque',expectedVersion:1}]}
 await sdk.arkoChangeLifecycle(command,signal)
 expect(service.arkoLifecycle).toHaveBeenCalledWith(['opaque'],signal)
 expect(service.arkoChangeLifecycle).toHaveBeenCalledWith(command,signal)
 expect(service.arkoRecentlyDeleted).toHaveBeenCalledWith(undefined,signal)
 await expect(sdk.arkoLifecycle([],AbortSignal.abort())).rejects.toThrow()
 const unsupported=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
 await expect(unsupported.arkoLifecycle()).rejects.toThrow('不支持')
})
