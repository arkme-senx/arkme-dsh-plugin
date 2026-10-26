import {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import {createSessionInput} from '../helpers/session-input.js'
import {ToolCallId as CallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'
it('discovers notification tools, enforces human confirmation and explicit boolean Schema, and disposes registrations',async()=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const read=vi.fn(async()=>({muted:false,policyVersion:0,notifyAfterSeq:0})),write=vi.fn(async()=>({muted:true,policyVersion:1,notifyAfterSeq:0}))
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{getTeamNotificationPolicy:read,setTeamNotificationPolicy:write} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 const session=Session.create(SessionId('team-notification-session')),inbox=createSessionInput(session),agent={id:session.id,session,inbox} as unknown as Agent
 let count=0
 const human=()=>{inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认开启此团队对话的消息免打扰'}],source:{kind:'user'}}));for(const m of inbox.claim('next-step',0))session.append('user/message',m,{surfaceOp:'append'})}
 const invoke=async(name:string,args:Record<string,unknown>)=>{
  const callId=CallId(`notice-${++count}`),call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)})
  const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
  session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result
 }
 try{
  expect(ctx.tools.schemas(agent).map(t=>t.name)).toEqual(expect.arrayContaining(['arkme_team_notification_policy','arkme_team_notification_policy_set']))
  expect((await invoke('arkme_team_notification_policy',{conversation_ref:'opaque'})).isError).toBe(false);expect(read).toHaveBeenCalledWith('opaque',expect.any(AbortSignal))
  const args={conversation_ref:'opaque',muted:true}
  expect(JSON.stringify(await invoke('arkme_team_notification_policy_set',args))).toContain('confirmation_required');expect(write).not.toHaveBeenCalled()
  human();const result=await invoke('arkme_team_notification_policy_set',args);expect(result.isError).toBe(false);expect(write).toHaveBeenCalledWith('opaque',true,expect.any(AbortSignal))
  expect((await invoke('arkme_team_notification_policy_set',{...args,muted:'false'})).isError).toBe(true);expect(write).toHaveBeenCalledOnce()
 }finally{await mounted.dispose();expect(ctx.tools.schemas().some(t=>t.name==='arkme_team_notification_policy')).toBe(false);await ctx.fiber.dispose()}
})
