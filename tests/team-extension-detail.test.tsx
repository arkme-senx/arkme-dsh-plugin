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
async function mount(){await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={source} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}} footer={target => <button type="button" onClick={() => extend(target)}>延展回复</button>}/>))}
async function click(label:string){await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label)!.click())}
it('pages nested extensions and restores the already-read parent page before extending an exact child',async()=>{
 await mount();expect(host.textContent).toContain('第一条延展')
 expect(host.querySelector('[data-arkme-timeline-detail-rich-content]')?.textContent).toContain('原消息正文')
 expect(host.querySelector('[data-arkme-detail-conversation-source]')?.textContent).toContain('团队 · 访客')
 await click('加载更多');expect(host.textContent).toContain('第二条延展')
 await act(async()=>host.querySelector<HTMLElement>('[data-team-extension-item=second]')!.click())
 expect(host.textContent).toContain('第二条延展');expect(host.textContent).not.toContain('原消息正文')
 expect(host.querySelector('[data-arkme-note-extension-count]')).toBeNull()
 await click('延展回复');expect(extend).toHaveBeenCalledWith(expect.objectContaining({key:'second',ref:'second-ref'}))
 await click('返回延展快记');expect(host.textContent).toContain('第一条延展');expect(host.textContent).toContain('第二条延展')
 expect(read.mock.calls.at(-1)?.[2]).toMatchObject({afterSeq:2,throughSeq:20})
})
it('clears visible source and child snapshots as soon as access needs revalidation',async()=>{
 await mount();read.mockRejectedValue(new Error('无权访问'))
 await act(async()=>invalidateTeamMessages('test:11'))
 expect(host.textContent).not.toContain('原消息正文');expect(host.textContent).not.toContain('第一条延展')
 expect(host.textContent).toContain('无权访问')
})

it('cancels the outstanding detail read on confirmed conversation revocation and waits for retry', async () => {
 await mount()
 let finish!: (page: unknown) => void
 read.mockImplementation(() => new Promise(resolve => {finish=resolve}))
 await act(async () => invalidateTeamMessages('test:11',false,{kind:'team.message.published',conversationKeys:[conversation.key]}))
 const count = read.mock.calls.length, pending = finish
 await act(async () => invalidateTeamMessages('test:11',false,{kind:'team.access.revoked',conversationKeys:[conversation.key]}))
 expect(read).toHaveBeenCalledTimes(count)
 await act(async () => pending({message:source,items:[first],totalCount:1,hasMore:false,nextSeq:2,throughSeq:20}))
 expect(host.textContent).not.toContain('原消息正文')
 expect(host.textContent).not.toContain('第一条延展')
 read.mockResolvedValue({message:source,items:[first],totalCount:1,hasMore:false,nextSeq:2,throughSeq:20})
 await click('重试')
 expect(host.textContent).toContain('原消息正文')
})

it('clears prior content when a later page is denied without a push event',async()=>{
 await mount();read.mockRejectedValue(new Error('无权访问'))
 await click('加载更多')
 expect(host.textContent).not.toContain('原消息正文');expect(host.textContent).not.toContain('第一条延展')
 expect(host.textContent).toContain('无权访问')
})

it('retains the focused composer DOM when a background notification needs revalidation',async()=>{
 await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={source} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}} footer={()=> <input aria-label="draft" defaultValue="正在输入"/>}/>))
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
 await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={child} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}}/>))
 await act(async()=>host.querySelector<HTMLElement>('[data-arkme-extension-parent-preview]')!.click())
 expect(read.mock.calls.at(-1)?.[1]).toBe('parent-ref')
 expect(host.textContent).toContain('完整父消息正文')
 await click('返回延展快记');expect(host.textContent).toContain('原消息正文')
})
it('displays the authorized timeline snapshot immediately while refreshing extensions',async()=>{
 let complete!:(value:unknown)=>void
 read.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
 await mount()
 expect(host.textContent).toContain('原消息正文')
 await act(async()=>complete({message:source,items:[],totalCount:0,hasMore:false,nextSeq:0,throughSeq:20}))
 expect(host.textContent).toContain('原消息正文')
})

it('keeps the source and loaded replies mounted while a new occurrence refreshes the window',async()=>{
 await mount();await click('加载更多')
 const reply=host.querySelector('[data-team-extension-item=first]')
 let complete!:(value:unknown)=>void
 read.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.message.changed',messageKey:'new-message',conversationKeys:['conversation']}))
 expect(host.textContent).toContain('原消息正文');expect(host.textContent).toContain('第一条延展');expect(host.textContent).toContain('第二条延展')
 expect(host.querySelector('[data-team-extension-item=first]')).toBe(reply)
 expect(read.mock.calls.at(-1)?.[2]).toEqual({throughSeq:0})
 await act(async()=>complete({message:source,items:[first,second],totalCount:2,hasMore:false,nextSeq:3,throughSeq:21}))
 expect(host.querySelector('[data-team-extension-item=first]')).toBe(reply)
})

