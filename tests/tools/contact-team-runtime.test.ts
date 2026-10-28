import {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import {createSessionInput} from '../helpers/session-input.js'
import {ToolCallId as CallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'
it('discovers team join in a real DSH session and enforces human confirmation',async()=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const read=vi.fn(async()=>({profileRef:'opaque',profileRevision:3,canEditProfile:true})),write=vi.fn(async()=>({requestUid:'receipt',acceptedRevision:4})),upload=vi.fn(async()=>({uploadRef:'upload'}))
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{searchContact:read,joinContactTeam:write} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 const session=Session.create(SessionId('team-profile-session')),inbox=createSessionInput(session),agent={id:session.id,session,inbox} as unknown as Agent
 let count=0
 const human=()=>{inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认申请加入团队 arkme_cn'}],source:{kind:'user'}}));for(const m of inbox.claim('next-step',0))session.append('user/message',m,{surfaceOp:'append'})}
 const invoke=async(name:string,args:Record<string,unknown>)=>{
  const callId=CallId(`profile-${++count}`),call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)})
  const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
  session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result
 }
 try{
  expect(ctx.tools.schemas(agent).map(t=>t.name)).toEqual(expect.arrayContaining(['arkme_contact_search','arkme_team_join']))
  expect((await invoke('arkme_contact_search',{identifier:'arkme_cn'})).isError).toBe(false)
  expect(read).toHaveBeenCalledWith('arkme_cn',expect.objectContaining({signal:expect.any(AbortSignal)}))
  const args={jotmo_id:'arkme_cn'}
  expect(JSON.stringify(await invoke('arkme_team_join',args))).toContain('confirmation_required');expect(write).not.toHaveBeenCalled()
  human();expect((await invoke('arkme_team_join',args)).isError).toBe(false)
  expect(write).toHaveBeenCalledWith('arkme_cn',expect.stringMatching(/^[0-9a-f-]{36}$/),expect.any(AbortSignal))
  expect((await invoke('arkme_team_join',{jotmo_id:7})).isError).toBe(true);expect(write).toHaveBeenCalledOnce()
 }finally{await mounted.dispose();expect(ctx.tools.schemas().some(t=>t.name==='arkme_team_join')).toBe(false);await ctx.fiber.dispose()}
})
