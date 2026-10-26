import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog, ArkmeLongArticleSnapshotDialog } from '../src/client/ArkmeLongArticleDialog.js'
import { ArkmeLongArticleActions } from '../src/client/ArkmeLongArticleActions.js'
import { ArkmeLongArticleQuickView } from '../src/client/ArkmeLongArticleQuickView.js'

const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call,ArkmeClientError:class extends Error{}}))
const detail=(id:string)=>({sourceRef:`source-${id}`,itemUid:id,title:`文章${id}`,textContent:'原始正文',textFormat:'plain',sendAtMillis:1,updateAtMillis:1,recordDurationMillis:0,editDurationMillis:0,thinkingDurationMillis:0,version:1,editable:true})
const row=(id:string)=>({recordUid:id,sourceKind:1,routeTargetKind:'record_detail',title:`文章${id}`,textContent:'',sendAtMillis:1,media:[],files:[],targetSource:{sourceRef:`source-${id}`,displayName:'发给自己'}})
let renderer:ReactTestRenderer|undefined,nativeClose:()=>void
const close=vi.fn(),updated=vi.fn(),cancelClose=vi.fn()
const mode={displayName:'发给自己',verifyAccount:async()=>{},cancelClose,subscribeClose:(listener:()=>void)=>{nativeClose=listener;return()=>{}}}
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?text(node.children??node.props?.children):''
const button=(label:string)=>renderer!.root.findAllByType('button').find(node=>text(node.props.children)===label)!
const choose=(id:string)=>renderer!.root.findByType(ArkmeLongArticleQuickView).props.onChooseArticle(row(id))
beforeEach(()=>{
  mocks.call.mockReset();close.mockReset();updated.mockReset();cancelClose.mockReset()
  vi.stubGlobal('window',{confirm:()=>true,addEventListener:vi.fn(),removeEventListener:vi.fn(),setInterval,clearInterval})
  mocks.call.mockImplementation(async(op,p)=>op==='provider.capabilities'?{features:{markdownLongArticles:false}}:op==='source.long-article.detail'?detail(p.itemUid):op==='source.long-article.update'?{...detail(p.itemUid),title:p.title,textContent:p.textContent,version:2}:undefined)
})
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals()})
async function mount(windowMode?:typeof mode){await act(async()=>{renderer=create(<ArkmeLongArticleDialog sourceRef="source-A" item={{itemUid:'A',title:'文章A',textContent:'',sendAtMillis:1}} onClose={close} onUpdated={updated} {...(windowMode?{windowMode}:{})}/> )})}
async function edit(){act(()=>renderer!.root.findByProps({'aria-label':'长文正文'}).props.onChange({target:{value:'尚未发布的修改'}}))}
it('keeps the original document when draft saving fails and permits a successful switch retry',async()=>{
  await mount();await edit()
  const original=mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async(op,p)=>{if(op==='source.long-article.draft.put')throw new Error('草稿保存失败');return original(op,p)})
  await act(async()=>choose('B'))
  expect(text(renderer!.toJSON())).toContain('草稿保存失败')
  expect(renderer!.root.findByProps({'aria-label':'长文标题'}).props.value).toBe('文章A')
  expect(close).not.toHaveBeenCalled()
  mocks.call.mockImplementation(original)
  await act(async()=>choose('B'))
  expect(text(renderer!.toJSON())).toContain('文章B')
  expect(mocks.call.mock.calls.filter(call=>call[0]==='source.long-article.detail').at(-1)?.[1].sourceRef).toBe('source-B')
})
it('flushes a native window navigation and subsequently closes the active document',async()=>{
  await mount(mode);await edit()
  await act(async()=>choose('B'))
  expect(mocks.call.mock.calls.some(call=>call[0]==='source.long-article.update'&&call[1].itemUid==='A')).toBe(true)
  expect(renderer!.root.findByProps({'aria-label':'长文标题'}).props.value).toBe('文章B')
  await act(async()=>nativeClose())
  expect(close).toHaveBeenCalledOnce()
})
it('does not apply a navigated article update receipt to the different opening message',async()=>{
  await mount();await act(async()=>choose('B'));await edit()
  await act(async()=>renderer!.root.findByType(ArkmeLongArticleActions).props.beforeAction())
  expect(mocks.call.mock.calls.find(call=>call[0]==='source.long-article.update')?.[1]).toMatchObject({sourceRef:'source-B',itemUid:'B'})
  expect(updated).not.toHaveBeenCalled()
})
it('handles Escape in an open compact sidebar before leaving and flushing the article',async()=>{
  Object.assign(window,{innerWidth:700})
  await mount(mode);await edit()
  act(()=>renderer!.root.findByProps({'aria-label':'展开长文列表'}).props.onClick())
  const handler=()=>vi.mocked(window.addEventListener).mock.calls.filter(call=>call[0]==='keydown').at(-1)![1] as (event:any)=>void
  await act(async()=>handler()({key:'Escape',stopPropagation:()=>{}}))
  expect(close).not.toHaveBeenCalled()
  expect(mocks.call.mock.calls.some(call=>call[0]==='source.long-article.update')).toBe(false)
  await act(async()=>handler()({key:'Escape',stopPropagation:()=>{}}))
  expect(close).toHaveBeenCalledOnce()
  expect(mocks.call.mock.calls.some(call=>call[0]==='source.long-article.update')).toBe(true)
})
it('replaces the snapshot close subscription when navigating to an editable document',async()=>{
  await act(async()=>{renderer=create(<ArkmeLongArticleSnapshotDialog standalone windowMode={mode} item={{itemUid:'copy',title:'转发副本',textContent:'副本',sendAtMillis:1}} onClose={close}/>)})
  await act(async()=>choose('B'));await edit()
  await act(async()=>nativeClose())
  expect(close).toHaveBeenCalledOnce()
  expect(mocks.call.mock.calls.find(call=>call[0]==='source.long-article.update')?.[1].itemUid).toBe('B')
})
