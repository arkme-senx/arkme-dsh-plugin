// Disposable official DSH profile only; synthetic owners never contact a real account.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
export const name='arko-replies-acceptance'
export const inject=['agents','sessions','tools','arkmeData']
export function apply(ctx,config){void(async()=>{
 await ctx.get('loader').await()
 const service=ctx.arkmeData
 const originals={arkoReplyPrompts:service.arkoReplyPrompts,arkoRepliesPage:service.arkoRepliesPage,saveArkoReplyPrompt:service.saveArkoReplyPrompt,resetArkoReplyPrompt:service.resetArkoReplyPrompt}
 let reads=0,pages=0,writes=0
 const items=['record_auto','record_mention','direct_receive','direct_sent','direct_mention','group_mention','group_auto'].map(scene=>({scene,title:scene,officialBody:'official',effectiveBody:'official',officialRevision:'fixture-v1',revision:0,userBody:null,protectedInstructions:'fixed',maxBodyRunes:6000}))
 service.arkoReplyPrompts=async()=>{reads++;return {accountScope:'test:11',items}}
 service.arkoRepliesPage=async()=>{pages++;return {accountScope:'test:11',items:[],nextCursor:'opaque-next'}}
 service.saveArkoReplyPrompt=service.resetArkoReplyPrompt=async()=>{writes++;throw Error('Unconfirmed probe wrote')}
 try{
  assert.equal(service.providerCapabilities().features.arkoReplyManagementV1,true)
  const {agent}=await ctx.agents.create({sessionId:`arko-replies-${randomUUID()}`,meta:{cwd:process.cwd()}});await agent.whenIdle()
  const names=ctx.tools.schemas(agent).map(t=>t.name)
  for(const name of ['arkme_arko_reply_prompts','arkme_arko_replies','arkme_set_arko_reply_prompt'])assert(names.includes(name),name)
  const invoke=(name,args)=>ctx.tools.execute({agent,name,callId:randomUUID(),arguments:args,signal:AbortSignal.timeout(10000)})
  const metadata=await invoke('arkme_arko_reply_prompts',{});assert(!metadata.isError,JSON.stringify(metadata));assert(JSON.stringify(metadata).includes('record_auto'))
  const body=await invoke('arkme_arko_reply_prompts',{scene:'record_auto'});assert(JSON.stringify(body).includes('officialBody'))
  const page=await invoke('arkme_arko_replies',{scene:'all'});assert(!page.isError,JSON.stringify(page));assert(JSON.stringify(page).includes('opaque-next'))
  const pending=await invoke('arkme_set_arko_reply_prompt',{scene:'record_auto',body:'synthetic instruction',expected_revision:0,base_official_revision:'fixture-v1'})
  assert(JSON.stringify(pending).includes('confirmation_required'),JSON.stringify(pending));assert.equal(writes,0);assert(reads>=2);assert.equal(pages,1)
  await ctx.sessions.flush(agent.session)
  await writeFile(config.output,JSON.stringify({runtime:'official DSH v0.2.1-rc.2',packedArtifact:true,threeToolsDiscovered:true,metadataAndBodyRead:true,historyRead:true,unconfirmedWriteBlocked:true,writes,ownerAdapter:'synthetic; authorization/CAS verified separately with HTTP and Mongo'},null,2)+'\n',{mode:0o600})
 }finally{Object.assign(service,originals)}
 ctx.get('appExit')(0)
})().catch(e=>{console.error(e);ctx.get('appExit')(1)})}
