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
import { DshNativeTransport, nativeRecord, nativeRequestIsRead } from './dsh-remote/native-transport.js'
import type { DshConnectionLike, DshGatewayLike } from './dsh-remote/gateway-api.js'
import { DshRemoteError } from './dsh-remote/errors.js'
import { LocalHistoryCloudRepair, type HistorySyncStatus, type HistorySyncEvent } from './local-history-cloud-repair.js'
import { nativeAnnotationProjection } from './dsh-remote/annotation-projection.js'
import { snapshotDshHistoryEntry } from './dsh-remote/dsh-event-contract.js'
import type { NativeAnnotationTarget } from './native-annotations.js'

import { LocalSessionIdentity } from './local-session-identity.js'

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
  private repair: LocalHistoryCloudRepair | undefined
  private readonly historyListeners = new Set<(event: HistorySyncEvent) => void>()
  private readonly historyStates = new Map<string, HistorySyncEvent>()
  private historyRevision = 0
  private accountId: string | undefined
  private readonly carriers = new Map<string, { sessionId: string; owner: string; epoch: number; touched: number; local?: boolean }>()
  private readonly native: DshNativeTransport
  private readonly peer: ReturnType<Context['connection']['createPeer']>
  readonly identities: LocalSessionIdentity
  private readonly registry: LocalSessionRegistry

  constructor(private readonly ctx: Context, private readonly config: Config) {
    this.identities = new LocalSessionIdentity({ post: (path, body, signal) => ctx.arkmeData.dshRemotePost<Json>(path, body, signal) })
    this.registry = ctx.agents as LocalSessionRegistry
    this.peer = ctx.connection.createPeer({ principal: { kind: 'owner' } })
    this.native = new DshNativeTransport(ctx.get('typertGateway') as DshGatewayLike, ctx.connection, this.peer)
    ctx.provide('arkmeLocalSessions', this)
    ctx.effect(() => async () => {
      this.lifetime.abort(); this.historyListeners.clear(); this.historyStates.clear(); this.identities.close(); this.native.close(); this.cloudValue?.close()
      await this.starting?.catch(() => undefined)
      await this.repair?.close()
      await this.controls?.close()
      await this.coordinator?.close()
      this.ownership?.close()
      await this.peer.dispose()
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
      const history = this.ctx.get('arkmeLocalHistory')
      if (history) await history.discovery.register(history.home, this.lifetime.signal)
      const scope = { accountId: this.accountId, environment: this.config.environment }
      const ownership = this.ownership = new LocalSessionOwnership(this.config.root, scope)
      this.cloudValue = new LocalSessionCloud({ ownership, instance: this.instance, accountId: this.accountId,
        recoveredLocalSource: id => this.discoveredHistory(id) && this.registry.get(SessionId(id)) !== undefined,
        request: { post: (path, body, signal) => this.ctx.arkmeData.dshRemotePost<Json>(path, body, signal) } })
      this.coordinator = new LocalSessionCoordinator({ ownership, registry: this.registry, instance: this.instance, scope,
        authorize: async () => { await this.authorize() }, native: (body, signal) => this.receive(body, signal) })
      await this.coordinator.start()
      if (history) void history.discovery.prepare(this.lifetime.signal).catch((error: unknown) => {
        if (!this.lifetime.signal.aborted) this.ctx.logger.warn('本机实例目录准备失败：%s', String(error))
      })
      this.controls = new LocalSessionControl(this.ctx, ownership, this.coordinator, this.instance, this.accountId, this.peer)
    })().catch(error => {
      this.ctx.logger.warn('本机会话接管启动失败：%s', error instanceof Error ? error.message : String(error))
      throw error
    })
  }

  get cloud(): LocalSessionCloud {
    if (!this.cloudValue) throw new Error('本机会话同步尚未就绪')
    return this.cloudValue
  }

  /** Enabled by the existing remote-sync policy, independent of writer ownership. */
  async enableHistoryRepair(): Promise<void> {
    await this.start(); await this.authorize()
    if (this.repair?.stopped) await this.suspendHistoryRepair()
    const persistence = this.ctx.get('arkmeLocalHistory')
    if (!persistence || this.repair) return
    this.repair = new LocalHistoryCloudRepair({
      root: join(persistence.home, 'arkme-self', 'history-repair'), scope: JSON.stringify([this.config.environment, this.accountId]), persistence,
      formats: (session, expected, signal) => persistence.formats(SessionId(session), expected, signal),
      authorize: async () => { await this.authorize() }, host: () => this.cloud.repairHost(),
      discover: async (runtime, session, signal) => await this.discover(runtime, session, signal) && persistence.isDiscovered(SessionId(session)),
      post: (path, body, signal) => this.ctx.arkmeData.dshRemotePost<Json>(path, body, signal),
      report: error => this.ctx.logger.warn('本机历史补传：%s', error instanceof Error ? error.message : String(error)),
      changed: (runtimeRef, sessionRef, status) => {
        const key = JSON.stringify([runtimeRef, sessionRef]), previous = this.historyStates.get(key)
        if (JSON.stringify(previous?.status) === JSON.stringify(status)) return
        if (!previous && this.historyStates.size >= 256) this.historyStates.delete(this.historyStates.keys().next().value!)
        const event = { runtimeRef, sessionRef, status, revision: ++this.historyRevision }
        this.historyStates.set(key, event)
        for (const notify of this.historyListeners) notify(event)
      },
    })
  }

  async observeHistorySync(notify: (event: HistorySyncEvent) => void, signal: AbortSignal): Promise<void> {
    await this.authorize(); signal.throwIfAborted()
    if (this.historyListeners.size >= 64) throw new Error('历史状态订阅数量超限')
    const stop = () => this.historyListeners.delete(notify)
    this.historyListeners.add(notify)
    signal.addEventListener('abort', stop, { once: true })
    for (const event of this.historyStates.values()) notify(event)
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    signal.removeEventListener('abort', stop)
  }

  cancelHistoryRepair(): void { this.repair?.cancel() }
  async suspendHistoryRepair(): Promise<void> {
    const repair = this.repair
    this.repair = undefined
    await repair?.close()
  }

  async captureHistory(session: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted(); await this.authorize()
    const runtime = this.ownership?.address(session)
    if (!runtime || !this.discoveredHistory(session) || !this.repair) return false
    const store = this.ctx.get('sessions'), live = store?.get(SessionId(session))
    if (live) await store!.flush(live)
    signal.throwIfAborted(); await this.authorize()
    await this.repair.enqueue(runtime, session)
    return true
  }

  historySync(runtime: string, session: string): HistorySyncStatus | undefined {
    return this.repair?.status(this.identities?.known(runtime, session)?.runtimeRef ?? runtime, session)
  }

  private discoveredHistory(session: string): boolean {
    return this.ctx?.get('arkmeLocalHistory')?.isDiscovered?.(SessionId(session)) === true
  }

  async annotationHistorySync(runtime: string, session: string, signal: AbortSignal): Promise<HistorySyncStatus | undefined> {
    if (!await this.discover(runtime, session, signal) || !this.ctx.get('arkmeLocalHistory')?.isDiscovered(SessionId(session))) return
    await this.repair?.enqueue(this.canonicalRuntime(session) ?? runtime, session)
    return this.historySync(runtime, session) ?? { state: 'unsupported', nextSeq: 0, throughSeq: -1 }
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
    if (typeof id !== 'string' || typeof params.runtimeRef !== 'string') return undefined
    await this.discover(params.runtimeRef, id, signal)
    if (!this.hasSession(params.runtimeRef, id)) return undefined
    const owner = this.ownership!.read(id)
    if (previous && !previous.local && body.mode !== 'close' && (owner?.owner !== previous.owner || owner.epoch !== previous.epoch)) {
      this.carriers.delete(streamRef)
      void this.coordinator!.requestPeer(previous.owner, { sessionId: id, epoch: previous.epoch, native: { mode: 'close', streamRef } }, AbortSignal.timeout(1000)).catch(() => undefined)
      throw new DshRemoteError('REMOTE_NOT_FOUND', '会话已经接管，请重新订阅', true)
    }
    if (body.mode === 'pull' && owner) {
      if (!previous && this.carriers.size >= 64) throw new Error('会话订阅数量超限')
      if (previous) previous.touched = Date.now()
      else this.carriers.set(streamRef, { sessionId: id, owner: owner.owner, epoch: owner.epoch, touched: Date.now() })
    }
    if (body.mode === 'close') this.carriers.delete(streamRef)
    const prompt = body.endpoint === 'session/prompt' && (args?.request as Json | undefined)?.mode === 'queue'
    const coldPage = body.endpoint === 'session/page' && body.mode === 'call'
    // The account-history adapter has no browser snapshot cursor. Supply the
    // current durable cut using the public store, while native callers retain
    // their explicit cut and official message-aligned paging semantics.
    if (coldPage && args && nativeRecord(args.request).throughSeq === undefined) {
      const handle = await this.ctx.get('sessionPersistence')!.open(SessionId(id), 'read', { signal })
      try {
        const { events } = await handle.read(0, undefined, { signal })
        args.request = { ...nativeRecord(args.request), throughSeq: events.at(-1)?.seq ?? -1 }
      } finally { await handle.close() }
    }
    let result: unknown
    let forwarded = false
    const targetOwner = body.mode === 'close' && previous ? previous : owner
    if (!previous?.local && !prompt && !coldPage && targetOwner && targetOwner.owner !== this.instance) {
      try {
        result = await this.coordinator!.requestPeer(targetOwner.owner, { sessionId: id, epoch: targetOwner.epoch, native: body }, signal)
        forwarded = true
      } catch (error) {
        this.carriers.delete(streamRef)
        if (body.endpoint !== 'session/follow' || !unavailablePeer(error)) throw error
        if (!this.discoveredHistory(id)) await this.acquire(id, signal)
        this.carriers.delete(streamRef)
      }
    }
    if (!forwarded) {
      if (prompt) {
        try { await this.acquire(id, signal) } catch (error) { if (!(error instanceof HandoffDenied)) throw error }
      }
      result = await this.native.request(body, {
        accountId: this.accountId!, createSessionId: randomUUID(), signal,
        claim: async () => { throw new Error('新会话应在发起实例创建') },
        owned: async ids => new Set(ids.filter(value => this.ownership!.address(value) !== undefined)),
      }).catch(error => { this.carriers.delete(streamRef); throw error })
      // Continuation and close must stay on the source that actually opened the lease.
      if (body.mode === 'pull' && nativeRecord(result).done !== true) this.carriers.set(streamRef, {
        sessionId: id, owner: owner?.owner ?? this.instance, epoch: owner?.epoch ?? 0, touched: Date.now(), local: true,
      })
    }
    if (body.mode === 'pull' && nativeRecord(result).done === true) this.carriers.delete(streamRef)
    const historySync = this.historySync(params.runtimeRef, id)
    return { ...nativeRecord(result), sourceWritable: true, localAccess: this.sessionAccess(params.runtimeRef, id), ...(historySync ? { historySync } : {}) }
  }

  hasSession(runtimeRef: string, sessionRef: string): boolean {
    return this.ownership?.address(sessionRef) === (this.identities?.known(runtimeRef, sessionRef)?.runtimeRef ?? runtimeRef)
  }

  sessionAccess(runtimeRef: string, sessionRef: string) {
    if (!this.hasSession(runtimeRef, sessionRef)) return
    const owner = this.ownership!.read(sessionRef)
    const execution = owner?.phase !== 'active' ? owner ? 'transferring' : 'unclaimed'
      : owner.owner === this.instance ? 'current' : 'peer'
    return { runtimeRef: this.canonicalRuntime(sessionRef)!, sessionRef, readHistory: true as const, annotate: true as const, execution,
      submit: execution === 'current' ? 'direct' : execution === 'peer' ? 'route-or-handoff' : 'handoff' } as const
  }

  /** Same Host path for UI, account-session Tools and the public SDK. */
  async discover(runtimeRef: string, sessionRef: string, signal: AbortSignal): Promise<boolean> {
    await this.start(); await this.authorize()
    const persistence = this.ctx.get('arkmeLocalHistory')
    let identity = this.identities?.known(runtimeRef, sessionRef)
    const address = this.ownership!.address(sessionRef)
    if (!identity && this.identities && address !== runtimeRef) identity = await this.identities.resolve(runtimeRef, sessionRef, signal)
    if (persistence && (!await persistence.stat(SessionId(sessionRef), { signal }) || identity && address !== identity.runtimeRef)) {
      let found = await persistence.discover({ accountId: this.accountId!, environment: this.config.environment,
        ...identity ?? { runtimeRef, sessionRef } }, signal, address === runtimeRef)
      if (!found && this.identities) {
        identity = await this.identities.resolve(runtimeRef, sessionRef, signal)
        if (identity.previousRuntimeRefs.length) found = await persistence.discover({ accountId: this.accountId!, environment: this.config.environment, ...identity }, signal)
      }
      await this.authorize(); signal.throwIfAborted()
      if (found) {
        const canonical = identity?.runtimeRef ?? runtimeRef
        if (identity) this.ownership!.canonicalizeAddress(sessionRef, canonical, identity.previousRuntimeRefs)
        else if (this.ownership!.bindAddress(sessionRef, canonical) !== canonical) throw new Error('本机会话云端地址冲突')
      }
    }
    const found = this.hasSession(runtimeRef, sessionRef)
    if (found && persistence?.isDiscovered(SessionId(sessionRef))) void this.repair?.enqueue(this.ownership!.address(sessionRef)!, sessionRef).catch(error => this.ctx.logger.warn('本机历史补传排队失败：%s', String(error)))
    return found
  }

  get commandLedgerDirectory(): string { return join(this.config.root, 'remote-commands') }
  canonicalRuntime(sessionRef: string): string | undefined { return this.ownership?.address(sessionRef) }

  /** Canonical identity is account scoped; knowing a source never grants execution. */
  async resolveAnnotationTarget(target: NativeAnnotationTarget, signal: AbortSignal): Promise<NativeAnnotationTarget> {
    await this.start(); await this.authorize(); signal.throwIfAborted()
    const identity = target.runtimeRef ? this.identities?.known(target.runtimeRef, target.sessionRef) : undefined
    const canonical = identity?.runtimeRef ?? this.canonicalRuntime(target.sessionRef)
    if (target.runtimeRef && canonical && canonical !== target.runtimeRef && this.identities?.known(target.runtimeRef, target.sessionRef)?.runtimeRef !== canonical) throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT', '会话来源不一致')
    const runtime = canonical ?? target.runtimeRef
    if (!runtime) throw new DshRemoteError('REMOTE_NOT_FOUND', '当前账号没有该来源会话')
    const coordinates = this.discoveredHistory(target.sessionRef) ? await this.repair?.annotationCoordinates(runtime, target.sessionRef, target.eventSeq, signal) : undefined
    return { ...target, runtimeRef: runtime, ...(coordinates?.formatVersion ? { formatVersion: coordinates.formatVersion } : {}) }
  }

  private async annotationMessageRef(target: NativeAnnotationTarget, signal: AbortSignal): Promise<string> {
    const coordinates = await this.repair!.annotationCoordinates(target.runtimeRef!, target.sessionRef, target.eventSeq, signal)
    const identity = coordinates.sourceSeq === undefined
      ? [this.accountId, target.runtimeRef, target.sessionRef, 4, target.eventSeq, target.role]
      : [this.accountId, target.runtimeRef, target.sessionRef, coordinates.sourceSeq, target.role]
    // Backend account identity is numeric, matching the existing annotation contract.
    identity[0] = Number(this.accountId)
    return `dsha_${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`
  }

  async annotationSource(target: NativeAnnotationTarget, signal: AbortSignal) {
    const resolved = await this.resolveAnnotationTarget(target, signal)
    if (!await this.discover(resolved.runtimeRef!, resolved.sessionRef, signal)) return
    const handle = await this.ctx.get('sessionPersistence')!.open(SessionId(resolved.sessionRef), 'read', { signal })
    try {
      const { events } = await handle.read(resolved.eventSeq, 1, { signal })
      const event = events[0]
      if (!event || event.seq !== resolved.eventSeq) throw new DshRemoteError('REMOTE_NOT_FOUND', '来源消息不存在')
      const entry = snapshotDshHistoryEntry({ event }), projection = nativeAnnotationProjection(entry)
      if (!projection || projection.role !== resolved.role) throw new DshRemoteError('CAPABILITY_UNSUPPORTED', '这条消息暂不支持云标记')
      await this.authorize(); signal.throwIfAborted()
      return { runtimeRef: resolved.runtimeRef!, hostGeneration: this.cloud.repairHost()?.generation ?? 0,
        entry, canonical: projection.canonical, writable: !resolved.formatVersion && this.cloud.ownsSession(resolved.sessionRef),
        ...(resolved.formatVersion ? { messageRef: await this.annotationMessageRef(resolved, signal) } : {}) }
    } finally { await handle.close() }
  }

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
    const history = ['session.history', 'session.model.get'].includes(String(body.operation)) && body.session_ref === sessionRef
    const typedQueuedPrompt = body.operation === 'session.prompt' && body.session_ref === sessionRef && body.mode === 'queue'
    const args = nativeRecord(nativeRecord(body.payload ?? {}).args ?? {})
    const follow = body.mode === 'pull' && body.endpoint === 'session/follow'
    const queuedPrompt = body.mode === 'call' && body.endpoint === 'session/prompt' && nativeRecord(args.request).mode === 'queue'
    const read = body.operation === undefined && body.mode !== undefined && nativeRequestIsRead(body)
    if (!history && !typedQueuedPrompt && !((follow || queuedPrompt || read) && (localCommandSession(args) ?? sessionRef) === sessionRef)) return
    // A retained canonical address does not mount its journal after a restart.
    if (!await this.discover(runtimeRef, sessionRef, signal)) return
    if (history || follow || read) return
    const owner = this.ownership!.read(sessionRef)
    if (!owner) {
      if (typedQueuedPrompt || queuedPrompt) await this.acquire(sessionRef, signal)
      return
    }
    if (owner.owner === this.instance || owner.phase !== 'active') return
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
    if (this.hasSession(runtimeRef, sessionRef) && nativeRequestIsRead(body)) {
      return this.carrier({ runtimeRef, sessionRef, body }, signal)
    }
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
      if ('error' in result) throw result.error
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
    if (body.sessionId !== undefined && nativeRecord(body.native).mode !== 'close') {
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
    if (request.namespace === 'session' && request.method === 'create') {
      await this.start(); await this.authorize()
      // A named blank is a reuse candidate, not a command to its old writer.
      // Native create owns workspace/preset checks and may mint a different id.
      return next()
    }
    const id = localCommandSession(request.args)
    if (!id && request.namespace === 'session' && request.method === 'list' && !this.incoming.getStore()) {
      await this.ctx.arkmeData.accountScope.start()
      await this.start(); await this.authorize()
      return this.controls!.projectList(await next())
    }
    if (!id) return next()
    await this.start(); await this.authorize()
    const origin = this.ownership!.address(id)
    if (origin) await this.discover(origin, id, request.signal ?? this.lifetime.signal)
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
    const origin = this.ownership!.address(id)
    if (origin) await this.discover(origin, id, request.signal ?? this.lifetime.signal)
    const runtime = this, store = this.ownership!, coordinator = this.coordinator!
    const follow = request.namespace === 'session' && request.method === 'follow'
    return (async function* () {
      let delivered = false
      let localHistory = false
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
        const remote = !localHistory && owner && owner.owner !== runtime.instance
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
              if (runtime.discoveredHistory(id)) localHistory = true
              else await runtime.acquire(id, signal)
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
