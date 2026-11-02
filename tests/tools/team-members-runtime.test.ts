import {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import {createSessionInput} from '../helpers/session-input.js'
import {ToolCallId as CallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'
it('discovers member tools and requires human intent before the shared owner',async()=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const manage=vi.fn(async()=>({state:'completed',items:[]}))
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{teamMemberManagement:manage} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 const session=Session.create(SessionId('team-profile-session')),inbox=createSessionInput(session),agent={id:session.id,session,inbox} as unknown as Agent
 let count=0
 const human=()=>{inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认修改团队名称'}],source:{kind:'user'}}));for(const m of inbox.claim('next-step',0))session.append('user/message',m,{surfaceOp:'append'})}
 const invoke=async(name:string,args:Record<string,unknown>)=>{
  const callId=CallId(`profile-${++count}`),call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)})
  const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
  session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result
 }
 try{
  expect(ctx.tools.schemas(agent).map(t=>t.name)).toEqual(expect.arrayContaining(['arkme_team_member_candidates','arkme_team_members_add']))
  expect((await invoke('arkme_team_member_candidates',{team_ref:'opaque',source:'contacts'})).isError).toBe(false)
  expect(manage).toHaveBeenCalledWith({teamRef:'opaque',action:'candidates',source:'contacts'},expect.any(AbortSignal))
  manage.mockClear();const args={team_ref:'opaque',action:'add',candidate_refs:['person']}
  expect(JSON.stringify(await invoke('arkme_team_members_add',args))).toContain('confirmation_required');expect(manage).not.toHaveBeenCalled()
  human();expect((await invoke('arkme_team_members_add',args)).isError).toBe(false)
  expect(manage).toHaveBeenCalledWith(expect.objectContaining({teamRef:'opaque',action:'add',candidateRefs:['person'],requestUid:expect.any(String)}),expect.any(AbortSignal))
  expect((await invoke('arkme_team_members_add',{...args,candidate_refs:'wrong'})).isError).toBe(true)
 }finally{await mounted.dispose();expect(ctx.tools.schemas().some(t=>t.name==='arkme_team_members_add')).toBe(false);await ctx.fiber.dispose()}
})
