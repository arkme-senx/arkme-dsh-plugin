import {expect,it,vi} from 'vitest'
import {RecordingService} from '../src/services/recording-service.js'
const locator={session_id:'session',child_id:'child',item_index:1,transcript_source:'system',start_at:100,end_at:200,revision:'old-revision'}
function fixture(){
 const row={startAt:1000,endAt:1100,locator:{child_id:'child',ordinal:1},speakerEdit:{start:100,end:200,revision:'current-revision'}}
 const transcript=vi.fn(async()=>({revision:'page-revision',items:[row],nextCursor:''}))
 const project=vi.fn(async()=>({items:[{itemId:'safe-item',itemRef:'opaque-ref',startAtMillis:1000,text:'当前原文'}]}))
 const ensure=vi.fn(async()=>{})
 const owner={assertWorkbenchEnabled:vi.fn(),runtime:{requireSession:async()=>({userId:1,refreshToken:'session'})},readOwner:{transcript},projectWorkbenchPage:project,ensureRecordingSession:ensure}
 const read=(options?:{allowChanged?:boolean})=>RecordingService.prototype.recordingGroupRows.call(owner as unknown as RecordingService,[{locator,occurred_at:1000}],undefined,options)
 return {read,transcript,project,ensure,row}
}
it('requires exact snapshot revision for selection but allows a read-only current conflict projection',async()=>{
 const f=fixture()
 await expect(f.read()).rejects.toMatchObject({code:'speaker-group-changed'})
 expect(f.project).not.toHaveBeenCalled()
 const rows=await f.read({allowChanged:true})
 expect(rows[0]?.text).toBe('当前原文')
 expect(f.transcript.mock.calls.at(-1)?.[2]).toEqual({startAt:0,endAt:Number.MAX_SAFE_INTEGER})
 expect(f.ensure).toHaveBeenCalledTimes(2)
})
it('still rejects a changed immutable utterance locator when reading conflicts',async()=>{
 const f=fixture();f.row.locator.ordinal=2
 await expect(f.read({allowChanged:true})).rejects.toMatchObject({code:'speaker-group-changed'})
 expect(f.project).not.toHaveBeenCalled()
})
it('checks the session before producing source refs and again before returning them',async()=>{
 const f=fixture();f.ensure.mockRejectedValueOnce(new Error('account changed'))
 await expect(f.read({allowChanged:true})).rejects.toThrow('account changed');expect(f.project).not.toHaveBeenCalled()
 const g=fixture();g.ensure.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('account changed after projection'))
 await expect(g.read({allowChanged:true})).rejects.toThrow('account changed after projection')
})
