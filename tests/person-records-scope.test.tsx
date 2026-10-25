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
 api.call.mockImplementation(async op=>op==='source.person-records.sources'?{items:[],hasMore:false}:{items:[record],hasMore:false})
})
afterEach(async()=>{if(view)await act(async()=>view!.unmount());view=undefined;vi.unstubAllGlobals()})
it('defaults to actual shared scope using existing reads, then switches to current conversation',async()=>{
 await act(async()=>{view=create(render())})
 expect(view!.root.findByProps({role:'switch'}).props['aria-checked']).toBe(false)
 expect(text()).not.toContain('接口开发中')
 expect(text()).toContain('cached-body')
 expect(api.call.mock.calls.some(([op])=>op==='source.person-records.sources')).toBe(true)
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
 api.call.mockImplementation(async op=>op==='source.person-records.sources'?{items:[],hasMore:false}:new Promise(next=>{resolve=next}))
 await act(async()=>{view=create(render())})
 expect(text()).not.toContain('cached-body')
 await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 expect(text()).toContain('cached-body'); expect(text()).toContain('正在加载快记')
 await act(async()=>resolve({items:[],hasMore:false}))
 expect(text()).not.toContain('cached-body');expect(text()).toContain('暂无快记')
})
it('aborts the shared query on scope switch and ignores its late data',async()=>{
 const reads:Array<{signal:AbortSignal;resolve:(value:unknown)=>void}>=[]
 api.call.mockImplementation(async(op,_p,signal)=>op==='source.person-records.sources'?{items:[],hasMore:false}:new Promise(resolve=>{reads.push({signal,resolve})}))
 await act(async()=>{view=create(render())})
 expect(reads).toHaveLength(1)
 await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 expect(reads[0]!.signal.aborted).toBe(true)
 await act(async()=>reads[0]!.resolve({items:[record],hasMore:false}))
 expect(text()).not.toContain('cached-body')
 await act(async()=>reads[1]!.resolve({items:[{...record,itemUid:'current',textContent:'current-body'}],hasMore:false}))
 expect(text()).toContain('current-body')
})
it('purges cached records when access is revoked during refresh',async()=>{
 await act(async()=>{view=create(render())});await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 await act(async()=>view!.unmount());view=undefined
 api.call.mockImplementation(async op=>{if(op==='source.person-records.sources')return{items:[],hasMore:false};throw new ArkmeClientError({code:'chat-member-ref-stale',message:'该成员已不属于当前会话',retryable:false})})
 await act(async()=>{view=create(render())});await act(async()=>view!.root.findByProps({role:'switch'}).props.onClick())
 expect(text()).not.toContain('cached-body');expect(text()).toContain('该成员已不属于当前会话')
 expect(memberRecordsCache.get('prod:11',JSON.stringify(['prod:11','chat:a','m','owner','conversation']))).toBeUndefined()
})

it('keeps each shared message origin and separate occurrence identity when record uid repeats',async()=>{
 const entry={sourceRef:'ref',sourceKey:'entry',kind:'group_chat' as const,displayName:'产品群',activeAtMillis:0,unreadCount:0}
 const other={...entry,sourceRef:'other-ref',sourceKey:'other',displayName:'另一个共同群'}
 const open=vi.fn()
 api.call.mockImplementation(async(op,p)=>op==='source.person-records.sources'?{items:[{source:other,memberRef:'other-member'}],hasMore:false}:{source:p.sourceRef==='ref'?entry:other,items:[{...record,memberRef:p.memberRef,timelineItemKey:'event',sequence:1,textContent:p.sourceRef}],hasMore:false})
 await act(async()=>{view=create(<ArkmeMemberRecordsPanel sourceRef="ref" source={entry} sourceName="产品群" sourceIdentityKey="entry" accountKey="prod:11" member={member} mode="owner" onClose={()=>{}} onOpenOrigin={open}/>)})
 const origins=view!.root.findAll(x=>x.props['data-arkme-member-record-origin']===true)
 expect(origins).toHaveLength(2)
 const otherButton=origins.find(x=>x.props.title==='所在对话：另一个共同群')!
 await act(async()=>otherButton.props.onClick())
 expect(open).toHaveBeenCalledWith(expect.objectContaining({itemUid:'one'}),expect.objectContaining({sourceRef:'other-ref'}))
 expect(new Set(view!.root.findAll(x=>typeof x.props['data-arkme-member-record-id']==='string').map(x=>x.props['data-arkme-member-record-id'])).size).toBe(2)
})
