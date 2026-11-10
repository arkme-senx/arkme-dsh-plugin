// Run in a fresh official DSH Profile installed from an immutable tgz.
// Synthetic business owner: this verifies real session discovery, schema,
// confirmation and public SDK/Host transport without supplier or account IO.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdir } from 'node:fs/promises'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
export const name='model-execution-acceptance'
export const inject=['webServer']
export function apply(ctx,config){
 void(async()=>{
  await new Promise(resolve=>setTimeout(resolve,250))
  await mkdir(config.workspace,{recursive:true})
  const service=ctx.get('arkmeData'),agents=ctx.get('agents'),sessions=ctx.get('sessions'),tools=ctx.get('tools'),llm=ctx.get('llm')
  assert(service&&agents&&sessions&&tools&&llm,'official services unavailable')
  const original=service.recordingAnalysis
  const calls=[],binding={catalogReleaseId:'11',offeringRevisionId:'22',publicModelCode:'selected'}
  service.recordingAnalysis=async(input,signal)=>{
   signal?.throwIfAborted();calls.push(input)
   assert(['summary','timeline'].includes(input.kind))
   if(input.action==='models')return {accountScope:'test:11',config:{defaultRouteKey:'dashscope/selected',effectiveRouteKey:'dashscope/selected',options:[{routeKey:'dashscope/selected',provider:'dashscope',modelKey:'selected',displayName:'Selected',binding,available:true,costDescription:'输入 1 积分'}]}}
   assert.equal(input.accountScope,'test:11')
   if(input.action==='select')return {accountScope:'test:11',effectiveRouteKey:input.routeKey}
   assert.equal(input.versionId,'a'.repeat(24))
   return {accountScope:'test:11',section:{state:'processing',items:[],message:'原任务继续'}}
  }
  const origin=`http://127.0.0.1:${ctx.webServer.port}`
  console.log('DPK02_SDK_BEGIN');
  const consumer=await promisify(execFile)(process.execPath,[config.consumer,origin],{timeout:15000})
  console.log('DPK02_SDK_END');
  assert(consumer.stdout.includes('SDK_CONSUMER_PASSED'),consumer.stdout+consumer.stderr)
  const waitIdle=async agent=>{
   let timer
   try{return await Promise.race([agent.whenIdle(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DSH agent timeout')),15000)})])}finally{clearTimeout(timer)}
  }
  const waitFor=async predicate=>{
   const until=Date.now()+15000
   while(!predicate()){if(Date.now()>until)throw new Error('DSH business acceptance timeout');await new Promise(resolve=>setTimeout(resolve,25))}
  }
  let confirmations=0,completed=false
  llm.registerAdapter(['model-execution-acceptance'],{
   providerInfo:id=>({id,name:id}),providerRetryPolicy:()=>undefined,
   listModels:async()=>[{id:'local',name:'local'}],resolveModel:async(provider,id)=>({provider,id,name:id}),
   async prepareCall(provider,model){return{model:await this.resolveModel(provider,model),stream:options=>this.stream(options)}},
   async *stream(options){
    const last=options.messages.at(-1)
    if(last?.role==='tool'){
     const text=last.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')
     assert(!last.isError,text)
     if(text.includes('confirmation_required'))confirmations++
     else {assert(text.includes('原任务继续'),text);completed=true}
     const answer=completed?'继续已接受':'是否确认继续原录音任务？'
     yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:answer};yield{type:'block-end',index:0,block:{type:'text',text:answer}};yield{type:'finish',reason:{kind:'stop'}};return
    }
    assert(options.tools.some(tool=>tool.name==='arkme_recording_analysis'))
    const id=randomUUID(),args=JSON.stringify({action:'continue',kind:'summary',account_scope:'test:11',version_id:'a'.repeat(24),date_stamp:0})
    yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:'arkme_recording_analysis',argumentsDelta:args};yield{type:'block-end',index:0,block:{type:'tool-call',id,name:'arkme_recording_analysis',arguments:args}};yield{type:'finish',reason:{kind:'tool-calls'}}
   }
  })
  const handle=await agents.create({sessionId:`model-execution-${randomUUID()}`,meta:{cwd:config.workspace},agentOptions:{provider:'model-execution-acceptance',model:'local'}})
  const {agent}=handle;console.log('DPK02_AGENT_CREATED');await waitIdle(agent)
  const names=tools.schemas(agent).map(tool=>tool.name)
  assert(names.includes('arkme_recording_analysis_models'));assert(names.includes('arkme_recording_analysis'))
  const query=await tools.execute({agent,name:'arkme_recording_analysis_models',callId:randomUUID(),arguments:{kind:'summary'},signal:AbortSignal.timeout(10000)})
  assert(!query.isError,JSON.stringify(query));assert(JSON.stringify(query).includes('Selected'))
  console.log('DPK02_TOOL_READ_DONE');
  const before=calls.length
  agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'请继续原录音任务'}]}));await waitFor(()=>confirmations===1);await waitIdle(agent)
  assert.equal(confirmations,1);assert.equal(calls.length,before)
  agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'确认，继续同一个任务和模型'}]}));await waitFor(()=>completed);await waitIdle(agent)
  assert(completed);assert.equal(calls.length,before+1)
  await sessions.flush(agent.session);await handle.dispose();service.recordingAnalysis=original
  await writeFile(config.output,JSON.stringify({runtime:'official unmodified DSH',artifact:true,sessionDiscovery:true,readTool:true,unconfirmedWriteBlocked:true,confirmedContinuation:true,publicSDK:true,ownerAdapter:'synthetic; actual service and financial contracts tested separately'},null,2)+'\n')
  ctx.get('appExit')(0)
 })().catch(error=>{console.error(error);ctx.get('appExit')(1)})
}
