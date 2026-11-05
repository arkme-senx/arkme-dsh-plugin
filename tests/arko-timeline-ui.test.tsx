// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { ArkoInteractionRow } from '../src/client/ArkoInteractionRow.js'
import { arkoTimelineMemory } from '../src/client/arko-timeline-memory.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { publishThoughtInvalidation } from '../src/client/thought-invalidations.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeArkoTimelineCache } from '../src/arko-timeline-contract.js'
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:vi.fn()}))
const cache = ():ArkmeArkoTimelineCache=>({schemaVersion:2,savedAtMillis:Date.now(),messages:[{id:'history:1',messageId:1,sessionId:88,role:'user',text:'已加载的普通聊天',status:'done',createdAtMillis:1000}],interactions:[{interactionKey:'thought-1',interactionRef:'opaque',occurredAtMillis:2000,kind:'self',sourceName:'复盘',summary:'已加载的互动',suggestion:false}],session:{sessionId:88,name:'Arko',created:false},historyCursor:'old-chat-page',interactionCursor:'old-interaction-page',viewport:{scrollTop:123,followTail:false}})
beforeEach(()=>{arkoTimelineMemory.clear();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('IntersectionObserver',class { observe(){} disconnect(){} });vi.stubGlobal('requestAnimationFrame',()=>0);vi.stubGlobal('cancelAnimationFrame',vi.fn());arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:10001})})
afterEach(()=>{arkoTimelineMemory.clear();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()})
it('paints both ready streams while cloud reads are pending and preserves loaded cursors on return',async()=>{
 arkoTimelineMemory.set('test:10001',cache())
 vi.mocked(callArkme).mockImplementation(async(method)=>{if(method==='arko.timeline.cache')return undefined as never;return new Promise(()=>{}) as never})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(<ArkmeArkoSurface/>));expect(host.textContent).toContain('已加载的普通聊天');expect(host.textContent).not.toContain('已加载的互动');expect(host.textContent).not.toContain('正在恢复会话')
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
  expect(host.textContent).toContain('已加载的普通聊天');expect(host.textContent).not.toContain('已加载的互动')
  expect(host.textContent).not.toContain('历史查询参数无效')
 }finally{await act(async()=>root.unmount());host.remove();service.dispose();runtime.dispose()}
})
it('resumes both clipped streams and repeats the history time filter with its cursor',async()=>{
 const observers:Array<{callback:(entries:unknown[])=>void;options:any;active:boolean}>=[]
 vi.stubGlobal('IntersectionObserver',class{
  entry:{callback:(entries:unknown[])=>void;options:any;active:boolean}
  constructor(callback:(entries:unknown[])=>void,options:any){this.entry={callback,options,active:true};observers.push(this.entry)}
  observe(){} disconnect(){this.entry.active=false}
 })
 const ready={...cache(),historyCursor:undefined,interactionCursor:undefined,historyBeforeMillis:1001,interactionBeforeMillis:2001}
 arkoTimelineMemory.set('test:10001',ready)
 let historyPages=0,interactionPages=0
 vi.mocked(callArkme).mockImplementation(async(method,params)=>{
  const p=params as any
  if(method==='arko.messages'){
   if(p?.startAtMillis)return {items:[],hasMore:false,scanned:0,consistency:'live'} as never
   const more=++historyPages===1
   return {items:[],hasMore:more,...(more?{nextCursor:'history-page-2'}:{}),scanned:0,consistency:'live'} as never
  }
  if(method==='arko.interactions'){
   const older=p?.beforeMillis||p?.cursor==='interaction-page-2',more=older&&++interactionPages===1
   return {accountScope:'test:10001',items:[],removedKeys:[],hasMore:more,...(more?{nextCursor:'interaction-page-2'}:{})} as never
  }
  if(method==='arko.session')return ready.session as never
  return new Promise(()=>{}) as never
 })
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const earlier=()=>{const o=observers.filter(x=>x.active&&x.options?.rootMargin==='120px 0px 0px').at(-1);expect(o).toBeDefined();o!.callback([{isIntersecting:true}])}
 try{
  await act(async()=>root.render(<ArkmeArkoSurface/>))
  await act(async()=>earlier())
  await act(async()=>vi.advanceTimersByTimeAsync(700))
  expect(arkoTimelineMemory.get('test:10001')).toMatchObject({historyCursor:'history-page-2',historyBeforeMillis:1001,interactionCursor:'interaction-page-2'})
  expect(arkoTimelineMemory.get('test:10001')?.interactionBeforeMillis).toBeUndefined()
  await act(async()=>earlier())
  expect(vi.mocked(callArkme).mock.calls.filter(([m,p])=>m==='arko.messages'&&!(p as any)?.startAtMillis).map(x=>x[1])).toEqual([{limit:50,endAtMillis:1001},{limit:50,cursor:'history-page-2',endAtMillis:1001}])
  expect(vi.mocked(callArkme).mock.calls.filter(([m,p])=>m==='arko.interactions'&&((p as any)?.beforeMillis||(p as any)?.cursor)).map(x=>x[1])).toEqual([{limit:20,beforeMillis:2001},{limit:20,cursor:'interaction-page-2'}])
  expect(host.textContent).toContain('已加载的普通聊天');expect(host.textContent).toContain('已加载的互动')
 }finally{await act(async()=>root.unmount());host.remove()}
 expect(arkoTimelineMemory.get('test:10001')?.historyBeforeMillis).toBeUndefined()
 expect(arkoTimelineMemory.get('test:10001')?.interactionBeforeMillis).toBeUndefined()
})

