import {expect,it,vi} from 'vitest'
import {createArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
it('uses the same Host owner and preserves account, revision, immutable route and cancellation',async()=>{
 const owner={accountModels:vi.fn(async()=>({revision:7})),accountModelPreferences:vi.fn(async()=>({revision:8})),disableAccountModel:vi.fn(async()=>({revision:9})),accountModelUsage:vi.fn(async()=>({totals:{calls:1}}))},signal=new AbortController().signal
 const sdk=createArkmeSdk({fetchImpl:async(_,init)=>{const b=JSON.parse(String(init?.body));const value=b.operation==='provider.capabilities'?{contractVersion:1,features:{accountModelsV1:true}}:await dispatchArkmeHostOperation(owner as never,b.operation,b.params,undefined,undefined,undefined,undefined,init?.signal??undefined);return new Response(JSON.stringify({ok:true,value}))}})
 const preferences={default_route:'user-api/model',scenes:{},points_fallback:false as const}
 await sdk.accountModels('test:42',signal);await sdk.accountModelPreferences('test:42',7,preferences,signal);await sdk.disableAccountModel('test:42',8,'model',true,signal);await sdk.accountModelUsage('test:42',{mode:'calls'},signal)
 expect(owner.accountModelPreferences).toHaveBeenCalledWith('test:42',7,preferences,expect.any(AbortSignal));expect(owner.disableAccountModel).toHaveBeenCalledWith('test:42',8,'model',true,expect.any(AbortSignal));sdk.dispose()
})
it('refuses unsupported consumers before accepting credentials or issuing writes',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))),sdk=createArkmeSdk({fetchImpl})
 await expect(sdk.saveAccountModel('test:42',{}as never)).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}});expect(fetchImpl).toHaveBeenCalledOnce();sdk.dispose()
})

it('cancels pending account reads and rejects all account commands after dispose',async()=>{
 let calls=0,started!:()=>void;const ready=new Promise<void>(r=>{started=r})
 const sdk=createArkmeSdk({fetchImpl:async(_,init)=>{calls++;started();return new Promise<Response>((_,reject)=>{init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true})})}})
 const pending=sdk.accountModels('test:42');await ready;sdk.dispose();await expect(pending).rejects.toMatchObject({name:'AbortError'});await expect(sdk.accountModels('test:42')).rejects.toMatchObject({name:'AbortError'});expect(calls).toBe(1)
})
