// Install the immutable package into a fresh official DSH Profile first.
// This probe creates only an isolated DSH session; no Arkme account is required.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export const name = 'message-anchor-acceptance-probe'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx) {
  void (async () => {
    await ctx.get('loader').await()
    assert.equal(ctx.arkmeData.providerCapabilities().features.messageTextAnchorsV1, true, 'Packaged Host must advertise the SDK feature')
    const { agent } = await ctx.agents.create({sessionId: `message-anchor-probe-${randomUUID()}`, meta:{cwd:process.cwd()}})
    await agent.whenIdle()
    const names = ctx.tools.schemas(agent).map(tool => tool.name)
    for (const name of ['arkme_message_marks_read','arkme_message_mark','arkme_message_quote_reply']) assert(names.includes(name), `Missing packaged tool ${name}`)
    for (const [name,args] of [
      ['arkme_message_marks_read',{source_ref:'unavailable',message_action_ref:'unavailable'}],
      ['arkme_message_mark',{source_ref:'unavailable',message_action_ref:'unavailable',action:'remove',annotation_uid:'own',operation_uid:'stable-probe'}],
      ['arkme_message_quote_reply',{source_ref:'unavailable',message_action_ref:'unavailable',start:0,end:2,text:'no-send',operation_uid:'stable-quote-probe'}],
    ]) {
      const result = await ctx.tools.execute({agent,name,callId:randomUUID(),arguments:args,signal:AbortSignal.timeout(10000)})
      assert(result.isError, 'Unauthenticated operations must fail closed')
      console.log(JSON.stringify({acceptance:'message-anchor-auth-denied',name,isError:true}))
    }
    await ctx.sessions.flush(agent.session)
    console.log(JSON.stringify({acceptance:'message-anchor-packaged-session',tools:3,session:agent.session.id}))
    ctx.get('appExit')(0)
  })().catch(error => {console.error(error);ctx.get('appExit')(1)})
}
