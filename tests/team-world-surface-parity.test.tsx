// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mock.call}))
vi.mock('../src/client/ArkmeWorldSurface.js',()=>({WorldAuthorAvatar:()=>null,WorldPublisher:()=>null,WorldCard:({item,onOpenDetail,onOpenInteractions,onInteractionCreated,detail}:any)=><article data-card={item.recordRef}>{item.textContent}{detail?<><input aria-label="评论草稿" defaultValue=""/><button onClick={()=>onInteractionCreated(item.recordRef)}>发送测试评论</button></>:<button onClick={()=>onOpenDetail?.(item)??onOpenInteractions(item)}>打开{item.recordRef}</button>}</article>}))
vi.mock('../src/client/TeamWorldManagement.js',()=>({TeamWorldManagement:()=>null}))
vi.mock('../src/client/WorldPublishGuide.js',()=>({WorldPublishGuide:()=>null}))
vi.mock('../src/client/TeamPublicCardDialog.js',()=>({TeamPublicCardDialog:()=>null}))
import {TeamWorldSurface} from '../src/client/TeamWorldSurface.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
const item=(id:string)=>({recordRef:id,authorName:'团队',teamAuthor:{name:'团队',jotmoId:'test_team'},textContent:id,headline:'',imageRefs:[],tags:[],createdAtMillis:1,publishedAtMillis:1,imageCount:0,videoCount:0,voiceCount:0,extendCount:0,templateKind:0})
const view=(more=false)=>({state:'ready',team:{name:'团队',jotmoId:'test_team'},context:{capabilities:{manage:false}},feed:{items:[item(more?'second':'first')],hasMore:!more,...(!more?{nextCursor:'next'}:{})}})
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mock.call.mockReset();arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});host=document.createElement('div');document.body.append(host);root=createRoot(host)
 mock.call.mockImplementation(async(op,input)=>op==='team.app.world.view'?view(!!input.cursor):op==='world.record.read'?item(input.recordRef):{items:[]})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const click=async(text:string)=>act(async()=>{[...document.querySelectorAll('button')].find(x=>x.textContent===text)!.click()})
it('opens the existing World detail and keeps its composer and previous cards after pagination and a reply',async()=>{
 await act(async()=>root.render(<TeamWorldSurface accountKey="test:42" target={{name:'团队',jotmoId:'test_team'}} onBack={()=>{}}/>))
 const first=document.querySelector('[data-card="first"]')
 await click('加载更多')
 expect(document.querySelector('[data-card="first"]')).toBe(first)
 expect(document.querySelector('[data-card="second"]')).toBeTruthy()
 await click('打开first')
 expect(document.querySelector('[role="dialog"][aria-label="世界动态详情"]')).toBeTruthy()
 const input=document.querySelector<HTMLInputElement>('[aria-label="评论草稿"]')!;input.value='保留的草稿'
 await click('发送测试评论')
 expect(document.querySelector('[aria-label="评论草稿"]')).toBe(input)
 expect(input.value).toBe('保留的草稿')
 expect(mock.call.mock.calls.filter(([op])=>op==='team.app.world.view')).toHaveLength(2)
 expect(document.querySelector('[data-card="first"]')).toBe(first)
})

it('allows pagination again after refreshing while an older page is pending',async()=>{
 let resolvePage!: (value: ReturnType<typeof view>)=>void
 let pageCalls=0
 mock.call.mockImplementation(async(op,input)=>{
  if(op!=='team.app.world.view') return {items:[]}
  if(!input.cursor) return view()
  if(++pageCalls===1) return new Promise<ReturnType<typeof view>>(resolve=>{resolvePage=resolve})
  return view(true)
 })
 await act(async()=>root.render(<TeamWorldSurface accountKey="test:42" target={{name:'团队',jotmoId:'test_team'}} onBack={()=>{}}/>))
 await click('加载更多')
 expect([...document.querySelectorAll('button')].find(x=>x.textContent==='加载更多')!.disabled).toBe(true)
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="刷新团队世界"]')!.click())
 expect([...document.querySelectorAll('button')].find(x=>x.textContent==='加载更多')!.disabled).toBe(false)
 await act(async()=>resolvePage({...view(true),feed:{items:[item('stale')],hasMore:false}}))
 expect(document.querySelector('[data-card="stale"]')).toBeNull()
 await click('加载更多')
 expect(document.querySelector('[data-card="second"]')).toBeTruthy()
})
