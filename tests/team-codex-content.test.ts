import {afterEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {uploadCodexObject,readCodexContent} from '../src/team-codex-content.js'

afterEach(()=>vi.unstubAllGlobals())
const event={event_id:'event',version:1,turn_id:'turn',turn_seq:1,message_seq:1,kind:'Progress',text:'真实过程回复',at:100,truncated:false}
const grant={url:'https://private.invalid/object',headers:{},expires_at:Date.now()+60_000}
const body=()=>({schema:'codex.content.v1',events:[event]})
function page(data:Buffer){return {items:[{...event,text:'',cursor:'cursor',content_ref:'block'}],content_objects:[{descriptor:{source_id:'source',task_id:'task',kind:'messages',size:data.length,sha256:createHash('sha256').update(data).digest('hex')},grant}],has_more:false}}
it('uploads bounded compressed bytes directly and returns ACK only after commit',async()=>{
 const uploaded:Buffer[]=[];const fetch=vi.fn(async(_url:unknown,input:RequestInit)=>{expect(input.redirect).toBe('error');expect(input.credentials).toBe('omit');uploaded.push(Buffer.from(input.body as Uint8Array));return new Response(null,{status:200})});vi.stubGlobal('fetch',fetch)
 const calls:string[]=[];const post=vi.fn(async(_owner:number,path:string,value:Record<string,unknown>)=>{calls.push(path);expect(value).not.toHaveProperty('events');return path.endsWith('/prepare')?{grant,base_revision:3}:{owner_ref:'3016',event_results:[{event_id:'event',status:'saved',version:1}]}})
 const result=await uploadCodexObject(3016,post as never,{source_id:'source',team_ref:'15'},'task','messages','1-1-0',{events:[event]},new AbortController().signal)
 expect(calls).toEqual(['/api/v1/team-codex/content/prepare','/api/v1/team-codex/content/commit']);expect(JSON.parse(gunzipSync(uploaded[0]!).toString())).toEqual(body());expect(result.owner_ref).toBe('3016')
})
it('never commits after the object upload fails',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:503})));const post=vi.fn(async()=>({grant,base_revision:0}));await expect(uploadCodexObject(3016,post as never,{source_id:'source',team_ref:'15'},'task','messages','1-1-0',{events:[event]},new AbortController().signal)).rejects.toThrow('CONTENT_UPLOAD_FAILED');expect(post).toHaveBeenCalledTimes(1)})
it('verifies object content against its index and preserves authorized private metadata',async()=>{const data=gzipSync(JSON.stringify(body()));vi.stubGlobal('fetch',vi.fn(async()=>new Response(data)));const wire=page(data);(wire.items[0] as Record<string,unknown>).private_images=[{image_id:'private'}];const result=await readCodexContent(wire,'source','task',new AbortController().signal);expect((result.items as Record<string,unknown>[])[0]).toMatchObject({text:event.text,cursor:'cursor',private_images:[{image_id:'private'}]});expect(result.content_objects).toBeUndefined()})
it('rejects a valid object from another scope before accessing the network',async()=>{const data=gzipSync(JSON.stringify(body())),fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(readCodexContent(page(data),'other-source','task',new AbortController().signal)).rejects.toThrow('INVALID_CONTENT_OBJECT');expect(fetch).not.toHaveBeenCalled()})
it('rejects checksum corruption and oversized expanded objects',async()=>{const data=gzipSync(JSON.stringify(body())),wire=page(data);wire.content_objects[0]!.descriptor.sha256='0'.repeat(64);vi.stubGlobal('fetch',vi.fn(async()=>new Response(data)));await expect(readCodexContent(wire,'source','task',new AbortController().signal)).rejects.toThrow('CONTENT_DIGEST_MISMATCH');const bomb=gzipSync('x'.repeat(8*1024*1024+1));vi.stubGlobal('fetch',vi.fn(async()=>new Response(bomb)));await expect(readCodexContent(page(bomb),'source','task',new AbortController().signal)).rejects.toThrow('PAYLOAD_TOO_LARGE')})
it('rejects credentials embedded in a signed URL',async()=>{const data=gzipSync(JSON.stringify(body())),wire=page(data);wire.content_objects[0]!.grant={...grant,url:'https://user:secret@private.invalid/object'};await expect(readCodexContent(wire,'source','task',new AbortController().signal)).rejects.toThrow('INVALID_CONTENT_OBJECT')})

it('isolates a failed private queue download from readable public messages',async()=>{
 const data=gzipSync(JSON.stringify(body())),wire={...page(data),owner_view:true,queue_object:{descriptor:{owner_id:3016,source_id:'source',task_id:'task',kind:'queue',size:1,sha256:'0'.repeat(64)},grant:{...grant,url:'https://private.invalid/queue'}}}
 vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>String(url).endsWith('/queue')?new Response(null,{status:503}):new Response(data)))
 const result=await readCodexContent(wire,'source','task',new AbortController().signal,3016);expect((result.items as typeof event[])[0]?.text).toBe(event.text);expect(result.queue_snapshot).toBeUndefined();expect(result.queue_object).toBeUndefined()
})
it('keeps physical retry bytes stable for unchanged source content',async()=>{
 const uploaded:Buffer[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:unknown,input:RequestInit)=>{uploaded.push(Buffer.from(input.body as Uint8Array));return new Response(null,{status:200})}))
 const post=vi.fn(async(_owner:number,path:string)=>path.endsWith('/prepare')?{grant,base_revision:0}:{owner_ref:'3016',event_results:[]})
 for(let n=0;n<2;n++)await uploadCodexObject(3016,post as never,{source_id:'source',team_ref:'15'},'task','messages','1-1-0',{events:[event],summary:{version:1,event_count:1,latest_at:100,state:'in_progress'}},new AbortController().signal)
 expect(uploaded[0]).toEqual(uploaded[1])
})

it.each([undefined,null])('accepts an OSS GET grant without extra headers (%s)',async(headers)=>{
 const data=gzipSync(JSON.stringify(body())),wire=page(data);(wire.content_objects[0]!.grant as Record<string,unknown>).headers=headers
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(data)))
 expect(((await readCodexContent(wire,'source','task',new AbortController().signal)).items as typeof event[])[0]?.text).toBe(event.text)
})

it('restores declared EventData scalar defaults after direct object transport',async()=>{
 const value={...event} as Record<string,unknown>;delete value.truncated;delete value.text
 const data=gzipSync(JSON.stringify({schema:'codex.content.v1',events:[value]}));vi.stubGlobal('fetch',vi.fn(async()=>new Response(data)))
 const result=await readCodexContent(page(data),'source','task',new AbortController().signal)
 expect((result.items as Record<string,unknown>[])[0]).toMatchObject({text:'',truncated:false})
})

it('restores queue DTO scalar defaults before the existing business decoder',async()=>{
 const data=gzipSync(JSON.stringify({schema:'codex.content.v1',queue:{schema_version:1,visibility:'owner',version:1,observed_at:100,changed_at:100,availability:'ready',reason:'none',items:[{request_id:'request',text:'private',delivery:'queue',state:'queued'}]}}))
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(data)))
 const queue={descriptor:{owner_id:3016,source_id:'source',task_id:'task',kind:'queue',size:data.length,sha256:createHash('sha256').update(data).digest('hex')},grant}
 const value=await readCodexContent({items:[],content_objects:[],has_more:false,owner_view:true,queue_object:queue},'source','task',new AbortController().signal,3016)
 expect(value.queue_snapshot).toMatchObject({source_at:null,items:[{created_at:0,attachment_count:0,paused:false,truncated:false,text:'private'}]})
})
