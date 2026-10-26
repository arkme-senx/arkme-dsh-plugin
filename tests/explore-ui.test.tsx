// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExploreNavigation } from '../src/client/explore/ExploreNavigation.js'
import { relationViewCache } from '../src/client/explore/relation-view-cache.js'
import { ExploreSurface } from '../src/client/explore/ExploreSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/ArkmeLocationDialog.js',()=>({ArkmeLocationDialog:({onClose}:{onClose():void})=><button onClick={onClose}>关闭位置</button>}))
vi.mock('../src/client/ArkmeNoteDetails.js',()=>({ArkmeTimelineDetailDrawer:()=>null}))
let host:HTMLDivElement,root:Root,scope=0
const item=(id:string)=>({key:id,ref:id,title:'档案 '+id,summary:'真实保存的内容',category:'偏好',status:'',date:0})
const items=[item('a'),item('b')]
const page={module:'profile',items,filters:[],total:2,contextRef:'context',actions:[]}
let pendingSource:((value:unknown)=>void)|undefined
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  relationViewCache.clear()
  mocks.call.mockReset();pendingSource=undefined
  mocks.call.mockImplementation(async(op,input)=>{
    if(op==='explore.list')return page
    if(op==='explore.detail')return {item:items.find(x=>x.ref===input.ref),fields:[],evidence:[{key:'source',label:'原记录',speaker:'你',text:'依据',date:0,anchor:true,ref:'source'}],actions:[{id:'correct',label:'纠正内容'}]}
    if(op==='explore.mutate')throw new Error('网络暂不可用')
    if(op==='explore.source')return new Promise(resolve=>{pendingSource=resolve})
  })
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function click(text:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);expect(button).toBeTruthy();await act(async()=>button!.click())}
async function renderSurface(){await act(async()=>root.render(<ExploreSurface module="profile" accountScope={'test:'+ ++scope}/>))}
describe('Explore interactions',()=>{
  it('groups all destinations and publishes module changes before closing the menu',async()=>{
    await act(async()=>root.render(<ExploreNavigation style={{}} active current="profile" locked={false}/>))
    const trigger=host.querySelector('button')!
    await act(async()=>trigger.click())
    const panel=document.querySelector('#arkme-explore-menu')!
    expect([...panel.querySelectorAll('button')].map(x=>x.textContent)).toEqual(['统计与分析','个人档案','关系','事件','目标','纪念日','位置','世界'])
    await click('统计与分析');expect(arkmeUi.getViewSnapshot().mode).toBe('statistics')
    expect(document.querySelector('#arkme-explore-menu')).toBeNull()
    await act(async()=>trigger.click())
    await click('目标');expect(arkmeUi.getViewSnapshot()).toMatchObject({mode:'explore',exploreModule:'goals'})
    expect(document.querySelector('#arkme-explore-menu')).toBeNull()
    await act(async()=>trigger.click());await click('纪念日')
    expect(arkmeUi.getViewSnapshot()).toMatchObject({mode:'explore',exploreModule:'anniversaries'})
    const beforeLocation = arkmeUi.getViewSnapshot()
    await act(async()=>trigger.click());await click('位置')
    expect(arkmeUi.getViewSnapshot()).toMatchObject({...beforeLocation,locationOpen:true})
    expect(document.querySelector('#arkme-explore-menu')).toBeNull()
    await click('关闭位置');expect(arkmeUi.getViewSnapshot()).toEqual(beforeLocation)
    await act(async()=>trigger.click());await click('世界');expect(arkmeUi.getViewSnapshot().mode).toBe('world')
    await act(async()=>trigger.click());await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})))
    expect(document.querySelector('#arkme-explore-menu')).toBeNull();expect(document.activeElement).toBe(trigger)
  })
  it('retains a failed correction dialog and the saved content for retry',async()=>{
    await renderSurface();await act(async()=>host.querySelector<HTMLButtonElement>('.explore-row')!.click());await click('纠正内容')
    const form=document.querySelector('form')!;await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('网络暂不可用')
    expect(host.textContent).not.toContain('已保存')
    expect(host.textContent).toContain('真实保存的内容')
  })
  it('does not navigate to a late source response after selecting another result',async()=>{
    const navigate=vi.spyOn(arkmeUi,'showConversationTarget')
    await renderSurface();await act(async()=>host.querySelector<HTMLButtonElement>('.explore-row')!.click());await click('定位原文 ↗')
    const sourceCall=mocks.call.mock.calls.find(c=>c[0]==='explore.source')!
    await act(async()=>host.querySelectorAll<HTMLButtonElement>('.explore-row')[1]!.click())
    expect(sourceCall[2].aborted).toBe(true)
    await act(async()=>pendingSource!({kind:'conversation',source:{},itemUid:'old',sendAtMillis:1}))
    expect(navigate).not.toHaveBeenCalled();expect(host.querySelector('h1')?.textContent).toBe('档案 b')
  })
  it('shows relationship information while records are pending and restores a recently viewed detail',async()=>{
    let finishRecords!:(value:unknown)=>void
    const relationDetail={item:items[0],fields:[{label:'别名',value:'已返回的别名'}],evidence:[],actions:[]}
    mocks.call.mockImplementation(async(op,input)=>{
      if(op==='explore.list')return {...page,module:'relations'}
      if(op==='explore.detail'&&input.part==='overview')return relationDetail
      if(op==='explore.detail'&&input.part==='records')return new Promise(resolve=>{finishRecords=resolve})
    })
    await act(async()=>root.render(<ExploreSurface module="relations" accountScope={'test:'+ ++scope}/>))
    await act(async()=>host.querySelector<HTMLButtonElement>('.explore-row')!.click())
    expect(host.textContent).toContain('已返回的别名')
    expect(host.textContent).toContain('正在读取相关记录')
    expect(host.textContent).not.toContain('暂未提供可查看的来源依据')
    const source={key:'source',label:'来源',speaker:'',text:'独立返回的原文',date:0,anchor:false}
    await act(async()=>finishRecords({...relationDetail,evidence:[source,source]}))
    expect(host.querySelectorAll('.explore-evidence')).toHaveLength(1)
    const count=mocks.call.mock.calls.filter(x=>x[0]==='explore.detail').length
    await click('返回列表')
    await act(async()=>host.querySelector<HTMLButtonElement>('.explore-row')!.click())
    expect(host.textContent).toContain('独立返回的原文')
    expect(mocks.call.mock.calls.filter(x=>x[0]==='explore.detail')).toHaveLength(count)
  })
  it('keeps records visible when the independent overview fails and retries only that region',async()=>{
    let attempts=0
    mocks.call.mockImplementation(async(op,input)=>{
      if(op==='explore.list')return {...page,module:'relations'}
      if(op==='explore.detail'&&input.part==='overview'){attempts++;throw new Error('人物信息暂不可用')}
      if(op==='explore.detail')return {item:items[0],fields:[],evidence:[{key:'source',label:'来源',speaker:'',text:'已加载原文',date:0,anchor:false}],actions:[]}
    })
    await act(async()=>root.render(<ExploreSurface module="relations" accountScope={'test:'+ ++scope}/>))
    await act(async()=>host.querySelector<HTMLButtonElement>('.explore-row')!.click())
    expect(host.textContent).toContain('已加载原文');expect(host.textContent).toContain('人物信息暂不可用')
    await click('重试人物信息')
    expect(attempts).toBe(2)
    expect(mocks.call.mock.calls.filter(x=>x[1]?.part==='records')).toHaveLength(1)
  })
  it('does not allow a late relationship response to overwrite a different selection',async()=>{
    let finishOld!:(value:unknown)=>void
    mocks.call.mockImplementation(async(op,input)=>{
      if(op==='explore.list')return {...page,module:'relations'}
      if(op==='explore.detail'&&input.ref==='a'&&input.part==='records')return new Promise(resolve=>{finishOld=resolve})
      if(op==='explore.detail')return {item:items.find(x=>x.ref===input.ref),fields:[],evidence:[],actions:[]}
    })
    await act(async()=>root.render(<ExploreSurface module="relations" accountScope={'test:'+ ++scope}/>))
    await act(async()=>host.querySelector<HTMLButtonElement>('.explore-row')!.click())
    const oldCall=mocks.call.mock.calls.find(x=>x[1]?.ref==='a'&&x[1]?.part==='records')!
    await act(async()=>host.querySelectorAll<HTMLButtonElement>('.explore-row')[1]!.click())
    await act(async()=>finishOld({item:items[0],fields:[],evidence:[{key:'old',text:'过期结果'}],actions:[]}))
    expect(oldCall[2].aborted).toBe(true)
    expect(host.querySelector('h1')?.textContent).toBe('档案 b');expect(host.textContent).not.toContain('过期结果')
  })
  it('renders list rows before optional remark enrichment and patches them without reloading detail',async()=>{
    let finishRemarks!:(value:unknown)=>void
    const original=mocks.call.getMockImplementation()!
    mocks.call.mockImplementation(async(op,input)=>{
      if(op==='explore.list')return {...page,module:'relations',needsEnrichment:true}
      if(op==='explore.enrich')return new Promise(resolve=>{finishRemarks=resolve})
      return original(op,input)
    })
    await act(async()=>root.render(<ExploreSurface module="relations" accountScope={'test:'+ ++scope}/>))
    expect(host.querySelectorAll('.explore-row')).toHaveLength(2)
    await act(async()=>host.querySelector<HTMLButtonElement>('.explore-row')!.click())
    const reads=mocks.call.mock.calls.filter(x=>x[0]==='explore.detail').length
    await act(async()=>finishRemarks({items:[{key:'a',linkedContactName:'备注姓名'}]}))
    expect(host.textContent).toContain('备注姓名')
    expect(mocks.call.mock.calls.filter(x=>x[0]==='explore.detail')).toHaveLength(reads)
  })
})

