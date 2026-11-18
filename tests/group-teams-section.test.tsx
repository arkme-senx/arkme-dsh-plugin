// @vitest-environment jsdom
import {createElement,act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {GroupTeamsSection} from '../src/client/GroupTeamsSection.js'
import type {ArkmeSourceItem} from '../src/types.js'
const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
vi.mock('../src/client/chat-directory-store.js',()=>({arkmeInterwovenInvalidation:{invalidate:vi.fn()}}))
vi.mock('../src/client/TeamPublicCardDialog.js',()=>({TeamPublicCardDialog:()=>null}))
vi.mock('../src/client/ArkmeTeamAvatar.js',()=>({ArkmeTeamAvatar:()=>null}))
vi.mock('../src/client/ArkmeDshMenu.js',()=>({ArkmeDshRowActionsMenu:({items,onSelect}:{items:{id:string;label:string}[];onSelect(id:string):void})=>createElement('div',{},items.map(item=>createElement('button',{key:item.id,onClick:()=>onSelect(item.id)},item.label)))}))
let root:Root,host:HTMLDivElement
const source={kind:'group_chat',sourceKey:'team-A-admission-1',sourceRef:'opaque-source',displayName:'客户群',activeAtMillis:1,unreadCount:0} satisfies ArkmeSourceItem
const team={key:'current-admission',mentionRef:'mention',teamRef:'team',name:'售后',jotmoId:'support',revision:3,canLeave:true}
const styles={}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);call.mockReset()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
const render=async(canManage=false,rows=[team])=>act(async()=>root.render(<GroupTeamsSection accountKey="test:90" source={source} teams={rows} ready canManage={canManage} leaveAvailable refresh={()=>{}} styles={styles}/>))
async function click(text:string){const button=[...document.querySelectorAll('button')].find(button=>button.textContent===text);expect(button,`button ${text}`).toBeDefined();await act(async()=>button!.click())}
it('offers proxy leave to current coworkers while reserving removal and approvals for real group managers',async()=>{
 await render()
 expect(document.body.textContent).toContain('团队退出群聊')
 expect(document.body.textContent).not.toContain('将团队移出群聊')
 expect(call).not.toHaveBeenCalled()
 await render(false,[{...team,canLeave:false}])
 expect(document.body.textContent).not.toContain('团队退出群聊')
})
it('recovers a lost ACK after remount using the permanent status receipt before another mutation',async()=>{
 call.mockImplementation(async operation=>{if(operation==='team.app.group.command')throw new Error('确认响应丢失');if(operation==='team.app.group.status')return {state:'left',accessStatus:'unavailable'};throw new Error(operation)})
 await render();await click('团队退出群聊');await click('退出群聊')
 expect(document.body.textContent).toContain('确认响应丢失')
 const command=call.mock.calls.find(([operation])=>operation==='team.app.group.command')![1]
 expect(localStorage.length).toBe(1)
 await act(async()=>root.render(<div/>));await render();await click('团队退出群聊');await click('退出群聊')
 expect(call.mock.calls.filter(([operation])=>operation==='team.app.group.command')).toHaveLength(1)
 expect(call).toHaveBeenLastCalledWith('team.app.group.status',{expectedAccountKey:'test:90',requestUid:command.requestUid},expect.any(AbortSignal))
 expect(localStorage.length).toBe(0)
 expect(document.querySelector('[aria-modal="true"]')).toBeNull()
})
it('uses the selected admission revision and reference for explicit approval',async()=>{
 call.mockImplementation(async operation=>operation==='team.app.group.approvals'?{items:[{key:'approval',teamRef:'pending-team',name:'支持组',jotmoId:'pending',revision:4,admissionRef:'exact-admission'}],hasMore:false}:{state:'joined',accessStatus:'available'})
 await render(true)
 await click('同意');await click('同意入群')
 expect(call).toHaveBeenCalledWith('team.app.group.command',expect.objectContaining({action:'approve',expectedRevision:4,admissionRef:'exact-admission',teamRef:'pending-team',sourceRef:source.sourceRef,expectedAccountKey:'test:90'}),expect.any(AbortSignal))
})
