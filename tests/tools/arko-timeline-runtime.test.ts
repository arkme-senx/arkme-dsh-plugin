import {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import {createSessionInput} from '../helpers/session-input.js'
import {ToolCallId as CallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'
it('allows cache reads and requires human confirmation for an exact local cache save',async()=>{
 const ctx=new Context();await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const owner=vi.fn(async()=>undefined)
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{arkoTimelineCache:owner} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 const session=Session.create(SessionId('arko-cache-session')),inbox=createSessionInput(session),agent={id:session.id,session,inbox} as unknown as Agent
 let count=0
 const invoke=async(args:Record<string,unknown>)=>{
  const callId=CallId(`cache-${++count}`),name='arkme_arko_timeline_cache'
  const call=session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)})
  const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal})
  session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result
 }
 try{
  expect((await invoke({account_scope:'test:11'})).isError).toBe(false);expect(owner).toHaveBeenCalledWith('test:11',undefined)
  const snapshot={schemaVersion:2,savedAtMillis:1000,messages:[],interactions:[]}
  const args={account_scope:'test:11',snapshot_json:JSON.stringify(snapshot)}
  expect(JSON.stringify(await invoke(args))).toContain('confirmation_required');expect(owner).toHaveBeenCalledOnce()
  inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认保存当前账号的 Arko 展示缓存'}],source:{kind:'user'}}))
  for(const message of inbox.claim('next-step',0))session.append('user/message',message,{surfaceOp:'append'})
  expect((await invoke(args)).isError).toBe(false);expect(owner).toHaveBeenLastCalledWith('test:11',snapshot)
 }finally{await mounted.dispose();await ctx.fiber.dispose()}
})
