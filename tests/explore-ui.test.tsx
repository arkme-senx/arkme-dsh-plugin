// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExploreNavigation } from '../src/client/explore/ExploreNavigation.js'
import { ExploreSurface } from '../src/client/explore/ExploreSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/ArkmeNoteDetails.js',()=>({ArkmeTimelineDetailDrawer:()=>null}))
let host:HTMLDivElement,root:Root,scope=0
const item=(id:string)=>({key:id,ref:id,title:'档案 '+id,summary:'真实保存的内容',category:'偏好',status:'',date:0})
const items=[item('a'),item('b')]
const page={module:'profile',items,filters:[],total:2,contextRef:'context',actions:[]}
let pendingSource:((value:unknown)=>void)|undefined
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
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
  it('groups all seven destinations and publishes module changes before closing the menu',async()=>{
    await act(async()=>root.render(<ExploreNavigation style={{}} active current="profile" locked={false}/>))
    const trigger=host.querySelector('button')!
    await act(async()=>trigger.click())
    const panel=document.querySelector('#arkme-explore-menu')!
    expect([...panel.querySelectorAll('button')].map(x=>x.textContent)).toEqual(['统计与分析','个人档案','关系','事件','目标','纪念日','世界'])
    await click('统计与分析');expect(arkmeUi.getViewSnapshot().mode).toBe('statistics')
    expect(document.querySelector('#arkme-explore-menu')).toBeNull()
    await act(async()=>trigger.click())
    await click('目标');expect(arkmeUi.getViewSnapshot()).toMatchObject({mode:'explore',exploreModule:'goals'})
    expect(document.querySelector('#arkme-explore-menu')).toBeNull()
    await act(async()=>trigger.click());await click('纪念日')
    expect(arkmeUi.getViewSnapshot()).toMatchObject({mode:'explore',exploreModule:'anniversaries'})
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
