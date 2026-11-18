// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PeopleSurface } from '../src/client/explore/PeopleSurface.js'
import { PersonPicker } from '../src/client/explore/PersonPicker.js'
import { clearPeopleDirectoryCache } from '../src/client/explore/usePeopleDirectory.js'
import type { PersonFacet } from '../src/people-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({ ArkmeTimelineDetailDrawer: () => null }))
const relation: PersonFacet = { key: 'e', personKey: 'u', source: 'relations', name: '宏顺', aliases: ['老何'], accountLinked: true, isSelf: false,
  relation: { key: 'e', ref: 'er', title: '宏顺', category: '人物', summary: '已保存概述', status: '', date: 1 } }
const speaker: PersonFacet = { key: 's', personKey: 'u', source: 'speakers', name: '何宏顺', aliases: [], accountLinked: true, isSelf: false, speakerRef: 'sr', assignmentRef: 'sr' }
const contact: PersonFacet = { key: 'c', personKey: 'u', source: 'contacts', name: '同事备注', hasRemark: true, aliases: [], accountLinked: true, isSelf: false, chatRef: 'cr', assignmentRef: 'ur' }
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  clearPeopleDirectoryCache(); mocks.call.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function click(text: string) { const button = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === text); expect(button).toBeTruthy(); await act(async () => button!.click()) }
it('renders early sources, updates one person as contacts arrive, and keeps details visible while records load', async () => {
  let finishContacts!: (value: unknown) => void, finishRecords!: (value: unknown) => void
  mocks.call.mockImplementation(async (op, input) => {
    if (op === 'people.list') {
      if (input.source === 'contacts') return new Promise(resolve => { finishContacts = resolve })
      return { source: input.source, items: input.source === 'relations' ? [relation] : [speaker] }
    }
    if (op === 'explore.detail') return new Promise(resolve => { finishRecords = resolve })
  })
  await act(async () => root.render(<PeopleSurface accountScope="test:1" onBack={() => {}}/>))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  await act(async () => (host.querySelector('.people-row') as HTMLButtonElement).click())
  expect(host.textContent).toContain('已保存概述'); expect(host.textContent).toContain('正在读取相关记录')
  await act(async () => finishContacts({ source: 'contacts', items: [contact] }))
  expect(host.querySelector('h1')?.textContent).toBe('同事备注')
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  const row = { key: 'record', text: '可定位的原文', speaker: '', date: 1, label: '来源', anchor: false }
  await act(async () => finishRecords({ evidence: [row, row] }))
  expect(host.querySelectorAll('.explore-evidence')).toHaveLength(1)
  expect(mocks.call.mock.calls.filter(x => x[0] === 'explore.detail')).toHaveLength(1)
})
it('reports partial failure without erasing available people', async () => {
  mocks.call.mockImplementation(async (_op, input) => { if (input.source === 'contacts') throw new Error('联系服务不可用'); return { source: input.source, items: input.source === 'speakers' ? [speaker] : [] } })
  await act(async () => root.render(<PeopleSurface accountScope="test:2" onBack={() => {}}/>))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  expect(host.textContent).toContain('即我联系人 · 暂不可用')
})
it('selects an existing speaker identity without writing and disables relation-only identity creation', async () => {
  const choose = vi.fn()
  const unbound = { ...relation, key: 'other', personKey: 'other', name: '张老师', accountLinked: false }
  mocks.call.mockImplementation(async (_op, input) => ({ source: input.source, items: input.source === 'relations' ? [relation, unbound] : input.source === 'contacts' ? [contact] : [speaker] }))
  await act(async () => root.render(<PersonPicker accountScope="test:3" onClose={() => {}} onChoose={choose}/>))
  const disabled = [...document.querySelectorAll<HTMLButtonElement>('.people-picker-list button')].find(x => x.textContent?.includes('张老师'))!
  expect(disabled.disabled).toBe(true)
  const linked = [...document.querySelectorAll<HTMLButtonElement>('.people-picker-list button')].find(x => x.textContent?.includes('同事备注'))!
  await act(async () => linked.click())
  expect(choose).toHaveBeenCalledWith({ label: '同事备注', speakerRef: 'sr' })
  expect(mocks.call.mock.calls.every(x => x[0] === 'people.list')).toBe(true)
})

