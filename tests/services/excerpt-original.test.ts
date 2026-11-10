import {expect,it,vi} from 'vitest'
import {readExcerptOriginal, type ExcerptOriginalReaders} from '../../src/services/excerpt-original.js'
import type {ServiceRuntime} from '../../src/services/service.js'
import {ArkmeService} from '../../src/arkme-service.js'
const session={userId:11,refreshToken:'same-session'}
function fixture(){
 const runtime={requireSession:vi.fn(async()=>session),accountScopedSession:vi.fn(async()=>session),authenticatedTeamPost:vi.fn(),authenticatedDshRemotePost:vi.fn(),authenticatedChatPost:vi.fn()} as unknown as ServiceRuntime
 const readers:ExcerptOriginalReaders={personal:vi.fn(async()=>({title:'原快记',textContent:'当前原文',sendAtMillis:100})),agent:vi.fn(),recording:vi.fn(),call:vi.fn()}
 return {runtime,readers}
}
it('rechecks the current owner on every open and never falls back to the personal quote on denial',async()=>{
 const {runtime,readers}=fixture(),source={kind:'codex_event',source_id:'source',task_id:'task',event_id:'event'}
 vi.mocked(runtime.authenticatedTeamPost).mockResolvedValueOnce({text:'当前原文',text_format:'plain',at:100}).mockRejectedValueOnce(Error('permission revoked'))
 await expect(readExcerptOriginal(runtime,source,readers)).resolves.toEqual({title:'Codex 原文',text:'当前原文',textFormat:'plain',at:100})
 await expect(readExcerptOriginal(runtime,source,readers)).rejects.toThrow('permission revoked')
 expect(runtime.authenticatedTeamPost).toHaveBeenCalledTimes(2)
})
it('requires exact private ownership or an actual Chat occurrence, never a public URL',async()=>{
 const {runtime,readers}=fixture()
 await expect(readExcerptOriginal(runtime,{kind:'record',owner_user_id:22,record_uid:'foreign'},readers)).rejects.toMatchObject({code:'excerpt-source-unavailable'})
 await expect(readExcerptOriginal(runtime,{kind:'record',owner_user_id:11,record_uid:'mine',url:'https://invalid.example'},readers)).rejects.toMatchObject({code:'excerpt-source-unavailable'})
 expect(readers.personal).not.toHaveBeenCalled()
})
it('drops a valid source result after an account switch',async()=>{
 const {runtime,readers}=fixture();vi.mocked(runtime.accountScopedSession).mockResolvedValueOnce({userId:22,refreshToken:'new'} as never)
 await expect(readExcerptOriginal(runtime,{kind:'record',owner_user_id:11,record_uid:'mine'},readers)).rejects.toMatchObject({code:'excerpt-account-changed'})
})
it('matches the exact DSH event/role and rejects a different response or an incomplete locator',async()=>{
 const {runtime,readers}=fixture(),source={kind:'dsh_message',runtime_ref:'runtime',session_ref:'session',event_seq:3,role:'assistant'}
 vi.mocked(runtime.authenticatedDshRemotePost).mockResolvedValue({items:[{runtime_ref:'runtime',session_ref:'session',event_seq:4,role:'assistant',canonical_text:'another'}]})
 await expect(readExcerptOriginal(runtime,source,readers)).rejects.toMatchObject({code:'excerpt-source-unavailable'})
 await expect(readExcerptOriginal(runtime,{...source,role:undefined},readers)).rejects.toMatchObject({code:'excerpt-source-unavailable'})
})
it('checks Team published/available state after the authoritative locate request',async()=>{
 const {runtime,readers}=fixture(),source={kind:'team_message',team_conversation_uid:'c',team_message_uid:'m',side:'external'}
 vi.mocked(runtime.authenticatedTeamPost).mockResolvedValueOnce({messages:[{message_uid:'m',state:'published',record:{status:'available',version:3,text_content:'当前消息'},created_at:20}]}).mockResolvedValueOnce({messages:[{message_uid:'m',state:'withdrawn',record:{status:'available',version:3,text_content:'旧内容'}}]})
 await expect(readExcerptOriginal(runtime,source,readers)).resolves.toMatchObject({text:'当前消息',recordVersion:3})
 await expect(readExcerptOriginal(runtime,source,readers)).rejects.toMatchObject({code:'excerpt-source-unavailable'})
})

it.each(['plain','markdown'] as const)('preserves Arko %s projection through the owner adapter',async textFormat=>{
 const {runtime,readers}=fixture()
 vi.mocked(readers.agent).mockResolvedValue({text:'**原文**',createdAtMillis:1,textFormat})
 await expect(readExcerptOriginal(runtime,{kind:'agent_message',agent_session_id:1,agent_message_id:2},readers)).resolves.toMatchObject({text:'**原文**',textFormat})
})

it('reads the current v4 DSH history through the same existing preference as annotations',async()=>{
 const {runtime,readers}=fixture(),source={kind:'dsh_message',runtime_ref:'runtime',session_ref:'session',event_seq:3,role:'assistant'}
 vi.mocked(runtime.authenticatedDshRemotePost).mockImplementation(async(_path,body)=>{
  if(body.prefer_format_version!==4)throw Error('annotation source is not ready')
  return {items:[{...source,canonical_text:'当前来源'}]}
 })
 await expect(readExcerptOriginal(runtime,source,readers)).resolves.toMatchObject({text:'当前来源'})
})

it.each(['plain','markdown'] as const)('keeps the authorized Codex %s source intact for the reader',async text_format=>{
 const {runtime,readers}=fixture()
 vi.mocked(runtime.authenticatedTeamPost).mockResolvedValue({text:'**原文** 😀',text_format})
 await expect(readExcerptOriginal(runtime,{kind:'codex_event',source_id:'s',task_id:'t',event_id:'e'},readers)).resolves.toMatchObject({text:'**原文** 😀',textFormat:text_format})
})

it.each(['source','final occurrence'])('closes the entire original read after an A-B-A account transition during %s',async phase=>{
 const {runtime}=fixture(),listeners=new Set<()=>void>()
 runtime.subscribeAccountScope=listener=>{listeners.add(listener);listener();return()=>{listeners.delete(listener)}}
 const saved={quote:{version:1 as const,sourceLabel:'快记',senderName:'作者',sourceAtMillis:1,text:'原文',source:{kind:'record' as const,record_uid:'source',owner_user_id:11}},header:'引用',noteText:'',storage:'cloud' as const}
 let reads=0
 const service={runtime,record:{personalRecordDetail:vi.fn(async()=>{
  reads++
  if(reads===(phase==='source'?2:3)){
   for(const listener of listeners)listener() // A → B
   for(const listener of listeners)listener() // B → A with the same restored credential
  }
  return reads===2?{textContent:'原文',title:'原文',sendAtMillis:1}:{localSelfQuote:saved}
 })}}
 await expect(ArkmeService.prototype.excerptOriginal.call(service as unknown as ArkmeService,'excerpt')).rejects.toMatchObject({code:'excerpt-account-changed'})
 expect(listeners.size).toBe(0)
})
