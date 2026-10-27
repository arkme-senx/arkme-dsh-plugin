import {createHash} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'

export function codexObjectFixture(){
 const objects=new Map<string,Buffer>(),uploads:Record<string,unknown>[]=[]
 const grant=(key:string)=>({url:`https://private.invalid/${key}`,headers:{},expires_at:Date.now()+60_000})
 const fetch=async(url:URL|string|Request,input?:RequestInit)=>{const key=new URL(String(url)).pathname.slice(1)
  if(input?.method==='PUT'){const data=Buffer.from(input.body as Uint8Array);objects.set(key,data);uploads.push(JSON.parse(gunzipSync(data).toString()));return new Response(null,{status:200})}
  const data=objects.get(key);return data?new Response(data):new Response(null,{status:404})}
 const prepare=(descriptor:Record<string,unknown>)=>({grant:grant(String(descriptor.sha256)),base_revision:0})
 const body=(descriptor:Record<string,unknown>)=>JSON.parse(gunzipSync(objects.get(String(descriptor.sha256))!).toString()) as Record<string,unknown>
 const page=(source:string,task:string,events:Record<string,unknown>[],extra:Record<string,unknown>={})=>{
  const data=gzipSync(JSON.stringify({schema:'codex.content.v1',events})),hash=createHash('sha256').update(data).digest('hex');objects.set(hash,data)
  return {items:events.map(event=>({...event,text:''})),content_objects:[{descriptor:{source_id:source,task_id:task,kind:'messages',sha256:hash,size:data.length},grant:grant(hash)}],has_more:false,...extra}
 }
 return {objects,uploads,grant,fetch,prepare,body,page}
}
