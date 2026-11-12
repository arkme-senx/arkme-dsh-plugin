import {expect,it,vi} from 'vitest'
import {ChatService} from '../src/services/chat-service.js'
it('routes the authenticated self to the owner aggregate without inventing a private chat',async()=>{
 const page=vi.fn(async()=>({supported:true,items:[],hasMore:false})),sources=vi.fn()
 const owner={runtime:{requireSession:async()=>({userId:510})},personRecordsPage:page,source:{chatSourcesBySessionUids:sources}}
 await ChatService.prototype.personRecordsForIdentity.call(owner as unknown as ChatService,'',510)
 expect(page).toHaveBeenCalledWith('','',{});expect(sources).not.toHaveBeenCalled()
})
it('sends a self-scoped read with the authenticated author and no entry or creation request',async()=>{
 const post=vi.fn(async()=>({protocol_version:1,applied_scope:'self',items:[],has_more:false,removed_relations:[]}))
 const owner={runtime:{requireSession:async()=>({userId:510,refreshToken:'test'}),config:{environment:'test',chatBaseUrl:'test'},stateStore:{uniqueCode:async()=> 'local-test'},authenticatedChatPost:post}}
 const result=await ChatService.prototype.personRecordsPage.call(owner as unknown as ChatService,'','')
 expect(result).toMatchObject({supported:true,items:[],hasMore:false})
 expect(post.mock.calls[0]?.[1]).toMatchObject({scope:'self',target_user_id:510})
 expect(post.mock.calls[0]?.[1]).not.toHaveProperty('chat_session_uid')
})
