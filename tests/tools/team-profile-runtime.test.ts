import {Context} from '@deepseek-ai/cordis'
import {Inbox,type Agent} from '@deepseek-ai/dsh-agent'
import {CallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'
it('discovers profile tools, enforces human confirmation and file-ref Schema, and disposes registrations',async()=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const read=vi.fn(async()=>({profileRef:'opaque',profileRevision:3,canEditProfile:true})),write=vi.fn(async()=>({requestUid:'receipt',acceptedRevision:4})),upload=vi.fn(async()=>({uploadRef:'upload'}))
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{getTeamProfile:read,updateTeamProfile:write,uploadTeamAvatarFile:upload} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 const session=Session.create(SessionId('team-profile-session')),inbox=new Inbox(session,{inserted(){},discarded(){},claimed(){}}),agent={id:session.id,session,inbox} as unknown as Agent
 let count=0
 const human=()=>{inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认修改团队名称'}],source:{kind:'user'}}));for(const m of inbox.claim('next-step',0))session.append('user/message',m,{surfaceOp:'append'})}
 const invoke=async(name:string,args:Record<string,unknown>)=>{
  const callId=CallId(`profile-${++count}`),call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)})
  const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
  session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result
 }
 try{
  expect(ctx.tools.schemas(agent).map(t=>t.name)).toEqual(expect.arrayContaining(['arkme_team_profile','arkme_team_profile_update']))
  expect((await invoke('arkme_team_profile',{jotmo_id:'exact_id'})).isError).toBe(false);expect(read).toHaveBeenCalledWith('exact_id',expect.any(AbortSignal))
  const args={profile_ref:'opaque',expected_revision:3,name:'新名',avatar_action:'default'}
  expect(JSON.stringify(await invoke('arkme_team_profile_update',args))).toContain('confirmation_required');expect(write).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled()
  human();const result=await invoke('arkme_team_profile_update',args);expect(result.isError).toBe(false);expect(write).toHaveBeenCalledWith('opaque',expect.objectContaining({requestUid:expect.any(String),expectedRevision:3,name:'新名',avatar:{action:'default'}}),expect.any(AbortSignal))
  expect((await invoke('arkme_team_profile_update',{...args,expected_revision:'3'})).isError).toBe(true);expect(write).toHaveBeenCalledOnce()
 }finally{await mounted.dispose();expect(ctx.tools.schemas().some(t=>t.name==='arkme_team_profile')).toBe(false);await ctx.fiber.dispose()}
})
