import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway/types'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LocalSessionOwnership, type LocalSessionOwner } from './local-session-ownership.js'
import { HandoffDenied, LocalSessionCoordinator } from './local-session-coordinator.js'
import { LocalSessionControl } from './local-session-control.js'
import { LocalSessionCloud } from './local-session-cloud.js'
import type LocalSessionRegistry from './local-session-registry.js'
import { DshNativeTransport, nativeRecord } from './dsh-remote/native-transport.js'
import type { DshConnectionLike, DshGatewayLike } from './dsh-remote/gateway-api.js'
import { DshRemoteError } from './dsh-remote/errors.js'

type Config = { root: string; accountRef: string; environment: 'test' | 'prod' }
type Json = Record<string, unknown>
function unavailablePeer(error: unknown): boolean {
  return error instanceof TypeError || error instanceof DshRemoteError && error.code === 'RUNTIME_OFFLINE'
}

export function localCommandSession(args: Readonly<Json>): string | undefined {
  const request = args.request && typeof args.request === 'object' ? args.request as Json : undefined
  const address = request?.address && typeof request.address === 'object' ? request.address as Json : undefined
  const id = request?.sessionId ?? request?.parentSessionId ?? args.agent ?? args.parentSessionId
    ?? (address?.kind === 'session' ? address.sessionId : address?.parentSessionId)
  return typeof id === 'string' ? id : undefined
}

/** Account-scoped Host owner. Never exposes the discovery token to a browser. */
export default class LocalSessionRuntime {
  static inject = ['arkmeData', 'agents', 'sessionController', 'typertGateway', 'connection']
  readonly instance = randomUUID()
  private readonly incoming = new AsyncLocalStorage<{ sessionId?: string }>()
  private readonly lifetime = new AbortController()
  private starting: Promise<void> | undefined
  private ownership: LocalSessionOwnership | undefined
  private coordinator: LocalSessionCoordinator | undefined
  private controls: LocalSessionControl | undefined
  private cloudValue: LocalSessionCloud | undefined
  private accountId: string | undefined
  private readonly carriers = new Map<string, { sessionId: string; owner: string; epoch: number; touched: number }>()
  private readonly native: DshNativeTransport
  private readonly registry: LocalSessionRegistry

  constructor(private readonly ctx: Context, private readonly config: Config) {
    this.registry = ctx.agents as LocalSessionRegistry
    this.native = new DshNativeTransport(ctx.get('typertGateway') as DshGatewayLike, ctx.get('connection') as DshConnectionLike)
    ctx.provide('arkmeLocalSessions', this)
    ctx.effect(() => async () => {
      this.lifetime.abort(); this.native.close()
      await this.starting?.catch(() => undefined)
      await this.controls?.close()
      await this.coordinator?.close()
      this.ownership?.close()
    }, 'arkme: same-machine session ownership')
  }

  private async authorize(): Promise<string> {
    const session = await this.ctx.arkmeData.accountScope.scopedSession()
    if (!session || !this.ctx.arkmeData.accountScope.ready()) throw new Error('请先登录当前会话账号')
    const id = String(session.userId)
    const expected = createHash('sha256').update(`arkme-dsh-account-scope-v1\n${id}`).digest('hex')
    if (expected !== this.config.accountRef || this.accountId && this.accountId !== id) throw new Error('共享会话目录属于其他账号')
    this.lifetime.signal.throwIfAborted()
    return id
  }

  start(): Promise<void> {
    return this.starting ??= (async () => {
      this.accountId = await this.authorize()
      const scope = { accountId: this.accountId, environment: this.config.environment }
      const ownership = this.ownership = new LocalSessionOwnership(this.config.root, scope)
      this.cloudValue = new LocalSessionCloud({ ownership, instance: this.instance, accountId: this.accountId,
        request: { post: (path, body, signal) => this.ctx.arkmeData.dshRemotePost<Json>(path, body, signal) } })
      this.coordinator = new LocalSessionCoordinator({ ownership, registry: this.registry, instance: this.instance, scope,
        authorize: async () => { await this.authorize() }, native: (body, signal) => this.receive(body, signal) })
      await this.coordinator.start()
      this.controls = new LocalSessionControl(this.ctx, ownership, this.coordinator, this.instance, this.accountId)
    })().catch(error => {
      this.ctx.logger.warn('本机会话接管启动失败：%s', error instanceof Error ? error.message : String(error))
      throw error
    })
  }

