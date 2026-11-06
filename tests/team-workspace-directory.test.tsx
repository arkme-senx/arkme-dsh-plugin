// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamWorkspaceDirectory} from '../src/client/TeamWorkspaceDirectory.js'
import {teamDirectoryPreferences} from '../src/client/team-directory-preferences.js'
import {arkmeUi} from '../src/client/ui-controller.js'
import type {TeamChannel,TeamConversation} from '../src/team-app-contract.js'
import type {TeamWorkspacePage} from '../src/team-group-contract.js'
const {call,prefs,legacy}=vi.hoisted(()=>({call:vi.fn(),prefs:{} as Record<string,{pinned:boolean;dismissed:boolean}>,legacy:{items:[] as unknown[]}}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
vi.mock('../src/client/team-conversation-directory.js',()=>({readTeamDirectory:()=>legacy,subscribeTeamDirectory:()=>()=>{}}))
vi.mock('../src/client/team-directory-preferences.js',async original=>({...await original<typeof import('../src/client/team-directory-preferences.js')>(),useTeamDirectoryPreferences:()=>prefs}))
vi.mock('../src/client/TeamMessagingPanel.js',()=>({TeamConversationRow:({conversation,onClick}:{conversation:TeamConversation;onClick():void})=><button role="treeitem" data-last-seq={conversation.lastSeq} onClick={onClick}>{conversation.visitor?.nickname}</button>}))
const channel={teamRef:'selected-team',jotmoId:'support',name:'Support'} as TeamChannel
const customer=(key:string,at:number)=>({entryKey:key,key,ref:`ref-${key}`,side:'team',channel,visitor:{nickname:key},lastSeq:1,updatedAt:at,unread:0} as TeamConversation)
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();for(const key of Object.keys(prefs))delete prefs[key];legacy.items=[];host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
const group={kind:'group_chat' as const,sourceRef:'encrypted-source',sourceKey:'team-scope',accessKind:'team_delegation' as const,displayName:'客户群',activeAtMillis:300,unreadCount:0}
const page:TeamWorkspacePage={items:[{kind:'group',key:'group',activityAt:300,source:group,entryKey:'group-pref',entryRef:'group-pref-ref'},{kind:'customer',key:'customer-a',activityAt:200,conversation:customer('hidden',200)},{kind:'customer',key:'customer-b',activityAt:100,conversation:customer('ordinary',100)}],hasMore:false,complete:true,resetRequired:false,unavailableSources:[]}
async function mount(){teamDirectoryPreferences.setWorkspaceAvailable('test:90',true);await act(async()=>root.render(<TeamWorkspaceDirectory accountKey="test:90" teamRef={channel.teamRef} channel={channel} onBack={()=>{}}/>))}

it('keeps private customer dismissal and pins outside the current page in the same mixed team directory',async()=>{
  prefs.hidden={pinned:false,dismissed:true};prefs.deep={pinned:true,dismissed:false};legacy.items=[customer('deep',1)]
  call.mockImplementation(async operation=>operation==='team.app.workspace'?page:{schemaVersion:2,items:[],hasMore:false})
  const select=vi.spyOn(arkmeUi,'selectSource').mockImplementation(()=>{})
  await mount()
  const rows=[...host.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')]
  expect(rows.map(row=>row.textContent)).toEqual(['deep',expect.stringContaining('客户群'),'ordinary'])
  expect(host.textContent).not.toContain('hidden')
  await act(async()=>rows[1]!.click())
  expect(select).toHaveBeenCalledWith(group)
  expect(call.mock.calls.filter(([operation])=>operation==='team.app.workspace')).toHaveLength(1)
  expect(call.mock.calls.some(([operation,params])=>operation==='team.app.entries.list'&&params.scope==='workspace')).toBe(true)
})

it('retains explicit source gaps and retries from a fresh server merge instead of advancing a partial cursor',async()=>{
  call.mockResolvedValueOnce({...page,complete:false,hasMore:true,nextCursor:'partial-position',unavailableSources:['groups']})
  await mount()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('当前列表尚不完整')
  expect([...host.querySelectorAll('button')].some(button=>button.textContent==='加载更多')).toBe(false)
  call.mockResolvedValue(page)
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='重试')!.click())
  expect(call.mock.calls.filter(([operation])=>operation==='team.app.workspace').at(-1)![1]).toEqual({expectedAccountKey:'test:90',teamRef:'selected-team'})
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('removes previously displayed group rows when current admission becomes stale',async()=>{
 let stale=false
 call.mockImplementation(async operation=>{
  if(operation==='team.app.workspace'){
   if(stale)throw {message:'团队群资格已变化',body:{code:'team-team_group_membership_stale'}}
   return page
  }
  return {schemaVersion:2,items:[],hasMore:false}
 })
 await mount()
 expect(host.textContent).toContain('客户群')
 stale=true
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(host.textContent).not.toContain('客户群')
 expect(host.querySelector('[role="alert"]')).not.toBeNull()
})

import {invalidateTeamMessages,invalidateTeamWorkspace} from '../src/client/team-messaging-events.js'
for(const hint of ['message','workspace'])it(`retains a ${hint} refresh received during an older pending page`,async()=>{
 let release!:(v:TeamWorkspacePage)=>void,reads=0
 const pending=new Promise<TeamWorkspacePage>(resolve=>{release=resolve})
 const fresh:TeamWorkspacePage={...page,items:[{kind:'customer',key:'new-contact',activityAt:400,conversation:customer('new-contact',400)}]}
 call.mockImplementation(async operation=>operation==='team.app.workspace'?(++reads===1?pending:fresh):{schemaVersion:2,items:[],hasMore:false})
 await mount()
 expect(reads).toBe(1)
 await act(async()=>{if(hint==='message')invalidateTeamMessages('test:90',false,{kind:'team.message.published'});else invalidateTeamWorkspace('test:90')})
 await act(async()=>{release({...page,items:[]});await Promise.resolve()})
 expect(reads,'the completed old page must be followed by the invalidated head read').toBe(2)
 expect(host.textContent).toContain('new-contact')
})

it('keeps a first-publish head refresh while an older contact page is pending',async()=>{
 const before={...customer('用户5',100),lastSeq:0,memberInitiated:true}
 const oldPage={...page,items:[{kind:'customer' as const,key:before.key,activityAt:100,conversation:before}]}
 const after={...before,lastSeq:1,updatedAt:200,preview:{text:'已发布的首条消息',status:'available',hasMedia:false}}
 let release!:(p:TeamWorkspacePage)=>void,reads=0
 const pending=new Promise<TeamWorkspacePage>(resolve=>{release=resolve})
 call.mockImplementation(async op=>op==='team.app.workspace'?(++reads===1?oldPage:reads===2?pending:{...oldPage,items:[{kind:'customer',key:after.key,activityAt:200,conversation:after}]}):{schemaVersion:2,items:[],hasMore:false})
 await mount();expect(host.querySelector('[data-last-seq]')?.getAttribute('data-last-seq')).toBe('0')
 await act(async()=>window.dispatchEvent(new Event('focus')))
 await act(async()=>invalidateTeamMessages('test:90',false,{kind:'team.message.published',conversationKeys:[before.key]}))
 await act(async()=>release(oldPage))
 expect(reads,'published data must supersede the page requested before publication').toBe(3)
 expect(host.querySelector('[data-last-seq]')?.getAttribute('data-last-seq')).toBe('1')
})


it('coalesces head hints during paging and drains them even when the page fails',async()=>{
 let reject!:(e:Error)=>void,reads=0
 const pending=new Promise<TeamWorkspacePage>((_,fail)=>{reject=fail})
 const fresh={...page,items:[{kind:'customer' as const,key:'fresh',activityAt:400,conversation:customer('fresh',400)}]}
 call.mockImplementation(async op=>op==='team.app.workspace'?(++reads===1?{...page,hasMore:true,nextCursor:'older'}:reads===2?pending:fresh):{schemaVersion:2,items:[],hasMore:false})
 await mount()
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='加载更多')!.click())
 await act(async()=>{for(let i=0;i<5;i++)invalidateTeamWorkspace('test:90');window.dispatchEvent(new Event('focus'))})
 expect(reads).toBe(2)
 await act(async()=>reject(new Error('old page unavailable')))
 expect(reads).toBe(3)
 expect(call.mock.calls.filter(([op])=>op==='team.app.workspace').map(([,params])=>params.cursor)).toEqual([undefined,'older',undefined])
 expect(host.textContent).toContain('fresh')
 expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('starts the new account read immediately and never publishes or drains the disposed account',async()=>{
 let release!:(p:TeamWorkspacePage)=>void
 const pending=new Promise<TeamWorkspacePage>(resolve=>{release=resolve})
 call.mockImplementation(async(op,params)=>op==='team.app.workspace'?(params.expectedAccountKey==='test:90'?pending:{...page,items:[]}):{schemaVersion:2,items:[],hasMore:false})
 await mount()
 await act(async()=>invalidateTeamWorkspace('test:90'))
 const oldSignal=call.mock.calls.find(([op])=>op==='team.app.workspace')![2] as AbortSignal
 await act(async()=>root.render(<TeamWorkspaceDirectory key="test:91:support" accountKey="test:91" teamRef={channel.teamRef} channel={channel} onBack={()=>{}}/>))
 expect(oldSignal.aborted).toBe(true)
 await act(async()=>release(page))
 expect(call.mock.calls.filter(([op])=>op==='team.app.workspace').map(([,params])=>params.expectedAccountKey)).toEqual(['test:90','test:91'])
 expect(host.textContent).not.toContain('客户群')
})

it('cancels an invalidated read on unmount without starting its queued refresh',async()=>{
 let release!:(p:TeamWorkspacePage)=>void,reads=0
 call.mockImplementation(async op=>op==='team.app.workspace'?(reads++,new Promise<TeamWorkspacePage>(resolve=>{release=resolve})):{schemaVersion:2,items:[],hasMore:false})
 await mount()
 await act(async()=>invalidateTeamWorkspace('test:90'))
 await act(async()=>root.render(null))
 await act(async()=>release(page))
 expect(reads).toBe(1)
 expect(host.textContent).toBe('')
})


it('retains the same team rows when only its encrypted reference rotates',async()=>{
 let release!:(p:TeamWorkspacePage)=>void,reads=0
 const pending=new Promise<TeamWorkspacePage>(resolve=>{release=resolve})
 call.mockImplementation(async op=>op==='team.app.workspace'?(++reads===1?page:pending):{schemaVersion:2,items:[],hasMore:false})
 await mount()
 await act(async()=>root.render(<TeamWorkspaceDirectory accountKey="test:90" teamRef="rotated-team-ref" channel={{...channel,teamRef:'rotated-team-ref'}} onBack={()=>{}}/>))
 expect(reads).toBe(2)
 expect(host.textContent).toContain('客户群')
 await act(async()=>release({...page,items:[]}))
 expect(host.textContent).not.toContain('客户群')
})
