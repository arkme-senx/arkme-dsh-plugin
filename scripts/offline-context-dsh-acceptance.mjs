// Load as a probe in a disposable official DSH Profile. All backend traffic must
// target the caller-owned loopback fixture; never use real account credentials.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export const name = 'offline-context-acceptance'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx) {
  void (async () => {
    await ctx.get('loader').await()
    const fixture = new URL(process.env.OFFLINE_CONTEXT_FIXTURE)
    assert.equal(fixture.hostname, '127.0.0.1')
    assert.equal(fixture.protocol, 'https:')
    const auth = await ctx.arkmeData.testLogin(7)
    assert.equal(auth.status, 'authenticated')
    const { agent } = await ctx.agents.create({ sessionId: `offline-context-${randomUUID()}`, meta: { cwd: process.cwd() } })
    await agent.whenIdle()
    const names = ctx.tools.schemas(agent).map(t => t.name)
    for (const name of ['arkme_offline_context_read', 'arkme_offline_context_command']) assert(names.includes(name), `missing ${name}`)
    for (const action of ['capability', 'pending']) {
      const result = await ctx.tools.execute({ agent, name: 'arkme_offline_context_read', callId: randomUUID(), arguments: { action }, signal: AbortSignal.timeout(10000) })
      assert(!result.isError, JSON.stringify(result))
      assert(!JSON.stringify(result).includes('fixture-access-token'))
      console.log(JSON.stringify({ acceptance: 'offline-context-real-session-tool', action, result }))
    }
    await ctx.sessions.flush(agent.session)
    console.log(JSON.stringify({ acceptance: 'offline-context-probe-ready' }))
  })().catch(error => { console.error(error); ctx.get('appExit')(1) })
}
