import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog } from '../src/tools/index.js'
it('covers interaction query, safe source resolution and bounded local persistence through SDK Host and formal Tools',async()=>{
 const page={accountScope:'test:11',items:[],hasMore:false,removedKeys:[]}
 const service={arkoInteractions:vi.fn(async()=>page),arkoInteractionOpen:vi.fn(async()=>({accountScope:'test:11'})),arkoTimelineCache:vi.fn(async()=>undefined)}
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const {operation,params}=JSON.parse(String(init?.body));const value=operation==='provider.capabilities'?{contractVersion:1,features:{arkoInteractionTimelineV1:true}}:await dispatchArkmeHostOperation(service as never,operation,params,undefined,undefined,undefined,undefined,init?.signal??undefined);return new Response(JSON.stringify({ok:true,value}))}})
 const signal=new AbortController().signal
 await sdk.arkoInteractions({limit:10,cursor:'cursor'},signal);expect(service.arkoInteractions).toHaveBeenCalledWith({limit:10,cursor:'cursor'},signal)
 await sdk.arkoInteractionOpen('opaque',signal);expect(service.arkoInteractionOpen).toHaveBeenCalledWith('opaque',signal)
 await sdk.arkoTimelineCache('test:11');expect(service.arkoTimelineCache).toHaveBeenCalledWith('test:11',undefined)
 const tools=createArkmeCoreToolDefinitions(service as never),exec={signal} as never
 await tools.find(x=>x.name==='arkme_arko_interactions')!.execute({limit:10},exec)
 await tools.find(x=>x.name==='arkme_arko_interaction_open')!.execute({interaction_ref:'opaque'},exec)
 await tools.find(x=>x.name==='arkme_arko_timeline_cache')!.execute({account_scope:'test:11'},exec)
 expect(arkmeToolCatalog.modulesFor('business').find(x=>x.meta.toolName==='arkme_arko_timeline_cache')!.meta.grant).toBe('explicit-user-write')
 const unsupported=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))})
 await expect(unsupported.arkoInteractions()).rejects.toThrow('不支持')
})