it('keeps people visible while refreshing and after a refresh failure', async () => {
  mocks.call.mockImplementation(async (_op, input) => ({ source: input.source, items: input.source === 'speakers' ? [speaker] : [] }))
  await act(async () => root.render(<PeopleSurface accountScope="refresh" onBack={() => {}}/>))
  let fail!: (error: Error) => void
  mocks.call.mockImplementation(async (_op, input) => input.source === 'speakers' ? new Promise((_resolve, reject) => { fail = reject }) : { source: input.source, items: [] })
  await click('刷新')
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  await act(async () => fail(new Error('暂时断网')))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  expect(host.textContent).toContain('录音说话人 · 1 暂未更新')
})

it('does not describe a failed speaker index as still processing', async () => {
  mocks.call.mockImplementation(async (op, input) => op === 'people.list' ? { source: input.source, items: input.source === 'speakers' ? [speaker] : [] } : { state: 'failed', dayCount: 0, items: [], lastSeenAt: 0 })
  await act(async () => root.render(<PeopleSurface accountScope="failed-index" onBack={() => {}}/>))
  await act(async () => (host.querySelector('.people-row') as HTMLButtonElement).click())
  expect(host.textContent).not.toContain('用于录音标记')
  await click('查看录音')
  expect(host.textContent).toContain('录音出现记录读取失败')
  expect(host.textContent).not.toContain('录音出现记录仍在整理')
})

it('publishes each relation page, retains partial results on a later error and retries from a new snapshot', async () => {
  let finish!: (v: unknown) => void
  mocks.call.mockImplementation(async (_op, input) => input.source !== 'relations' ? { source: input.source, items: [] }
    : input.cursor ? new Promise(resolve => { finish = resolve }) : { source: 'relations', items: [relation], nextCursor: 'second-page' })
  await act(async () => root.render(<PeopleSurface accountScope="paged" onBack={() => {}}/>))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  expect(mocks.call.mock.calls.some(([op, p]) => op === 'people.list' && p.cursor === 'second-page')).toBe(false)
  await click('加载更多人物')
  expect(host.textContent).toContain('关系人物 · 1 加载中')
  expect(mocks.call.mock.calls.some(([op, p]) => op === 'people.list' && p.cursor === 'second-page')).toBe(true)
  await act(async () => finish({ source: 'relations', items: [{...relation, key: 'e2', personKey: 'u2', name:'第二位'}] }))
  expect(host.querySelectorAll('.people-row')).toHaveLength(2)
  mocks.call.mockImplementation(async (_op, input) => { if (input.source === 'relations') throw new Error('offline'); return {source:input.source,items:[]} })
  await click('刷新')
  expect(host.querySelectorAll('.people-row')).toHaveLength(2)
  expect(host.textContent).toContain('关系人物 · 2 暂未更新')
})

it('restores stale directory, selected person, original records and scroll immediately on reentry', async () => {
  mocks.call.mockImplementation(async (op, input) => op === 'people.list' ? { source:input.source, items:input.source === 'relations' ? [relation] : [] }
    : {evidence:[{key:'old',text:'缓存中的原始记录',label:'来源',date:1,speaker:'',anchor:false}]})
  await act(async () => root.render(<PeopleSurface accountScope="restored" onBack={() => {}}/>))
  await act(async () => (host.querySelector('.people-row') as HTMLButtonElement).click())
  const scroll = host.querySelector('.explore-detail') as HTMLElement
  await act(async () => { scroll.scrollTop=123;scroll.dispatchEvent(new Event('scroll')) })
  await act(async () => root.render(<div/>))
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+31_000)
  mocks.call.mockImplementation(()=>new Promise(()=>{}))
  await act(async () => root.render(<PeopleSurface accountScope="restored" onBack={() => {}}/>))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  expect(host.querySelector('h1')?.textContent).toBe('宏顺')
  expect(host.textContent).toContain('缓存中的原始记录')
  expect((host.querySelector('.explore-detail') as HTMLElement).scrollTop).toBe(123)
  await act(async () => root.render(<PeopleSurface accountScope="another-account" onBack={() => {}}/>))
  expect(host.querySelectorAll('.people-row')).toHaveLength(0)
  expect(host.textContent).not.toContain('缓存中的原始记录')
})

