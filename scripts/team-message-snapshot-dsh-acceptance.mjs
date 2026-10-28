// Test-only driver for the unmodified published DSH runtime and packed Arkme.
// The public Team gateway supplies synthetic facts; owner persistence is tested
// separately against the real Team/Record HTTP + Mongo stack.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
export const name = 'team-snapshot-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx, config) {
  void (async()=>{
    await ctx.get('loader').await()
    const service=ctx.arkmeData,original=service.executeTeamApp,calls=[]
    service.executeTeamApp=async(operation,_params,signal)=>{
      signal?.throwIfAborted();calls.push(operation)
      if(operation==='team.app.snapshot.read')return {schemaVersion:1,recorded:true,version:1,snapshotVersion:1,captureStates:{device:'recorded',location:'recorded'},detail:{itemUid:'opaque-message',textContent:'',backgroundSound:'unknown',startAtMillis:1000,durationState:'complete',recordDurationMillis:0,editDurationMillis:0,captureContext:{clientName:'synthetic-private-device'},locationCapture:{latitude:30,longitude:120}}}
      throw new Error('Unexpected synthetic gateway operation: '+operation)
    }
    try {
      const {agent}=await ctx.agents.create({sessionId:`t15-snapshot-${randomUUID()}`,meta:{cwd:process.cwd()}})
      await agent.whenIdle()
      const names=ctx.tools.schemas(agent).map(tool=>tool.name)
      assert(names.includes('arkme_team_messages')&&names.includes('arkme_team_message_edit'))
      const read=await ctx.tools.execute({agent,name:'arkme_team_messages',callId:randomUUID(),arguments:{snapshot:true,conversation_ref:'opaque-conversation',message_ref:'opaque-message'},signal:AbortSignal.timeout(10000)})
      assert(!read.isError,JSON.stringify(read))
      assert(JSON.stringify(read).includes('startAtMillis'))
      assert(!/synthetic-private-device|latitude|longitude/.test(JSON.stringify(read)))
      const write=await ctx.tools.execute({agent,name:'arkme_team_message_edit',callId:randomUUID(),arguments:{conversation_ref:'opaque-conversation',message_ref:'opaque-message',version:1,revision_uid:randomUUID(),text:'synthetic edit'},signal:AbortSignal.timeout(10000)})
      assert(write.isError||JSON.stringify(write).includes('confirmation_required'))
      assert(!calls.includes('team.app.edit'))
      const result={runtime:'official @deepseek-ai/dsh 0.2.1-rc.2',artifact:'packed tgz installed in isolated Profile',readSucceeded:true,modelOutputRedacted:true,unconfirmedEditBlocked:true,gatewayCalls:calls,businessAdapter:'synthetic public Team gateway; real owner HTTP/Mongo acceptance is separate'}
      await writeFile(config.output,JSON.stringify(result,null,2)+'\n',{mode:0o600})
      console.log('T15_DSH_ACCEPTANCE '+JSON.stringify(result))
      process.exitCode=0
    } finally {service.executeTeamApp=original}
    process.exit(0)
  })().catch(error=>{console.error(error);process.exit(1)})
}
