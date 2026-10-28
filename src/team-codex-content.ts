import { createHash } from 'node:crypto'
import { createGzip, createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { TeamCodexCloudJournal,CloudBatch } from './team-codex-cloud-journal.js'

type Post=<T>(owner:number,path:string,body:Record<string,unknown>,signal:AbortSignal)=>Promise<T>
export type CodexContentCache=Map<string,{body:Record<string,unknown>;bytes:number}>
type Grant={url:string;headers:Record<string,string>;expires_at:number}
const phase=(kind:string)=>kind==='Progress'?1:kind==='Interrupt'?2:kind==='Stop'?3:0
let transfers=0
async function boundedTransfer<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{signal.throwIfAborted();if(transfers>=2)throw new Error('CONTENT_BUSY');transfers++;try{return await work()}finally{transfers--}}

/** One bounded compression/upload owner; credentials stay in Host, outside UI and model tools. */
export function uploadCodexObject(owner:number,post:Post,scope:{team_ref:string;source_id:string},task:string,kind:'messages'|'queue',block:string,body:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{return boundedTransfer(signal,()=>uploadObject(owner,post,scope,task,kind,block,body,signal))}
async function uploadObject(owner:number,post:Post,scope:{team_ref:string;source_id:string},task:string,kind:'messages'|'queue',block:string,body:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{
 signal=AbortSignal.any([signal,AbortSignal.timeout(30_000)])
 const raw=Buffer.from(JSON.stringify({schema:'codex.content.v1',...body}))
 if(raw.length>8*1024*1024)throw new Error('PAYLOAD_TOO_LARGE')
 const parts:Buffer[]=[];let size=0
 await pipeline(Readable.from([raw]),createGzip(),async stream=>{for await(const part of stream){size+=part.length;if(size>5*1024*1024)throw new Error('PAYLOAD_TOO_LARGE');parts.push(part)}},{signal})
 const data=Buffer.concat(parts)
 const descriptor={owner_id:owner,team_id:Number(scope.team_ref),source_id:scope.source_id,task_id:task,kind,block_id:block,
  sha256:createHash('sha256').update(data).digest('hex'),md5:createHash('md5').update(data).digest('base64'),size:data.length}
 const prepared=await post<{grant:Grant;base_revision:number}>(owner,'/api/v1/team-codex/content/prepare',{descriptor,base_revision:0},signal)
 const grant=prepared.grant;const url=new URL(grant.url)
 if(url.protocol!=='https:'||url.username||url.password||url.hash||grant.expires_at<=Date.now()||!Number.isSafeInteger(prepared.base_revision))throw new Error('INVALID_OBJECT_GRANT')
 const headers=new Headers()
 for(const [key,value]of Object.entries(grant.headers)){if(!/^[a-z0-9-]{1,64}$/i.test(key)||/[\r\n]/.test(value)||['authorization','cookie','host','proxy-authorization'].includes(key.toLowerCase()))throw new Error('INVALID_OBJECT_GRANT');headers.set(key,value)}
 const response=await fetch(url,{method:'PUT',headers,body:data,redirect:'error',credentials:'omit',signal})
 await response.body?.cancel()
 if(!response.ok&&response.status!==409)throw new Error('CONTENT_UPLOAD_FAILED')
 return post(owner,'/api/v1/team-codex/content/commit',{descriptor,base_revision:prepared.base_revision},signal)
}

export async function syncCodexContent(owner:number,post:Post,journal:TeamCodexCloudJournal,batch:CloudBatch,signal:AbortSignal):Promise<Record<string,unknown>>{
 const metadata={...batch,tasks:batch.tasks.map(task=>({...task,events:[]}))}
 const result=await post<Record<string,unknown>>(owner,'/api/v1/team-codex/sync',metadata,signal)
 if(result.owner_ref!==String(owner))throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
 const accepted=new Set(Array.isArray(result.task_results)?result.task_results.filter(raw=>{const row=raw as Record<string,unknown>;return ['saved','unchanged','stale'].includes(String(row.status))}).map(raw=>String((raw as Record<string,unknown>).task_id)):[])
 const eventResults:unknown[]=[];const blocks=new Set<string>();let count=0
 for(const task of batch.tasks)for(const event of task.events){if(!accepted.has(task.task_id))continue;const block=`${event.turn_seq}-${event.kind==='UserPromptSubmit'?1:phase(event.kind)}-${event.kind==='Progress'?Math.floor((Number(event.message_seq)-1)/4):0}`
  const key=`${task.task_id}:${block}`;if(blocks.has(key))continue;blocks.add(key)
  if(count++>=8)break
  const events=journal.contentBlock(task.task_id,event)
  const committed=await uploadCodexObject(owner,post,batch,task.task_id,'messages',block,{events,summary:journal.contentSummary(task.task_id)},signal)
  if(!Array.isArray(committed.event_results)||committed.owner_ref!==String(owner))throw new Error('INVALID_CONTENT_ACK')
  eventResults.push(...committed.event_results)
 }
 return {...result,event_results:eventResults}
}

const object=(value:unknown):Record<string,unknown>=>{if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_CONTENT_OBJECT');return value as Record<string,unknown>}
export function readCodexContent(value:unknown,source:string,task:string,signal:AbortSignal,owner?:number,cache?:CodexContentCache):Promise<Record<string,unknown>>{return boundedTransfer(signal,()=>readObjects(value,source,task,signal,owner,cache))}
async function readObjects(value:unknown,source:string,task:string,signal:AbortSignal,owner?:number,cache?:CodexContentCache):Promise<Record<string,unknown>>{
 signal=AbortSignal.any([signal,AbortSignal.timeout(30_000)])
 const page=object(value)
 if(!Array.isArray(page.items)||page.items.length>50||!Array.isArray(page.content_objects)||page.content_objects.length>50)throw new Error('INVALID_CONTENT_PAGE')
 const wanted=new Map(page.items.map(raw=>{const row=object(raw);return [String(row.event_id),row]}))
 const decoded=new Map<string,Record<string,unknown>>()
 for(const raw of page.content_objects){const body=await downloadObject(raw,source,task,'messages',signal,cache,owner)
  if(body.schema!=='codex.content.v1'||!Array.isArray(body.events)||body.events.length>5)throw new Error('INVALID_CONTENT_OBJECT')
  for(const rawEvent of body.events){const event=object(rawEvent),id=String(event.event_id),meta=wanted.get(id);if(!meta)continue
   if(decoded.has(id)||event.version!==meta.version||event.turn_id!==meta.turn_id||event.turn_seq!==meta.turn_seq||event.kind!==meta.kind||event.at!==meta.at||Number(event.message_seq??0)!==Number(meta.message_seq??0))throw new Error('CONTENT_INDEX_MISMATCH')
   // EventData JSON scalars have explicit zero values even when omitted in an object.
   decoded.set(id,{...event,text:event.text??'',truncated:event.truncated??false,cursor:meta.cursor,private_images:meta.private_images,images_version:meta.images_version,private_images_unavailable:meta.private_images_unavailable})
  }
 }
 if(decoded.size!==wanted.size)throw new Error('CONTENT_PAGE_INCOMPLETE')
 let queue:Record<string,unknown>|undefined
 if(page.owner_view===true&&page.queue_object&&owner){try{const d=object(object(page.queue_object).descriptor);if(d.owner_id!==owner)throw new Error('PRIVATE_CONTENT_OWNER_MISMATCH');const body=await downloadObject(page.queue_object,source,task,'queue',signal);if(body.schema!=='codex.content.v1')throw new Error('INVALID_CONTENT_OBJECT');queue=queuePayload(body.queue);queue.observed_at=Math.max(Number(queue.observed_at),Number(page.queue_observed_at??0))}catch{signal.throwIfAborted()}}
 return {...page,queue_object:undefined,content_objects:undefined,queue_snapshot:queue,items:page.items.map(raw=>decoded.get(String(object(raw).event_id)))}
}

async function downloadObject(value:unknown,source:string,task:string,kind:'messages'|'queue',signal:AbortSignal,cache?:CodexContentCache,viewer?:number):Promise<Record<string,unknown>>{
 const entry=object(value),d=object(entry.descriptor),g=object(entry.grant),url=new URL(String(g.url))
  if(d.source_id!==source||d.task_id!==task||d.kind!==kind||url.protocol!=='https:'||url.username||url.password||url.hash||Number(g.expires_at)<=Date.now()||!Number.isSafeInteger(d.size)||Number(d.size)<1||Number(d.size)>5*1024*1024||!/^[0-9a-f]{64}$/.test(String(d.sha256)))throw new Error('INVALID_CONTENT_OBJECT')
  const headers=new Headers({'accept-encoding':'identity'})
  for(const [key,value]of Object.entries(object(g.headers??{}))){if(typeof value!=='string'||/[\r\n]/.test(value)||['authorization','cookie','host','proxy-authorization','accept-encoding'].includes(key.toLowerCase()))throw new Error('INVALID_OBJECT_GRANT');headers.set(key,value)}
  const key=JSON.stringify([viewer??0,source,task,d.sha256,d.size])
  signal.throwIfAborted()
  const cached=kind==='messages'?cache?.get(key):undefined
  if(cached){cache!.delete(key);cache!.set(key,cached);return cached.body}
  const response=await fetch(url,{headers,redirect:'error',credentials:'omit',signal})
  if(!response.ok||!response.body){await response.body?.cancel();throw new Error('CONTENT_DOWNLOAD_FAILED')}
  let compressed=0,expanded=0;const sha=createHash('sha256'),parts:Buffer[]=[]
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),async function*(stream){for await(const part of stream){compressed+=part.length;if(compressed>Number(d.size))throw new Error('PAYLOAD_TOO_LARGE');sha.update(part);yield part}},createGunzip(),async stream=>{for await(const part of stream){expanded+=part.length;if(expanded>8*1024*1024)throw new Error('PAYLOAD_TOO_LARGE');parts.push(part)}},{signal})
  if(compressed!==Number(d.size)||sha.digest('hex')!==d.sha256)throw new Error('CONTENT_DIGEST_MISMATCH')
  const body=object(JSON.parse(Buffer.concat(parts).toString('utf8')))
  signal.throwIfAborted()
  if(cache&&kind==='messages'&&body.schema==='codex.content.v1'){
    while(cache.size&&(cache.size>=64||[...cache.values()].reduce((sum,item)=>sum+item.bytes,0)+expanded>8*1024*1024))cache.delete(cache.keys().next().value!)
    cache.set(key,{body,bytes:expanded})
  }
  return body

}

// Direct objects preserve the raw JSON, so restore the queue DTO's scalar defaults
// here just as the server JSON decoder does, before the existing business parser.
function queuePayload(value:unknown):Record<string,unknown>{
 const q=object(value)
 if(!Array.isArray(q.items)||q.items.length>200)throw new Error('INVALID_CONTENT_OBJECT')
 return {...q,source_at:q.source_at??null,items:q.items.map(value=>{const item=object(value);return {...item,text:item.text??'',created_at:item.created_at??0,attachment_count:item.attachment_count??0,paused:item.paused??false,truncated:item.truncated??false}})}
}
