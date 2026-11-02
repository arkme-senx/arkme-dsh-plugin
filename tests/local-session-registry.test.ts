import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import LocalSessionRegistry from '../src/local-session-registry.js'

describe('local session lifecycle owner', () => {
  it('recovers at native registry resume, retaining the exact preset setup before writer publication', async () => {
    const ctx = new Context(), id = SessionId('saved-blank')
    ctx.provide('sessions', {} as never); ctx.provide('sessionPersistence', {} as never)
    await ctx.plugin(LocalSessionRegistry)
    const registry = ctx.agents as LocalSessionRegistry
    let owner = { owner: 'old', phase: 'active' }
    const order: string[] = [], setup = vi.fn(async () => ({ commit() { order.push('preset') } }))
    const restore = vi.fn(async (target: typeof id, activate: () => Promise<AgentHandle>) => registry.acquireOwned(target, () => {
      order.push('ownership'); owner = { owner: 'new', phase: 'active' }
    }, activate))
    registry.coordinate({ read: () => owner, register: () => {} } as any, 'new', restore)
    const resume = vi.fn(async (context: Context, options: any) => {
      const agent = { id, session: { id }, ctx: context } as Agent
      const prepared = await options.setup(context, agent); prepared.commit()
      order.push('publish'); const detach = context.agents.enter(agent); context.agents.announce(agent)
      return { agent, dispose: async () => { detach() } }
    })
    registry.setFactory({ createAgent: vi.fn(), resume })
    try {
      // The official HTTP carrier dispatches directly to the controller; no
      // gateway.invoke wrapper or caller AsyncLocalStorage is required.
      const handle = await registry.resume({ resumeSessionId: id, setup })
      expect(handle.agent.id).toBe(id); expect(registry.get(id)).toBe(handle.agent)
      expect(restore).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce(); expect(setup).toHaveBeenCalledOnce()
      expect(order).toEqual(['preset', 'ownership', 'publish'])
      await handle.dispose()
    } finally { await ctx.fiber.dispose() }
  })
  it('fences admission, drains one handle, refuses implicit resume and preserves unrelated agents', async () => {
    const ctx = new Context()
    const flush = vi.fn(async () => {})
    ctx.provide('sessions', { flush } as never)
    await ctx.plugin(LocalSessionRegistry)
    const registry = ctx.agents as LocalSessionRegistry
    const disposals = new Map<string, ReturnType<typeof vi.fn>>()
    registry.setFactory({
      async createAgent(owner, options) {
        const id = options.sessionId
        const agent = {
          id, session: { id }, ctx: owner, status: 'idle',
          inbox: { nextTurn: [], nextStep: [] },
          runMaintenance: async (fn: () => Promise<void>) => await fn(),
        } as unknown as Agent
        const detach = owner.agents.enter(agent, options.parentAgent)
        owner.agents.announce(agent)
        const dispose = vi.fn(async () => { detach() })
        disposals.set(id, dispose)
        return { agent, dispose }
      },
      async resume() { throw new Error('must not implicitly resume') },
    })
    const id = SessionId('first')
    const first = await registry.create({ sessionId: id })
    const other = await registry.create({ sessionId: SessionId('other') })
    const release = registry.release(id)
    expect(registry.get(id)).toBeUndefined()
    expect(registry.release(id)).toBe(release)
    await expect(registry.resume({ resumeSessionId: id })).rejects.toThrow('交接')
    await release
    expect(flush).toHaveBeenCalledWith(first.agent.session)
    expect(disposals.get(id)).toHaveBeenCalledTimes(1)
    expect(registry.get(other.agent.id)).toBe(other.agent)
    await expect(registry.create({ sessionId: id })).rejects.toThrow('交接')
    registry.allowAcquisition(id)
    const replacement = await registry.create({ sessionId: id })
    await first.dispose()
    expect(registry.get(id)).toBe(replacement.agent)
    await registry.release(id)
    await ctx.fiber.dispose()
  })

  it('does not cancel busy work, child agents, or a lifecycle whose flush failed', async () => {
    const ctx = new Context()
    const flush = vi.fn(async () => { throw new Error('disk full') })
    ctx.provide('sessions', { flush } as never)
    await ctx.plugin(LocalSessionRegistry)
    const registry = ctx.agents as LocalSessionRegistry
    const dispose = vi.fn(async () => {})
    let handle: AgentHandle
    registry.setFactory({
      async createAgent(owner, options) {
        const agent = {
          id: options.sessionId, session: { id: options.sessionId }, ctx: owner,
          status: 'running', inbox: { nextTurn: [], nextStep: [] },
          runMaintenance: async (fn: () => Promise<void>) => await fn(),
        } as unknown as Agent
        owner.agents.enter(agent, options.parentAgent)
        owner.agents.announce(agent)
        return handle = { agent, dispose }
      },
      async resume() { return handle },
    })
    const id = SessionId('busy')
    const original = await registry.create({ sessionId: id })
    await expect(registry.release(id)).rejects.toThrow('未完成')
    Object.assign(original.agent, { status: 'idle' })
    const maintenance = original.agent.runMaintenance
    Object.assign(original.agent, { runMaintenance() { throw new Error('maintenance active') } })
    await expect(registry.release(id)).rejects.toThrow('maintenance active')
    expect(registry.get(id)).toBe(original.agent)
    Object.assign(original.agent, { runMaintenance: maintenance })
    await expect(registry.release(id)).rejects.toThrow('disk full')
    expect(registry.get(id)).toBe(original.agent)
    expect(dispose).not.toHaveBeenCalled()
    await registry.create({ sessionId: SessionId('child'), parentAgent: original.agent })
    await expect(registry.release(id)).rejects.toThrow('子代理')
    await ctx.fiber.dispose()
  })
})
