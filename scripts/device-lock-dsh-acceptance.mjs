// Mount only in a fresh DSH_HOME/profile with a unique keychainServicePrefix.
// This probe needs no account and never grants lock/unlock or authenticates a user.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export const name = 'device-lock-acceptance-probe'
export const inject = ['agents', 'sessions', 'tools', 'arkmeData']
export function apply(ctx) {
  void (async () => {
    await ctx.get('loader').await()
    const { agent } = await ctx.agents.create({ sessionId: `device-lock-acceptance-${randomUUID()}`, meta: { cwd: process.cwd() } })
    await agent.whenIdle()
    const names = ctx.tools.schemas(agent).map(tool => tool.name)
    for (const name of ['arkme_device_lock_status', 'arkme_device_lock', 'arkme_device_unlock_request']) assert(names.includes(name), `Missing ${name}`)
    const result = await ctx.tools.execute({ agent, name: 'arkme_device_lock_status', callId: randomUUID(), arguments: {}, signal: AbortSignal.timeout(10000) })
    assert(!result.isError, JSON.stringify(result))
    assert.match(String(result.value), /"available":\s*false/)
    for (const name of ['arkme_device_lock', 'arkme_device_unlock_request']) {
      const denied = await ctx.tools.execute({ agent, name, callId: randomUUID(), arguments: {}, signal: AbortSignal.timeout(10000) })
      assert.match(JSON.stringify(denied), /confirmation_required|等待用户确认/)
    }
    await ctx.sessions.flush(agent.session)
    console.log(JSON.stringify({ acceptance: 'packaged-device-lock-real-session', discovered: names.length, status: 'unavailable-without-native-host', unrequestedWrites: 'denied' }))
    ctx.get('appExit')(0)
  })().catch(error => { console.error(error); ctx.get('appExit')(1) })
}
