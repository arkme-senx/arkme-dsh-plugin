// @vitest-environment jsdom
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {afterEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({callArkme:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.callArkme}))
vi.mock('../src/client/ArkmeRichContent.js',()=>({ArkmeMessageContent:({item}:any)=><p>{item.textContent}</p>}))
vi.mock('../src/client/redesign/contacts/TeamFeatureDialog.js',()=>({TeamFeatureDialog:({children,footer}:any)=><div>{children}{footer}</div>}))
import {TeamExternalChats,SharePrivateChat} from '../src/client/TeamExternalChats.js'
const share={key:'s',ref:'share',teamKey:'team-key',teamRef:'fresh-sealed-team-ref',sharerKey:'member',sharerName:'成员甲',peerName:'客户乙',own:true}
const item=(uid:string,textContent:string)=>({itemUid:uid,textContent,senderName:'客户乙',sendAtMillis:1,version:1,contentBlocks:[]})
let view:ReactTestRenderer
const tick=async()=>{await Promise.resolve();await Promise.resolve()}
const text=()=>JSON.stringify(view.toJSON())
const button=(label:string)=>view.root.findAllByType('button').find(b=>b.props['aria-label']===label||b.children.join('')===label)!
afterEach(async()=>{if(view)await act(async()=>view.unmount());vi.useRealTimers();mocks.callArkme.mockReset()})
it('groups by sharer and refreshes away withdrawn content, clearing content on revoked access',async()=>{
 vi.useFakeTimers()
 let revoked=false,removed=false
 mocks.callArkme.mockImplementation(async(op)=>{if(op.endsWith('.list'))return{items:[share],hasMore:false};if(revoked)throw Error('已取消共享');return{items:removed?[item('2','新消息')]:[item('2','新消息'),item('1','待撤回')],hasMore:false,beforeSeq:1,mediaUrls:{}}})
 await act(async()=>{view=create(<TeamExternalChats teamRef="team" teamName="团队" onClose={()=>{}}/>);await tick()})
 expect(text()).toContain('成员甲')
 await act(async()=>{button('查看与 客户乙 的私聊').props.onClick();await tick()})
 expect(text()).toContain('待撤回')
 expect(view.root.findAllByType('textarea')).toHaveLength(0)
 removed=true
 await act(async()=>{vi.advanceTimersByTime(15000);await tick()})
 expect(text()).not.toContain('待撤回')
 revoked=true
 await act(async()=>{vi.advanceTimersByTime(15000);await tick()})
 expect(text()).not.toContain('新消息')
 expect(text()).toContain('已取消共享')
 expect(mocks.callArkme.mock.calls.every(([op])=>op==='team.app.external.list'||op==='team.app.external.page')).toBe(true)
})
it('matches shared state by stable team key and cancels using the grant reference',async()=>{
 mocks.callArkme.mockImplementation(async(op)=>op==='team.app.teams'?[{teamRef:'different-team-ref',key:'team-key',name:'团队'}]:{items:[share]})
 await act(async()=>{view=create(<SharePrivateChat sourceRef="source" name="客户" onClose={()=>{}}/>);await tick()})
 expect(text()).toContain('全部历史和新消息')
 expect(view.root.findByType('input').props.checked).toBe(true)
 await act(async()=>{view.root.findByType('input').props.onChange();await tick()})
 expect(mocks.callArkme).not.toHaveBeenCalledWith('team.app.external.unshare',expect.anything(),expect.anything())
 await act(async()=>{button('保存更改').props.onClick();await tick()})
 expect(mocks.callArkme).toHaveBeenCalledWith('team.app.external.unshare',{shareRef:'share'},expect.any(AbortSignal))
 expect(view.root.findByType('input').props.checked).toBe(false)
 expect(text()).toContain('共享设置已更新')
})
it('aborts a pending request when leaving the share picker',async()=>{
 mocks.callArkme.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>{view=create(<SharePrivateChat sourceRef="source" name="客户" onClose={()=>{}}/>);await tick()})
 const signal=mocks.callArkme.mock.calls[0]![2] as AbortSignal
 await act(async()=>view.unmount())
 expect(signal.aborted).toBe(true)
})
