import {it,expect,vi} from 'vitest'
import {createArkmeSdk} from '../src/sdk/index.js'
import {worldSoundReadTool,worldSoundWriteTool} from '../src/tools/business/world/sound-excerpts.js'
const response=(value:unknown)=>new Response(JSON.stringify({ok:true,value}),{headers:{'content-type':'application/json'}})
it('discovers SDK capability, forwards account-bound requests and cancellation without replay',async()=>{
 const calls:unknown[]=[],signal=new AbortController().signal
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{expect(init?.signal).toBe(signal);const request=JSON.parse(String(init?.body));calls.push(request);return request.operation==='provider.capabilities'?response({contractVersion:1,features:{worldSoundExcerptsV1:true}}):response({version:1,recording:false,call:false})}})
 await expect(sdk.worldSoundExcerpts({accountKey:'prod:11',action:'capabilities'},signal)).resolves.toEqual({version:1,recording:false,call:false})
 expect(calls).toEqual([{operation:'provider.capabilities'},{operation:'world.sound-excerpts',params:{accountKey:'prod:11',action:'capabilities'}}])
 const old=createArkmeSdk({fetchImpl:async()=>response({contractVersion:1,features:{}})})
 await expect(old.worldSoundExcerpts({accountKey:'test:1',action:'capabilities'})).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}})
})
it('separates sound Tool grants and never allows a withdrawal through the read adapter',async()=>{
 expect(worldSoundReadTool.meta.effect).toBe('read');expect(worldSoundWriteTool.meta.grant).toBe('explicit-user-write')
 const owner=vi.fn().mockResolvedValue({version:1,recording:false,call:false})
 const read=worldSoundReadTool.create({worldSoundExcerpts:owner} as never) as unknown as {execute(input:{request_json:string},ctx:{signal:AbortSignal}):Promise<unknown>}
 const ctx={signal:new AbortController().signal}
 await expect(read.execute({request_json:JSON.stringify({action:'management',accountKey:'test:1',withdraw:true,recordRef:'opaque'})},ctx)).rejects.toThrow()
 expect(owner).not.toHaveBeenCalled()
})
