// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog, ArkmeLongArticleSnapshotDialog } from '../src/client/ArkmeLongArticleDialog.js'

const mocks=vi.hoisted(()=>({call:vi.fn(),width:1280,resize:[] as Array<()=>void>,auth:{auth:{status:'authenticated',environment:'test',userId:42}}}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call,ArkmeClientError:class extends Error{}}))
vi.mock('../src/client/auth-store.js',()=>({arkmeAuthStore:{subscribe:()=>()=>{},getSnapshot:()=>mocks.auth}}))
const article=(id:string)=>({recordUid:id,recordOwnerUserId:42,sourceKind:1,routeTargetKind:'record_detail',sendAtMillis:1,title:`文章${id}`,
  textContent:'',snippet:'不该出现在标题目录的摘要',templateKind:8,media:[],files:[],targetSource:{sourceRef:`source-${id}`,kind:'send_to_self',displayName:'发给自己',activeAtMillis:1,unreadCount:0}})
const page={items:[article('A'),article('B')],hasMore:false,sourceAggregates:[],queryGuard:{state:'complete'}}
const initial={itemUid:'A',title:'文章A',textContent:'',sendAtMillis:1,recordOwnerUserId:42}
const detail=(id:string)=>({sourceRef:`source-${id}`,itemUid:id,title:`文章${id}`,textContent:`# ${id}总览\n\n## 同名标题\n\n正文\n\n## 同名标题\n\n\`\`\`md\n# 代码里的伪标题\n\`\`\`\n\n**加粗不是标题**`,
  textFormat:'markdown',sendAtMillis:1,updateAtMillis:1,recordDurationMillis:0,editDurationMillis:0,thinkingDurationMillis:0,version:1,editable:true})
