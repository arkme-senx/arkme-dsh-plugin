import { expect,it,vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions,arkmeToolCatalog } from '../src/tools/index.js'
const ref='arkme-file-v1.11111111-1111-4111-8111-111111111111'
it('SDK and granted Tools use the same Arko owner with ordered opaque images',async()=>{
 const owner={arkoAsk:vi.fn(async()=>({sessionId:88,userMsgId:1,assistantMsgId:2,status:'completed',text:'done',reasoning:'',createdRecordUids:[],terminal:true,timedOut:false})),arkoPendingTurns:vi.fn(async()=>[]),arkoModelCatalog:vi.fn(async()=>({options:[]}))}
 const signal=new AbortController().signal
 const sdk=createArkmeSdk({fetchImpl:async(_,init)=>{
  expect(init?.signal).toBe(signal)
  const request=JSON.parse(String(init?.body)),value=request.operation==='provider.capabilities'?{contractVersion:1,features:{arkoImagesV1:true}}:await dispatchArkmeHostOperation(owner as never,request.operation,request.params)
  return new Response(JSON.stringify({ok:true,value}))
 }})
 await sdk.arkoAsk('',{sessionId:88,imageFileRefs:[ref]},signal)
 expect(owner.arkoAsk.mock.calls[0]).toEqual(['',{sessionId:88,imageFileRefs:[ref],waitMillis:25000}])
 const ask=createArkmeCoreToolDefinitions(owner as never).find(tool=>tool.name==='arkme_arko_ask')!
 await ask.execute({image_file_refs:[ref],session_id:88},{callId:'call-1',signal} as never)
 expect(owner.arkoAsk.mock.calls[1]).toEqual(['',expect.objectContaining({sessionId:88,imageFileRefs:[ref],signal,clientTurnUid:expect.any(String)})])
 expect(arkmeToolCatalog.modules.find(module=>module.meta.toolName==='arkme_arko_ask')?.meta).toMatchObject({effect:'write',grant:'explicit-user-write'})
 expect(createArkmeCoreToolDefinitions(owner as never).map(tool=>tool.name)).toEqual(expect.arrayContaining(['arkme_arko_models','arkme_arko_pending']))
})
it('rejects unsupported SDK providers before sending or uploading',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}})))
 await expect(createArkmeSdk({fetchImpl}).arkoAsk('',{imageFileRefs:[ref]})).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})
