// Synthetic business owner; official DSH session/grant and packed SDK transport.
// Backend execution, settlement and storage are tested by the Go suites.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,writeFile} from 'node:fs/promises'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
export const name='account-model-acceptance'
export const inject=['webServer','agents','sessions','tools','llm','arkmeData']
export function apply(ctx,config){void(async()=>{
 await ctx.get('loader').await();await mkdir(config.workspace,{recursive:true})
 const service=ctx.arkmeData,scope='test:42',calls=[]
 const model={uid:'owned',route:'user-api/owned',version_route:'user-api/owned/version',name:'验收模型',execution:'cloud',protocol:'openai-chat',base_url:'https://example.com/v1',model_key:'owned',disabled:false,key_configured:true,capabilities:{text:true,json:true,tools:true,stream:true,images:false,context_tokens:16384,output_tokens:4096}}
 let settings={accountScope:scope,revision:1,enabled:true,models:[model],connectors:[],scenes:[],preferences:{default_route:'system-default',scenes:{},points_fallback:false}}
 const totals={calls:1,failed_calls:0,unknown_calls:1,invalid_calls:0,input_known_calls:0,output_known_calls:0,cache_known_calls:0,input_tokens:0,output_tokens:0,cached_tokens:0,cache_creation_tokens:0}
 service.authStatus=async()=>({status:'authenticated',environment:'test',userId:42})
 service.cachedProfile=async()=>({profile:null,cachedAtMillis:0,revision:0})
 service.accountModels=async(expected)=>{assert(!expected||expected===scope);return structuredClone(settings)}
 service.modelDirectory=async()=>({accountScope:scope,models:[],failures:[]})
 service.accountModelPreferences=async(expected,revision,preferences)=>{assert.equal(expected,scope);assert.equal(revision,settings.revision);calls.push('preferences');settings={...settings,revision:revision+1,preferences};return structuredClone(settings)}
 service.disableAccountModel=async(expected,revision,uid,disabled)=>{assert.equal(expected,scope);assert.equal(revision,settings.revision);assert.equal(uid,'owned');calls.push('disable');settings={...settings,revision:revision+1,models:[{...model,disabled}]};return structuredClone(settings)}
 service.accountModelUsage=async(expected)=>{assert.equal(expected,scope);return{accountScope:scope,start:'2026-11-04',end:'2026-11-05',grain:'day',before:1793870000000,earliest_at:1,retention_days:180,totals,timeline:[],scenes:[],models:[],operations:[],calls:[]}}
 const factAt=Date.parse('2026-11-04T08:00:00+08:00'),cutoff=1793870000000
 const includes=query=>factAt>=Date.parse(query.fromDate+'T00:00:00+08:00')&&factAt<Date.parse(query.untilDate+'T00:00:00+08:00')
 service.aiPointsStatistics=async(query,expected)=>{
  assert(!expected||expected===scope);const buckets=[];let cursor=query.fromDate
  while(cursor<query.untilDate){const next=new Date(cursor+'T00:00:00Z');if(query.grain==='month')next.setUTCMonth(next.getUTCMonth()+1);else next.setUTCDate(next.getUTCDate()+(query.grain==='week'?7:1));const untilDate=next.toISOString().slice(0,10),has=includes({fromDate:cursor,untilDate});buckets.push({fromDate:cursor,untilDate,chargedPoints:has?'0.1234567':'0',types:has?[{businessCode:'arkme',chargedPoints:'0.1234567'}]:[]});cursor=untilDate}
  return{accountScope:scope,unit:'ai_points',query,chargedPoints:includes(query)?'0.1234567':'0',observedAt:cutoff,buckets}
 }
 service.aiPointsConsumptionRange=async(query,expected)=>{assert(!expected||expected===scope);const has=includes(query);return{accountScope:scope,unit:'ai_points',fromDate:query.fromDate,untilDate:query.untilDate,observedAt:query.settledBefore,chargedPoints:has?'0.1234567':'0',items:has?[{requestUid:'synthetic-statement',businessCode:'arkme',model:'验收模型',chargedPoints:'0.1234567',modelPoints:'0.1234567',services:[],grantedPoints:'0',purchasedPoints:'0.1234567',createdAt:factAt,completedAt:factAt+1,tokens:{cacheHitInput:'0',cacheMissInput:'1',output:'2'}}]:[],nextBeforeId:''}}

 const origin=`http://127.0.0.1:${ctx.webServer.port}`
 const consumer=await promisify(execFile)(process.execPath,[config.consumer,origin],{timeout:20000});assert(consumer.stdout.includes('ACCOUNT_MODEL_CONSUMER_PASSED'),consumer.stdout+consumer.stderr)
 let confirmations=0,completed=false
 ctx.llm.registerAdapter(['account-model-acceptance'],{providerInfo:id=>({id,name:id}),providerRetryPolicy:()=>undefined,listModels:async()=>[{id:'local',name:'local'}],resolveModel:async(provider,id)=>({provider,id,name:id}),async prepareCall(provider,model){return{model:await this.resolveModel(provider,model),stream:options=>this.stream(options)}},async *stream(options){
 const last=options.messages.at(-1)
 if(last?.role==='tool'){const text=last.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');assert(!last.isError,text);if(text.includes('confirmation_required'))confirmations++;else{assert(text.includes('模型偏好'),text);completed=true}const answer=completed?'模型偏好已更新':'是否确认修改默认模型？';yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:answer};yield{type:'block-end',index:0,block:{type:'text',text:answer}};yield{type:'finish',reason:{kind:'stop'}};return}
 assert(options.tools.some(x=>x.name==='arkme_account_model_preference'));const id=randomUUID(),args=JSON.stringify({route:'system-default'});yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:'arkme_account_model_preference',argumentsDelta:args};yield{type:'block-end',index:0,block:{type:'tool-call',id,name:'arkme_account_model_preference',arguments:args}};yield{type:'finish',reason:{kind:'tool-calls'}}
 }})
 const handle=await ctx.agents.create({sessionId:`account-model-${randomUUID()}`,meta:{cwd:config.workspace},agentOptions:{provider:'account-model-acceptance',model:'local'}}),{agent}=handle
 const until=async predicate=>{const deadline=Date.now()+20000;while(!predicate()){if(Date.now()>deadline)throw new Error('session acceptance timeout');await new Promise(r=>setTimeout(r,25))}}
 await agent.whenIdle();const names=ctx.tools.schemas(agent).map(x=>x.name)
 const invoke=(name,args={})=>ctx.tools.execute({agent,name,callId:randomUUID(),arguments:args,signal:AbortSignal.timeout(10000)})
 for(const name of ['arkme_account_models','arkme_account_model_binding','arkme_account_model_usage','arkme_account_model_preference','arkme_account_model_disable','arkme_ai_points_statistics','arkme_ai_points_consumption_range'])assert(names.includes(name),name)
 for(const [name,args]of [['arkme_account_models',{}],['arkme_account_model_binding',{}],['arkme_account_model_usage',{mode:'statistics'}],['arkme_ai_points_statistics',{fromDate:'2026-11-04',untilDate:'2026-11-05',grain:'day'}],['arkme_ai_points_consumption_range',{fromDate:'2026-11-04',untilDate:'2026-11-05',settledBefore:1793870000000}]]){const result=await invoke(name,args);assert(!result.isError,JSON.stringify(result));assert(! /\"(?:api_key|accessToken|credential)\"\s*:/.test(JSON.stringify(result)))}
 const before=calls.length
 agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'修改全局默认模型'}]}));await until(()=>confirmations===1);await agent.whenIdle();assert.equal(calls.length,before)
 agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'确认修改全局默认模型'}]}));await until(()=>completed);await agent.whenIdle();assert.equal(calls.length,before+1)
 await ctx.sessions.flush(agent.session);await handle.dispose()
 await writeFile(config.output,JSON.stringify({runtime:'official DSH 0.2.1-rc.2',artifact:true,toolDiscovery:names.filter(x=>/arkme_(account_model|ai_points_stat|ai_points_consumption_range)/.test(x)),grantedRead:true,humanConfirmation:true,publicConsumer:true,unknownUsage:true,owner:'synthetic; Go owner contracts tested separately'},null,2)+'\n')
 console.log('HPK01_DSH_ACCEPTANCE_PASSED '+origin)
 // Keep this isolated Profile open for the actual existing UI acceptance.
})().catch(e=>{console.error(e);ctx.get('appExit')(1)})}
