import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
const ok=(value:unknown)=>new Response(JSON.stringify({ok:true,value}))
it('discovers the cache-only capability and never silently downloads on an older Provider', async()=>{
 const call=vi.fn(async (_url:unknown,init?:RequestInit)=>{
  const request=JSON.parse(String(init?.body))
  return ok(request.operation==='provider.capabilities'?{contractVersion:1,features:{imageCacheRead:true}}:{mediaType:'image/png',dataBase64:'aW1hZ2U=',bytes:5})
 })
 const sdk=createArkmeSdk({fetchImpl:call})
 await expect(sdk.readCachedImage('file_asset://cached-image')).resolves.toMatchObject({bytes:5})
 expect(JSON.parse(String(call.mock.calls.at(-1)?.[1]?.body))).toEqual({operation:'image.read',params:{imageRef:'file_asset://cached-image',cacheOnly:true}})
 const oldCall=vi.fn(async()=>ok({contractVersion:1,features:{}}))
 await expect(createArkmeSdk({fetchImpl:oldCall}).readCachedImage('file_asset://cached-image')).rejects.toThrow('不支持本地头像探测')
 expect(oldCall).toHaveBeenCalledTimes(1)
})
it('maps cache miss to undefined but preserves authorization failures',async()=>{
 for(const code of ['image-cache-miss','auth-required']){
  const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>JSON.parse(String(init?.body)).operation==='provider.capabilities'
   ?ok({contractVersion:1,features:{imageCacheRead:true}}):new Response(JSON.stringify({ok:false,error:{code,message:code,retryable:false}}))})
  if(code==='image-cache-miss')await expect(sdk.readCachedImage('file_asset://missing-image')).resolves.toBeUndefined()
  else await expect(sdk.readCachedImage('file_asset://missing-image')).rejects.toMatchObject({body:{code}})
 }
})
