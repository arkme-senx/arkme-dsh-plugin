// Install the immutable package into a fresh official DSH Profile first.
// Synthetic read adapter: no account credentials, writes, or production IO.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
export const name = 'message-extension-summary-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx, config) {
  void (async () => {
    await ctx.get('loader').await()
    const service = ctx.arkmeData, original = service.sourceMessageExtensionSummaries
    let reads = 0
    try {
      assert.equal(service.providerCapabilities().features.messageExtensionSummariesV1, true)
      const { agent } = await ctx.agents.create({ sessionId: `extension-summary-${randomUUID()}`, meta: { cwd: process.cwd() } })
      await agent.whenIdle()
      assert(ctx.tools.schemas(agent).some(tool => tool.name === 'arkme_message_comments_summary'))
      const invoke = () => ctx.tools.execute({ agent, name: 'arkme_message_comments_summary', callId: randomUUID(), arguments: { source_ref: 'opaque-source', message_action_ref: 'opaque-action' }, signal: AbortSignal.timeout(10000) })
      const denied = await invoke()
      assert(denied.isError, 'Unconfigured account must fail closed')
      service.sourceMessageExtensionSummaries = async (sourceRef, actionRefs, signal) => {
        signal?.throwIfAborted(); reads++
        assert.equal(sourceRef, 'opaque-source'); assert.deepEqual(actionRefs, ['opaque-action'])
        return [{ actionRef: actionRefs[0], summary: { accessible: true, complete: true, commentCount: 125, quoteCount: 0, sourceRecordVersion: 1, anchors: [] } }]
      }
      const result = await invoke()
      assert(!result.isError, JSON.stringify(result)); assert(JSON.stringify(result).includes('125')); assert.equal(reads, 1)
      await ctx.sessions.flush(agent.session)
      await writeFile(config.output, JSON.stringify({ runtime: 'official DSH v0.2.1-rc.2', immutablePackage: true, discovery: true, unauthenticatedDenied: true, readInvoked: true, ownerAdapter: 'synthetic; authorization and real Mongo owner verified separately', session: agent.session.id }, null, 2) + '\n', { mode: 0o600 })
    } finally { service.sourceMessageExtensionSummaries = original }
    ctx.get('appExit')(0)
  })().catch(error => { console.error(error); ctx.get('appExit')(1) })
}