it('does not reload original records just because a refreshed signed reference changed', async () => {
  let ref='first'
  mocks.call.mockImplementation(async (op,input)=>op==='people.list'?{source:input.source,items:input.source==='relations'?[{...relation,relation:{...relation.relation,ref}}]:[]}
    :{evidence:[{key:'old',text:'保持正在看的内容',label:'来源',date:1,speaker:'',anchor:false}]})
  await act(async () => root.render(<PeopleSurface accountScope="references" onBack={() => {}}/>))
  await act(async () => (host.querySelector('.people-row') as HTMLButtonElement).click())
  ref='new-signed-reference';await click('刷新')
  expect(host.textContent).toContain('保持正在看的内容')
  expect(mocks.call.mock.calls.filter(([op])=>op==='explore.detail')).toHaveLength(1)
})

it('resumes a page interrupted by new identity facets and retries the actual failed page',async()=>{
  const observers:Array<()=>void>=[]
  vi.stubGlobal('IntersectionObserver',class {constructor(private cb:(entries:unknown[])=>void){} observe(){observers.push(()=>this.cb([{isIntersecting:true}]))} disconnect(){}})
  let moreFacet=false, failPage!:(error:Error)=>void, blockedSignal:AbortSignal|undefined
  const evidence=(key:string)=>({key,text:key,label:'来源',date:1,speaker:'',anchor:false})
  mocks.call.mockImplementation(async(op,input,signal)=>{
    if(op==='people.list')return {source:input.source,items:input.source==='relations'?[relation,...(moreFacet?[{...relation,key:'e-extra',relation:{...relation.relation,key:'e-extra',ref:'extra'}}]:[])]:[]}
    if(input.ref==='extra')return {evidence:[]}
    if(input.cursor){blockedSignal=signal;return new Promise((_resolve,reject)=>{failPage=reject})}
    return {evidence:[evidence('原文第一页')],nextCursor:'page-two'}
  })
  await act(async()=>root.render(<PeopleSurface accountScope="interrupted-page" onBack={()=>{}}/>))
  await act(async()=>(host.querySelector('.people-row') as HTMLButtonElement).click())
  await act(async()=>observers.at(-1)!())
  moreFacet=true;await click('刷新')
  expect(blockedSignal?.aborted).toBe(true)
  expect(host.textContent).toContain('原文第一页')
  expect(host.textContent).not.toContain('正在读取相关记录')
  await act(async()=>observers.at(-1)!())
  await act(async()=>failPage(new Error('第二页暂时失败')))
  mocks.call.mockImplementation(async()=>({evidence:[evidence('原文第二页')]}))
  await click('重试')
  expect(mocks.call.mock.lastCall?.[1].cursor).toBe('page-two')
  expect(host.textContent).toContain('原文第一页');expect(host.textContent).toContain('原文第二页')
})

it('previews relation-only recording identity and only creates it after confirmation', async () => {
  const choose = vi.fn()
  const unbound = { ...relation, key: 'unbound', personKey: 'unbound', name: '张老师', accountLinked: false, personRef: 'person-ref' }
  mocks.call.mockImplementation(async (op, input) => op === 'people.list' ? { source: input.source, items: input.source === 'relations' ? [unbound] : [] }
    : input.action === 'binding-preview' ? { state: 'create_required', commandRef: 'binding-command' } : { speakerRef: 'new-speaker' })
  await act(async () => root.render(<PersonPicker accountScope="binding" onClose={() => {}} onChoose={choose}/>))
  await act(async () => (host.querySelector('.people-picker-list button') as HTMLButtonElement).click())
  expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('无需对方注册账号')
  expect(choose).not.toHaveBeenCalled()
  expect(mocks.call.mock.calls.some(([, p]) => p.action === 'binding-apply')).toBe(false)
  await click('确认并继续标记')
  expect(choose).toHaveBeenCalledWith({ label: '张老师', speakerRef: 'new-speaker' })
})

