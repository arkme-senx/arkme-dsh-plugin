// Run only in a fresh isolated official DSH Profile with an immutable plugin tgz.
// Synthetic owner adapters exercise DSH discovery/grants without production writes.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
export const name = 'arko-thought-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx, config) {
  void (async () => {
    await ctx.get('loader').await()
    const service = ctx.arkmeData
    const originalRead = service.sourceMessageThoughts, originalWrite = service.extendSourceMessage
    let reads = 0, writes = 0
    service.sourceMessageThoughts = async (_source, _action, signal) => {
      signal?.throwIfAborted(); reads++
      return { accountScope: 'test:11', items: [{ id: 'synthetic-thought', recordUid: 'synthetic-root', biz: 1, content: 'Synthetic Arko suggestion', replyTargetRef: 'opaque-test-target' }] }
    }
    service.extendSourceMessage = async () => { writes++; throw new Error('An unconfirmed probe must never write') }
    try {
      assert.equal(service.providerCapabilities().features.arkoThoughtRepliesV1, true)
      const { agent } = await ctx.agents.create({ sessionId: `arko-thought-${randomUUID()}`, meta: { cwd: process.cwd() } })
      await agent.whenIdle()
      const names = ctx.tools.schemas(agent).map(tool => tool.name)
      for (const name of ['arkme_message_thoughts', 'arkme_thought_reply']) assert(names.includes(name), `Missing ${name}`)
      const read = await ctx.tools.execute({ agent, name: 'arkme_message_thoughts', callId: randomUUID(),
        arguments: { source_ref: 'opaque-source', message_action_ref: 'opaque-action' }, signal: AbortSignal.timeout(10000) })
      assert(!read.isError, JSON.stringify(read)); assert(JSON.stringify(read).includes('opaque-test-target'))
      const pending = await ctx.tools.execute({ agent, name: 'arkme_thought_reply', callId: randomUUID(),
        arguments: { source_ref: 'opaque-source', message_action_ref: 'opaque-action', thought_reply_ref: 'opaque-test-target', text: 'Synthetic reply', operation_uid: 'synthetic-operation' },
        signal: AbortSignal.timeout(10000) })
      assert(JSON.stringify(pending).includes('confirmation_required'), JSON.stringify(pending))
      assert.equal(reads, 1); assert.equal(writes, 0)
      await ctx.sessions.flush(agent.session)
      await writeFile(config.output, JSON.stringify({ runtime: 'official DSH', packedArtifact: true,
        toolDiscovery: true, readInvocation: true, unconfirmedWriteBlocked: true,
        ownerAdapter: 'synthetic; real service authorization covered separately' }, null, 2) + '\n', { mode: 0o600 })
    } finally { service.sourceMessageThoughts = originalRead; service.extendSourceMessage = originalWrite }
    ctx.get('appExit')(0)
  })().catch(error => { console.error(error); ctx.get('appExit')(1) })
}
