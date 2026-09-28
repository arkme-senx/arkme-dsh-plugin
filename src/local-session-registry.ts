import type { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, type AgentHandle, type AgentSetup, type CreateAgentOptions, type ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import agentPackage from '@deepseek-ai/dsh-agent/package.json' with { type: 'json' }
import type { SessionId } from '@deepseek-ai/dsh-session'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { LocalSessionOwnership } from './local-session-ownership.js'

/** Opt-in Profile replacement for the public agent registry; never patches a live service. */
export default class LocalSessionRegistry extends AgentRegistry {
  static inject = ['sessions']
  private readonly handles = new Map<SessionId, AgentHandle>()
  private readonly fences = new Set<SessionId>()
  private readonly releasing = new Map<SessionId, Promise<void>>()
  private readonly commands = new Map<SessionId, number>()
  private readonly acquisition = new AsyncLocalStorage<{ id: SessionId; commit: () => void }>()
  private coordination: { ownership: LocalSessionOwnership; instance: string } | undefined

  constructor(ctx: Context) {
    if (agentPackage.version !== '0.1.5-rc.2') throw new Error('本机接管需要已验证的 DSH Agent 0.1.5-rc.2')
    super(ctx)
    ctx.on('agent/disposed', ({ agent }) => {
      if (this.handles.get(agent.id)?.agent === agent) this.handles.delete(agent.id)
    })
  }

  override async create(options: CreateAgentOptions): Promise<AgentHandle> {
    this.assertUnfenced(options.sessionId)
    return this.remember(await super.create({ ...options, setup: this.guardSetup(options.sessionId, options.setup, options.parentAgent !== undefined) }))
  }

  override async resume(options: ResumeAgentOptions): Promise<AgentHandle> {
    this.assertUnfenced(options.resumeSessionId)
    return this.remember(await super.resume({ ...options, setup: this.guardSetup(options.resumeSessionId, options.setup, options.parentAgent !== undefined) }))
  }

  /** Configure before any Agent is published in this Profile. */
  coordinate(ownership: LocalSessionOwnership, instance: string): void {
    if (this.coordination || this.list().length) throw new Error('必须在会话启动之前装配接管协调器')
    if (!this.ctx.get('sessionPersistence')) throw new Error('接管协调器需要 DSH 持久化写锁')
    this.coordination = { ownership, instance }
  }

  async acquireOwned(id: SessionId, commit: () => void, activate: () => Promise<unknown>): Promise<AgentHandle> {
    if (this.releasing.has(id)) throw new Error('会话尚未完成释放')
    const current = this.handles.get(id)
    if (current && this.get(id) === current.agent) { commit(); return current }
    await this.acquisition.run({ id, commit }, activate)
    const handle = this.handles.get(id)
    if (!handle || super.get(id) !== handle.agent) throw new Error('恢复流程没有发布会话')
    this.fences.delete(id)
    return handle
  }

  private guardSetup(id: SessionId, setup: AgentSetup | undefined, child: boolean): AgentSetup {
    return async (ctx, agent) => {
      const prepared = await setup?.(ctx, agent)
      return { commit: () => {
        this.assertUnfenced(id)
        prepared?.commit()
        const acquisition = this.acquisition.getStore()
        if (acquisition?.id === id) acquisition.commit()
        // The coordinator's setup commit changes the metadata only after DSH
        // obtained its writer. All other root activations must already own it.
        if (this.coordination && !child) this.coordination.ownership.register(id, this.coordination.instance)
      } }
    }
  }

  /** A handed-off journal still exists; disposal is not a user deletion. */
  retainsSession(id: SessionId): boolean { return this.fences.has(id) }

  override get(id: SessionId) {
    // Native prompt admission rechecks this exact identity after attachment I/O.
    return this.fences.has(id) ? undefined : super.get(id)
  }

  private remember(handle: AgentHandle): AgentHandle {
    // Publication listeners may have disposed it before create/resume returned.
    if (super.get(handle.agent.id) === handle.agent) this.handles.set(handle.agent.id, handle)
    return handle
  }

  private assertUnfenced(id: SessionId): void {
    if (this.acquisition.getStore()?.id === id) return
    if (this.fences.has(id)) throw new Error('会话正在交接，请重新连接当前执行者')
    const current = this.coordination?.ownership.read(id)
    if (current && (current.owner !== this.coordination!.instance || current.phase !== 'active')) {
      throw new Error('会话正在其他实例执行，请通过交接入口继续')
    }
  }

  /** All native command carriers must enter here before resolving an Agent.
   * A command keeps its admission until asynchronous attachment/settings work
   * finishes; release cannot dispose the captured Agent underneath that work. */
  async command<T>(id: SessionId, run: () => Promise<T>): Promise<T> {
    this.assertUnfenced(id)
    this.commands.set(id, (this.commands.get(id) ?? 0) + 1)
    try { return await run() }
    finally {
      const remaining = this.commands.get(id)! - 1
      if (remaining) this.commands.set(id, remaining)
      else this.commands.delete(id)
    }
  }

  private assertIdle(handle: AgentHandle): void {
    const agent = handle.agent
    if (!this.roots().includes(agent) || this.list().some(child => this.isOwnedBy(child.id, agent))) {
      throw new Error('会话仍有关联子代理，暂不能交接')
    }
    const jobs = this.ctx.get('jobs') as { list(owner: typeof agent): { ownerSession?: string; status: string; reported: boolean }[] } | undefined
    const terminals = agent.ctx.get('terminals') as { list(owner: typeof agent): unknown[] } | undefined
    if (terminals?.list(agent).length) throw new Error('会话仍有持久终端，不能丢弃终端状态后自动接管')
    if (agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length
      || jobs?.list(agent).some(job => job.ownerSession === agent.id
        && (job.status === 'running' || job.status === 'stopping' || !job.reported))) {
      throw new Error('会话仍有未完成的工作，请等待完成后交接')
    }
  }

  /**
   * Release only a captured, idle root. The caller must authorize the transfer
   * and fence its entry points first. Success leaves activation fenced locally;
   * only an explicit, separately authorized reacquisition may lift that fence.
   */
  release(id: SessionId): Promise<void> {
    const pending = this.releasing.get(id)
    if (pending) return pending
    if (this.commands.has(id)) return Promise.reject(new Error('会话命令尚未完成，请等待完成后交接'))
    const handle = this.handles.get(id)
    if (!handle || super.get(id) !== handle.agent) return Promise.reject(new Error('当前实例不持有该会话的生命周期'))
    const agent = handle.agent
    try { this.assertIdle(handle) } catch (error) { return Promise.reject(error) }
    // Retain fences until explicit reacquisition; evicting one would let stale
    // native pages seize execution. Bound retained handoffs instead.
    if (!this.fences.has(id) && this.fences.size >= 1024) return Promise.reject(new Error('当前实例交接记录已达上限，请重启后重试'))
    this.fences.add(id)
    const operation = Promise.resolve().then(async () => {
      let disposing = false
      try {
        // Public status is also idle during maintenance. Claiming maintenance
        // rejects that case and serializes the durability barrier with the loop.
        await agent.runMaintenance(async () => { await this.ctx.sessions.flush(agent.session) })
        this.assertIdle(handle)
        disposing = true
        await handle.dispose()
      } catch (error) {
        // A failed close may already have released the writer: never reopen an
        // uncertain lifecycle or let an old page implicitly resume it.
        if (!disposing && super.get(id) === agent) this.fences.delete(id)
        throw error
      } finally {
        this.releasing.delete(id)
      }
    })
    this.releasing.set(id, operation)
    return operation
  }

  /** Called only after the coordinator has authorized acquisition for this instance. */
  allowAcquisition(id: SessionId): void {
    if (this.coordination) throw new Error('已启用协调器，不能绕过执行权提交')
    if (this.releasing.has(id)) throw new Error('会话尚未完成释放')
    this.fences.delete(id)
  }
}
