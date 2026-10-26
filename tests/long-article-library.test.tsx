// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleLibraryDialog } from '../src/client/ArkmeLongArticleLibraryDialog.js'

const mocks=vi.hoisted(()=>({call:vi.fn(),auth:{auth:{status:'authenticated',environment:'test',userId:42}},listeners:new Set<()=>void>()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/auth-store.js',()=>({arkmeAuthStore:{subscribe:(listener:()=>void)=>{mocks.listeners.add(listener);return()=>mocks.listeners.delete(listener)},getSnapshot:()=>mocks.auth}}))
vi.mock('react-dom',()=>({createPortal:(value:unknown)=>value}))
vi.mock('../src/client/ArkmeLongArticleDialog.js',()=>({ArkmeLongArticleDialog:(props:any)=><div data-test-editor={props.sourceRef}>
  <button onClick={()=>{props.onCreated?.({itemUid:'created',title:'刚创建的长文',textContent:'正文',sendAtMillis:99});props.onClose()}}>完成新建</button>
  <button onClick={props.onClose}>取消新建</button>
</div>}))
const target={sourceRef:'signed-self',kind:'send_to_self',displayName:'发给自己'}
const article={recordUid:'existing',recordOwnerUserId:42,sourceKind:1,routeTargetKind:'record_detail',sendAtMillis:1,title:'已有长文',snippet:'摘要',textContent:'内容',templateKind:8,media:[],files:[],targetSource:target}
const page={items:[article],hasMore:false,sourceAggregates:[],queryGuard:{state:'complete'}}
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?text(node.children??node.props?.children):''
let renderer:ReactTestRenderer
const button=(label:string)=>renderer.root.findAllByType('button').find(node=>text(node.props.children)===label)!
const close=vi.fn()
beforeEach(()=>{
  mocks.call.mockReset();close.mockReset();mocks.auth={auth:{status:'authenticated',environment:'test',userId:42}}
  vi.stubGlobal('requestAnimationFrame',()=>0)
  mocks.call.mockImplementation(async(op,params)=>{
    if(op==='sources.self-target')return target
    if(params.articleScope)throw Object.assign(new Error('后端接口开发中，开发完成后此功能完整可用。'),{body:{code:'long-article-sharing-unavailable'}})
    return page
  })
})
afterEach(()=>{if(renderer)act(()=>renderer.unmount());vi.unstubAllGlobals()})
const mount=async()=>{await act(async()=>{renderer=create(<ArkmeLongArticleLibraryDialog onClose={close} />)})}
it('opens a large standalone library and preserves recent cards while switching sharing categories',async()=>{
  await mount()
  expect(renderer.root.findByProps({'aria-label':'长文库'}).props.role).toBe('dialog')
  expect(renderer.root.findAllByProps({role:'tab'}).map(tab=>text(tab.props.children))).toEqual(['最近','我共享的','共享给我的'])
  expect(mocks.call).toHaveBeenCalledExactlyOnceWith('search.scene',{scene:'long_article',limit:30},expect.any(AbortSignal))
  await act(async()=>button('我共享的').props.onClick())
  expect(mocks.call.mock.calls.at(-1)?.[1].articleScope).toBe('shared_by_me')
  expect(text(renderer.toJSON())).toContain('后端接口开发中，开发完成后此功能完整可用。')
  expect(button('重试')).toBeUndefined()
  await act(async()=>button('共享给我的').props.onClick())
  expect(mocks.call.mock.calls.at(-1)?.[1].articleScope).toBe('shared_with_me')
  const reads=mocks.call.mock.calls.length
  await act(async()=>button('最近').props.onClick())
  expect(mocks.call).toHaveBeenCalledTimes(reads)
  expect(renderer.root.findAllByProps({'data-arkme-long-article-result':'true'})).toHaveLength(1)
})
it('creates through the signed self destination and immediately shows the confirmed article in recent',async()=>{
  await mount()
  await act(async()=>button('共享给我的').props.onClick())
  await act(async()=>button('新建长文').props.onClick())
  expect(renderer.root.findByProps({'data-test-editor':'signed-self'})).toBeDefined()
  await act(async()=>button('完成新建').props.onClick())
  expect(renderer.root.findByProps({role:'tab','aria-selected':true}).props.children).toBe('最近')
  expect(text(renderer.toJSON())).toContain('刚创建的长文')
  expect(renderer.root.findAllByProps({'data-test-editor':'signed-self'})).toHaveLength(0)
  expect(mocks.call.mock.calls.every(call=>call[0]==='search.scene'||call[0]==='sources.self-target')).toBe(true)
})
it('deduplicates rapid create clicks and ignores a late self target after account changes',async()=>{
  let finish!:(value:unknown)=>void
  await mount()
  mocks.call.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  act(()=>{button('新建长文').props.onClick();button('新建长文').props.onClick()})
  expect(mocks.call.mock.calls.filter(call=>call[0]==='sources.self-target')).toHaveLength(1)
  const signal=mocks.call.mock.calls.at(-1)![2] as AbortSignal
  await act(async()=>{mocks.auth={auth:{status:'authenticated',environment:'test',userId:43}};for(const listener of mocks.listeners)listener()})
  expect(close).toHaveBeenCalledOnce();expect(signal.aborted).toBe(true)
  await act(async()=>finish(target))
  expect(renderer.root.findAllByProps({'data-test-editor':'signed-self'})).toHaveLength(0)
})

it('delegates opening the library to the v3 native bridge', async () => {
  const open=vi.fn(async()=>true)
  vi.stubGlobal('arkmeLongArticle',{version:3,open,account:async()=>true})
  await mount()
  expect(open).toHaveBeenCalledWith(expect.objectContaining({surface:'library',accountKey:'test:42'}))
  expect(close).toHaveBeenCalledOnce()
  expect(renderer.root.findAllByProps({'aria-label':'长文库'})).toHaveLength(0)
})
it('native library opens articles and automatically published new documents through the existing editor bridge', async () => {
  const open=vi.fn(async()=>true)
  vi.stubGlobal('arkmeLongArticle',{version:3,open,account:async()=>true,active:async()=>true})
  vi.stubGlobal('location',{search:'?arkmeLongArticle=1'})
  await act(async()=>{renderer=create(<ArkmeLongArticleLibraryDialog standalone onClose={close}/>)})
  await act(async()=>renderer.root.findByProps({'data-arkme-long-article-result':'true'}).props.onClick({currentTarget:{}}))
  expect(open).toHaveBeenLastCalledWith(expect.objectContaining({article:expect.objectContaining({mode:'existing'})}))
  await act(async()=>button('新建长文').props.onClick())
  expect(open).toHaveBeenLastCalledWith(expect.objectContaining({autoPublish:true,sourceRef:'signed-self',sourceKey:'signed-self'}))
  expect(renderer.root.findAllByProps({'data-test-editor':'signed-self'})).toHaveLength(0)
})
