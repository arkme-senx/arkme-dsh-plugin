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
const preview={state:'preview',previewRef:'sealed-preview',requestUid:'original',expiresAt:Date.now()+300000,add:[{key:'a',name:'小林'}],remove:[{key:'r',name:'小王'}],retainCount:2,botCount:1,owner:{key:'o',name:'负责人'},ownerChanged:true,roleChanges:[{key:'r',name:'小赵',before:'admin',after:'member'}],closePublicAccess:true,requiresClientUpgrade:true}
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
 await act(async()=>{button('检查创建条件').click();button('检查创建条件').click()})
 expect(call.mock.calls.filter(([op])=>op==='team.app.internal-group.prepare')).toHaveLength(1)
 expect(call.mock.calls.some(([op])=>op==='team.app.internal-group.confirm')).toBe(false)
 for(const text of ['小林','小王','小赵','负责人','重新加入','合法历史权限','客户端后继续使用','公开发现'])expect(document.body.textContent).toContain(text)
 await click('确认以上变更')
 expect(call.mock.calls.at(-1)![1]).toEqual({expectedAccountKey:'prod:90',teamRef:'sealed-team',previewRef:'sealed-preview'})
 expect(document.body.textContent).toContain('请求已受理')
 expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true)
})
it('links only the selected group and never uses personal membership CRUD',async()=>{
 await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{mode:'link',source}} onClose={vi.fn()}/>);await click('查看关联影响')
 expect(call.mock.calls.at(-1)![1]).toMatchObject({mode:'link',sourceRef:'group-ref',teamRef:'sealed-team'})
 expect(call.mock.calls.every(([op])=>['team.app.teams','team.app.internal-group.recover','team.app.internal-group.prepare'].includes(op))).toBe(true)
})
it('recovers a lost request on reopen and renews only that original command',async()=>{
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'unresolved',requestUid:'old-request',label:'原工程群'}:preview)
 await mount(create());expect(document.body.textContent).toContain('原工程群')
 expect(document.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
 await click('重新检查原请求');expect(call.mock.calls.at(-1)![0]).toBe('team.app.internal-group.prepare-original')
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
 await mount(create());expect(button('检查创建条件').disabled).toBe(true);expect(document.body.textContent).toContain('仅团队所有者或管理员')
})
it('aborts preparation and ignores late responses after account change',async()=>{
 let resolve!:(v:unknown)=>void
 call.mockImplementation(async op=>op==='team.app.teams'?[team]:op==='team.app.internal-group.recover'?{state:'none'}:new Promise(done=>{resolve=done}))
 await mount(create());await click('检查创建条件');const signal=call.mock.calls.at(-1)![2] as AbortSignal
 call.mockResolvedValue([]);await mount(<TeamInternalGroupDialog accountKey="prod:91" target={{mode:'link',source}} onClose={vi.fn()}/>);expect(signal.aborted).toBe(true)
 await act(async()=>resolve(preview));expect(document.body.textContent).toContain('你尚未加入团队');expect(document.body.textContent).not.toContain('小林')
})
it('keeps Escape working while showing a preview',async()=>{
 const close=vi.fn();await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{mode:'create',teamJotmoId:'our_team'}} onClose={close}/>);await click('检查创建条件')
 await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(close).toHaveBeenCalledOnce()
})
