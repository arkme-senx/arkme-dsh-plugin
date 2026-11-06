// Test driver only: run with the immutable plugin in an isolated official DSH Profile.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'world-report-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData', 'llm']
export function apply(ctx) {
  void (async () => {
    const origin = new URL(process.env.ARKME_REPORT_ACCEPTANCE_ORIGIN)
    assert.equal(origin.protocol, 'https:'); assert.equal(origin.hostname, '127.0.0.1')
    await ctx.get('loader').await()
    const require = createRequire(join(process.env.ARKME_REPORT_ACCEPTANCE_PROFILE, 'package.json'))
    const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
    assert.equal(ctx.arkmeData.providerCapabilities().features.worldReportsV1, true)
    assert.equal((await ctx.arkmeData.testLogin(99101)).status, 'authenticated')
    const item = (await ctx.arkmeData.listWorldFeed()).items.find(item => item.textContent === '工具举报验收正文')
    assert(item, 'The packaged Host must mint the public item reference')
    let plannedCall
    ctx.llm.registerAdapter(['report-acceptance'], {
      providerInfo: id => ({ id, name: id }), providerRetryPolicy: () => undefined,
      listModels: async () => [{ id: 'local', name: 'local' }], resolveModel: async (provider, id) => ({ provider, id, name: id }),
      async prepareCall(provider, model) { return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) } },
      async *stream() {
        if (plannedCall) {
          const block = plannedCall; plannedCall = undefined
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
          yield { type: 'block-end', index: 0, block }; yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: '测试完成' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '测试完成' } }; yield { type: 'finish', reason: { kind: 'stop' } }
      },
    })
    const { agent } = await ctx.agents.create({ sessionId: `report-${randomUUID()}`, meta: { cwd: process.cwd() }, agentOptions: { provider: 'report-acceptance', model: 'local' } })
    await agent.whenIdle()
    assert(ctx.tools.schemas(agent).some(tool => tool.name === 'arkme_world_report'))
    const call = async (request, text) => {
      const id = randomUUID()
      plannedCall = { type: 'tool-call', id, name: 'arkme_world_report', arguments: JSON.stringify({ request_json: JSON.stringify(request) }) }
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
      await agent.whenIdle()
      const message = agent.session.snapshotEvents().find(event => event.type === 'tool/result' && event.data.message.source.callId === id)?.data.message
      assert(message, 'Official Agent must persist the tool result')
      return { error: message.isError, text: JSON.stringify(message.content) }
    }
    const common = { recordRef: item.recordRef, expectedUserId: 99101 }
    const request = { ...common, action: 'submit', confirmed: true, reportType: 6, reason: '工具明确确认的说明', requestUid: randomUUID() }
    const prepared = await call(request, '先展示本次举报内容')
    assert(prepared.text.includes('confirmation_required')); assert(prepared.text.includes(request.reason))
    const accepted = await call(request, '确认按刚才的类型和说明举报这条内容')
    console.log('WORLD_REPORT_TOOL_RESULT', JSON.stringify(accepted))
    assert(!accepted.error, accepted.text); assert(accepted.text.includes('submitted'))
    const pending = await ctx.arkmeData.worldReport({ ...common, action: 'pending' })
    assert.equal(pending.submitted, true); assert.equal(pending.pending.requestUid, request.requestUid)
    await ctx.arkmeData.worldReport({ ...common, action: 'acknowledge', requestUid: request.requestUid })
    assert.deepEqual(await ctx.arkmeData.worldReport({ ...common, action: 'pending' }), {})
    await ctx.sessions.flush(agent.session)
    console.log('WORLD_REPORT_OFFICIAL_AGENT_READY')
    // Keep this isolated Host alive for UI and installed public SDK acceptance.
  })().catch(async error => {
    console.error(error)
    await ctx.arkmeData.logout().catch(() => {})
    ctx.get('appExit')(1)
  })
}