it('opens the existing consent controls without creating a task, including when results already exist',async()=>{
  const original=mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async(op,input)=>{
    if(op==='explore.list')return {...page,analysisEnabled:false}
    if(op==='account.capabilities.query')return {accountScope:input.expectedAccountScope,settings:[{key:'personal_profile',title:'个人档案',enabled:false,version:0,enabledAt:0}]}
    return original(op,input)
  })
  await renderSurface()
  expect(host.textContent).toContain('尚未开启分析')
  expect(host.textContent).toContain('真实保存的内容')
  await click('自动使用额度')
  expect(document.querySelector('[role="switch"]')).not.toBeNull()
  expect(mocks.call.mock.calls.some(x=>x[0]==='explore.mutate'||x[0]==='account.capabilities.update')).toBe(false)
})


it('restores saved relationship content immediately, keeps it on refresh failure and retries the first page', async () => {
  const account = 'test:' + ++scope, at = Date.now() - 60_000
  const evidence = { key: 'saved-source', label: '来源', speaker: '', text: '已经看过的原文', date: 0, anchor: false }
  relationViewCache.write(account, 'view', { filter: '', query: '', page: { ...page, module: 'relations' }, selected: items[0], listTop: 120, detailTop: 200, savedAt: at }, at)
  relationViewCache.write(account, 'relations:a', { detail: { item: items[0], fields: [], evidence: [evidence], actions: [], nextCursor: 'second-page' }, recordsAt: at, overviewAt: at, firstKeys: ['saved-source'] }, at)
  const requests: Array<{input: any; resolve: (v: any) => void; reject: (e: Error) => void}> = []
  mocks.call.mockImplementation(async (_op, input) => new Promise((resolve, reject) => requests.push({ input, resolve, reject })))
  await act(async () => root.render(<ExploreSurface module="relations" accountScope={account}/>))
  expect(host.querySelectorAll('.explore-row')).toHaveLength(2)
  expect(host.textContent).toContain('已经看过的原文')
  expect(host.textContent).toContain('正在后台更新相关记录')
  expect(host.querySelector('.explore-detail')?.scrollTop).toBe(200)
  await act(async () => { for (const r of requests) r.reject(new Error('暂时离线')) })
  expect(host.querySelectorAll('.explore-row')).toHaveLength(2)
  expect(host.textContent).toContain('已经看过的原文')
  const detailRetry = host.querySelector('.explore-detail .explore-error:last-of-type button') as HTMLButtonElement
  await act(async () => detailRetry.click())
  expect(requests.at(-1)?.input).toEqual({ ref: 'a', part: 'records' })
  await act(async () => requests.at(-1)!.resolve({ item: items[0], evidence: [evidence, evidence], fields: [], actions: [] }))
  expect(host.querySelectorAll('.explore-evidence')).toHaveLength(1)
})