it('loads newly published extensions past the previous snapshot while retaining the open detail', async () => {
 await mount()
 const article = host.querySelector('[data-team-extension-item=first]')
 let finish!: (page: unknown) => void
 read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
 const count = read.mock.calls.length
 await act(async () => invalidateTeamMessages('test:11', false, {kind:'team.message.published', conversationKeys:['other']}))
 expect(read).toHaveBeenCalledTimes(count)
 await act(async () => invalidateTeamMessages('test:11', false, {kind:'team.message.published', conversationKeys:[conversation.key]}))
 expect(read).toHaveBeenCalledTimes(count + 1)
 expect(read.mock.lastCall?.[2].throughSeq ?? 0).toBe(0)
 expect(host.querySelector('[data-team-extension-item=first]')).toBe(article)
 await act(async () => finish({message:source, items:[first,second], totalCount:2, hasMore:false, nextSeq:3, throughSeq:21}))
 expect(host.textContent).toContain('第二条延展')
})

it('invalidates one reply without hiding its independent source and sibling',async()=>{
 await mount();await click('加载更多')
 read.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.message.changed',messageKey:'first',conversationKeys:['conversation']}))
 expect(host.textContent).toContain('原消息正文');expect(host.textContent).toContain('第二条延展')
 expect(host.textContent).not.toContain('第一条延展')
})

it('retains independent replies when the source is revalidating',async()=>{
 await mount();read.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.message.changed',messageKey:'source',conversationKeys:['conversation']}))
 expect(host.textContent).not.toContain('原消息正文');expect(host.textContent).toContain('第一条延展')
})

it('keeps a loaded detail when only its opaque read reference rotates',async()=>{
 await mount();const reply=host.querySelector('[data-team-extension-item=first]')
 read.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={{...source,ref:'rotated-source-ref'}} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}}/>))
 expect(host.textContent).toContain('原消息正文');expect(host.querySelector('[data-team-extension-item=first]')).toBe(reply)
})

it('keeps independent replies across the timeline source-version projection and clears them on account replacement',async()=>{
 await mount();read.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.message.changed',messageKey:'source',conversationKeys:['conversation']}))
 const changed={...source,version:0,contentStatus:'revalidating' as const,content:undefined}
 await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={changed} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}}/>))
 expect(host.textContent).not.toContain('原消息正文');expect(host.textContent).toContain('第一条延展')
 await act(async()=>root.render(<TeamMessageDetail accountKey="test:99" message={source} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}}/>))
 expect(host.textContent).not.toContain('原消息正文');expect(host.textContent).not.toContain('第一条延展')
})

it('ignores unrelated accounts and conversations',async()=>{
 await mount();const count=read.mock.calls.length
 read.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>invalidateTeamMessages('test:99',false,{kind:'team.message.changed',messageKey:'source',conversationKeys:['conversation']}))
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.message.changed',messageKey:'source',conversationKeys:['other']}))
 expect(read).toHaveBeenCalledTimes(count)
 expect(host.textContent).toContain('原消息正文');expect(host.textContent).toContain('第一条延展')
})

it('retains unaffected material on a transient refresh failure and rejects late pre-recall reads',async()=>{
 await mount()
 let complete!:(value:unknown)=>void
 read.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve}))
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.message.changed',messageKey:'new-message',conversationKeys:['conversation']}))
 read.mockRejectedValue(Object.assign(new Error('服务暂时不可用'),{body:{code:'team-dependency_unavailable'}}))
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.message.changed',messageKey:'first',conversationKeys:['conversation']}))
 await act(async()=>complete({message:source,items:[first],totalCount:1,hasMore:false,nextSeq:2,throughSeq:20}))
 expect(host.textContent).toContain('原消息正文');expect(host.textContent).not.toContain('第一条延展')
 expect(host.textContent).toContain('服务暂时不可用')
})

