// Test-only consumer of the immutable installed plugin and unmodified official DSH.
// Run in a fresh DSH_HOME with every business endpoint set to the loopback Go fixture.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createArkmeSdk } from '@senguoyun/dsh-arkme/sdk'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'speaker-correction-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData', 'webServer', 'llm']
export function apply(ctx) {
  void (async () => {
    await ctx.get('loader').await()
    const ownerURL = new URL(process.env.CORRECTION_OWNER_URL)
    assert.equal(ownerURL.hostname, '127.0.0.1')
    const fixture = await (await fetch(new URL('/fixture', ownerURL))).json()
    await ctx.arkmeData.testLogin(fixture.owner)
    const origin = `http://127.0.0.1:${ctx.webServer.port}`
    const sdk = createArkmeSdk({ fetchImpl: (path, init) => fetch(new URL(path, origin), { ...init, headers: { ...init?.headers, Origin: origin } }) })
    let selection = await sdk.recordingSpeakerCorrectionItems({ dateStamp: fixture.day, atMillis: fixture.day + 3000, transcriptSource: 'system' })
    assert.equal(selection.items.length, 3)
    assert.equal(selection.items[1].speakerLabel, '人物 A')
    let item = selection.items[1]
    let context = await sdk.recordingSpeakerCorrectionContext(item.itemRef)
    assert(context.supported)
    const input = { itemRef: item.itemRef, itemRefs: [item.itemRef], expectedVersion: context.version, idempotencyKey: randomUUID(), detach: true, rejectCurrent: true, soundSource: 'playback' }
    const result = await sdk.applyRecordingSpeakerCorrection(input)
    assert.equal(result.affectedCount, 1)
    assert.equal(result.day.transcript.items[0].speakerLabel, '人物 A')
    assert.notEqual(result.day.transcript.items[1].speakerLabel, '人物 A')
    assert.equal(result.day.transcript.items[1].soundSource, 'playback')
    const replay = await sdk.applyRecordingSpeakerCorrection(input)
    assert.equal(replay.affectedCount, 1)
    item = result.day.transcript.items[1]
    context = await sdk.recordingSpeakerCorrectionContext(item.itemRef)
    await sdk.undoRecordingSpeakerCorrection({ itemRef: item.itemRef, undoRef: context.undoRef, expectedVersion: context.version, idempotencyKey: randomUUID() })
    console.log(JSON.stringify({ acceptance: 'installed-public-sdk-real-owner', apply: true, replay: true, undo: true }))

    selection = await sdk.recordingSpeakerCorrectionItems({ dateStamp: fixture.day, atMillis: fixture.day + 3000, transcriptSource: 'system' })
    item = selection.items[1]
    context = await sdk.recordingSpeakerCorrectionContext(item.itemRef)
    const toolArgs = { action: 'apply', request_json: JSON.stringify({ itemRef: item.itemRef, itemRefs: [item.itemRef], expectedVersion: context.version, idempotencyKey: randomUUID(), detach: false, soundSource: 'playback' }) }
    let completed = false, confirmations = 0
    // Only the model response is deterministic. The official Agent loop executes
    // the registered tool, records its result and enforces the conversational grant.
    ctx.llm.registerAdapter(['correction-acceptance'], {
      providerInfo: id => ({ id, name: id }), providerRetryPolicy: () => undefined,
      listModels: async () => [{ id: 'local', name: 'local' }],
      resolveModel: async (provider,id) => ({ provider,id,name:id }),
      async prepareCall(provider,model) { return { model:await this.resolveModel(provider,model),stream:options=>this.stream(options) } },
      async *stream(options) {
        const messages = options.messages
        const last = messages.at(-1)
        const toolResults = last?.content?.filter(block=>block.type==='tool-result') ?? []
        if (toolResults.length) {
          const text = toolResults.flatMap(block=>block.content).filter(block=>block.type==='text').map(block=>block.text).join('\n')
          assert(!toolResults.some(block=>block.isError), text)
          if (text.includes('confirmation_required')) confirmations++
          else { assert(text.includes('affectedCount'), text); completed=true }
          const answer = completed ? '纠错已完成' : '是否确认仅把这个片段设为播放内容？'
          yield { type:'block-start',index:0,blockType:'text' }
          yield { type:'text-delta',index:0,text:answer }
          yield { type:'block-end',index:0,block:{type:'text',text:answer} }
          yield { type:'finish',reason:{kind:'stop'} }; return
        }
        assert(options.tools.some(tool=>tool.name==='arkme_recording_speaker_correct'))
        const id=randomUUID(), args=JSON.stringify(toolArgs)
        yield { type:'block-start',index:0,blockType:'tool-call' }
        yield { type:'tool-call-delta',index:0,id,name:'arkme_recording_speaker_correct',argumentsDelta:args }
        yield { type:'block-end',index:0,block:{type:'tool-call',id,name:'arkme_recording_speaker_correct',arguments:args} }
        yield { type:'finish',reason:{kind:'tool-calls'} }
      },
    })
    const handle = await ctx.agents.create({ sessionId:`correction-${randomUUID()}`,meta:{cwd:process.cwd()},agentOptions:{provider:'correction-acceptance',model:'local'} })
    const {agent}=handle
    await agent.whenIdle()
    const names=ctx.tools.schemas(agent).map(tool=>tool.name)
    assert(names.includes('arkme_recording_speaker_correction_context'))
    const read=await ctx.tools.execute({agent,name:'arkme_recording_speaker_correction_context',callId:randomUUID(),arguments:{item_ref:item.itemRef},signal:AbortSignal.timeout(10000)})
    assert(!read.isError,JSON.stringify(read))
    agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'请把验收片段设为播放内容'}]}))
    await agent.whenIdle()
    assert.equal(confirmations,1)
    assert.equal((await sdk.recordingSpeakerCorrectionContext(item.itemRef)).soundSource,'unknown')
    agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'确认，仅修改该片段的声音来源'}]}))
    await agent.whenIdle()
    if (!completed) console.error(JSON.stringify({ diagnostic: agent.session.events.slice(-12) }))
    assert(completed)
    const fresh=await sdk.recordingSpeakerCorrectionItems({dateStamp:fixture.day,atMillis:fixture.day+3000,transcriptSource:'system'})
    assert.equal(fresh.items[1].soundSource,'playback')
    assert.equal(fresh.items[1].speakerLabel,'人物 A')
    const restore=await sdk.recordingSpeakerCorrectionContext(fresh.items[1].itemRef)
    await sdk.undoRecordingSpeakerCorrection({itemRef:fresh.items[1].itemRef,undoRef:restore.undoRef,expectedVersion:restore.version,idempotencyKey:randomUUID()})
    await ctx.sessions.flush(agent.session)
    await handle.dispose()
    console.log(JSON.stringify({acceptance:'installed-tool-real-agent-real-owner',read:true,confirmation:true,write:true,sourceIndependentOfIdentity:true}))
    // Leave this isolated instance alive for the browser UI acceptance.
    console.log(JSON.stringify({acceptance:'ready-for-browser',origin,dateStamp:fixture.day}))
  })().catch(error=>{console.error(error);ctx.get('appExit')(1)})
}
