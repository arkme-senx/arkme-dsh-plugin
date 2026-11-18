// Synthetic read adapter in an unmodified official DSH with a packed Provider.
// No credentials or production writes. Record persistence is verified separately.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
export const name = 'record-history-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx, config) {
  void (async () => {
    await ctx.get('loader').await()
    const service = ctx.arkmeData
    const page = service.recordEditHistoryPage, snapshot = service.recordRevisionSnapshot
    let reads = 0
    try {
      assert.equal(service.providerCapabilities().features.recordEditHistoryV1, true)
      const { agent } = await ctx.agents.create({ sessionId: `history-${randomUUID()}`, meta: { cwd: process.cwd() } })
      await agent.whenIdle()
      assert(ctx.tools.schemas(agent).some(tool => tool.name === 'arkme_record_history'))
      const invoke = args => ctx.tools.execute({ agent, name: 'arkme_record_history', callId: randomUUID(), arguments: args, signal: AbortSignal.timeout(10000) })
      const args = { source_ref: 'opaque-source', message_action_ref: 'opaque-action', revision_uid: 'one' }
      assert((await invoke(args)).isError, 'unconfigured account must fail closed')
      service.recordRevisionSnapshot = async (source, action, revision, signal) => {
        signal?.throwIfAborted(); reads++
        assert.equal(source, 'opaque-source'); assert.equal(action, 'opaque-action'); assert.equal(revision, 'one')
        return { revisionUid: revision, textContent: 'historical', durationState: 'complete', editDurationMillis: 0,
          captureContext: { clientName: 'synthetic-private-device' }, locationCapture: { latitude: 30, longitude: 120 }, audioUrl: 'synthetic-secret-url' }
      }
      const result = await invoke(args)
      assert(!result.isError, JSON.stringify(result))
      assert(JSON.stringify(result).includes('historical'))
      assert(!/synthetic-private-device|latitude|longitude|synthetic-secret-url/.test(JSON.stringify(result)))
      service.recordEditHistoryPage = async (_source, _action, cursor, signal) => {
        signal?.throwIfAborted(); assert.equal(cursor, 0)
        return { items: [], hasMore: false }
      }
      assert(!(await invoke({ source_ref: 'opaque-source', message_action_ref: 'opaque-action', cursor_version: 0 })).isError)
      assert.equal(reads, 1)
      await ctx.sessions.flush(agent.session)
      await writeFile(config.output, JSON.stringify({ runtime: 'official DSH v0.2.1-rc.2', immutablePackage: true,
        discovered: true, unauthenticatedDenied: true, exactRevisionCalled: true, versionPageCalled: true, privateToolOutputRedacted: true,
        session: agent.session.id, adapter: 'synthetic read owner; real Mongo persistence verified separately' }, null, 2) + '\n', { mode: 0o600 })
    } finally { service.recordEditHistoryPage = page; service.recordRevisionSnapshot = snapshot }
    ctx.get('appExit')(0)
  })().catch(error => { console.error(error); ctx.get('appExit')(1) })
}
