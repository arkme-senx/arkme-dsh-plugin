// Public DSH services and the installed public SDK; no runtime/source patches.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {writeFile} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
export const name='team-history-live-acceptance'
export const inject=['agents','sessions','tools','arkmeData','webServer']
export function apply(ctx,config) {
  void (async()=>{
    await ctx.get('loader').await()
    await ctx.arkmeData.testLogin(4)
    const origin=ctx.webServer.getOrigin()
    const require=createRequire(config.profileManifest)
    const {createArkmeSdk}=await import(pathToFileURL(require.resolve('@senguoyun/dsh-arkme/sdk')).href)
    const sdk=createArkmeSdk({fetchImpl:(_url,init)=>fetch(origin+'/arkme-self/api',{...init,headers:{...init.headers,Origin:origin}})})
    const conversations=await sdk.listTeamConversations('team')
    const conversation=conversations.items.find(c=>c.visitor?.nickname===`用户${config.visitor}`)
    assert(conversation,'seeded conversation is visible in installed SDK')
    const call=(action,options={})=>sdk.teamHistory(conversation.ref,action,{timezone:'Asia/Shanghai',...options})
    const wait=()=>new Promise(resolve=>setTimeout(resolve,500))
    const prepared=async(action,options)=>{
      let page=await call(action,options)
      for(let n=0;n<120&&page.state!=='ready';n++){
        assert(!['failed','cancelled'].includes(page.state),JSON.stringify(page))
        await wait();page=await call(action==='exports/create'?'exports/state':'analysis/state',{resultRef:page.resultRef})
      }
      assert.equal(page.state,'ready');return page
    }
    let page
    for(let n=0;n<120;n++){
      try{page=await call('query',{keyword:config.needle,limit:1});if(page.state==='ready')break}catch(error){if(!/snapshot_expired|已变化|过期/.test(String(error)))throw error}
      await wait()
    }
    assert.equal(page.state,'ready');assert.equal(page.messages.length,1)
    const analysis=await prepared('analysis/create',{analysisKind:'words',requestId:randomUUID()})
    await call('analysis/result',{resultRef:analysis.resultRef})
    const words=await call('analysis/words',{resultRef:analysis.resultRef})
    const word=words.words.find(w=>w.word==='工作');assert(word)
    const source=await call('analysis/sources',{resultRef:analysis.resultRef,sourceRef:word.sourceRef})
    assert(source.messages.length>0)
    const activity=await prepared('analysis/create',{analysisKind:'activity',requestId:randomUUID()})
    const verified=await call('analysis/result',{resultRef:activity.resultRef});assert(verified.activity.totalMessages>=2)
    const exported=await prepared('exports/create',{requestId:randomUUID()})
    const hash=createHash('sha256');let cursor,bytes=0
    do{
      const chunk=await sdk.readTeamHistoryExportChunk(exported.resultRef,cursor)
      const body=Buffer.from(chunk.chunkBase64,'base64')
      assert.equal(chunk.offset,bytes+body.length);assert.equal(createHash('sha256').update(body).digest('hex'),chunk.chunkSha256)
      hash.update(body);bytes+=body.length;cursor=chunk.complete?undefined:chunk.cursor
      if(chunk.complete){assert.equal(hash.digest('hex'),chunk.sha256);assert.equal(bytes,chunk.bytes)}
    }while(cursor)
    const {agent}=await ctx.agents.create({sessionId:'team-history-live-'+randomUUID(),meta:{cwd:process.cwd()}})
    await agent.whenIdle();assert(ctx.tools.schemas(agent).some(t=>t.name==='arkme_team_history'))
    const result=await ctx.tools.execute({agent,name:'arkme_team_history',callId:randomUUID(),arguments:{conversation_ref:conversation.ref,action:'query',keyword:config.needle,timezone:'Asia/Shanghai'},signal:AbortSignal.timeout(30000)})
    assert(!result.isError,JSON.stringify(result));assert(JSON.stringify(result).includes(config.needle))
    await writeFile(config.output,JSON.stringify({officialRuntime:'0.2.1-rc.2',installedSdk:true,realToolSession:true,conversation,sourceCount:source.messages.length,word,exportBytes:bytes,origin},null,2))
  })().catch(error=>{console.error(error);process.exitCode=1;setTimeout(()=>process.exit(1),100)})
}
