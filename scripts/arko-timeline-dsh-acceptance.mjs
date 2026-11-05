// Test-only Cordis extension for a fresh official DSH Profile. Install a packed
// artifact first. Transport adapters are synthetic; real owners are tested apart.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
export const name='arko-timeline-acceptance'
export const inject=['agents','sessions','tools','arkmeData']
export function apply(ctx,config){void(async()=>{
 await ctx.get('loader').await()
 const service=ctx.arkmeData
 const originals={read:service.arkoInteractions,open:service.arkoInteractionOpen,cache:service.arkoTimelineCache}
 let reads=0,opens=0,caches=0
 try{
  assert.equal(service.providerCapabilities().features.arkoInteractionTimelineV1,true)
  const {agent}=await ctx.agents.create({sessionId:`hpk02-${randomUUID()}`,meta:{cwd:process.cwd()}})
  await agent.whenIdle()
  const names=ctx.tools.schemas(agent).map(row=>row.name)
  for(const name of ['arkme_arko_interactions','arkme_arko_interaction_open','arkme_arko_timeline_cache'])assert(names.includes(name),`Missing ${name}`)
  const invoke=(name,args)=>ctx.tools.execute({agent,name,callId:randomUUID(),arguments:args,signal:AbortSignal.timeout(10000)})
  assert((await invoke('arkme_arko_interactions',{limit:1})).isError,'unconfigured account must fail closed')
  service.arkoInteractions=async(query,signal)=>{signal?.throwIfAborted();assert.equal(query.limit,1);assert.deepEqual(query.observedRefs,['opaque-result']);assert.equal(query.afterMillis,500);reads++;return {accountScope:'test:11',items:[{interactionKey:'opaque-key',interactionRef:'opaque-result',occurredAtMillis:1000,sourceName:'来源',kind:'chat',summary:'Synthetic authorized result',suggestion:false}],hasMore:false,removedKeys:[]}}
  service.arkoInteractionOpen=async(ref,signal)=>{signal?.throwIfAborted();assert.equal(ref,'opaque-result');opens++;return {accountScope:'test:11',source:{sourceRef:'opaque-source',kind:'private_chat',displayName:'私聊'},itemUid:'synthetic-root',recordOwnerUserId:11,interactionKey:'opaque-key',occurredAtMillis:1000,sourceAtMillis:500,suggestion:false,thought:{id:'synthetic-result',recordUid:'synthetic-root',biz:2,status:'ready',content:'Synthetic authorized result'}}}
  service.arkoTimelineCache=async(scope)=>{assert.equal(scope,'test:11');caches++;return undefined}
  assert(!(await invoke('arkme_arko_interactions',{limit:1,after_millis:500,observed_refs:['opaque-result']})).isError)
  const opened=await invoke('arkme_arko_interaction_open',{interaction_ref:'opaque-result'})
  assert(!opened.isError,JSON.stringify(opened));assert(JSON.stringify(opened).includes('Synthetic authorized result'))
  const cached=await invoke('arkme_arko_timeline_cache',{account_scope:'test:11'})
  assert(!cached.isError,JSON.stringify(cached));assert.equal(reads,1);assert.equal(opens,1);assert.equal(caches,1)
  const pendingSave=await invoke('arkme_arko_timeline_cache',{account_scope:'test:11',snapshot_json:'{}'})
  assert(JSON.stringify(pendingSave).includes('confirmation_required'));assert.equal(caches,1)
  await ctx.sessions.flush(agent.session)
  await writeFile(config.output,JSON.stringify({runtime:'official DSH v0.2.1-rc.2',packedArtifact:true,discovered:names.filter(n=>n.includes('arko_interaction')||n==='arkme_arko_timeline_cache'),unauthenticatedDenied:true,read:true,exactResultOpen:true,cacheRead:true,unconfirmedCacheWriteBlocked:true,modelCalls:0,adapter:'synthetic; actual Record/Chat/MySQL owners verified separately'},null,2)+'\n',{mode:0o600})
 }finally{service.arkoInteractions=originals.read;service.arkoInteractionOpen=originals.open;service.arkoTimelineCache=originals.cache}
 ctx.get('appExit')(0)
})().catch(error=>{console.error(error);ctx.get('appExit')(1)})}