  get cloud(): LocalSessionCloud {
    if (!this.cloudValue) throw new Error('本机会话同步尚未就绪')
    return this.cloudValue
  }

  /** Browser carrier resolves a local journal before consulting cloud presence. */
  async carrier(params: Json, signal: AbortSignal): Promise<unknown | undefined> {
    await this.start(); await this.authorize()
    const body = nativeRecord(params.body), payload = body.payload as Json | undefined
    const args = payload?.args as Json | undefined
    const streamRef = String(body.streamRef ?? '')
    for (const [key, lease] of this.carriers) if (Date.now() - lease.touched > 45_000) this.carriers.delete(key)
    const previous = this.carriers.get(streamRef)
    const id = previous?.sessionId ?? (args ? localCommandSession(args) : undefined) ?? params.sessionRef
    if (typeof id !== 'string' || this.ownership!.address(id) !== params.runtimeRef) return undefined
    const owner = this.ownership!.read(id)
    if (previous && (owner?.owner !== previous.owner || owner.epoch !== previous.epoch)) {
      this.carriers.delete(streamRef)
      throw new DshRemoteError('REMOTE_NOT_FOUND', '会话已经接管，请重新订阅', true)
    }
    if (body.mode === 'pull' && owner) {
      if (!previous && this.carriers.size >= 64) throw new Error('会话订阅数量超限')
      this.carriers.set(streamRef, { sessionId: id, owner: owner.owner, epoch: owner.epoch, touched: Date.now() })
    }
    if (body.mode === 'close') this.carriers.delete(streamRef)
    const prompt = body.endpoint === 'session/prompt' && (args?.request as Json | undefined)?.mode === 'queue'
    const coldPage = body.endpoint === 'session/page' && body.mode === 'call'
    let result: unknown
    let forwarded = false
    if (!prompt && !coldPage && owner && owner.owner !== this.instance) {
      try {
        result = await this.coordinator!.requestPeer(owner.owner, { sessionId: id, epoch: owner.epoch, native: body }, signal)
        forwarded = true
      } catch (error) {
        if (body.endpoint !== 'session/follow' || !unavailablePeer(error)) throw error
        await this.acquire(id, signal)
        this.carriers.delete(streamRef)
      }
    }
    if (!forwarded) {
      result = await this.native.request(body, {
        accountId: this.accountId!, createSessionId: randomUUID(), signal,
        claim: async () => { throw new Error('新会话应在发起实例创建') },
        owned: async ids => new Set(ids.filter(value => this.ownership!.address(value) !== undefined)),
      })
    }
    return { ...nativeRecord(result), sourceWritable: true }
  }

  hasSession(runtimeRef: string, sessionRef: string): boolean {
    return this.ownership?.address(sessionRef) === runtimeRef
  }

  get commandLedgerDirectory(): string { return join(this.config.root, 'remote-commands') }
  canonicalRuntime(sessionRef: string): string | undefined { return this.ownership?.address(sessionRef) }

  /** Undefined is another computer, zero is handoff, negative is an active peer. */
  channelEpoch(runtimeRef: string, sessionRef: string): number | undefined {
    if (!this.hasSession(runtimeRef, sessionRef)) return undefined
    const owner = this.ownership!.read(sessionRef)
    return owner?.phase === 'active' ? owner.owner === this.instance ? owner.epoch : -owner.epoch : 0
  }

  /** A remote opening may restore an exited local writer, never take a live one. */
  async recoverChannel(runtimeRef: string, sessionRef: string, body: Json, signal: AbortSignal): Promise<void> {
    await this.start(); await this.authorize()
    signal.throwIfAborted()
    if (!this.hasSession(runtimeRef, sessionRef)) return
    const history = body.operation === 'session.history' && body.session_ref === sessionRef
    const follow = body.mode === 'pull' && body.endpoint === 'session/follow'
      && localCommandSession(nativeRecord(nativeRecord(body.payload).args)) === sessionRef
    if (!history && !follow) return
    const owner = this.ownership!.read(sessionRef)
    if (!owner || owner.owner === this.instance || owner.phase !== 'active') return
    if (this.ownership!.peer(owner.owner)) {
      try {
        // A fresh, nonexistent stream close authenticates the existing peer
        // without opening history, releasing its writer, or issuing a command.
        await this.coordinator!.requestPeer(owner.owner, { sessionId: sessionRef, epoch: owner.epoch,
          native: { mode: 'close', streamRef: randomUUID() } }, signal)
        return
      } catch (error) {
        if (!(error instanceof DshRemoteError) || error.code !== 'RUNTIME_OFFLINE') throw error
      }
    }
    signal.throwIfAborted()
    await this.acquire(sessionRef, signal, owner)
  }

