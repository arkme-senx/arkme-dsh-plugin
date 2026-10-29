// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {TeamAddMembersDialog} from '../src/client/TeamAddMembersDialog.js'
const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
vi.mock('../src/client/ArkmeAvatar.js',()=>({ArkmeUserAvatar:({label}:{label:string})=><span role="img" aria-label={label}/>}))
let host:HTMLDivElement,root:Root
const close=vi.fn(),changed=vi.fn()
const person=(key:string,extra={})=>({key,candidateRef:`sealed-${key}`,displayName:key,alreadyMember:false,isSelf:false,...extra})
const page=(items=[person('同事'),person('已加入',{alreadyMember:true})],extra={})=>({items,groups:[],hasMore:false,...extra})
const completed={state:'completed',requestUid:'batch',memberCount:3,membershipRevision:2,items:[{key:'同事',displayName:'同事',status:'added'},{key:'失败',displayName:'失败',status:'rejected',reason:'account_unavailable'}]}
let recovery:unknown,add:()=>Promise<unknown>
const mount=async(accountKey='prod:90')=>act(async()=>root.render(<TeamAddMembersDialog accountKey={accountKey} teamRef="team" teamName="团队" onClose={close} onChanged={changed}/>))
const button=(name:string)=>[...document.querySelectorAll('button')].find(n=>n.textContent===name)!
const check=(name:string)=>document.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="${name}"]`)!
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();close.mockReset();changed.mockReset();recovery={state:'none'};add=async()=>completed
 call.mockImplementation(async(op,params)=>{
  if(op==='team.app.members.add-recover')return recovery
  if(op==='team.app.members.add'||op==='team.app.members.add-retry')return add()
  if(op==='team.app.members.add-ack')return {state:'acknowledged'}
  if(params.source==='conversations')return page([person('同事')],{groups:[{sourceRef:'group',sourceKey:'group-key',displayName:'群聊',kind:'group_chat'}]})
  if(params.source==='group')return page([person('同事'),person('失败')])
  return page()
 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('deduplicates across sources and applies each actual result while preserving rejected selections',async()=>{
 await mount();expect(check('已加入').disabled).toBe(true)
 await act(async()=>check('同事').click());await act(async()=>button('最近对话与群聊').click())
 expect(check('同事').getAttribute('aria-checked')).toBe('true')
 await act(async()=>button('群聊').click());await act(async()=>check('失败').click())
 await act(async()=>button('确认添加（2）').click())
 expect(call.mock.calls.find(([op])=>op==='team.app.members.add')![1]).toMatchObject({expectedAccountKey:'prod:90',candidateRefs:['sealed-同事','sealed-失败']})
 expect(document.body.textContent).toContain('同事：已添加');expect(document.body.textContent).toContain('失败：账号不可用，未添加')
 expect(button('确认添加（1）').disabled).toBe(false);expect(changed).toHaveBeenCalled();expect(close).not.toHaveBeenCalled()
 expect(call.mock.calls.some(([op])=>op==='team.app.members.add-ack')).toBe(true)
})
it('freezes uncertain selections and retries the original batch without a new selection',async()=>{
 await mount();await act(async()=>check('同事').click());add=async()=>{throw new Error('网络结果未知')}
 await act(async()=>button('确认添加（1）').click());expect(check('同事').disabled).toBe(true)
 expect(document.body.textContent).toContain('原批次结果待核对')
 recovery={state:'unresolved',requestUid:'batch'};add=async()=>completed
 await act(async()=>button('核对并重试原批次').click())
 expect(call.mock.calls.find(([op])=>op==='team.app.members.add-retry')![1]).not.toHaveProperty('candidateRefs')
 expect(document.body.textContent).toContain('同事：已添加')
})
it('recovers accepted results on reopen without resubmitting and isolates account remounts',async()=>{
 recovery=completed;await mount();expect(document.body.textContent).toContain('同事：已添加')
 expect(call.mock.calls.some(([op])=>op==='team.app.members.add')).toBe(false)
 recovery={state:'unresolved',requestUid:'old'};await mount('prod:91')
 expect(button('核对并重试原批次')).toBeTruthy();expect(check('同事').disabled).toBe(true)
 expect(document.body.textContent).not.toContain('同事：已添加')
})
it('does not apply stale candidate responses after account change and handles Escape',async()=>{
 let done!:(v:unknown)=>void
 call.mockImplementationOnce(async()=>({state:'none'})).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve}))
 await mount();const signal=call.mock.calls.find(([op])=>op==='team.app.member-candidates')![2] as AbortSignal
 await mount('prod:91');expect(signal.aborted).toBe(true)
 await act(async()=>done(page([person('旧账号')])));expect(document.body.textContent).not.toContain('旧账号')
 await act(async()=>document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(close).toHaveBeenCalledOnce()
})

it('does not treat a historical added receipt as current membership after removal',async()=>{
 recovery={...completed,items:[{key:'同事',displayName:'同事',status:'added'}]};await mount()
 expect(document.body.textContent).toContain('同事：已添加')
 expect(check('同事').disabled).toBe(false)
 await act(async()=>check('同事').click());expect(button('确认添加（1）').disabled).toBe(false)
})
