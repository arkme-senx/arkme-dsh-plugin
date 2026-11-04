// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { arkoTimelineMemory } from '../src/client/arko-timeline-memory.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeArkoTimelineCache } from '../src/arko-timeline-contract.js'
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:vi.fn()}))
const cache = ():ArkmeArkoTimelineCache=>({schemaVersion:1,savedAtMillis:Date.now(),messages:[{id:'history:1',messageId:1,sessionId:88,role:'user',text:'已加载的普通聊天',status:'done',createdAtMillis:1000}],interactions:[{interactionKey:'thought-1',interactionRef:'opaque',occurredAtMillis:2000,kind:'self',sourceName:'复盘',summary:'已加载的互动',suggestion:false}],session:{sessionId:88,name:'Arko',created:false},historyCursor:'old-chat-page',interactionCursor:'old-interaction-page',viewport:{scrollTop:123,followTail:false}})
beforeEach(()=>{arkoTimelineMemory.clear();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('IntersectionObserver',class { observe(){} disconnect(){} });vi.stubGlobal('requestAnimationFrame',()=>0);vi.stubGlobal('cancelAnimationFrame',vi.fn());arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:10001})})
afterEach(()=>{arkoTimelineMemory.clear();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()})
it('paints both ready streams while cloud reads are pending and preserves loaded cursors on return',async()=>{
 arkoTimelineMemory.set('test:10001',cache())
 vi.mocked(callArkme).mockImplementation(async(method)=>{if(method==='arko.timeline.cache')return undefined as never;return new Promise(()=>{}) as never})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(<ArkmeArkoSurface/>));expect(host.textContent).toContain('已加载的普通聊天');expect(host.textContent).toContain('已加载的互动');expect(host.textContent).not.toContain('正在恢复会话')
 expect(vi.mocked(callArkme).mock.calls.find(([m])=>m==='arko.messages')?.[1]).toEqual({startAtMillis:1000,direction:'asc',limit:50})
 expect(vi.mocked(callArkme).mock.calls.find(([m,p])=>m==='arko.interactions'&&!(p as any)?.knownRefs)?.[1]).toEqual({limit:20,afterMillis:2000})
 }finally{await act(async()=>root.unmount());host.remove()}
 expect(arkoTimelineMemory.get('test:10001')).toMatchObject({historyCursor:'old-chat-page',interactionCursor:'old-interaction-page'})
})
it('renders cold direct history without waiting for profile, suggestions or session metadata',async()=>{
 vi.mocked(callArkme).mockImplementation(async(method)=>{if(method==='arko.timeline.cache')return undefined as never;if(method==='arko.messages')return {items:[{messageId:2,sessionId:88,role:'assistant',text:'先看到普通聊天',reasoning:'',createdAtMillis:3000,status:1,createdRecordUids:[]}],hasMore:false,scanned:1,consistency:'live'} as never;return new Promise(()=>{}) as never})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(<ArkmeArkoSurface/>));expect(host.textContent).toContain('先看到普通聊天');expect(host.textContent).not.toContain('正在恢复会话')}finally{await act(async()=>root.unmount());host.remove()}
})
it('rejects late previous-account data and never writes it under the next account',async()=>{
 arkoTimelineMemory.set('test:10001',cache());let finish:((value:unknown)=>void)|undefined
 vi.mocked(callArkme).mockImplementation(async(method)=>{if(method==='arko.timeline.cache')return undefined as never;if(method==='arko.interactions')return new Promise(resolve=>{finish=resolve}) as never;return new Promise(()=>{}) as never})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(<ArkmeArkoSurface/>));await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:10002}));expect(host.textContent).not.toContain('已加载的普通聊天');await act(async()=>finish?.({accountScope:'test:10001',items:cache().interactions,hasMore:false,removedKeys:[]}));expect(host.textContent).not.toContain('已加载的互动')
 }finally{await act(async()=>root.unmount());host.remove()}
 expect(arkoTimelineMemory.get('test:10002')?.messages??[]).toEqual([])
})
it('runs every warm history page through the real Host query validator',async()=>{
 vi.useRealTimers()
 vi.stubGlobal('requestAnimationFrame',()=>0);vi.stubGlobal('cancelAnimationFrame',vi.fn())
 const {ArkoService}=await import('../src/services/arko-service.js')
 const {ServiceRuntime}=await import('../src/services/service.js')
 const {ProfileService}=await import('../src/services/profile-service.js')
 const wireBodies:unknown[]=[]
 const runtime=new ServiceRuntime({environment:'test',intelligentBaseUrl:'https://intelligent.test',requestTimeoutMs:5000} as never,
  {async read(){return {userId:10001,accessToken:'synthetic',refreshToken:'synthetic'}},async write(){},async delete(){}},
  {async uniqueCode(){return 'synthetic-cache-test'}} as never,
  async(_url,init)=>{wireBodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({code:200,data:{items:[],has_more:wireBodies.length===1,...(wireBodies.length===1?{next_cursor:'next-warm-page'}:{}),scanned:0,consistency:'live'}}),{headers:{'Content-Type':'application/json'}})})
 const service=new ArkoService(runtime,new ProfileService(runtime))
 arkoTimelineMemory.set('test:10001',cache())
 vi.mocked(callArkme).mockImplementation(async(method,params,signal)=>{
  if(method==='arko.messages')return service.arkoMessages(params as never,signal) as never
  if(method==='arko.session')return {sessionId:88,name:'Arko',created:false} as never
  return new Promise(()=>{}) as never
 })
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<ArkmeArkoSurface/>))
  // Real Host validation rejects 100 before HTTP; both cursor pages must reach it.
  await act(async()=>{await vi.waitFor(()=>expect(wireBodies).toHaveLength(2))})
  expect(wireBodies).toEqual([{limit:50,direction:'asc',start_at:1000},{limit:50,direction:'asc',cursor:'next-warm-page',start_at:1000}])
  expect(host.textContent).toContain('已加载的普通聊天');expect(host.textContent).toContain('已加载的互动')
  expect(host.textContent).not.toContain('历史查询参数无效')
 }finally{await act(async()=>root.unmount());host.remove();service.dispose();runtime.dispose()}
})