  async channelRequest(runtimeRef: string, sessionRef: string, body: Json, signal: AbortSignal): Promise<unknown> {
    await this.start(); await this.authorize()
    const epoch = this.channelEpoch(runtimeRef, sessionRef)
    if (epoch === undefined || epoch <= 0) throw new DshRemoteError('SESSION_STATE_CHANGED', '会话执行权已改变', true)
    const args = nativeRecord(nativeRecord(body.payload ?? {}).args ?? {})
    const id = localCommandSession(args)
    if (id !== undefined ? id !== sessionRef : !['$events', '$events/result', 'session/control'].includes(String(body.endpoint)) && body.mode !== 'close' && body.endpoint !== undefined) {
      throw new DshRemoteError('REMOTE_REQUEST_INVALID', '操作不属于指定会话')
    }
    return this.receive({ sessionId: sessionRef, epoch, native: body }, signal)
  }

  private acquire(id: string, signal: AbortSignal, exitedOwner?: LocalSessionOwner): Promise<unknown> {
    return this.coordinator!.acquire(SessionId(id), async () => {
      const result = await (this.ctx.get('sessionController') as SessionController).resolveAgent(SessionId(id))
      if ('error' in result) throw new Error('无法恢复原会话，请检查工作目录、模型和预设')
      // Publish at activation, not after the next background history upload.
      // Local execution stays available offline; existing outboxes retry it.
      void this.cloud.publishExecution(id, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]))
        .catch(error => this.ctx.logger.warn('接管执行者同步未完成，将由后台同步恢复：%s', error instanceof Error ? error.message : String(error)))
    }, signal, exitedOwner)
  }

  private async receive(body: Json, signal: AbortSignal): Promise<unknown> {
    await this.authorize()
    const scoped = AbortSignal.any([signal, this.lifetime.signal])
    if (body.observation === true) {
      if (!this.controls) throw new Error('本机状态同步尚未就绪')
      return this.controls.request(nativeRecord(body.native), scoped)
    }
    if (body.sessionId !== undefined) {
      const owner = this.ownership!.read(String(body.sessionId))
      if (!owner || owner.owner !== this.instance || owner.epoch !== body.epoch || owner.phase !== 'active') throw new Error('会话执行权已改变')
    }
    return this.incoming.run(body.sessionId === undefined ? {} : { sessionId: String(body.sessionId) }, () => this.native.request(nativeRecord(body.native), {
      accountId: this.accountId!, createSessionId: randomUUID(), signal: scoped,
      claim: async () => { throw new Error('新会话应在发起实例创建') },
      owned: async ids => new Set(ids.filter(id => {
        const owner = this.ownership!.read(id)
        return owner?.owner === this.instance && owner.phase === 'active'
      })),
    }))
  }

  async invoke(request: InvokeRemoteRequest, next: () => Promise<unknown>): Promise<unknown> {
    const id = localCommandSession(request.args)
    if (!id && request.namespace === 'session' && request.method === 'list' && !this.incoming.getStore()) {
      await this.ctx.arkmeData.accountScope.start()
      await this.start(); await this.authorize()
      return this.controls!.projectList(await next())
    }
    if (!id) {
      if (request.namespace === 'session' && request.method === 'create') { await this.start(); await this.authorize() }
      return next()
    }
    await this.start(); await this.authorize()
    // The public page API is a read-only journal operation; a departed peer
    // must not make existing history unreadable before the next prompt.
    if (request.namespace === 'session' && request.method === 'page') return next()
    const signal = AbortSignal.any([this.lifetime.signal, ...(request.signal ? [request.signal] : []), AbortSignal.timeout(30_000)])
    const prompt = request.namespace === 'session' && request.method === 'prompt'
      && (request.args.request as Json)?.mode === 'queue'
    if (prompt && !this.incoming.getStore()) {
      try { await this.acquire(id, signal) }
      catch (error) {
        // A busy owner keeps its tools and inbox. Admit the prompt there now;
        // the next idle send can perform the handoff without delaying this queue.
        if (!(error instanceof HandoffDenied)) throw error
      }
    }

    const owner = this.ownership!.read(id)
    if (owner && owner.owner !== this.instance) {
      if (this.incoming.getStore()) throw new Error('会话执行权已改变')
      const result = nativeRecord(await this.coordinator!.requestPeer(owner.owner, {
        sessionId: id, epoch: owner.epoch,
        native: { mode: 'call', endpoint: `${request.namespace}/${request.method}`, payload: { args: request.args } },
      }, signal))
      if (result.ok !== true) throw new Error(String(nativeRecord(result.error).message ?? '会话命令失败'))
      return result.value
    }
    return this.registry.command(SessionId(id), next)
  }

  async stream(request: InvokeRemoteRequest, next: (request?: InvokeRemoteRequest) => Promise<AsyncIterable<unknown>>): Promise<AsyncIterable<unknown>> {
    const incoming = this.incoming.getStore()
    const control = request.namespace === 'session' && request.method === 'control'
    // Native control has no session argument. A directed peer read still belongs
    // to the fenced session from receive(), including while its pull is pending.
    const id = localCommandSession(request.args) ?? (control ? incoming?.sessionId : undefined)
    if (!id && control && !incoming) {
      await this.ctx.arkmeData.accountScope.start()
      await this.start(); await this.authorize()
      const signal = AbortSignal.any([this.lifetime.signal, ...(request.signal ? [request.signal] : [])])
      return this.controls!.stream(scoped => next({ ...request, signal: scoped }), signal)
    }
    if (!id) return next()
    await this.start(); await this.authorize()
    const runtime = this, store = this.ownership!, coordinator = this.coordinator!
    const follow = request.namespace === 'session' && request.method === 'follow'
    return (async function* () {
      let delivered = false
      do {
        const owner = store.read(id)
        const changed = () => {
          const current = store.read(id)
          return owner !== undefined && (current?.owner !== owner.owner || current.epoch !== owner.epoch || current.phase !== owner.phase)
        }
        const controller = new AbortController()
        const signal = AbortSignal.any([runtime.lifetime.signal, controller.signal, ...(request.signal ? [request.signal] : [])])
        const timer = follow || control ? setInterval(() => { if (changed()) controller.abort() }, 250) : undefined
        timer?.unref()
        const streamRef = randomUUID()
        const remote = owner && owner.owner !== runtime.instance
        try {
          if (!remote) {
            for await (const item of await next({ ...request, signal })) {
              delivered = true
              yield item
            }
          } else {
            while (!signal.aborted) {
              const result = nativeRecord(await coordinator.requestPeer(owner.owner, {
                sessionId: id, epoch: owner.epoch,
                native: { mode: 'pull', streamRef, endpoint: `${request.namespace}/${request.method}`, payload: { args: request.args } },
              }, signal))
              if (!Array.isArray(result.items)) throw new Error('会话订阅响应无效')
              for (const item of result.items) { delivered = true; yield item }
              if (result.done === true) break
            }
          }
        } catch (error) {
          if (request.signal?.aborted || runtime.lifetime.signal.aborted) throw error
          if (remote && (follow || control) && !signal.aborted
            && error instanceof DOMException && error.name === 'TimeoutError') {
            // The bounded IPC read expired, not the writer lease. Accepted
            // observers reopen via DSH; an opening read waits for its baseline.
            if (delivered) return
            await delay(250, undefined, { signal })
            continue
          }
          if (!follow && !(control && controller.signal.aborted && changed())) throw error
          if (!changed()) {
            if (remote && error instanceof DshRemoteError && error.code === 'REMOTE_NOT_FOUND' && error.retryable) {
              // A release can reject IPC before the next epoch is committed.
              // End accepted follows normally; an opening follow waits for the handoff.
              if (!delivered) await delay(50, undefined, { signal })
            } else {
              if (!remote || !unavailablePeer(error)) throw error
              // Recover only after the official writer lock permits activation.
              await runtime.acquire(id, signal)
            }
          }
        } finally {
          clearInterval(timer)
          controller.abort()
          if (remote) await coordinator.requestPeer(owner.owner, {
            sessionId: id, epoch: owner.epoch, native: { mode: 'close', streamRef },
          }, AbortSignal.timeout(1000)).catch(() => undefined)
        }
        // Native journal/control consumers reopen a completed carrier with its
        // full snapshot/baseline. Never splice two openings into one stream.
        if (delivered || !follow) return
      } while (!request.signal?.aborted && !runtime.lifetime.signal.aborted)
    })()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { arkmeLocalSessions: LocalSessionRuntime }
}
