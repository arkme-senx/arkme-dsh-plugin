// Isolated Browser module workload. It never uses desktop credentials or writes shared service data.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const output=process.env.CODEX_UI_SOAK_OUTPUT
assert(output,'CODEX_UI_SOAK_OUTPUT is required')
const seconds=Number(process.env.CODEX_UI_SOAK_SECONDS??7200)
assert(Number.isInteger(seconds)&&seconds>=60&&seconds<=7200)
await mkdir(output,{recursive:true})
const temp=await mkdtemp(join(tmpdir(),'codex reading window '))
const adapter=join(temp,'api.ts'),entry=join(temp,'entry.tsx')
const sharp=createRequire(join(root,'package.json'))('sharp')
const thumbnail='data:image/webp;base64,'+(await sharp({create:{width:480,height:360,channels:3,background:{r:30,g:90,b:140}}}).webp().toBuffer()).toString('base64')
await writeFile(adapter,`export * from ${JSON.stringify(root+'/src/client/api.ts')};
const total=1000000;const count=50;
const event=n=>({eventId:'e'+n,cursor:'c_'+n,sequence:n,turnSequence:n,messageSequence:0,turnId:'turn'+n,kind:n%3===0?'UserPromptSubmit':n%3===1?'Progress':'Stop',text:'正文 '+n+'\\n\\n'+('稳定历史与分页性能验证。'.repeat(25)),at:1700000000000+n,truncated:false,version:1,...(n%30===2?{privateImages:[{ref:'image'+n,width:480,height:360,state:'ready'}]}:{})});
export async function callArkme(operation,params,signal){signal?.throwIfAborted();
 if(operation==='team.codex.image')return {dataUrl:${JSON.stringify(thumbnail)}};
 if(operation==='codex.local-mark.capabilities')return {supported:true,maxLength:2000,storage:'local'};
 if(operation==='codex.local-mark.list')return params.markRefs.map(actionRef=>({actionRef,snapshot:{revision:1,accessible:true,items:[]}}));
 if(operation!=='team.codex.events')return {items:[],annotations:[]};window.__codexRequests=(window.__codexRequests??0)+1;
 const number=v=>Number(v.slice(2));const forward=!!(params.from||params.after);let first=params.from?number(params.from):params.after?number(params.after)+1:1,last=params.through?number(params.through):total;
 if(params.cursor){if(forward)first=Math.max(first,number(params.cursor)+1);else last=Math.min(last,number(params.cursor)-1)}
 first=Math.max(1,first);last=Math.min(total,last);const lo=forward?first:Math.max(first,last-count+1),hi=forward?Math.min(last,first+count-1):last;
 const items=Array.from({length:Math.max(0,hi-lo+1)},(_,i)=>event(lo+i));return {items,...(items.length&&(forward?hi<last:lo>first)?{nextCursor:'c_'+(forward?hi:lo)}:{})};}
export const requestCount=()=>window.__codexRequests??0;
`)
await writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';
import{TeamCodexConversation,newCodexReadingState}from ${JSON.stringify(root+'/src/client/redesign/contacts/TeamCodexConversation.tsx')};
import{requestCount}from './api';import ${JSON.stringify(root+'/src/client/redesign/arkme-redesign.css')};
import{arkmeAuthStore}from ${JSON.stringify(root+'/src/client/auth-store.ts')};
import{MessageUnderlineSession}from ${JSON.stringify(root+'/src/client/message-underline-session.ts')};
arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7});
const read=MessageUnderlineSession.prototype.read;MessageUnderlineSession.prototype.read=async function(targets){try{return await read.call(this,targets)}finally{window.__markCount=this.snapshots.size}};
const reading=newCodexReadingState();window.__reading=reading;window.__requests=requestCount;
const task={id:'task',title:'百万历史',state:'finished',status:'active',updatedAt:1,eventCount:1000000,member:{userRef:'7',displayName:'本人',role:'member',joinedAtMillis:1,identityState:'ready'},cloud:{sourceId:'source',taskId:'task',ownerRef:'7',sourceName:'来源',remote:true}};
createRoot(document.getElementById('app')).render(<TeamCodexConversation teamRef="team" task={task} reading={reading} inputName="本人"/>);
`)
await writeFile(join(temp,'index.html'),'<!doctype html><html><body><div id="app" style="display:flex;height:700px;width:900px"></div><script type="module" src="/entry.tsx"></script></body></html>')
const {createServer}=await import(join(root,'node_modules/vite/dist/node/index.js'))
const server=await createServer({configFile:false,root:temp,cacheDir:join(temp,'.vite'),server:{host:'127.0.0.1',port:0,fs:{allow:[temp,root]}},resolve:{alias:{react:join(root,'node_modules/react'),'react-dom':join(root,'node_modules/react-dom')},dedupe:['react','react-dom']},plugins:[{name:'isolated-codex-api',enforce:'pre',resolveId(id,importer){if(importer&&importer!==adapter&&/\/api\.js$/.test(id)&&!id.includes('sdk'))return adapter}}]})
await server.listen()
const address=server.httpServer.address();assert(address&&typeof address==='object')
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ANCHOR??join(root,'package.json')))('playwright')
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1100,height:900}}),page=await context.newPage()
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const samples=[],began=Date.now();let cycles=0
try{
 await page.goto('http://127.0.0.1:'+address.port)
 await page.locator('[data-codex-row]').first().waitFor({timeout:60000})
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable')
 let nextSample=Date.now(),oldest=1000000
 while(Date.now()-began<seconds*1000){
  for(let i=0;i<12;i++){const button=page.getByRole('button',{name:'加载更早记录',exact:true});if(!await button.count())break;await button.click();await page.waitForFunction(()=>!document.querySelector('.arkme-codex-older')?.disabled)}
  await page.locator('.arkme-codex-transcript').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'))})
  await page.waitForTimeout(100)
  cycles++
  const state=await page.evaluate(()=>({messages:window.__reading.items.length,bytes:window.__reading.items.reduce((n,e)=>n+new TextEncoder().encode(e.text).byteLength,0),oldest:window.__reading.items[0]?.sequence,newer:window.__reading.newer,marks:window.__markCount??0,images:document.querySelectorAll('.arkme-codex-private-picture img').length,dom:document.querySelectorAll('*').length,requests:window.__requests(),alerts:Array.from(document.querySelectorAll('[role="alert"]')).map(e=>e.textContent)}))
  assert(state.messages<=200&&state.bytes<=2*1024*1024);assert(state.marks<=200&&state.images<=10);assert.equal(state.alerts.length,0);assert.equal(errors.length,0)
  oldest=Math.min(oldest,state.oldest)
  if(cycles%25===0){const jump=page.getByRole('button',{name:/有新内容 ↓|回到最新 ↓/});if(await jump.count())await jump.click()}
  if(Date.now()>=nextSample){await cdp.send('HeapProfiler.collectGarbage');const {metrics}=await cdp.send('Performance.getMetrics');const heap=metrics.find(m=>m.name==='JSHeapUsedSize')?.value;const sample={elapsed_seconds:(Date.now()-began)/1000,cycles,oldest,heap_bytes:heap,...state};samples.push(sample);console.log('browser_soak_sample='+JSON.stringify(sample));await writeFile(join(output,'browser-soak.json'),JSON.stringify({seconds,completed:false,samples,errors},null,2));nextSample=Date.now()+30000}
  await page.waitForTimeout(150)
 }
 await page.screenshot({path:join(output,'reading-window.png')})
 await writeFile(join(output,'browser-soak.json'),JSON.stringify({seconds,elapsed_seconds:(Date.now()-began)/1000,completed:true,cycles,oldest,samples,errors},null,2))
}finally{await browser.close();await server.close()}
