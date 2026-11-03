// Test-only public adapter fixture for a packed artifact in unmodified DSH.
// Real Team/Record/Mongo/search evidence is exercised separately; this driver
// verifies official discovery, grants, invocation and unload semantics.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
export const name='team-history-acceptance'
export const inject=['agents','sessions','tools','arkmeData']
export function apply(ctx,config){
  void (async()=>{
    await ctx.get('loader').await()
    const service=ctx.arkmeData,original=service.executeTeamApp,calls=[]
    service.executeTeamApp=async(operation,params,signal)=>{
      signal?.throwIfAborted();assert.equal(operation,'team.app.history');calls.push(params.action)
      return {state:'ready',resultRef:'opaque-result',messages:[],words:params.action==='analysis/words'?[{word:'中文',count:3,messageCount:2,sourceRef:'opaque-source'}]:[],days:[],participants:[],hasMore:false}
    }
    try{
      assert.equal(service.providerCapabilities().features.teamHistoryV1,true)
      const {agent}=await ctx.agents.create({sessionId:`team-history-${randomUUID()}`,meta:{cwd:process.cwd()}});await agent.whenIdle()
      assert(ctx.tools.schemas(agent).some(tool=>tool.name==='arkme_team_history'))
      for(const action of ['query','dates','participants','analysis/create','analysis/state','analysis/result','analysis/words','analysis/sources','exports/create','exports/state','exports/cancel','exports/link']){
        const response=await ctx.tools.execute({agent,name:'arkme_team_history',callId:randomUUID(),arguments:{conversation_ref:'opaque-conversation',action,analysis_kind:'words',result_ref:'opaque-result',source_ref:'opaque-source'},signal:AbortSignal.timeout(10000)})
        assert(!response.isError,JSON.stringify(response));assert(!/owner_user_id|accessToken|refreshToken/.test(JSON.stringify(response)))
      }
      assert.equal(calls.length,12)
      const result={runtime:'official @deepseek-ai/dsh 0.2.1-rc.2',artifact:'immutable tgz in fresh isolated profile',toolDiscovered:true,operationsCalled:calls,providerCapability:true,adapter:'synthetic public Team gateway; real backend evidence reported separately'}
      await writeFile(config.output,JSON.stringify(result,null,2)+'\n',{mode:0o600})
    }finally{service.executeTeamApp=original}
    process.exit(0)
  })().catch(error=>{console.error(error);process.exit(1)})
}
