import {expect,it,vi} from 'vitest'
import {createArkmeSdk} from '../src/sdk/index.js'
it('uses public capability discovery and cancels every selected-text operation on dispose',async()=>{
 const quote={version:1 as const,sourceLabel:'私聊',senderName:'作者',sourceAtMillis:1,text:'选段'},command={expectedAccountKey:'test:11',targetSourceRef:'target',recordUid:'record',relationUid:'relation',sendAtMillis:1,commentText:'',quote}
 const fetchImpl=vi.fn(async(_url,init)=>{init?.signal?.throwIfAborted();const r=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:r.operation==='provider.capabilities'?{contractVersion:1,features:{selectedTextForwardV1:true}}:r.operation==='selected-text.prepare'?quote:r.operation==='selected-text.forward'?{itemUid:'record',sourceRef:'target',status:1,localState:'synced'}:{title:'原文',text:'选段'}}))})
 const sdk=createArkmeSdk({fetchImpl});expect((await sdk.prepareSelectedText({expectedAccountKey:'test:11',quote})).text).toBe('选段');expect((await sdk.forwardSelectedText(command)).itemUid).toBe('record');expect((await sdk.excerptOriginal('record')).text).toBe('选段')
 sdk.dispose();const count=fetchImpl.mock.calls.length
 await expect(sdk.prepareSelectedText({expectedAccountKey:'test:11',quote})).rejects.toThrow();await expect(sdk.forwardSelectedText(command)).rejects.toThrow();await expect(sdk.excerptOriginal('record')).rejects.toThrow();expect(fetchImpl).toHaveBeenCalledTimes(count)
 const legacy=createArkmeSdk({fetchImpl:async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))});await expect(legacy.forwardSelectedText(command)).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}});legacy.dispose()
})
