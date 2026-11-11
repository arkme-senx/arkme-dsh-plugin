import {expect,it,vi} from 'vitest'
import {SpeakerGroupService} from '../../src/services/speaker-group-service.js'
import {ArkmePluginError,type ServiceRuntime} from '../../src/services/service.js'
import type {SpeakerGroupPreview,SpeakerGroupJob,SpeakerGroupJobs} from '../../src/speaker-group-contract.js'
const locator={session_id:'private-session',child_id:'private-child',item_index:0,transcript_source:'system',start_at:100,end_at:200,revision:'revision-1'}
const job=(state='queued')=>({job_id:'private-job',action:'apply',state,prepared_count:0,total_count:300,conflicts:[]})
function fixture(){
 let owner=11,token='session-1'
 const switchAccount=()=>{owner=12},switchSession=()=>{token='session-2'}
 const unique=vi.fn(async()=> 'secret')
 const post=vi.fn(async(path:string,body:Record<string,unknown>):Promise<any>=>{
  if(path.endsWith('/members'))return {items:[{locator,occurred_at:1000}],snapshot_version:'private-snapshot',total_count:300,first_at:1000,last_at:100000,requires_review:false,has_more:!body.cursor,next_cursor:'private-cursor'}
  if(path.endsWith('/preview'))return {preview_token:'private-preview',affected_count:300,first_at:1000,last_at:100000,conflicts:[],sources:[{total_count:300}],expires_at:99999}
  if(path.endsWith('/jobs'))return {items:[job()],has_more:false}
  return job()
 })
 const rows=vi.fn(async()=>[{itemId:'row',itemRef:'opaque-row',text:'当前原文'}] as any)
 const detail=vi.fn(async(ref:unknown)=>({type:'speaker',id:ref,expectedVersion:'version'}))
 const service=new SpeakerGroupService({config:{environment:'test'},stateStore:{uniqueCode:unique},requireSession:async()=>({userId:owner,refreshToken:token}),authenticatedAudioPost:post} as unknown as ServiceRuntime,{recordingGroupRows:rows},detail)
 return {service,post,rows,detail,unique,switchAccount,switchSession}
}
it('keeps source snapshots and cursors opaque, binds pages to their source and rejects changed snapshots',async()=>{
 const f=fixture(),page=await f.service.members({detailRef:'speaker-a'})
 expect(page.totalCount).toBe(300);expect(JSON.stringify(page)).not.toContain('private-')
 await f.service.members({detailRef:'speaker-a',cursor:page.nextCursor})
 expect(f.post.mock.calls.at(-1)?.[1]).toMatchObject({cursor:'private-cursor',snapshot_version:'private-snapshot'})
 await expect(f.service.members({detailRef:'speaker-b',cursor:page.nextCursor})).rejects.toThrow()
 f.post.mockResolvedValueOnce({items:[],snapshot_version:'different',total_count:300,first_at:1,last_at:2,requires_review:false,has_more:false})
 await expect(f.service.members({detailRef:'speaker-a',cursor:page.nextCursor})).rejects.toThrow()
 f.switchAccount();await expect(f.service.members({detailRef:'speaker-a',cursor:page.nextCursor})).rejects.toThrow()
})
it('uses backend totals for whole-group scope, confirms signed command, and recovers persisted cancel/undo jobs',async()=>{
 const f=fixture(),page=await f.service.members({detailRef:'speaker-a'})
 const preview=await f.service.action('preview',{snapshots:[page.snapshotRef,page.snapshotRef],target:{kind:'directory',detailRef:'target'},idempotencyKey:'explicit-whole-key-123'}) as SpeakerGroupPreview
 expect(preview.affectedCount).toBe(300)
 expect(f.post.mock.calls.at(-1)?.[1]).toEqual({scope:'whole_group',snapshots:['private-snapshot'],target:{kind:'existing',speaker_id:'target'},idempotency_key:'explicit-whole-key-123'})
 const first=await f.service.action('apply',{commandRef:preview.commandRef}) as SpeakerGroupJob
 await f.service.action('apply',{commandRef:preview.commandRef})
 expect(f.post.mock.calls.filter(c=>c[0].endsWith('/apply')).map(c=>c[1])).toEqual([{preview_token:'private-preview'},{preview_token:'private-preview'}])
 const persisted=await f.service.action('jobs',{}) as SpeakerGroupJobs
 await f.service.action('cancel',{jobRef:persisted.items[0]!.jobRef})
 expect(f.post.mock.calls.at(-1)?.[1]).toEqual({job_id:'private-job'})
 const undo=await f.service.action('undo-preview',{jobRef:first.jobRef}) as SpeakerGroupPreview
 await expect(f.service.action('apply',{commandRef:undo.commandRef})).rejects.toThrow()
 await f.service.action('undo',{commandRef:undo.commandRef})
 expect(f.post.mock.calls.at(-1)?.[0]).toMatch(/\/undo$/)
})
it('returns bounded opaque conflict locators and reads current source only through the authenticated recording projection',async()=>{
 const f=fixture(),page=await f.service.members({detailRef:'speaker-a'})
 f.post.mockResolvedValueOnce({preview_token:'',affected_count:1,first_at:1,last_at:2,sources:[{total_count:1}],conflicts:[locator],expires_at:10})
 const preview=await f.service.action('preview',{snapshots:[page.snapshotRef],target:{kind:'anonymous'},idempotencyKey:'conflict-preview-123'}) as SpeakerGroupPreview
 expect(preview.commandRef).toBe('');expect(preview.conflictCount).toBe(1);expect(JSON.stringify(preview)).not.toContain('private-')
 await f.service.action('conflict',{conflictRef:preview.conflicts[0]!.conflictRef})
 expect(f.rows).toHaveBeenLastCalledWith([{locator,occurred_at:0}],undefined,{allowChanged:true})
 f.switchAccount();await expect(f.service.action('conflict',{conflictRef:preview.conflicts[0]!.conflictRef})).rejects.toThrow()
})
it('rejects account or session changes during detail, row projection, and sealing without returning refs or cross-account writes',async()=>{
 for(const point of ['detail','rows','seal'] as const){
  const f=fixture()
  if(point==='detail')f.detail.mockImplementationOnce(async()=>{f.switchAccount();return {type:'speaker',id:'old',expectedVersion:'v'}})
  if(point==='rows')f.rows.mockImplementationOnce(async()=>{f.switchSession();return []})
  if(point==='seal')f.unique.mockImplementationOnce(async()=>{f.switchSession();return 'secret'})
  await expect(f.service.members({detailRef:'speaker-a'})).rejects.toThrow()
  if(point==='detail')expect(f.post).not.toHaveBeenCalled()
 }
 const f=fixture(),page=await f.service.members({detailRef:'speaker-a'})
 f.detail.mockImplementationOnce(async()=>{f.switchSession();return {type:'speaker',id:'target',expectedVersion:'v'}})
 await expect(f.service.action('preview',{snapshots:[page.snapshotRef],target:{kind:'directory',detailRef:'target'},idempotencyKey:'session-race-key-123'})).rejects.toThrow()
 expect(f.post.mock.calls.some(c=>c[0].endsWith('/preview'))).toBe(false)
})
it('reports the 2000 atomic budget clearly without sending apply',async()=>{
 const f=fixture(),page=await f.service.members({detailRef:'speaker-a'})
 f.post.mockRejectedValueOnce(new ArkmePluginError('http','budget',false,502,{upstreamStatus:422}))
 await expect(f.service.action('preview',{snapshots:[page.snapshotRef],target:{kind:'anonymous'},idempotencyKey:'budget-preview-123'})).rejects.toThrow('2000')
 expect(f.post.mock.calls.some(c=>c[0].endsWith('/apply'))).toBe(false)
})
