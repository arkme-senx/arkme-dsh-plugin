import { it, expect, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
import { RecordService } from '../src/services/record-service.js'
it('uses the accepted message action and refuses forged refs or an account switch during playback', async () => {
 let userId=42, switchAccount=false
 const core={record_uid:'target',send_at:1,owner_user_id:42,user_id:42,status:1,template_kind:1,text_content:'selected',content_payload:{forward_records:{render_kind:'forward_records',source_type:'long_recording_segments',forward_id:'accepted',items:[{long_recording_segments:[{text:'selected',start_millis:1000,end_millis:2000}]}]}}}
 const post=vi.fn(async (path:string,body:Record<string,unknown>)=>{
  if(path==='/api/v1/home/feed/query') return {items:[{record_uid:'target',record_core:core}],has_more:false}
  expect(path).toBe('/api/v1/records/long-recording-forward/playback');expect(body).toEqual({record_uid:'target',path:[]})
  if(switchAccount)userId=99
  return {audio_url:'https://trusted/frozen',duration_millis:1000,size:100}
 })
 const runtime={config:{maxTextLength:20000},stateStore:{uniqueCode:async()=> 'test-key'},requireSession:async()=>({userId}),authenticatedPost:post}
 const source={openSourceRef:async()=>({kind:'send_to_self',userId,ownerRef:'destination'}),sourceItem:async()=>({kind:'send_to_self',sourceRef:'target-source',displayName:'self',unreadCount:0,activeAtMillis:0})}
 const media={recordMediaUnavailable:()=>false,richContentBlocks:()=>[],hydrateRecordMediaPage:async()=>({displayItemsByRecordUid:new Map(),unavailableRecordUids:new Set()}),issueForwardRecordingMediaRef:vi.fn(()=> 'local-only-ref')}
 const records=new RecordService(runtime as never,media as never,source as never)
 const chat=new ChatService(runtime as never,source as never,{} as never,media as never,records,{} as never,{} as never,{} as never,{} as never,{lockedRecordUids:async()=>new Set()} as never)
 const page=await chat.readSource('target-source');const action=page.items[0]!.messageActionRef!
 await expect(chat.forwardRecordingPlayback('target-source','forged','accepted',[])).rejects.toBeDefined()
 expect(post).toHaveBeenCalledTimes(1)
 await expect(chat.forwardRecordingPlayback('target-source',action,'accepted',[-1])).rejects.toMatchObject({code:'forward-recording-input-invalid'})
 expect(await chat.forwardRecordingPlayback('target-source',action,'accepted',[])).toEqual({mediaRef:'local-only-ref',durationMillis:1000})
 expect(media.issueForwardRecordingMediaRef).toHaveBeenCalledWith(42,'https://trusted/frozen',100)
 switchAccount=true
 await expect(chat.forwardRecordingPlayback('target-source',action,'accepted',[])).rejects.toMatchObject({code:'account-changed'})
 expect(media.issueForwardRecordingMediaRef).toHaveBeenCalledOnce()
})
