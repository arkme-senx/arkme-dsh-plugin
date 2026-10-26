import {expect,it,vi} from 'vitest'
import {ReactionService} from '../src/services/reaction-service.js'
import type {ServiceRuntime} from '../src/services/service.js'
import type {ReactionTargetRef} from '../src/reaction-contract.js'

it('partitions mounted ordinary/internal/external targets without changing occurrence identity',async()=>{
 const post=vi.fn(async(path:string,body:Record<string,unknown>)=>({items:(body.targets as object[]).map(target=>({target,mine:{revision:2,selections:[]},groups:[],has_more:false,private:false,actors_visible:body.side==='team'}))}))
 const runtime={requireSession:async()=>({userId:42}),config:{environment:'test'},authenticatedPost:post} as unknown as ServiceRuntime
 const service=new ReactionService(runtime,async target=>target.teamConversationRef?{team_conversation_uid:'conversation',team_message_uid:'message',team_side:target.teamConversationRef==='internal'?'team':'external'}:{chat_session_uid:'chat',rel_uid:'relation'})
 const targets:ReactionTargetRef[]=[{id:'chat',sourceRef:'chat-ref',messageActionRef:'message'},{id:'internal',teamConversationRef:'internal',teamMessageRef:'message'},{id:'external',teamConversationRef:'external',teamMessageRef:'message'}]
 const out=await service.request({action:'query',accountKey:'test:42',targets}) as {items:{target_id:string;actors_visible:boolean}[]}
 expect(out.items).toHaveLength(3)
 expect(out.items.find(item=>item.target_id==='internal')?.actors_visible).toBe(true)
 expect(out.items.find(item=>item.target_id==='external')?.actors_visible).toBe(false)
 expect(post.mock.calls.map(([path])=>path).sort()).toEqual(['/api/v1/reactions/query','/api/v1/reactions/team/query','/api/v1/reactions/team/query'])
 const scoped=post.mock.calls.filter(([path])=>path.includes('/team/')).map(([,body])=>body)
 expect(scoped.map(body=>body.side).sort()).toEqual(['external','team'])
 for(const body of scoped)expect(body.targets).toEqual([{team_conversation_uid:'conversation',team_message_uid:'message'}])
})

it('transports explicit removal and original request identity through the Team endpoint',async()=>{
 const post=vi.fn(async()=>({outcome:'idempotent',state:{revision:3,selections:[]}}))
 const runtime={requireSession:async()=>({userId:42}),config:{environment:'test'},authenticatedPost:post} as unknown as ServiceRuntime
 const service=new ReactionService(runtime,async()=>({team_conversation_uid:'conversation',team_message_uid:'message',team_side:'external'}))
 const input={action:'set' as const,accountKey:'test:42',target:{id:'team-message',teamConversationRef:'conversation-ref',teamMessageRef:'message-ref'},active:false,expected_revision:2,request_id:'stable',expression:{text:'赞'}}
 expect(await service.request(input)).toMatchObject({outcome:'idempotent',state:{revision:3}})
 expect(post).toHaveBeenCalledWith('/api/v1/reactions/team/set',expect.objectContaining({side:'external',active:false,request_id:'stable',target:{team_conversation_uid:'conversation',team_message_uid:'message'}}),expect.anything(),undefined,undefined)
 await expect(service.request({...input,target:{...input.target,sourceRef:'forged',messageActionRef:'forged'}} as never)).rejects.toThrow('目标无效')
 expect(post).toHaveBeenCalledOnce()
})
