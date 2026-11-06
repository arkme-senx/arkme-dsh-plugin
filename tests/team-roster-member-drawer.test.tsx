// @vitest-environment jsdom
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {GroupMembersDrawer,AddMembersDrawer} from '../src/client/ArkmeGroupChatControls.js'
import type {ArkmeSourceItem} from '../src/types.js'

const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:(...args:unknown[])=>call(...args)}))
vi.mock('../src/client/use-conversation-members.js',()=>({useConversationMembers:()=>({items:[],ready:true,refreshing:false})}))
vi.mock('../src/client/use-group-bots.js',()=>({useGroupBots:()=>({items:[],ready:true,loading:false,refresh:()=>{}}),arkmeGroupBotsChanged:()=>{}}))
vi.mock('../src/client/use-resizable-note-detail.js',()=>({useResizableNoteDetail:()=>({style:{},handle:null})}))
const source:ArkmeSourceItem={sourceRef:'same-group',sourceKey:'group:key',kind:'group_chat',displayName:'同一个群',activeAtMillis:1,unreadCount:0}
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const render=async(value:ArkmeSourceItem)=>act(async()=>root.render(<GroupMembersDrawer source={value} open accountScope="test:42"
 onClose={()=>{}} onAdd={()=>{}} onMemberOpen={()=>{}} onMemberContextMenu={()=>{}} onError={()=>{}} onBotOpen={()=>{}} onBotContextMenu={()=>{}}/>))
it('keeps independent team participation out of a Team roster group',async()=>{
 await render({...source,teamRosterManaged:true})
 expect(call).not.toHaveBeenCalled()
 expect(host.textContent).not.toContain('团队列表加载失败')
 expect(host.textContent).not.toContain('团队操作资格')
})
it('aborts an ordinary-group team read when the same group becomes roster managed',async()=>{
 let resolve!:(value:unknown)=>void
 call.mockReturnValueOnce(new Promise(done=>{resolve=done}))
 await render(source)
 expect(call.mock.calls.map(([operation])=>operation)).toEqual(['team.app.group.participants'])
 const signal=call.mock.calls[0]![2] as AbortSignal
 await render({...source,teamRosterManaged:true})
 expect(signal.aborted).toBe(true)
 await act(async()=>resolve({items:[{key:'team',name:'独立参与的团队',jotmoId:'team',teamRef:'opaque',revision:1}],hasMore:false,canManage:true,leaveAvailable:true}))
 expect(host.textContent).not.toContain('独立参与的团队')
 expect(call).toHaveBeenCalledTimes(1)
})


it('preserves Bot addition without offering manual people or team admission',async()=>{
 const onAdded=vi.fn(),onError=vi.fn()
 call.mockImplementation(async(operation:string)=>{
  if(operation==='group.bots')return {groupSourceRef:source.sourceRef,displayName:source.displayName,canAddBots:true,items:[{botRef:'bot-ref',name:'原有机器人',description:'群助手',installed:false}]}
  if(operation==='group.bot.add')return {installed:true}
  throw new Error('unexpected '+operation)
 })
 await act(async()=>root.render(<AddMembersDrawer source={{...source,teamRosterManaged:true}} open accountScope="test:42" onClose={()=>{}} onAdded={onAdded} onError={onError}/>))
 expect([...host.querySelectorAll('[role="tab"]')].map(node=>node.textContent)).toEqual(['Bot'])
 const row=[...host.querySelectorAll('button')].find(node=>node.textContent?.includes('原有机器人'))!
 await act(async()=>row.click())
 const confirm=[...host.querySelectorAll('button')].find(node=>node.textContent==='确认添加（1）')!
 expect(confirm).toBeDefined()
 await act(async()=>confirm.click())
 expect(call.mock.calls.map(([operation])=>operation)).toEqual(['group.bots','group.bot.add'])
 expect(onAdded).toHaveBeenCalledOnce();expect(onError).not.toHaveBeenCalled()
})
