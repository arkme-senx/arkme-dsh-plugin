// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamInternalGroupDialog} from '../src/client/TeamInternalGroupDialog.js'
import type {ArkmeSourceItem} from '../src/types.js'
const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const team={teamRef:'sealed-team',jotmoId:'our_team',name:'即我',currentUserRole:'owner',createdAtMillis:1,updatedAtMillis:1}
const source:ArkmeSourceItem={kind:'group_chat',sourceRef:'group-ref',displayName:'产品群',activeAtMillis:1,unreadCount:0}
const preview={state:'preview',mode:'create',label:'即我内部群',previewRef:'sealed-preview',requestUid:'original',expiresAt:Date.now()+300000,add:[{key:'a',name:'小林'}],remove:[{key:'r',name:'小王'}],retainCount:2,botCount:1,retain:[],bots:[],owner:{key:'o',name:'负责人'},ownerChanged:true,roleChanges:[{key:'r',name:'小赵',before:'admin',after:'member'}],closePublicAccess:true}
let host:HTMLDivElement,root:Root
const mount=async(element:React.ReactNode)=>act(async()=>root.render(element))
function button(label:string){const v=[...document.querySelectorAll('button')].find(x=>x.textContent===label);if(!v)throw new Error(label);return v}
const click=async(label:string)=>act(async()=>button(label).click())
const create=()=> <TeamInternalGroupDialog accountKey="prod:90" target={{mode:'create',teamJotmoId:'our_team'}} onClose={vi.fn()}/>
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 call.mockReset().mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'none'}:op==='team.app.internal-group.prepare'?preview:{state:'activating',requestUid:'original'})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('previews without writes, presents exact effects and requires a separate explicit confirmation',async()=>{
 await mount(create());expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('即我内部群')
 await act(async()=>{button('下一步').click();button('下一步').click()})
 expect(call.mock.calls.filter(([op])=>op==='team.app.internal-group.prepare')).toHaveLength(1)
 expect(call.mock.calls.some(([op])=>op==='team.app.internal-group.confirm')).toBe(false)
 for(const text of ['小林','小王','小赵','负责人','重新入群','公开发现'])expect(document.body.textContent).toContain(text)
 await click('确认创建')
 expect(call.mock.calls.at(-1)![1]).toEqual({expectedAccountKey:'prod:90',teamRef:'sealed-team',previewRef:'sealed-preview'})
 expect(document.body.textContent).toContain('正在同步成员')
 expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true)
})
it('links only the selected group and never uses personal membership CRUD',async()=>{
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'none'}:{...preview,mode:'link',label:'产品群'})
 await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{mode:'link',source}} onClose={vi.fn()}/>);await click('下一步')
 expect(call.mock.calls.at(-1)![1]).toMatchObject({mode:'link',sourceRef:'group-ref',teamRef:'sealed-team'})
 for(const text of ['合法历史权限不变','不能单独退群或解除关联','公开发现']) expect(document.body.textContent).toContain(text)
 expect(document.body.textContent).not.toContain('需升级客户端')
 expect(button('确认关联').disabled).toBe(false)
 expect(call.mock.calls.every(([op])=>['team.app.teams','team.app.internal-group.recover','team.app.internal-group.prepare'].includes(op))).toBe(true)
})
it('recovers a lost request on reopen and renews only that original command',async()=>{
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'unresolved',requestUid:'old-request',label:'原工程群'}:preview)
 await mount(create());expect(document.body.textContent).toContain('原工程群')
 expect(document.querySelector('input')).toBeNull()
 await click('重新检查');expect(call.mock.calls.at(-1)![0]).toBe('team.app.internal-group.prepare-original')
 expect(call.mock.calls.some(([op])=>op==='team.app.internal-group.prepare')).toBe(false)
})
it('acknowledges a recovered ready result before closing',async()=>{
 const close=vi.fn();call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.ack'?{state:'acknowledged'}:{state:'ready',requestUid:'old'})
 await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{mode:'create',teamJotmoId:'our_team'}} onClose={close}/>);await click('完成')
 expect(call.mock.calls.at(-1)![1]).toMatchObject({requestUid:'old'});expect(close).toHaveBeenCalledOnce()
})
it('allows retrying a failed current status without creating another command',async()=>{
 call.mockRejectedValueOnce(new Error('团队加载失败'));await mount(create());expect(document.body.textContent).not.toContain('你尚未加入团队')
 await click('重试');expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('即我内部群')
})
it('does not allow ordinary members to prepare a binding',async()=>{
 call.mockImplementation(async op=>op==='team.app.teams'?[{...team,currentUserRole:'member'}]:{state:'none'})
 await mount(create());expect(button('下一步').disabled).toBe(true);expect(document.body.textContent).toContain('仅团队所有者或管理员')
})
it('aborts preparation and ignores late responses after account change',async()=>{
 let resolve!:(v:unknown)=>void
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'none'}:new Promise(done=>{resolve=done}))
 await mount(create());await click('下一步');const signal=call.mock.calls.at(-1)![2] as AbortSignal
 call.mockResolvedValue([]);await mount(<TeamInternalGroupDialog accountKey="prod:91" target={{mode:'link',source}} onClose={vi.fn()}/>);expect(signal.aborted).toBe(true)
 await act(async()=>resolve(preview));expect(document.body.textContent).toContain('你尚未加入团队');expect(document.body.textContent).not.toContain('小林')
})
it('keeps Escape working while showing a preview',async()=>{
 const close=vi.fn();await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{mode:'create',teamJotmoId:'our_team'}} onClose={close}/>);await click('下一步')
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(close).toHaveBeenCalledOnce()
})