it.each([false, true])('uses the resolved nickname for a recalled detail while own=%s', async own => {
 const recalled = { ...source, own, state: 'recalled', contentStatus: 'recalled', sender: { nickname: '原始昵称', publicNickname: '账号昵称' } }
 read.mockResolvedValue({ message: recalled, items: [], totalCount: 0, hasMore: false, nextSeq: 0, throughSeq: 20 })
 const render = async (nickname: string) => act(async () => root.render(<TeamMessageDetail accountKey="test:11" message={recalled} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}} displayIdentity={person => ({ ...person, nickname })} />))
 await render('我的备注')
 expect(host.textContent).toContain(own ? '你撤回了一条消息' : '我的备注撤回了一条消息')
 expect(host.textContent).not.toContain('对方撤回了一条消息')
 expect(host.textContent).not.toContain(source.content!.text_content)
 await render('更新后的昵称 {v0}')
 expect(host.textContent).toContain(own ? '你撤回了一条消息' : '更新后的昵称 {v0}撤回了一条消息')
})

it('highlights mentions in the Team message detail with the shared message renderer', async () => {
 const text = '正文 @同事 联系 a@example.com'
 const named = { ...source, content: { text_content: text, template_kind: 1, mentions: [{ personRef: 'person-ref', displayName: '同事', startIndex: text.indexOf('@'), length: 3 }] } }
 read.mockResolvedValue({ message: named, items: [], totalCount: 0, hasMore: false, nextSeq: 0, throughSeq: 20 })
 await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={named} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}}/>))
 expect([...host.querySelectorAll<HTMLSpanElement>('span')].filter(el => el.style.color.includes('state-business-primary')).map(el => el.textContent)).toContain('@同事')
 expect(host.textContent).toContain('a@example.com')
})

it('clears the initial snapshot on revocation and ignores a late detail response', async () => {
 let finish!:(value:unknown)=>void
 read.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 await mount();expect(host.textContent).toContain('原消息正文')
 await act(async()=>invalidateTeamMessages('test:11',false,{kind:'team.access.revoked',conversationKeys:[conversation.key]}))
 expect(host.textContent).not.toContain('原消息正文')
 await act(async()=>finish({message:source,items:[],totalCount:0,hasMore:false,nextSeq:0,throughSeq:20}))
 expect(host.textContent).not.toContain('原消息正文')
})
it('does not seed history previews or unavailable snapshots', async () => {
 read.mockImplementation(()=>new Promise(()=>{}))
 for(const message of [{...source,historyPreview:true},{...source,version:0,contentStatus:'revalidating' as const}]) {
  await act(async()=>root.render(<TeamMessageDetail key={String(message.historyPreview)} accountKey="test:11" message={message} conversation={conversation} avatar={null} onClose={()=>{}} onLocate={()=>{}}/>))
  expect(host.textContent).not.toContain('原消息正文')
 }
})
it('opens mention cards from the source and loaded extension without navigating the detail', async () => {
 const text='正文 @同事', mentions=[{personRef:'person-ref',displayName:'同事',startIndex:3,length:3}]
 const named={...source,content:{text_content:text,template_kind:1,mentions}}
 const reply={...first,content:named.content}
 read.mockResolvedValue({message:named,items:[reply],totalCount:1,hasMore:false,nextSeq:2,throughSeq:20})
 const openPerson=vi.fn()
 await act(async()=>root.render(<TeamMessageDetail accountKey="test:11" message={named} conversation={conversation} avatar={null} onOpenPerson={openPerson} onClose={()=>{}} onLocate={()=>{}}/>))
 const links=[...host.querySelectorAll<HTMLElement>('[role="link"]')].filter(el=>el.textContent==='@同事')
 expect(links).toHaveLength(2)
 await act(async()=>{links[0]!.click();links[1]!.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))})
 expect(openPerson).toHaveBeenCalledTimes(2)
 expect(openPerson).toHaveBeenLastCalledWith({personRef:'person-ref',nickname:'同事'})
 expect(host.querySelector('[data-team-extension-item=first]')).not.toBeNull()
 expect(read).toHaveBeenCalledTimes(1)
})

it.each(['team-not_accessible','team-dependency_unavailable'])('handles %s during the initial detail refresh', async code => {
 read.mockRejectedValue(Object.assign(new Error('读取失败'),{body:{code}}))
 await mount()
 expect(host.textContent?.includes('原消息正文')).toBe(code==='team-dependency_unavailable')
 expect(host.textContent).toContain('读取失败')
})
it('shows an already-loaded extension immediately while its own extension request is pending', async () => {
 await mount()
 read.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>host.querySelector<HTMLElement>('[data-team-extension-item=first]')!.click())
 expect(host.querySelector('[data-arkme-timeline-detail-rich-content]')?.textContent).toContain('第一条延展')
 expect(read.mock.calls.at(-1)?.[1]).toBe('first-ref')
})
