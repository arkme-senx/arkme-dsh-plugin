import {expect,it,vi} from 'vitest'
import {readExcerptOriginal, type ExcerptOriginalReaders} from '../../src/services/excerpt-original.js'
import type {ServiceRuntime} from '../../src/services/service.js'
const session={userId:11,refreshToken:'same-session'}
function fixture(){
 const runtime={requireSession:vi.fn(async()=>session),accountScopedSession:vi.fn(async()=>session),authenticatedTeamPost:vi.fn(),authenticatedDshRemotePost:vi.fn(),authenticatedChatPost:vi.fn()} as unknown as ServiceRuntime
 const readers:ExcerptOriginalReaders={personal:vi.fn(async()=>({title:'原快记',textContent:'当前原文',sendAtMillis:100})),agent:vi.fn(),recording:vi.fn(),call:vi.fn()}
 return {runtime,readers}
}
it('rechecks the current owner on every open and never falls back to the personal quote on denial',async()=>{
 const {runtime,readers}=fixture(),source={kind:'codex_event',source_id:'source',task_id:'task',event_id:'event'}
 vi.mocked(runtime.authenticatedTeamPost).mockResolvedValueOnce({text:'当前原文',at:100}).mockRejectedValueOnce(Error('permission revoked'))
 await expect(readExcerptOriginal(runtime,source,readers)).resolves.toEqual({title:'Codex 原文',text:'当前原文',at:100})
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
 vi.mocked(runtime.authenticatedTeamPost).mockResolvedValueOnce({messages:[{message_uid:'m',state:'published',content:{status:'available',text_content:'当前消息'},created_at:20}]}).mockResolvedValueOnce({messages:[{message_uid:'m',state:'withdrawn',content:{status:'available',text_content:'旧内容'}}]})
 await expect(readExcerptOriginal(runtime,source,readers)).resolves.toMatchObject({text:'当前消息'})
 await expect(readExcerptOriginal(runtime,source,readers)).rejects.toMatchObject({code:'excerpt-source-unavailable'})
})
