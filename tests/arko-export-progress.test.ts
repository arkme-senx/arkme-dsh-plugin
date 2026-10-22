import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { createArkmeHostApi } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import type { ArkmeArkoExportProgress } from '../src/arko-history-contract.js'

const cleanups:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const close of cleanups.splice(0))await close()})
const result={fileRef:'arkme-generated-v1.synthetic',fileName:'Arko.md',size:20,count:100,expiresAtMillis:Date.now()+60000}
async function live(owner:(signal:AbortSignal,notify:(p:ArkmeArkoExportProgress)=>void)=>Promise<typeof result>){
 const service={arkoExport:vi.fn(owner),arkoMessages:vi.fn(async()=>({items:[],hasMore:false,scanned:0,consistency:'live'}))}
 let handler:ReturnType<typeof createArkmeHostApi>
 const server=createServer((req,res)=>{void handler(req,res)})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const port=(server.address() as {port:number}).port,origin=`http://127.0.0.1:${port}`
 handler=createArkmeHostApi(service as never,{expectedPort:port,allowNonLoopback:false})
 cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))})
 const sdk=createArkmeSdk({fetchImpl:async(url,init)=>{
  if(JSON.parse(String(init?.body)).operation==='provider.capabilities')return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{arkoHistoryReadsV1:true}}}))
  return fetch(new URL(String(url),origin),{...init,headers:{...init?.headers,Origin:origin}})
 }})
 return {sdk,service}
}
it('streams request-scoped progress through real HTTP without blocking ordinary Host calls',async()=>{
 let finish!:()=>void
 const {sdk,service}=await live(async(_signal,notify)=>{notify({count:0});notify({count:5});await new Promise<void>(resolve=>{finish=resolve});notify({count:100});return result})
 const progress:number[]=[];const pending=sdk.arkoExport(undefined,p=>progress.push(p.count))
 await vi.waitFor(()=>expect(progress).toEqual([0,5]))
 await expect(sdk.arkoMessages()).resolves.toMatchObject({items:[]})
 finish();await expect(pending).resolves.toEqual(result)
 expect(progress).toEqual([0,5,100]);expect(service.arkoExport).toHaveBeenCalledOnce()
})
it('propagates UI cancellation to the real Host owner without a final artifact',async()=>{
 let observed!:AbortSignal
 const {sdk}=await live(async(signal,notify)=>{observed=signal;notify({count:2});await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return result})
 const controller=new AbortController(),progress=vi.fn()
 const pending=sdk.arkoExport(controller.signal,progress);const outcome=pending.then(()=>false,()=>true)
 await vi.waitFor(()=>expect(progress).toHaveBeenCalledWith({count:2}))
 controller.abort();expect(await outcome).toBe(true)
 await vi.waitFor(()=>expect(observed.aborted).toBe(true))
})
it.each([
 '{"kind":"progress","count":3}\n',
 '{"kind":"progress","count":3}\n{"kind":"progress","count":2}\n',
 '{"kind":"progress","count":-1}\n',
 '{broken}\n',
 JSON.stringify({kind:'result',value:result}),
 JSON.stringify({kind:'result',value:result})+'\n'+JSON.stringify({kind:'progress',count:100})+'\n',
 'x'.repeat(17000)+'\n',
])('rejects malformed, regressing, or incomplete progress without returning a file',async body=>{
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>JSON.parse(String(init?.body)).operation==='provider.capabilities'
  ?new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{arkoHistoryReadsV1:true}}}))
  :new Response(body,{headers:{'Content-Type':'application/x-ndjson'}})})
 await expect(sdk.arkoExport(undefined,()=>{})).rejects.toMatchObject({body:{code:'local-response-invalid'}})
})