it('keeps optional rules collapsed and critical changes outside the disclosure',async()=>{
 await mount(create());
 const details=document.querySelector('details')!;expect(details.open).toBe(false)
 expect(document.body.textContent).not.toContain('确认时会再次核对')
 await click('下一步')
 const effects=document.querySelector('[aria-label="成员变更"]')!
 expect(effects.textContent).toContain('新增 1 人');expect(effects.textContent).toContain('移出 1 人')
 for(const text of ['小王','小赵','负责人','不能单独退群或解除关联']) {
   const nodes=[...document.querySelectorAll('dd,p')].filter(n=>n.textContent?.includes(text))
   expect(nodes.some(n=>!n.closest('details'))).toBe(true)
 }
 await act(async()=>document.querySelector('summary')!.click())
 expect(details.open).toBe(true)
 expect(call.mock.calls.some(([op])=>op==='team.app.internal-group.confirm')).toBe(false)
})
it('shows a focused result instead of a disabled form after completion',async()=>{
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:{state:'ready',requestUid:'old'})
 await mount(create());expect(document.body.textContent).toContain('内部群已就绪')
 expect(document.querySelector('input,select,details')).toBeNull()
 expect(button('完成').disabled).toBe(false)
})
it('does not fill an unchanged roster with zero-count notices',async()=>{
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'none'}:{...preview,add:[],remove:[],roleChanges:[],retainCount:3,botCount:0,retain:[],bots:[],closePublicAccess:false})
 await mount(create());await click('下一步')
 expect(document.body.textContent).toContain('保留 3 人')
 expect(document.body.textContent).not.toContain('新增 0 人');expect(document.body.textContent).not.toContain('移出 0 人')
 expect(document.body.textContent).not.toContain('需升级客户端');expect(document.body.textContent).not.toContain('关闭公开发现')
 expect(button('确认创建').disabled).toBe(false)
})

it('confirms the original operation and target when recovery starts from another entry',async()=>{
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'unresolved',requestUid:'old',label:'原协作群'}:{...preview,mode:'link',label:'原协作群'})
 await mount(create());await click('重新检查')
 expect(document.body.textContent).not.toContain('需升级客户端')
 expect(button('确认关联').disabled).toBe(false)
 expect(document.querySelector('[role="dialog"]')!.textContent).toContain('原协作群')
 expect(document.querySelector('input')).toBeNull()
 expect(document.body.textContent).toContain('保留成员的合法历史权限不变')
 await click('确认关联')
 expect(call.mock.calls.at(-1)![1]).toMatchObject({previewRef:'sealed-preview'})
})

it('notifies its source owner when a link is ready, before waiting for the user to close it',async()=>{
 const ready=vi.fn(),close=vi.fn()
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:{state:'ready',requestUid:'linked'})
 await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{mode:'link',source}} onReady={ready} onClose={close}/>)
 expect(ready).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled()
})