it('keeps the first history cursor when a restored cache contains only interactions',async()=>{
 arkoTimelineMemory.set('test:10001',{...cache(),messages:[],historyCursor:undefined})
 vi.mocked(callArkme).mockImplementation(async(method)=>{
  if(method==='arko.messages')return {items:[{messageId:2,sessionId:88,role:'assistant',text:'最新聊天',reasoning:'',createdAtMillis:3000,status:1,createdRecordUids:[]}],hasMore:true,nextCursor:'first-older-page',scanned:1,consistency:'live'} as never
  if(method==='arko.session')return cache().session as never
  return new Promise(()=>{}) as never
 })
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<ArkmeArkoSurface/>))
  expect(host.textContent).toContain('最新聊天');expect(host.textContent).not.toContain('已加载的互动')
 }finally{await act(async()=>root.unmount());host.remove()}
 expect(arkoTimelineMemory.get('test:10001')?.historyCursor).toBe('first-older-page')
})

it('hides warm sensitive text until proof, rechecks ordinary invalidation, and fences a late proof',async()=>{
 arkoTimelineMemory.set('test:10001',cache())
 const proofs:Array<(page:unknown)=>void>=[]
 vi.mocked(callArkme).mockImplementation(async(method,params)=>{
  if(method==='arko.interactions'&&(params as any)?.knownRefs)return new Promise(resolve=>proofs.push(resolve)) as never
  if(method==='arko.interactions')return {accountScope:'test:10001',items:[],removedKeys:[],hasMore:false} as never
  return new Promise(()=>{}) as never
 })
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const page={accountScope:'test:10001',items:[],removedKeys:[],hasMore:false}
 try{
  await act(async()=>root.render(<ArkmeArkoSurface/>))
  expect(host.textContent).not.toContain('复盘');expect(host.textContent).not.toContain('已加载的互动')
  expect(host.querySelector('[data-arko-interaction="thought-1"]')).not.toBeNull()
  await act(async()=>proofs.shift()?.(page));expect(host.textContent).toContain('已加载的互动')
  await act(async()=>publishThoughtInvalidation({accountScope:'test:10001'}))
  expect(host.textContent).not.toContain('已加载的互动')
  await act(async()=>vi.advanceTimersByTimeAsync(300))
  expect(proofs.length).toBe(1)
  await act(async()=>publishThoughtInvalidation({accountScope:'test:10001',clear:true}))
  await act(async()=>proofs.shift()?.(page))
  expect(host.textContent).not.toContain('已加载的互动')
  await act(async()=>vi.advanceTimersByTimeAsync(300))
  await act(async()=>proofs.shift()?.({...page,removedKeys:['thought-1']}))
  expect(host.querySelector('[data-arko-interaction="thought-1"]')).toBeNull()
 }finally{await act(async()=>root.unmount());host.remove()}
 expect(arkoTimelineMemory.get('test:10001')?.interactions).toEqual([])
})

it('replaces a changed result under the same identity and verifies its new reference on retry',async()=>{
 arkoTimelineMemory.set('test:10001',cache())
 const proofs:Array<(page:unknown)=>void>=[]
 vi.mocked(callArkme).mockImplementation(async(method,params)=>{
  if(method==='arko.interactions'&&(params as any)?.knownRefs)return new Promise(resolve=>proofs.push(resolve)) as never
  if(method==='arko.interactions')return {accountScope:'test:10001',items:[],removedKeys:[],hasMore:false} as never
  return new Promise(()=>{}) as never
 })
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const page={accountScope:'test:10001',items:[],removedKeys:[],hasMore:false}
 const updated={...cache().interactions[0]!,interactionRef:'new-result-reference',summary:'新的已授权结果'}
 try{
  await act(async()=>root.render(<ArkmeArkoSurface/>))
  await act(async()=>proofs.shift()?.({...page,items:[updated]}))
  expect(host.textContent).toContain('新的已授权结果');expect(host.textContent).not.toContain('已加载的互动')
  await act(async()=>window.dispatchEvent(new Event('focus')))
  expect(host.textContent).not.toContain('新的已授权结果')
  const query=vi.mocked(callArkme).mock.calls.filter(([method,params])=>method==='arko.interactions'&&(params as any)?.knownRefs).at(-1)
  expect(query?.[1]).toEqual({knownRefs:['new-result-reference']})
  await act(async()=>proofs.shift()?.(page))
  expect(host.textContent).toContain('新的已授权结果');expect(host.textContent).not.toContain('已加载的互动')
 }finally{await act(async()=>root.unmount());host.remove()}
})

