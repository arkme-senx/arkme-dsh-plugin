import {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import {createSessionInput} from '../helpers/session-input.js'
import {ToolCallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'

it('discovers reads and commands in an official DSH session and enforces the write grant before reaching the shared owner',async()=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const groups=vi.fn(async()=>({state:'pending',accessStatus:'unavailable'})),workspace=vi.fn(async()=>({items:[],hasMore:false,complete:true})),search=vi.fn(async()=>({items:[],sourceAggregates:[],hasMore:false,queryGuard:{state:'complete'}})),scenes=vi.fn(async()=>({items:[],sourceAggregates:[],hasMore:false,queryGuard:{state:'complete'}}))
 const sharedRecording=vi.fn(async()=>({title:'录音',summary:'摘要',transcript:'全文'}))
 const report=vi.fn(async()=>({reportUid:'report',status:1})),withdraw=vi.fn(async()=>({timelineItemKey:'canonical',withdrawnAtMillis:123,alreadyWithdrawn:false}))
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{teamGroups:groups,teamWorkspace:workspace,searchRemote:search,searchScene:scenes,reportMessage:report,withdrawGroupMessage:withdraw,sharedRecordingDetail:sharedRecording} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 const session=Session.create(SessionId('team-group-workspace')),inbox=createSessionInput(session),agent={id:session.id,session,inbox} as unknown as Agent
 let count=0
 const invoke=async(name:string,args:Record<string,unknown>)=>{
  const callId=ToolCallId(`group-${++count}`),call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)})
  const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
  session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result
 }
 try {
  expect(ctx.tools.schemas(agent).map(t=>t.name)).toEqual(expect.arrayContaining(['arkme_team_groups_read','arkme_team_groups_change','arkme_team_workspace']))
  expect((await invoke('arkme_team_groups_read',{request:{operation:'directory',teamRef:'opaque'}})).isError).toBe(false)
  expect((await invoke('arkme_team_workspace',{request:{operation:'folders'}})).isError).toBe(false)
  expect(workspace).toHaveBeenLastCalledWith({operation:'folders'},expect.any(AbortSignal))
  expect((await invoke('arkme_team_workspace',{request:{operation:'cards',conversationRef:'customer'}})).isError).toBe(false)
  expect((await invoke('arkme_records_search',{query:'授权',source_ref:'opaque-team-source'})).isError).toBe(false)
  expect(search).toHaveBeenLastCalledWith(expect.objectContaining({sourceRef:'opaque-team-source',query:'授权'}))
  expect((await invoke('arkme_records_search',{scene:'file',source_ref:'opaque-team-source'})).isError).toBe(false)
  expect(scenes).toHaveBeenLastCalledWith(expect.objectContaining({sourceRef:'opaque-team-source',scene:'file'}))
  expect((await invoke('arkme_records_search',{query:'授权',source_ref:'opaque-team-source',sync_all:true})).isError).toBe(true)
  expect((await invoke('arkme_shared_recording_read',{detail_ref:'scoped-detail',source_ref:'exact-source'})).isError).toBe(false)
  expect(sharedRecording).toHaveBeenCalledWith('scoped-detail',expect.objectContaining({sourceRef:'exact-source',signal:expect.any(AbortSignal)}))
  groups.mockClear()
  const command={sourceRef:'group',teamRef:'team',action:'join',requestUid:'attempt',expectedRevision:0}
  expect(JSON.stringify(await invoke('arkme_team_groups_change',{command}))).toContain('confirmation_required');expect(groups).not.toHaveBeenCalled()
  inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认将所选团队加入这个群'}],source:{kind:'user'}}));for(const m of inbox.claim('next-step',0))session.append('user/message',m,{surfaceOp:'append'})
  expect((await invoke('arkme_team_groups_change',{command})).isError).toBe(false)
  expect(groups).toHaveBeenCalledWith({operation:'command',command},expect.any(AbortSignal))
  const confirm = (text:string) => {
   inbox.append('next-step',createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}))
   for(const message of inbox.claim('next-step',0))session.append('user/message',message,{surfaceOp:'append'})
  }
  const reportArgs={message_ref:'message',category:'illegal',source_ref:'exact-source'}
  expect(JSON.stringify(await invoke('arkme_message_report',reportArgs))).toContain('confirmation_required')
  expect(report).not.toHaveBeenCalled();confirm('确认举报刚才指定的违法消息')
  expect((await invoke('arkme_message_report',reportArgs)).isError).toBe(false)
  expect(report).toHaveBeenCalledWith('message',2,expect.objectContaining({sourceRef:'exact-source',signal:expect.any(AbortSignal)}))
  const withdrawArgs={message_withdrawal_ref:'withdrawal',source_ref:'exact-source'}
  expect(JSON.stringify(await invoke('arkme_message_withdraw',withdrawArgs))).toContain('confirmation_required')
  expect(withdraw).not.toHaveBeenCalled();confirm('确认以真实群主权限撤回刚才指定的消息')
  expect((await invoke('arkme_message_withdraw',withdrawArgs)).isError).toBe(false)
  expect(withdraw).toHaveBeenCalledWith('withdrawal',expect.objectContaining({sourceRef:'exact-source',signal:expect.any(AbortSignal)}))
  const calls=groups.mock.calls.length
  expect((await invoke('arkme_team_groups_read',{request:{operation:'command',command}})).isError).toBe(true)
  expect(groups).toHaveBeenCalledTimes(calls)
 } finally {await mounted.dispose();expect(ctx.tools.schemas().some(t=>t.name==='arkme_team_groups_change')).toBe(false);await ctx.fiber.dispose()}
})
