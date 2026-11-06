import {expect,it,vi} from 'vitest'
import {MediaService,type ArkmeChatMediaSource} from '../src/services/media-service.js'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../src/services/service.js'
import {parseOwnerJson} from '../src/record-owner-id.js'

const source:ArkmeChatMediaSource={accessRef:'private-signed-group-frame',chatSessionUid:'group',relationUid:'relation',recordOwnerUserId:'9223372036854775806',recordUid:'record',version:3,audienceKey:'team-admission-scope'}
function fixture() {
 let revoked=false,mime='text/plain',content='abc',marked=true
 const requests:{url:string;body:unknown;headers:Headers}[]=[]
 const fetchImpl=vi.fn(async(url,init)=>{
  const headers=new Headers(init?.headers);requests.push({url:String(url),body:parseOwnerJson(String(init?.body)),headers})
  expect(init?.method).toBe('POST')
  if(revoked)return new Response(null,{status:404})
  const partial=headers.get('Range')==='bytes=1-2',body=partial?content.slice(1,3):content
  return new Response(body,{status:partial?206:200,headers:{'content-type':mime,'content-length':String(Buffer.byteLength(body)),'cache-control':'private, no-store',...(marked?{'X-Jotmo-Source-Stream':'1'}:{}),...(partial?{'content-range':`bytes 1-2/${Buffer.byteLength(content)}`}:{})}})
 }) as typeof fetch
 const sessions={read:async()=>({userId:42,accessToken:'fake-token',refreshToken:'fake-refresh'}),write:async()=>{},delete:async()=>{}}
 const runtime=new ServiceRuntime({environment:'test',recordBaseUrl:'https://record.example',authBaseUrl:'https://auth.example',requestTimeoutMs:1000} as ArkmeServiceConfig,sessions,{uniqueCode:async()=> 'fake-key'} as StateStore,fetchImpl)
 const media=new MediaService(runtime,{} as never,{} as never,{recordUid:()=> 'record'})
 const raw={media_display_items:[{file_asset_uid:'asset',file_name:'original.txt',file_kind:4,mime_type:'text/plain',size:3,source_attachment_ref:'a'.repeat(64)}]}
 return {media,raw,requests,revoke:()=>{revoked=true},json:()=>{mime='application/json';content='{"code":1004}'},unmark:()=>{marked=false}}
}

it('streams an exact source attachment with Range, preserves owner precision and denies the same reference after revocation',async()=>{
 const f=fixture(),block=f.media.richContentBlocks(f.raw,42,[],source)[0]!
 expect(block.originalRef).toBe(block.mediaRef)
 expect(JSON.stringify(block)).not.toContain(source.accessRef)
 const opening=await f.media.fetchMedia(block.mediaRef,'bytes=1-2')
 expect(await opening.response.text()).toBe('bc')
 expect(opening.response.status).toBe(206)
 expect(opening.response.headers.get('Cache-Control')).toContain('no-store')
 expect(JSON.stringify(opening.descriptor)).not.toContain(source.accessRef)
 expect(f.requests[0]!.body).toEqual({access_ref:source.accessRef,chat_session_uid:'group',relation_uid:'relation',record_owner_user_id:source.recordOwnerUserId,record_uid:'record',version:3,attachment:'a'.repeat(64)})
 expect(f.requests[0]!.headers.get('Authorization')).toBe('Bearer fake-token')
 const head=await f.media.fetchMedia(block.mediaRef,undefined,undefined,true,'HEAD')
 expect(head.response.body).toBeNull()
 f.revoke()
 await expect(f.media.fetchMedia(block.mediaRef)).rejects.toMatchObject({httpStatus:404})
 expect(f.requests.every(r=>r.url==='https://record.example/api/v1/content/source-stream')).toBe(true)
})

it('keeps JSON attachments distinct from error envelopes and does not upgrade an unbound source to a signed URL',async()=>{
 const f=fixture();f.json()
 const block=f.media.richContentBlocks(f.raw,42,[],source)[0]!
 expect(await (await f.media.fetchMedia(block.mediaRef)).response.text()).toBe('{"code":1004}')
 f.unmark()
 await expect(f.media.fetchMedia(block.mediaRef)).rejects.toThrow()
 const unbound={media_display_items:[{...f.raw.media_display_items[0],source_attachment_ref:undefined,download_url:'https://userfiles.example/personal'}]}
 expect(f.media.richContentBlocks(unbound,42,[],source)).toEqual([])
 const other=f.media.richContentBlocks(f.raw,42,[],{...source,audienceKey:'another-team-scope'})[0]!
 expect(other.mediaRef).not.toBe(block.mediaRef)
 const newer=f.media.richContentBlocks(f.raw,42,[],{...source,version:4})[0]!
 expect(newer.mediaRef).not.toBe(block.mediaRef)
})
