import {it,expect,vi} from 'vitest'
import {MediaService,chatMediaSource} from '../src/services/media-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import type {ArkmeSessionStore} from '../src/keychain-store.js'
const config={environment:'test',authBaseUrl:'https://auth.test',recordBaseUrl:'https://record.test',chatBaseUrl:'https://chat.test',audioBaseUrl:'https://audio.test',requestTimeoutMs:5000,richMediaRenderEnabled:true} as ArkmeServiceConfig
const attachment='a'.repeat(64),owner='9007199254740993'
const source={relation:{chat_session_uid:'group',rel_uid:'mount',record_owner_user_id:owner,record_uid:'record'},record:{payload:{owner_user_id:owner,record_uid:'record',version:3,content_payload:{media_refs:[{file_asset_uid:'same-asset',render_role:1}]},media_display_items:[{file_asset_uid:'same-asset',source_attachment_ref:attachment,file_name:'report.json',mime_type:'application/json',file_kind:4,size:4}]}}}
it('streams each exact source with current authority, preserves numeric owner/Range and never issues a storage lookup',async()=>{
 let allowed=true
 const sessions:ArkmeSessionStore={read:async()=>({userId:42,accessToken:'test-token',refreshToken:'test-refresh'}),write:async()=>{},delete:async()=>{}}
 const fetch=vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{
  expect(new URL(String(url)).pathname).toBe('/api/v1/content/source-stream')
  expect(init?.method).toBe('POST');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
  expect(String(init?.body)).toContain(`"record_owner_user_id":${owner}`)
  expect(String(init?.body)).not.toContain(`"record_owner_user_id":"${owner}"`)
  const body=JSON.parse(String(init?.body));expect(body).toMatchObject({chat_session_uid:'group',relation_uid:'mount',record_uid:'record',version:3,attachment})
  if(!allowed)return new Response('',{status:404})
  const partial=new Headers(init?.headers).has('Range')
  return new Response(partial?'12':'1234',{status:partial?206:200,headers:{'X-Jotmo-Source-Stream':'1','content-type':'application/json','content-length':partial?'2':'4','content-disposition':'attachment; filename="report.json"','content-security-policy':"sandbox; default-src 'none'",...(partial?{'content-range':'bytes 1-2/4'}:{})}})
 })
 const runtime=new ServiceRuntime(config,sessions,{} as StateStore,fetch),media=new MediaService(runtime,{} as never,{} as never,{} as never)
 const blocks=media.richContentBlocks(source,42)
 expect(blocks).toHaveLength(1);const ref=blocks[0]!.originalRef!
 expect(ref).not.toContain('group');expect(ref).not.toContain(owner);expect(fetch).not.toHaveBeenCalled()
 const first=await media.fetchMedia(ref,'bytes=1-2');expect(await first.response.text()).toBe('12')
 const second=await media.fetchMedia(ref);expect(await second.response.text()).toBe('1234')
 expect(second.response.headers.get('cache-control')).toBe('private, no-store')
 allowed=false;await expect(media.fetchMedia(ref)).rejects.toThrow()
 expect(fetch).toHaveBeenCalledTimes(3)
 const missing=structuredClone(source);missing.relation.rel_uid=''
 expect(media.richContentBlocks(missing,42)).toEqual([])
 media.dispose()
})

it('forwarded files use the containing mounted occurrence, including nested files, without substituting source owner rights',()=>{
 const runtime=new ServiceRuntime(config,{} as ArkmeSessionStore,{} as StateStore,vi.fn()),media=new MediaService(runtime,{} as never,{} as never,{} as never)
 const blocks=media.forwardContentBlocks([{source_attachment_ref:attachment,name:'nested.pdf',type:4,size:12,download_url:'https://unauthorized.test/file'}],42,{source:chatMediaSource(source)})
 expect(blocks).toHaveLength(1);expect(blocks[0]).toMatchObject({kind:'file',fileName:'nested.pdf',size:12})
 expect(blocks[0]!.originalRef).not.toContain(owner)
 expect(media.forwardContentBlocks([{source_attachment_ref:'',name:'closed.pdf',type:4,download_url:'https://unauthorized.test/file'}],42,{source:chatMediaSource(source)})).toEqual([])
 expect(media.forwardContentBlocks([{source_attachment_ref:attachment,name:'closed.pdf',type:4}],42)).toEqual([])
 media.dispose()
})

it.each(['group','private'])('keeps ordinary %s media and forwarded files when occurrence coordinates carry no source-media marker',chatSessionUid=>{
 const runtime=new ServiceRuntime(config,{} as ArkmeSessionStore,{} as StateStore,vi.fn()),media=new MediaService(runtime,{} as never,{} as never,{} as never)
 const ordinary={relation:{chat_session_uid:chatSessionUid,rel_uid:'ordinary-rel',record_owner_user_id:42,record_uid:'ordinary-record'},record:{payload:{owner_user_id:42,record_uid:'ordinary-record',version:1,media_display_items:[{file_asset_uid:'ordinary-image',file_kind:1,file_name:'photo.png',mime_type:'image/png',download_url:'https://ordinary.test/photo.png'}]}}}
 const occurrence=chatMediaSource(ordinary)!
 expect(media.richContentBlocks(ordinary,42,[],occurrence)).toMatchObject([{kind:'image',fileAssetUid:'ordinary-image',mediaRef:expect.any(String)}])
 const withPreview={...ordinary,content_payload:{media_refs:[{file_asset_uid:'ordinary-image',upload:{attachment_uid:'slot',preview_asset_uid:'preview'}}]},media_display_items:[{file_asset_uid:'preview',preview_for_attachment_uid:'slot',mime_type:'image/webp',size:12,download_url:'https://ordinary.test/preview.webp'}]}
 const photo=media.richContentBlocks(withPreview,42,[],occurrence)[0]!
 expect(photo.thumbnailRef).toMatch(/^arkme-media-v1\./)
 expect(photo.thumbnailRef).not.toBe(photo.originalRef)
 const files=[{type:4,name:'ordinary.pdf',download_url:'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/file.pdf?Signature=fixture'}]
 expect(media.forwardContentBlocks(files,42,{source:occurrence})).toMatchObject([{kind:'file',fileName:'ordinary.pdf',mediaRef:expect.any(String)}])
 // An explicit delegated frame or source marker must never reuse an ordinary URL.
 expect(media.richContentBlocks(ordinary,42,[],{...occurrence,accessRef:'delegation',audienceKey:'team'})).toEqual([])
 expect(media.forwardContentBlocks([{...files[0],source_attachment_ref:''}],42,{source:occurrence})).toEqual([])
 media.dispose()
})
