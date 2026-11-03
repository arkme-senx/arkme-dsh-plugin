import {afterEach,expect,it,vi} from 'vitest'
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import ts from 'typescript'
import {readCodexContent} from '../src/team-codex-content.js'

afterEach(()=>vi.unstubAllGlobals())
const frozen=readFileSync(new URL('./fixtures/codex-content-v1.json',import.meta.url))
const events=JSON.parse(frozen.toString()).events as Record<string,unknown>[]
const page=(data:Buffer,items=events)=>({items:items.map(e=>({...e,text:'',cursor:'cursor-'+e.event_id})),content_objects:[{descriptor:{source_id:'source',task_id:'task',kind:'messages',sha256:createHash('sha256').update(data).digest('hex'),size:data.length},grant:{url:'https://private.invalid/frozen',headers:{},expires_at:Date.now()+60_000}}]})

it('restores immutable v1 history in a fresh Host without DSH native packages, a local transcript or a native event serializer',()=>{
 const directory=mkdtempSync(join(tmpdir(),'codex v1 upgrade '))
 try{
  const source=readFileSync(new URL('../src/team-codex-content.ts',import.meta.url),'utf8')
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  writeFileSync(join(directory,'content.mjs'),compiled)
  writeFileSync(join(directory,'no-dsh.mjs'),`export async function resolve(s,c,n){if(s.startsWith('@deepseek-ai/'))throw Error('native DSH dependency forbidden');return n(s,c)}`)
  const data=gzipSync(frozen)
  writeFileSync(join(directory,'read.mjs'),`import{readCodexContent}from'./content.mjs';import{strict as assert}from'node:assert';const data=Buffer.from('${data.toString('base64')}','base64');globalThis.fetch=async()=>new Response(data);const page=${JSON.stringify(page(data))};const value=await readCodexContent(page,'source','task',new AbortController().signal);assert.deepEqual(value.items.map(e=>e.text),${JSON.stringify(events.map(e=>e.text))});assert.equal(value.items[1].message_seq,1);console.log('frozen_v1_restored_without_dsh')`)
  const result=spawnSync(process.execPath,['--loader',pathToFileURL(join(directory,'no-dsh.mjs')).href,join(directory,'read.mjs')],{encoding:'utf8',timeout:15_000,env:{...process.env,DSH_HOME:join(directory,'empty-profile')}})
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('frozen_v1_restored_without_dsh')
 }finally{rmSync(directory,{recursive:true,force:true})}
})

it('rejects an unsupported future schema without corrupting the old bytes and can immediately read the old history again',async()=>{
 const good=gzipSync(frozen),bad=gzipSync(frozen.toString().replace('codex.content.v1','codex.content.v999'))
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(bad)))
 await expect(readCodexContent(page(bad),'source','task',new AbortController().signal)).rejects.toThrow('INVALID_CONTENT_OBJECT')
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(good)))
 const result=await readCodexContent(page(good),'source','task',new AbortController().signal)
 expect((result.items as Record<string,unknown>[]).map(e=>e.text)).toEqual(events.map(e=>e.text))
 expect(readFileSync(new URL('./fixtures/codex-content-v1.json',import.meta.url))).toEqual(frozen)
})

it('bounds concurrent full-page restoration, rejects excess work and releases capacity after cancellation',async()=>{
 const all=Array.from({length:50},(_,i)=>({...events[1],event_id:'e'+i,text:'历史正文'.repeat(1024),message_seq:i+1}))
 const data=all.map(e=>gzipSync(JSON.stringify({schema:'codex.content.v1',events:[e]})))
 const wire={items:all.map(e=>({...e,text:''})),content_objects:all.map((e,i)=>({...page(data[i]!,[e]).content_objects[0],grant:{url:`https://private.invalid/${i}`,headers:{},expires_at:Date.now()+60_000}}))}
 let active=0,peak=0,calls=0
 vi.stubGlobal('fetch',vi.fn(async(url:unknown,input:RequestInit)=>{calls++;active++;peak=Math.max(peak,active);try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,2);input.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(input.signal!.reason)},{once:true})});return new Response(data[Number(new URL(String(url)).pathname.slice(1))]!)}finally{active--}}))
 const begin=performance.now(),controllers=Array.from({length:32},()=>new AbortController())
 const pending=controllers.map(c=>readCodexContent(wire,'source','task',c.signal));controllers[0]!.abort()
 const results=await Promise.allSettled(pending)
 expect(peak).toBeLessThanOrEqual(2);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
 expect(results.filter(r=>r.status==='rejected'&&String(r.reason).includes('CONTENT_BUSY'))).toHaveLength(30)
 const next=await readCodexContent(wire,'source','task',new AbortController().signal)
 expect(next.items).toHaveLength(50);expect(active).toBe(0)
 console.log(JSON.stringify({host_pressure:{callers:32,page_messages:50,max_object_fetches:peak,fetches:calls,elapsed_ms:performance.now()-begin,cancellation:true,recovery:true}}))
},15_000)
