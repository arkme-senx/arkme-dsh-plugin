import {expect,it,vi} from 'vitest'
import {RecordingService} from '../../src/services/recording-service.js'

function fixture(exact=true){
 const startAt=new Date(2026,10,2,15,23,12,456).getTime()
 const query={recordingId:'a'.repeat(24),childId:'b'.repeat(24),ordinal:3,revision:'c'.repeat(64),startAt,endAt:startAt+5000}
 const matching={recordingId:query.recordingId,revision:query.revision,locator:{child_id:query.childId,source:'primary',ordinal:3},startAt,endAt:query.endAt}
 const transcript=vi.fn(async()=>({items:exact?[{...matching,locator:{...matching.locator,child_id:'d'.repeat(24)}},matching]:[],nextCursor:'',revision:query.revision}))
 const project=vi.fn(async(_date,_source,page)=>({items:page.items.map(()=>({itemRef:'opaque-exact-source'}))}))
 const service=Object.assign(Object.create(RecordingService.prototype),{runtime:{requireSession:async()=>({userId:7})},assertWorkbenchEnabled:()=>{},readOwner:{transcript,completeDay:()=>{throw new Error('must not look up nearby recordings')}},projectWorkbenchPage:project}) as RecordingService
 return {service,query,transcript,project}
}
it('normalizes an arbitrary clip instant to a local date and selects only the canonical ordinal',async()=>{
 const f=fixture();expect(await f.service.recordingVoiceSourceItems(f.query)).toEqual({items:[{itemRef:'opaque-exact-source'}]})
 expect(f.transcript).toHaveBeenCalledWith(f.query.recordingId,'primary',{startAt:f.query.startAt,endAt:f.query.endAt},{userId:7},{limit:200,revision:f.query.revision},undefined)
 const [date,,page]=f.project.mock.calls[0]!
 expect(new Date(date).getHours()).toBe(0);expect(new Date(date).getMinutes()).toBe(0);expect(new Date(date).getSeconds()).toBe(0);expect(new Date(date).getMilliseconds()).toBe(0)
 expect(page.items).toHaveLength(1);expect(page.items[0].locator).toMatchObject({child_id:f.query.childId,ordinal:3})
})
it('refuses a missing canonical clip instead of taking another nearby clip',async()=>{
 const f=fixture(false);await expect(f.service.recordingVoiceSourceItems(f.query)).rejects.toThrow('原音片段已更新')
 expect(f.project).not.toHaveBeenCalled()
})
