import {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import {createSessionInput} from '../helpers/session-input.js'
import {ToolCallId as CallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'
it('enforces human confirmation and versions for deletion and restores through official ToolRuntime',async()=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const read=vi.fn(async()=>({revision:0,items:[]})),write=vi.fn(async()=>({operationUid:'receipt',items:[]}))
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{arkoLifecycle:read,arkoChangeLifecycle:write} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 const session=Session.create(SessionId('team-profile-session')),inbox=createSessionInput(session),agent={id:session.id,session,inbox} as unknown as Agent
 let count=0
 const human=()=>{inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认删除所选 Arko 消息'}],source:{kind:'user'}}));for(const m of inbox.claim('next-step',0))session.append('user/message',m,{surfaceOp:'append'})}
 const invoke=async(name:string,args:Record<string,unknown>)=>{
  const callId=CallId(`profile-${++count}`),call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)})
  const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
  session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result
 }
 try{
  expect(ctx.tools.schemas(agent).map(t=>t.name)).toEqual(expect.arrayContaining(['arkme_arko_lifecycle','arkme_arko_change_lifecycle']))
  expect((await invoke('arkme_arko_lifecycle',{action:'query',message_refs:['opaque']})).isError).toBe(false);expect(read).toHaveBeenCalledWith(['opaque'],expect.any(AbortSignal))
  const args={action:'delete',message_refs:['opaque'],expected_versions:[3]}
  expect(JSON.stringify(await invoke('arkme_arko_change_lifecycle',args))).toContain('confirmation_required');expect(write).not.toHaveBeenCalled()
  human();const result=await invoke('arkme_arko_change_lifecycle',args);expect(result.isError).toBe(false);expect(write).toHaveBeenCalledWith(expect.objectContaining({operationUid:expect.any(String),action:'delete',targets:[{messageRef:'opaque',expectedVersion:3}]}),expect.any(AbortSignal))
  expect((await invoke('arkme_arko_change_lifecycle',{...args,expected_versions:['3']})).isError).toBe(true);expect(write).toHaveBeenCalledOnce()
 }finally{await mounted.dispose();expect(ctx.tools.schemas().some(t=>t.name==='arkme_arko_lifecycle')).toBe(false);await ctx.fiber.dispose()}
})