let element:HTMLDivElement,root:Root
const originalScrollTo=HTMLElement.prototype.scrollTo
const button=(label:string)=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent===label)!
const outline=()=>[...element.querySelectorAll<HTMLButtonElement>('.arkme-article-outline-item')]
beforeEach(()=>{
  mocks.width=1280;mocks.resize=[];mocks.call.mockReset()
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{queueMicrotask(()=>callback(0));return 1})
  vi.stubGlobal('cancelAnimationFrame',()=>{})
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){mocks.resize.push(callback)}observe(){}disconnect(){}})
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    const body=this.closest<HTMLElement>('[data-arkme-article-scroll]')
    const headings=body?[...body.querySelectorAll('h1,h2,h3,h4,h5,h6')]:[]
    const index=headings.indexOf(this)
    const top=index>=0?100+index*240-(body?.scrollTop??0):this.hasAttribute('data-arkme-article-scroll')?100:0
    return {x:0,y:top,top,left:0,right:mocks.width,bottom:top+600,width:mocks.width,height:600,toJSON(){}} as DOMRect
  })
  Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:function(this:HTMLElement,options:any){this.scrollTop=this.scrollHeight>0?Math.min(options.top,Math.max(0,this.scrollHeight-this.clientHeight)):options.top;this.dispatchEvent(new Event('scroll'))}})
  mocks.call.mockImplementation(async(op,params)=>op==='provider.capabilities'?{features:{markdownLongArticles:false}}:op==='source.long-article.detail'?detail(params.itemUid):op==='search.scene'?page:undefined)
  element=document.createElement('div');document.body.append(element);root=createRoot(element)
})
afterEach(async()=>{if(root)await act(async()=>root.unmount());element?.remove();vi.restoreAllMocks();vi.unstubAllGlobals();if(originalScrollTo)Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,value:originalScrollTo});else delete (HTMLElement.prototype as any).scrollTo})
async function mount(){await act(async()=>root.render(<ArkmeLongArticleDialog sourceRef="source-A" item={initial} initialDirectoryPage={page as any} onClose={()=>{}}/>))}
it('builds a hierarchical outline from real headings, distinguishes duplicate titles and leaves the document DOM intact on collapse',async()=>{
  await mount()
  expect(outline().map(node=>node.textContent)).toEqual(['A总览','同名标题','同名标题'])
  expect(outline()[1]!.style.paddingLeft).toBe('20px')
  expect(element.querySelectorAll('.arkme-article-directory-item')).toHaveLength(2)
  expect(element.querySelector('.arkme-article-workspace-directory')?.textContent).not.toContain('不该出现在标题目录的摘要')
  const body=element.querySelector<HTMLElement>('[data-arkme-article-scroll]')!,heading=body.querySelector('h1')
  await act(async()=>outline()[2]!.click())
  expect(body.scrollTop).toBe(460)
  expect(outline()[2]!.getAttribute('aria-current')).toBe('location')
  await act(async()=>button('收起大纲').click())
  expect(element.querySelector<HTMLElement>('.arkme-article-workspace-outline')!.hidden).toBe(true)
  await act(async()=>button('展开大纲').click())
  await act(async()=>button('收起长文列表').click())
  expect(element.querySelector<HTMLElement>('.arkme-article-workspace-directory')!.hidden).toBe(true)
  await act(async()=>button('展开长文列表').click())
  expect(body.querySelector('h1')).toBe(heading)
  expect(mocks.call.mock.calls.filter(call=>call[0]==='search.scene')).toHaveLength(0)
})
it('switches documents within the reader, cancels the previous read and restores each document scroll independently',async()=>{
  await mount()
  const bodyA=element.querySelector<HTMLElement>('[data-arkme-article-scroll]')!
  await act(async()=>{bodyA.scrollTop=145;bodyA.dispatchEvent(new Event('scroll'))})
  const readA=mocks.call.mock.calls.find(call=>call[0]==='source.long-article.detail')![2] as AbortSignal
  await act(async()=>button('文章B').click())
  expect(readA.aborted).toBe(true)
  const bodyB=element.querySelector<HTMLElement>('[data-arkme-article-scroll]')!
  expect(outline()[0]!.textContent).toBe('B总览');expect(bodyB.scrollTop).toBe(0)
  await act(async()=>{bodyB.scrollTop=333;bodyB.dispatchEvent(new Event('scroll'))})
  await act(async()=>button('文章A').click())
  expect(element.querySelector<HTMLElement>('[data-arkme-article-scroll]')!.scrollTop).toBe(145)
  await act(async()=>button('文章B').click())
  expect(element.querySelector<HTMLElement>('[data-arkme-article-scroll]')!.scrollTop).toBe(333)
})
it('highlights the final heading when the document bottom prevents aligning it to the top',async()=>{
  await mount()
  const body=element.querySelector<HTMLElement>('[data-arkme-article-scroll]')!
  Object.defineProperties(body,{clientHeight:{configurable:true,value:600},scrollHeight:{configurable:true,value:720}})
  await act(async()=>outline()[2]!.click())
  expect(body.scrollTop).toBe(120)
  expect(outline()[2]!.getAttribute('aria-current')).toBe('location')
})
it('uses temporary sidebars in a narrow window and closes a sidebar with Escape before closing the document',async()=>{
  mocks.width=700
  const close=vi.fn()
  await act(async()=>root.render(<ArkmeLongArticleDialog sourceRef="source-A" item={initial} initialDirectoryPage={page as any} onClose={close}/>))
  expect(element.querySelector<HTMLElement>('.arkme-article-workspace-directory')!.hidden).toBe(true)
  await act(async()=>button('展开大纲').click())
  expect(element.querySelector<HTMLElement>('.arkme-article-workspace-outline')!.hidden).toBe(false)
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(close).not.toHaveBeenCalled()
  expect(element.querySelector<HTMLElement>('.arkme-article-workspace-outline')!.hidden).toBe(true)
  await act(async()=>button('展开大纲').click())
  await act(async()=>{mocks.width=1280;for(const resize of mocks.resize)resize()})
  expect(element.querySelector('.arkme-article-workspace')?.getAttribute('data-compact')).toBe('false')
  await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(close).toHaveBeenCalledOnce()
})
it('does not reserve an empty outline for plain text and keeps forwarded snapshots read-only',async()=>{
  await act(async()=>root.render(<ArkmeLongArticleSnapshotDialog item={{itemUid:'snapshot',title:'转发副本',textContent:'只有普通正文',sendAtMillis:1}} onClose={()=>{}}/>))
  expect(outline()).toHaveLength(0)
  expect(button('展开大纲')).toBeUndefined()
  expect(element.querySelector('[data-arkme-long-article-dialog]')?.getAttribute('data-arkme-long-article-dialog')).toBe('snapshot')
  expect([...element.querySelectorAll('button')].some(node=>node.textContent?.includes('编辑'))).toBe(false)
})
