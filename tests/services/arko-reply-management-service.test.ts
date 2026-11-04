import {expect,it,vi} from 'vitest'
import {readReplyPrompts,writeReplyPrompt,readReplyHistory} from '../../src/services/arko-reply-management-service.js'
import {configurableReplyScenes} from '../../src/arko-reply-contract.js'
import type {ServiceRuntime} from '../../src/services/service.js'
const view=(scene:string,body:string|null=null,revision=0)=>({official:{scene,title:scene,body:'official',revision:'v1',protected_instructions:'fixed',max_body_runes:6000},revision,user_body:body,effective:{scene,body:body??'official',user_revision:revision,official_revision:'v1'}})
function fixture(){const session=vi.fn(async()=>({userId:11,refreshToken:'same'})),post=vi.fn();return{session,post,runtime:{config:{environment:'test'},requireSession:session,authenticatedIntelligentPost:post} as unknown as ServiceRuntime}}
it('reads seven actual defaults and preserves exact write text while returning conflict distinctly',async()=>{
 const f=fixture();f.post.mockResolvedValueOnce({items:configurableReplyScenes.map(s=>view(s))})
 expect((await readReplyPrompts(f.runtime,'test:11')).items).toHaveLength(7)
 f.post.mockResolvedValueOnce({conflict:true,current:view('record_auto','newer',4)})
 const body=' exact 100%\n🐱\n';const result=await writeReplyPrompt(f.runtime,{scene:'record_auto',expectedRevision:3,baseOfficialRevision:'v1',body},'test:11',false)
 expect(result.conflict).toBe(true);expect(result.current.userBody).toBe('newer');expect(f.post.mock.calls[1]?.[1]).toMatchObject({body,expected_revision:3});expect(f.post.mock.calls.every(([path])=>String(path).startsWith('/api/v1/arko/reply-prompts/'))).toBe(true)
})
it('rejects invalid scenes/bodies, stale account results and duplicate scenes',async()=>{
 const f=fixture();await expect(writeReplyPrompt(f.runtime,{scene:'record_auto',expectedRevision:0,baseOfficialRevision:'v1',body:'字'.repeat(6001)},'test:11',false)).rejects.toThrow('无效');expect(f.post).not.toHaveBeenCalled()
 f.post.mockResolvedValue({items:Array(7).fill(view('record_auto'))});await expect(readReplyPrompts(f.runtime,'test:11')).rejects.toThrow('暂时无法读取')
 const other=fixture();other.post.mockResolvedValue({items:configurableReplyScenes.map(s=>view(s))});other.session.mockResolvedValueOnce({userId:11,refreshToken:'same'}).mockResolvedValue({userId:12,refreshToken:'next'});await expect(readReplyPrompts(other.runtime,'test:11')).rejects.toThrow('账号已切换')
})
it('seals authorized history facts in Host and never guesses navigation time',async()=>{
 const f=fixture(),source={selfTarget:vi.fn(async()=>({kind:'send_to_self',sourceRef:'self',displayName:'self'}))},chat={arkoReplyHistoryActionRef:vi.fn(async()=> 'opaque-action')}
 const row={key:'record:one',scene:'record_auto',result_kind:'root',source_kind:'record',source_owner_user_id:11,source_sender_user_id:11,record_uid:'root',source_version:2,source_order_at:100,navigation_at:100,generation:10,content:'actual'}
 f.post.mockResolvedValue({items:[row],next:'signed-next'})
 const page=await readReplyHistory(f.runtime,source as never,chat as never,{scene:'all',cursor:'signed-current'},'test:11')
 expect(page.items[0]?.item.messageActionRef).toBe('opaque-action');expect(page.nextCursor).toBe('signed-next');expect(chat.arkoReplyHistoryActionRef).toHaveBeenCalledWith('self',expect.objectContaining({recordUid:'root',sendAtMillis:100}),undefined)
 f.post.mockResolvedValue({items:[{...row,navigation_at:0}]});await expect(readReplyHistory(f.runtime,source as never,chat as never,{},'test:11')).rejects.toThrow('暂时无法读取')
 f.post.mockResolvedValue({items:[{...row,scene:'group_mention'}]});await expect(readReplyHistory(f.runtime,source as never,chat as never,{},'test:11')).rejects.toThrow('暂时无法读取')
})
