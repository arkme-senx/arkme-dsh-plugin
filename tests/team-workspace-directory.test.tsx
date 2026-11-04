// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamWorkspaceDirectory} from '../src/client/TeamWorkspaceDirectory.js'
import {arkmeUi} from '../src/client/ui-controller.js'
import type {TeamChannel,TeamConversation} from '../src/team-app-contract.js'
import type {TeamWorkspacePage} from '../src/team-group-contract.js'
const {call,prefs,legacy}=vi.hoisted(()=>({call:vi.fn(),prefs:{} as Record<string,{pinned:boolean;dismissed:boolean}>,legacy:{items:[] as unknown[]}}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
vi.mock('../src/client/team-conversation-directory.js',()=>({readTeamDirectory:()=>legacy,subscribeTeamDirectory:()=>()=>{}}))
vi.mock('../src/client/team-directory-preferences.js',async original=>({...await original<typeof import('../src/client/team-directory-preferences.js')>(),useTeamDirectoryPreferences:()=>prefs}))
vi.mock('../src/client/TeamMessagingPanel.js',()=>({TeamConversationRow:({conversation,onClick}:{conversation:TeamConversation;onClick():void})=><button role="treeitem" onClick={onClick}>{conversation.visitor?.nickname}</button>}))
const channel={teamRef:'selected-team',jotmoId:'support',name:'Support'} as TeamChannel
const customer=(key:string,at:number)=>({entryKey:key,key,ref:`ref-${key}`,side:'team',channel,visitor:{nickname:key},lastSeq:1,updatedAt:at,unread:0} as TeamConversation)
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();for(const key of Object.keys(prefs))delete prefs[key];legacy.items=[];host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
const group={kind:'group_chat' as const,sourceRef:'encrypted-source',sourceKey:'team-scope',accessKind:'team_delegation' as const,displayName:'客户群',activeAtMillis:300,unreadCount:0}
const page:TeamWorkspacePage={items:[{kind:'group',key:'group',activityAt:300,source:group,entryKey:'group-pref',entryRef:'group-pref-ref'},{kind:'customer',key:'customer-a',activityAt:200,conversation:customer('hidden',200)},{kind:'customer',key:'customer-b',activityAt:100,conversation:customer('ordinary',100)}],hasMore:false,complete:true,resetRequired:false,unavailableSources:[]}
async function mount(){await act(async()=>root.render(<TeamWorkspaceDirectory accountKey="test:90" teamRef={channel.teamRef} channel={channel} onBack={()=>{}}/>))}

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