it('restores the complete loaded list window, retains its counts on failure and retries without an old cursor', async () => {
  const account='test:'+ ++scope, at=Date.now()-60_000
  const savedItems=Array.from({length:150},(_,i)=>item('saved-'+i))
  const savedPage={...page,module:'relations',items:savedItems,total:1200,nextCursor:'old-snapshot',filters:[{key:'',label:'全部',count:1200}]}
  relationViewCache.write(account,'view',{filter:'',query:'',page:savedPage,listTop:1600,detailTop:0,savedAt:at},at)
  const pending:Array<{params:any;resolve:(v:any)=>void;reject:(e:Error)=>void}>=[]
  mocks.call.mockImplementation(async(op,params)=>{
    expect(op).toBe('explore.list')
    return new Promise((resolve,reject)=>pending.push({params,resolve,reject}))
  })
  await act(async()=>root.render(<ExploreSurface module="relations" accountScope={account}/>))
  expect(host.querySelectorAll('.explore-row')).toHaveLength(150)
  expect(host.querySelector('.explore-list')?.scrollTop).toBe(1600)
  expect(pending[0]!.params).toEqual({module:'relations',filter:'',query:'',limit:150})
  await act(async()=>pending[0]!.reject(new Error('离线')))
  expect(host.querySelectorAll('.explore-row')).toHaveLength(150)
  expect(host.querySelector('.explore-header-actions')?.textContent).toContain('1200')
  await click('重试')
  expect(pending[1]!.params).toEqual(pending[0]!.params)
  await act(async()=>pending[1]!.resolve({...savedPage,nextCursor:'new-snapshot'}))
  expect(host.querySelectorAll('.explore-row')).toHaveLength(150)
})

