import {it,expect,vi} from 'vitest'
import {MediaService} from '../src/services/media-service.js'
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
 const blocks=media.forwardContentBlocks([{source_attachment_ref:attachment,name:'nested.pdf',type:4,size:12,download_url:'https://unauthorized.test/file'}],42,{source:media.chatMediaSource(source)})
 expect(blocks).toHaveLength(1);expect(blocks[0]).toMatchObject({kind:'file',fileName:'nested.pdf',size:12})
 expect(blocks[0]!.originalRef).not.toContain(owner)
 expect(media.forwardContentBlocks([{source_attachment_ref:'',name:'closed.pdf',type:4,download_url:'https://unauthorized.test/file'}],42,{source:media.chatMediaSource(source)})).toEqual([])
 expect(media.forwardContentBlocks([{source_attachment_ref:attachment,name:'closed.pdf',type:4}],42)).toEqual([])
 media.dispose()
})