it('hides an already verified cache on disconnect and rechecks it after reconnect',async()=>{
 arkoTimelineMemory.set('test:10001',cache())
 const proofs:Array<(page:unknown)=>void>=[]
 vi.mocked(callArkme).mockImplementation(async(method,params)=>{
  if(method==='arko.interactions'&&(params as any)?.knownRefs)return new Promise(resolve=>proofs.push(resolve)) as never
  if(method==='arko.interactions')return {accountScope:'test:10001',items:[],removedKeys:[],hasMore:false} as never
  return new Promise(()=>{}) as never
 })
 const online=vi.spyOn(window.navigator,'onLine','get').mockReturnValue(true)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const page={accountScope:'test:10001',items:[],removedKeys:[],hasMore:false}
 try{
  await act(async()=>root.render(<ArkmeArkoSurface/>))
  await act(async()=>proofs.shift()?.(page));expect(host.textContent).toContain('已加载的互动')
  online.mockReturnValue(false)
  await act(async()=>window.dispatchEvent(new Event('offline')))
  expect(host.textContent).not.toContain('已加载的互动');expect(host.textContent).not.toContain('复盘')
  expect(host.querySelector('[data-arko-interaction="thought-1"]')).not.toBeNull()
  expect(host.textContent).toContain('已加载的普通聊天');expect(proofs).toHaveLength(0)
  online.mockReturnValue(true)
  await act(async()=>window.dispatchEvent(new Event('online')))
  expect(proofs).toHaveLength(1)
  await act(async()=>proofs.shift()?.({...page,removedKeys:['thought-1']}))
  expect(host.querySelector('[data-arko-interaction="thought-1"]')).toBeNull()
 }finally{await act(async()=>root.unmount());host.remove();online.mockRestore()}
})

it('hides verified text when a later page read fails without a focus or source event',async()=>{
 arkoTimelineMemory.set('test:10001',cache())
 const observers:Array<{callback:(entries:unknown[])=>void;options:any;active:boolean}>=[]
 vi.stubGlobal('IntersectionObserver',class{
  entry:{callback:(entries:unknown[])=>void;options:any;active:boolean}
  constructor(callback:(entries:unknown[])=>void,options:any){this.entry={callback,options,active:true};observers.push(this.entry)}
  observe(){} disconnect(){this.entry.active=false}
 })
 vi.mocked(callArkme).mockImplementation(async(method,params)=>{
  if(method==='arko.interactions'){
   if((params as any)?.cursor)throw new Error('owner unavailable')
   return {accountScope:'test:10001',items:[],removedKeys:[],hasMore:false} as never
  }
  return new Promise(()=>{}) as never
 })
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<ArkmeArkoSurface/>));expect(host.textContent).toContain('已加载的互动')
  const observer=observers.filter(row=>row.active&&row.options?.rootMargin==='120px 0px 0px').at(-1)
  expect(observer).toBeDefined()
  await act(async()=>observer!.callback([{isIntersecting:true}]))
  expect(host.textContent).not.toContain('已加载的互动');expect(host.textContent).not.toContain('复盘')
  expect(host.querySelector('[data-arko-interaction="thought-1"]')).not.toBeNull()
  expect(host.textContent).toContain('已加载的普通聊天')
 }finally{await act(async()=>root.unmount());host.remove()}
})

it.each(['proof-lost','result-changed'])('closes an open suggestion when %s and never restores its old body',async reason=>{
 const item={...cache().interactions[0]!,suggestion:true}
 vi.mocked(callArkme).mockResolvedValue({accountScope:'test:10001',source:{sourceRef:'source',kind:'private_chat',displayName:'私聊'},itemUid:'root',recordOwnerUserId:10001,interactionKey:item.interactionKey,occurredAtMillis:2000,suggestion:true,thought:{id:'thought',recordUid:'root',biz:1,scene:5,status:'ready',content:'已授权的敏感建议'}} as never)
 const host=document.createElement('ul');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<ArkoInteractionRow item={item} scope="test:10001" verified/>))
  await act(async()=>host.querySelector('button')!.click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('已授权的敏感建议')
  const next=reason==='result-changed' ? {...item,interactionRef:'replacement-result'} : item
  await act(async()=>root.render(<ArkoInteractionRow item={next} scope="test:10001" verified={reason!=='proof-lost'}/>))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async()=>root.render(<ArkoInteractionRow item={next} scope="test:10001" verified/>))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
 }finally{await act(async()=>root.unmount());host.remove()}
})