it('keeps later detail pages visible when refreshing the first page and persists independently loaded regions', async () => {
  const account = 'test:' + ++scope, at = Date.now() - 60_000
  const evidence = (key: string) => ({ key, label: '来源', speaker: '', text: key, date: 0, anchor: false })
  relationViewCache.write(account, 'relations:a', { detail: { item: items[0], fields: [], evidence: [evidence('old-first'), evidence('later-page')], actions: [], nextCursor: 'third-page' }, recordsAt: at, overviewAt: at, firstKeys: ['old-first'] }, at)
  mocks.call.mockImplementation(async (op, input) => {
    if (op === 'explore.list') return { ...page, module: 'relations' }
    if (input.part === 'overview') throw new Error('人物信息失败')
    return { item: items[0], fields: [], evidence: [evidence('new-first')], actions: [], nextCursor: 'second-page' }
  })
  await act(async () => root.render(<ExploreSurface module="relations" accountScope={account}/>))
  await act(async () => host.querySelector<HTMLButtonElement>('.explore-row')!.click())
  expect([...host.querySelectorAll('.explore-evidence p')].map(e => e.textContent)).toEqual(['new-first', 'later-page'])
  expect(host.textContent).toContain('人物信息失败')
  const calls = mocks.call.mock.calls.filter(c => c[1]?.part === 'records').length
  await click('返回列表')
  await act(async () => host.querySelector<HTMLButtonElement>('.explore-row')!.click())
  expect(mocks.call.mock.calls.filter(c => c[1]?.part === 'records')).toHaveLength(calls)
  expect(host.textContent).toContain('later-page')
})

it.each([0,60_000])('preserves the saved overview and renews only its reference on return (age %d)',async age=>{
  const account='test:'+ ++scope,at=Date.now()-age
  const selected={...items[0],ref:'fresh-ref',title:'列表标题',summary:'列表概述'}
  const saved={...items[0],ref:'old-ref',title:'已经读过的详情标题',summary:'已经读过的完整详情概述'}
  relationViewCache.write(account,'view',{filter:'',query:'',page:{...page,module:'relations',items:[selected]},selected,listTop:0,detailTop:200,savedAt:at},at)
  relationViewCache.write(account,'relations:a',{detail:{item:saved,fields:[{label:'别名',value:'已读别名'}],evidence:[{key:'saved',label:'来源',speaker:'',text:'已读原文',date:0,anchor:false}],actions:[]},recordsAt:at,overviewAt:at,firstKeys:['saved']},at)
  const pending:Array<{input:any;resolve:(v:any)=>void;reject:(e:Error)=>void}>=[]
  mocks.call.mockImplementation(async(_op,input)=>new Promise((resolve,reject)=>pending.push({input,resolve,reject})))
  await act(async()=>root.render(<ExploreSurface module="relations" accountScope={account}/>))
  expect(host.querySelector('h1')?.textContent).toBe(saved.title)
  expect(host.querySelector('.explore-detail-summary')?.textContent).toBe(saved.summary)
  expect(host.textContent).toContain('已读原文')
  expect(host.querySelector('.explore-detail')?.scrollTop).toBe(200)
  const cached=relationViewCache.read(account,'relations:a',()=>true)?.value as any
  expect(cached.detail.item.ref).toBe('fresh-ref')
  if(age){
    expect(pending.filter(r=>r.input.part==='overview').map(r=>r.input.ref)).toEqual(['fresh-ref'])
    await act(async()=>{for(const r of pending)r.reject(new Error('离线'))})
    expect(host.querySelector('.explore-detail-summary')?.textContent).toBe(saved.summary)
  }
})
