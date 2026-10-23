// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { ArkoMessageDeletionDialog,ArkoDeletedMessagesNotice } from '../src/client/ArkoMessageDeletion.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:vi.fn()}))
let root:Root,host:HTMLDivElement
const fact=(state='active')=>({messageRef:'opaque',messageKey:'88:1',version:state==='active'?0:1,state,deletedAtMillis:1000,purgeAtMillis:Date.now()+2592000000,lastOperationUid:''})
const click=async(text:string)=>{await act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);expect(b,text).toBeDefined();b!.click()})}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7});vi.mocked(callArkme).mockReset()})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('reconciles an unknown write without replay and keeps failed targets visible',async()=>{
 const changed=vi.fn(),closed=vi.fn()
 vi.mocked(callArkme).mockImplementation(async op=>{if(op==='arko.lifecycle.query')return {revision:0,items:[fact()]} as never;if(op==='arko.lifecycle.change')return {items:[{...fact(),result:'unknown'}]} as never;throw Error(op)})
 await act(async()=>root.render(<ArkoMessageDeletionDialog messageRefs={['opaque']} onClose={closed} onFacts={changed}/>))
 await click('确认删除');expect(document.body.textContent).toContain('尚未确认');expect(closed).not.toHaveBeenCalled()
 await click('核对状态');expect(vi.mocked(callArkme).mock.calls.filter(c=>c[0]==='arko.lifecycle.change')).toHaveLength(1)
 expect(document.body.textContent).toContain('操作结果尚未确认');expect(changed).toHaveBeenLastCalledWith([expect.objectContaining({state:'active',version:0})], [])
})
it('shows read failure rather than an empty bin, and cancels account-scoped restore',async()=>{
 vi.mocked(callArkme).mockRejectedValueOnce(Error('offline'))
 await act(async()=>root.render(<ArkoDeletedMessagesNotice/>))
 expect(host.textContent).toContain('offline');expect(host.textContent).not.toContain('暂无最近删除')
 let finish!:(x:unknown)=>void
 vi.mocked(callArkme).mockImplementation(async op=>op==='arko.deleted'?{items:[{...fact('deleted'),message:{text:'deleted question',role:'user'}}],hasMore:false} as never:new Promise(resolve=>{finish=resolve}) as never)
 await click('刷新核对');await act(async()=>host.querySelector('input')!.click());await click('恢复所选消息')
 await click('确认恢复')
 const write=vi.mocked(callArkme).mock.calls.find(c=>c[0]==='arko.lifecycle.change')!
 expect(write[1]).toMatchObject({action:'restore',targets:[{messageRef:'opaque',expectedVersion:1}]})
 await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:8}))
 expect((write[2] as AbortSignal).aborted).toBe(true)
 await act(async()=>finish({items:[{...fact(),result:'applied'}]}))
 expect(host.textContent).not.toContain('已恢复所选消息')
})
