import {Context} from '@deepseek-ai/cordis'
import type {Agent} from '@deepseek-ai/dsh-agent'
import {ToolCallId,createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {expect,it,vi} from 'vitest'
import {registerArkmeTools,type ArkmeToolPorts} from '../../src/tools/index.js'
import {createSessionInput} from '../helpers/session-input.js'

it('discovers selected-text Tools in an official DSH session and requires human grant before the shared send owner',async()=>{
 const ctx=new Context();ctx.provide('workingDirectory',{ensure:async()=>process.cwd()});await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime)
 const prepare=vi.fn(async(input)=>input.quote),send=vi.fn(async(input)=>({sourceRef:input.targetSourceRef,itemUid:input.recordUid,status:1,localState:'synced'})),original=vi.fn(async()=>({title:'原文',text:'选段'}))
 const mounted=await ctx.plugin(Object.assign((inner:Context)=>registerArkmeTools(inner,{prepareSelectedText:prepare,forwardSelectedText:send,excerptOriginal:original} as unknown as ArkmeToolPorts),{inject:['tools','systemPrompt']}))
 try{
  const session=Session.create(SessionId('selected-text-real-dsh-session')),inbox=createSessionInput(session),agent={ctx,id:session.id,session,inbox} as unknown as Agent
  let count=0;const invoke=async(name:string,input:unknown)=>{const callId=ToolCallId('selected-'+ ++count);const args={request_json:JSON.stringify(input)};session.append('tool/call',{turn:1,step:count,callId,name,arguments:JSON.stringify(args)});const result=await ctx.tools.execute({callId,name,arguments:args,agent,signal:new AbortController().signal});session.append('tool/result',{turn:1,step:count,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append'});return result}

  const quote={version:1,sourceLabel:'私聊',senderName:'作者',sourceAtMillis:1,text:'选段'}
  expect((await invoke('arkme_selected_text_prepare',{expectedAccountKey:'test:11',quote})).isError).toBe(false);expect(prepare).toHaveBeenCalledOnce()
  const command={expectedAccountKey:'test:11',targetSourceRef:'opaque-target',recordUid:'record',relationUid:'relation',sendAtMillis:1000,commentText:'',quote,confirmed:true}
  expect(JSON.stringify(await invoke('arkme_selected_text_forward',command))).toContain('confirmation_required');expect(send).not.toHaveBeenCalled()
  inbox.append('next-step',createUserMessage({content:[{type:'text',text:'确认发送选段'}],source:{kind:'user'}}));for(const message of inbox.claim('next-step',0))session.append('user/message',message,{surfaceOp:'append'})
  expect((await invoke('arkme_selected_text_forward',command)).isError).toBe(false);expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]![0].quote).toEqual(quote)
  expect((await invoke('arkme_selected_text_original',{recordUid:'record'})).isError).toBe(false);expect(original).toHaveBeenCalledOnce()
 }finally{await mounted.dispose()}
})
