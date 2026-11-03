// Run only in an isolated official DSH Profile with the packaged plugin and a loopback fixture.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
export const name = 'public-social-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData', 'llm']
export function apply(ctx) {
  void (async () => {
    const fixture = new URL(process.env.ARKME_SOCIAL_ACCEPTANCE_ORIGIN)
    assert.equal(fixture.hostname, '127.0.0.1'); assert.equal(fixture.protocol, 'https:')
    await ctx.get('loader').await()
    const require = createRequire(join(process.env.ARKME_SOCIAL_ACCEPTANCE_PROFILE, 'node_modules/@senguoyun/dsh-arkme/package.json'))
    const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
    assert.equal(ctx.arkmeData.providerCapabilities().features.publicSocialV1, true)
    const auth = await ctx.arkmeData.testLogin(99101); assert.equal(auth.status, 'authenticated')
    let plannedCall
    ctx.llm.registerAdapter(['social-acceptance'], {
      providerInfo: id => ({ id, name: id }), providerRetryPolicy: () => undefined,
      listModels: async () => [{id:'local', name:'local'}], resolveModel: async (provider,id)=>({provider,id,name:id}),
      async prepareCall(provider, model) { return {model:await this.resolveModel(provider,model), stream:options=>this.stream(options)} },
      async *stream() {
        if (plannedCall) {
          const block=plannedCall;plannedCall=undefined
          yield {type:'block-start',index:0,blockType:'tool-call'}
          yield {type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments}
          yield {type:'block-end',index:0,block}; yield {type:'finish',reason:{kind:'tool-calls'}};return
        }
        yield {type:'block-start',index:0,blockType:'text'}; yield {type:'text-delta',index:0,text:'测试完成'}
        yield {type:'block-end',index:0,block:{type:'text',text:'测试完成'}};yield {type:'finish',reason:{kind:'stop'}}
      },
    })
    const {agent}=await ctx.agents.create({sessionId:`public-social-${randomUUID()}`,meta:{cwd:process.cwd()},agentOptions:{provider:'social-acceptance',model:'local'}})
    await agent.whenIdle()
    const names=ctx.tools.schemas(agent).map(row=>row.name)
    for(const name of ['arkme_social_read','arkme_social_write'])assert(names.includes(name),`Missing ${name}`)
    const call=async(name,args,text)=>{
      const id=randomUUID();plannedCall={type:'tool-call',id,name,arguments:JSON.stringify(args)}
      agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}));await agent.whenIdle()
      const message=agent.session.snapshotEvents().find(event=>event.type==='tool/result'&&event.data.message.source.callId===id)?.data.message
      assert(message,'Official Agent must persist the Tool result');return {isError:message.isError,text:JSON.stringify(message.content)}
    }
    const read=await call('arkme_social_read',{operation:'groups'},'读取本地测试公开群目录')
    assert(!read.isError,read.text);assert(!/access_token|refresh_token|chat_session_uid/.test(read.text))
    const args={operation:'listing',account_scope:'test:99101',enabled:true,introduction:'隔离 DSH 会话验证'}
    const pending=await call('arkme_social_write',args,'展示我的测试介绍');assert(pending.text.includes('confirmation_required'))
    const saved=await call('arkme_social_write',args,'确认展示我的测试介绍');assert(!saved.isError,saved.text);assert(saved.text.includes('isListed'))
    const own=await call('arkme_social_read',{operation:'person'},'读取我的公开展示');assert(!own.isError,own.text);assert(own.text.includes('隔离 DSH 会话验证'))
    await ctx.arkmeData.publicSocialWrite({operation:'listing',accountScope:'test:99101',enabled:false})
    await ctx.arkmeData.logout();await ctx.sessions.flush(agent.session)
    console.log(JSON.stringify({acceptance:'public-social-packaged-real-agent',read:true,writeConfirmation:true,write:true,readBack:true,cleanup:true}))
    ctx.get('appExit')(0)
  })().catch(error=>{console.error(error);ctx.get('appExit')(1)})
}
