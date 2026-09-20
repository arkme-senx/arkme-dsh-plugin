// Official DSH acceptance driver; mount through a temporary Profile patch.
// RECORDING_DSH_HANDOFF points only to the opt-in loopback OpenAPI Go fixture.
// Uses real scoped Agent/ToolRuntime and the official MCP bridge, not a mock tool registry.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export const name = 'recording-acceptance-probe'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx) {
  void (async () => {
    await ctx.get('loader').await()
    const { agent } = await ctx.agents.create({ sessionId: `recording-acceptance-${randomUUID()}`, meta: { cwd: process.cwd() } })
    await agent.whenIdle()
    const names = ctx.tools.schemas(agent).map(t => t.name)
    assert(names.includes('arkme_ai_video'), 'packaged Arkme business tools must be active')
    for (const name of ['arkme_recording_days_list', 'arkme_recording_read']) {
      assert(!names.includes(name))
      const result = await ctx.tools.execute({ agent, name, callId: randomUUID(), arguments: { date: '2026-09-08', content: 'transcript' }, signal: AbortSignal.timeout(10000) })
      assert(result.isError, JSON.stringify(result))
      console.log(JSON.stringify({ acceptance: 'retired-tool-rejected', name, result }))
    }
    if (process.env.RECORDING_DSH_HANDOFF) {
      const handoff = new URL(process.env.RECORDING_DSH_HANDOFF)
      assert(handoff.protocol === 'http:' && handoff.hostname === '127.0.0.1', 'only isolated loopback test fixtures are allowed')
      const fixture = await (await fetch(process.env.RECORDING_DSH_HANDOFF + '/fixture')).json()
      const endpoint = new URL(fixture.endpoint)
      assert(endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1')
      const call = async (raw, args) => {
        const name = `mcp__arkme__${raw}`
        assert(names.includes(name), `missing ${name}`)
        const result = await ctx.tools.execute({ agent, name, callId: randomUUID(), arguments: args, signal: AbortSignal.timeout(10000) })
        assert(!result.isError, JSON.stringify(result))
        assert(result.value.structuredContent)
        console.log(JSON.stringify({ acceptance: 'real-owner-mcp-call', name, validOutput: true }))
        return result.value.structuredContent
      }
      const found = await call('query_recordings', { start_at: 1000, end_at: 2000 })
      assert(found.items.some(i => i.recording_uid === fixture.recording_uid))
      const args = { recording_uid: fixture.recording_uid, text_mode: 'full', start_at: 1000, end_at: 2000, limit: 1 }
      let text = ''
      for (let i = 0; i < 20; i++) {
        const page = await call('query_recording_transcript', args)
        for (const item of page.utterances) if (item.utterance_index === 0) text += item.text
        if (!page.has_more) break
        args.page_cursor = page.next_page_cursor
      }
      assert.equal(text, '原句🙂'.repeat(2000) + '尾句')
      const list = await call('query_recording_summaries', { start_at: 1000, end_at: 2000 })
      assert.equal(list.items[0].summary_uid, fixture.summary_uid)
      const read = { summary_uid: fixture.summary_uid, limit: 10000 }
      let reference = ''
      for (let i = 0; i < 20; i++) {
        const page = await call('read_recording_summary', read)
        assert.equal(page.summary.content_origin, 'business_recording_summary')
        reference += page.text
        if (!page.has_more) break
        read.page_cursor = page.next_page_cursor
      }
      assert.equal(reference, '参考🙂'.repeat(9000))
      await fetch(process.env.RECORDING_DSH_HANDOFF + '/finish', { method: 'POST' })
      console.log(JSON.stringify({ acceptance: 'real-owner-full-text-lossless', transcriptRunes: [...text].length, summaryRunes: [...reference].length }))
    }
    await ctx.sessions.flush(agent.session)
    console.log(JSON.stringify({ acceptance: 'packaged-plugin-real-session', discovered: names.length, session: agent.session.id }))
    ctx.get('appExit')(0)
  })().catch(e => { console.error(e); ctx.get('appExit')(1) })
}