it('replaces cached parent-scoped record keys with a fresh full page and shows one canonical card across merged facets',async()=>{
 const second={...relation,key:'e-merged',relation:{...relation.relation!,key:'e-merged',ref:'merged-ref'}}
 let fresh=false
 mocks.call.mockImplementation(async(op,input)=>{
  if(op==='people.list')return {source:input.source,items:input.source==='relations'?[relation,second]:[]}
  const key=fresh?'canonical-source':`legacy-${input.ref}`
  return {evidence:[{key,text:'同一条合并原文',label:'来源',date:1,speaker:'',anchor:false,mentions:[{start:input.ref==='merged-ref'?3:0,end:input.ref==='merged-ref'?4:1,text:'人'}]}]}
 })
 await act(async()=>root.render(<PeopleSurface accountScope="canonical-refresh" onBack={()=>{}}/>))
 await act(async()=>(host.querySelector('.people-row') as HTMLButtonElement).click())
 expect(host.querySelectorAll('.explore-evidence')).toHaveLength(2)
 await act(async()=>root.render(<div/>))
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+31_000);fresh=true
 await act(async()=>root.render(<PeopleSurface accountScope="canonical-refresh" onBack={()=>{}}/>))
 expect(host.querySelectorAll('.explore-evidence')).toHaveLength(1)
 expect(host.textContent).toContain('此原文提及 2 处')
})
it('filters explicit person record roles without promoting mentions to speech and preserves distinct times',async()=>{
 mocks.call.mockImplementation(async(op,input)=>op==='people.list'?{source:input.source,items:input.source==='relations'?[relation]:[]}:{evidence:[
  {key:'mention',text:'别人提到了他',date:1000,label:'录音',roles:['mentioned']},
  {key:'author',text:'他发出的消息',date:2000,label:'聊天',roles:['author'],uploadedAt:3000,recognizedAt:4000},
  {key:'unknown',text:'未确定角色',date:5000,label:'记录'}]})
 await act(async()=>root.render(<PeopleSurface accountScope="role-filter" onBack={()=>{}}/>))
 await act(async()=>(host.querySelector('.people-row') as HTMLButtonElement).click())
 await click('作者')
 expect(host.textContent).toContain('他发出的消息');expect(host.textContent).not.toContain('别人提到了他')
 await click('录音发言');expect(host.textContent).not.toContain('别人提到了他')
 expect(host.textContent).toContain('已加载记录中没有此角色')
})

 it('opens new-person confirmation from the search input and returns a draft without writing', async () => {
  const create = vi.fn()
  mocks.call.mockImplementation(async (_op, p) => ({ source: p.source, items: [] }))
  await act(async () => root.render(<PersonPicker accountScope="create-draft" onClose={() => {}} onChoose={() => {}} onCreate={create}/>))
  expect([...document.querySelectorAll('button')].some(b=>b.textContent==='新建人物')).toBe(false)
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索人物档案"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '新人物示例')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('新建人物')
  expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain('保存标记时')
  expect(create).not.toHaveBeenCalled()
  await click('确认并继续标记')
  expect(create).toHaveBeenCalledWith('新人物示例')
  expect(mocks.call.mock.calls.every(([op]) => op==='people.list')).toBe(true)
 })

it.each([true,false])('creates an independent same-name draft with root=%s without selecting an existing person', async hasRoot => {
 const create=vi.fn(); const existing={...relation,personKey:'independent',accountLinked:false,name:'同名人物',...(hasRoot?{personRef:'existing-root'}:{})};
 mocks.call.mockImplementation(async (_op,p)=>({source:p.source,items:p.source==='relations'?[existing]:[]}));
 await act(async()=>root.render(<PersonPicker accountScope={'duplicate-'+hasRoot} onClose={()=>{}} onChoose={()=>{}} onCreate={create}/>));
 await act(async()=>{const input=document.querySelector<HTMLInputElement>('input[aria-label="搜索人物档案"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'同名人物');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('新建人物'); await click('确认并继续标记');
 expect(create).toHaveBeenCalledWith('同名人物');
 expect(mocks.call.mock.calls.every(([op])=>op==='people.list')).toBe(true);
});
