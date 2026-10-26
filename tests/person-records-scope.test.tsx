import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:api.call}))
vi.mock('react-dom',()=>({createPortal:(node:unknown)=>node}))
import { ArkmeClientError } from '../src/client/api.js'
import { ArkmeMemberRecordsPanel } from '../src/client/ArkmeChatMemberActions.js'
import { memberRecordsCache } from '../src/client/member-records-cache.js'
let view:ReactTestRenderer|undefined
const member={memberRef:'m',displayName:'私人备注',isSelf:false,role:'member' as const,status:'active' as const,isOwner:false,joinedAtMillis:1,recordCount:30,mentionCount:2}
const record={itemUid:'one',memberRef:'m',senderName:'原昵称',isMe:false,sendAtMillis:1000,title:'',textContent:'cached-body',status:1}
const render=(accountKey='prod:11',memberRef='m')=><ArkmeMemberRecordsPanel sourceRef="ref" sourceIdentityKey="chat:a" sourceName="产品群" accountKey={accountKey} member={{...member,memberRef}} mode="owner" onClose={()=>{}}/>
const text=()=>JSON.stringify(view!.toJSON())
beforeEach(()=>{
 memberRecordsCache.activate('reset'); api.call.mockReset()
 vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn(),requestAnimationFrame:()=>1,cancelAnimationFrame:vi.fn()})
 vi.stubGlobal('document',{body:{style:{}}})
 api.call.mockImplementation(async op=>op==='source.person-records.capabilities'?{version:1,shared:false}:{items:[record],hasMore:false})
})
afterEach(async()=>{if(view)await act(async()=>view!.unmount());view=undefined;vi.unstubAllGlobals()})
it('defaults to shared scope without passing off conversation content as an aggregate, then loads actual current data',async()=>{
 await act(async()=>{view=create(render())})
 expect(view!.root.findByProps({role:'switch'}).props['aria-checked']).toBe(false)
 expect(text()).toContain('共同对话汇总接口开发中')
 expect(api.call.mock.calls.some(([op])=>op==='source.member-records')).toBe(false)
 await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 expect(api.call).toHaveBeenLastCalledWith('source.member-records',expect.objectContaining({limit:12,basicPresentation:true}),expect.any(AbortSignal))
 expect(text()).toContain('cached-body'); expect(text()).toContain('产品群'); expect(text()).toContain('私人备注')
 expect(view!.root.findByProps({role:'switch'}).props['aria-checked']).toBe(true)
})
it('restores current conversation content on reopen while revalidating and never mixes it into shared scope',async()=>{
 await act(async()=>{view=create(render())})
 await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 await act(async()=>view!.unmount());view=undefined
 let resolve!: (value:unknown)=>void
 api.call.mockImplementation(async op=>op==='source.person-records.capabilities'?{version:1,shared:false}:new Promise(next=>{resolve=next}))
 await act(async()=>{view=create(render())})
 expect(text()).not.toContain('cached-body')
 await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 expect(text()).toContain('cached-body'); expect(text()).toContain('正在加载快记')
 await act(async()=>resolve({items:[],hasMore:false}))
 expect(text()).not.toContain('cached-body');expect(text()).toContain('暂无快记')
})
it('aborts a current read on scope switch and ignores its late data',async()=>{
 let resolve!:(value:unknown)=>void, signal!:AbortSignal
 api.call.mockImplementation(async(op,_p,s)=>op==='source.person-records.capabilities'?{version:1,shared:false}:new Promise(next=>{resolve=next;signal=s}))
 await act(async()=>{view=create(render())})
 await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 expect(signal.aborted).toBe(true)
 await act(async()=>resolve({items:[record],hasMore:false}))
 expect(text()).not.toContain('cached-body')
 expect(text()).toContain('共同对话汇总接口开发中')
})
it('purges cached records when access is revoked during refresh',async()=>{
 await act(async()=>{view=create(render())});await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 await act(async()=>view!.unmount());view=undefined
 api.call.mockImplementation(async op=>{if(op==='source.person-records.capabilities')return{version:1,shared:false};throw new ArkmeClientError({code:'chat-member-ref-stale',message:'该成员已不属于当前会话',retryable:false})})
 await act(async()=>{view=create(render())});await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 expect(text()).not.toContain('cached-body');expect(text()).toContain('该成员已不属于当前会话')
 expect(memberRecordsCache.get('prod:11',JSON.stringify(['prod:11','chat:a','m','owner','conversation']))).toBeUndefined()
})
