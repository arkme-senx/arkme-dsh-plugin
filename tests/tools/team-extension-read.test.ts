import { expect, it, vi } from 'vitest'
import { teamMessageTools } from '../../src/tools/business/conversation/team-messages.js'

it.each([{extensions:true},{extensions:true,conversation_ref:'conversation'},{extensions:true,message_ref:'message'}])('requires both scoped refs for an extension read: %j',async args=>{
 const ports={readTeamExtensions:vi.fn(),listTeamConversations:vi.fn(async()=>[])}
 const module=teamMessageTools.find(item=>item.meta.toolName==='arkme_team_messages')!
 const tool=module.create(ports as never)
 const execute=tool.execute as (args:Record<string,unknown>,context:unknown)=>Promise<unknown>
 await expect(execute(args,{signal:new AbortController().signal})).rejects.toThrow('requires conversation_ref and message_ref')
 expect(ports.listTeamConversations).not.toHaveBeenCalled();expect(ports.readTeamExtensions).not.toHaveBeenCalled()
})
it('keeps extension cursor and cancellation on the shared read owner',async()=>{
 const signal=new AbortController().signal,read=vi.fn(async()=>({totalCount:0}))
 const tool=teamMessageTools.find(item=>item.meta.toolName==='arkme_team_messages')!.create({readTeamExtensions:read} as never)
 const execute=tool.execute as (args:Record<string,unknown>,context:unknown)=>Promise<unknown>
 await execute({extensions:true,conversation_ref:'conversation',message_ref:'message',after_seq:2,through_seq:10,limit:3},{signal})
 expect(read).toHaveBeenCalledWith('conversation','message',{afterSeq:2,throughSeq:10,limit:3},signal)
})
