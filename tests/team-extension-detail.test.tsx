// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {TeamMessageDetail} from '../src/client/TeamMessageDetail.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import type {TeamConversation,TeamMessage} from '../src/team-app-contract.js'
const {read}=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('../src/sdk/index.js',()=>({createArkmeSdk:()=>({readTeamExtensions:read})}))
const source:TeamMessage={key:'source',ref:'source-ref',seq:1,revision:1,side:'team',sender:{nickname:'作者'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:1,contentStatus:'available',media:[],content:{text_content:'原消息正文',template_kind:1}}
const first={...source,key:'first',ref:'first-ref',seq:2,content:{text_content:'第一条延展',template_kind:1}}
const second={...source,key:'second',ref:'second-ref',seq:3,content:{text_content:'第二条延展',template_kind:1}}
const conversation={ref:'conversation',key:'conversation',side:'team',channel:{name:'团队'},visitor:{nickname:'访客'}} as TeamConversation
let root:Root,host:HTMLDivElement
const extend=vi.fn()
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);read.mockReset();extend.mockReset()
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 read.mockImplementation(async(_conversation,ref,options)=>ref==='second-ref'
  ? {message:second,items:[],totalCount:0,hasMore:false,nextSeq:0,throughSeq:20}
  : {message:source,items:options.afterSeq?[second]:[first],totalCount:2,hasMore:!options.afterSeq,nextSeq:options.afterSeq?3:2,throughSeq:20})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function mount(){await act(async()=>root.render(<TeamMessageDetail message={source} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}} onExtend={extend}/>))}
async function click(label:string){await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label)!.click())}
it('pages nested extensions and restores the already-read parent page before extending an exact child',async()=>{
 await mount();expect(host.textContent).toContain('第一条延展')
 await click('加载更多');expect(host.textContent).toContain('第二条延展')
 await act(async()=>host.querySelector<HTMLElement>('[data-team-extension-item=second]')!.click())
 expect(host.textContent).toContain('第二条延展');expect(host.textContent).not.toContain('原消息正文')
 await click('延展回复');expect(extend).toHaveBeenCalledWith(expect.objectContaining({key:'second',ref:'second-ref'}))
 await click('返回延展列表');expect(host.textContent).toContain('第一条延展');expect(host.textContent).toContain('第二条延展')
 expect(read.mock.calls.at(-1)?.[2]).toMatchObject({afterSeq:2,throughSeq:20})
})
it('clears visible source and child snapshots as soon as access needs revalidation',async()=>{
 await mount();read.mockRejectedValue(new Error('无权访问'))
 await act(async()=>invalidateTeamMessages('test:11'))
 expect(host.textContent).not.toContain('原消息正文');expect(host.textContent).not.toContain('第一条延展')
 expect(host.textContent).toContain('无权访问')
})

it('clears prior content when a later page is denied without a push event',async()=>{
 await mount();read.mockRejectedValue(new Error('无权访问'))
 await click('加载更多')
 expect(host.textContent).not.toContain('原消息正文');expect(host.textContent).not.toContain('第一条延展')
 expect(host.textContent).toContain('无权访问')
})

it('retains the focused composer DOM when a background notification needs revalidation',async()=>{
 await act(async()=>root.render(<TeamMessageDetail message={source} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}} footer={()=> <input aria-label="draft" defaultValue="正在输入"/>}/>))
 const input=host.querySelector('input')!;input.focus()
 read.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>invalidateTeamMessages('test:11'))
 expect(host.querySelector('input')).toBe(input);expect(document.activeElement).toBe(input)
 expect(host.textContent).not.toContain('原消息正文')
})
it('opens an available parent in the detail trail and can return to the reply',async()=>{
 const parent={...source,key:'parent',ref:'parent-ref',content:{text_content:'完整父消息正文',template_kind:1}}
 const child={...source,reply:{key:parent.key,ref:parent.ref,seq:1,version:1,state:'available' as const,text:'父预览',sender:parent.sender}}
 read.mockImplementation(async(_conversation,ref)=>({message:ref==='parent-ref'?parent:child,items:[],totalCount:0,hasMore:false,nextSeq:0,throughSeq:20}))
 await act(async()=>root.render(<TeamMessageDetail message={child} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}}/>))
 await act(async()=>host.querySelector<HTMLElement>('[data-arkme-extension-parent-preview]')!.click())
 expect(read.mock.calls.at(-1)?.[1]).toBe('parent-ref')
 expect(host.textContent).toContain('完整父消息正文')
 await click('返回延展列表');expect(host.textContent).toContain('原消息正文')
})
