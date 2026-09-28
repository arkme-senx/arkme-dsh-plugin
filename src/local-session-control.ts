import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DshNativeTransport, nativeRecord } from './dsh-remote/native-transport.js'
import type { LocalSessionOwnership } from './local-session-ownership.js'
import type { LocalSessionCoordinator } from './local-session-coordinator.js'

type Frame = Record<string, any>

/** A bounded, cancellable fan-in. Overflow disconnects so a fresh baseline can recover. */
export async function* controlFrames(signal: AbortSignal, attach: (push: (frame: Frame) => void, fail: (error: unknown) => void) => () => void): AsyncGenerator<Frame> {
  const queue: { frame: Frame; bytes: number }[] = []
  let bytes = 0, error: unknown, wake: (() => void) | undefined
  const notify = () => { wake?.(); wake = undefined }
  const fail = (cause: unknown) => { error ??= cause; notify() }
  const dispose = attach(frame => {
    if (signal.aborted || error) return
    const size = Buffer.byteLength(JSON.stringify(frame))
    if (queue.length >= 256 || bytes + size > 8 * 1024 * 1024) { fail(new Error('本机状态订阅积压超限，请重新连接')); return }
    queue.push({ frame, bytes: size }); bytes += size; notify()
  }, fail)
  signal.addEventListener('abort', notify, { once: true })
  try {
    while (!signal.aborted) {
      if (error) throw error
      const item = queue.shift()
      if (item) { bytes -= item.bytes; yield item.frame }
      else await new Promise<void>(resolve => { wake = resolve })
    }
  } finally { dispose(); signal.removeEventListener('abort', notify) }
}

/** One Host-owned control relay for all windows; DSH remains the projection owner. */
export class LocalSessionControl {
  private readonly transport: DshNativeTransport
  private readonly peers = new Map<string, { signature: string; controller: AbortController; task: Promise<void> }>()
  private readonly cached = new Map<string, { epoch: number; frames: Map<string, Frame> }>()
  private readonly subscribers = new Map<(frame: Frame) => void, (error: unknown) => void>()
  private failure: unknown
  private cacheBytes = 0
  private readonly lifetime = new AbortController()
  private readonly task: Promise<void>

  constructor(private readonly ctx: Context, private readonly store: LocalSessionOwnership,
    private readonly coordinator: LocalSessionCoordinator, private readonly instance: string,
    private readonly accountId: string) {
    this.transport = new DshNativeTransport({ wireStream: { open: (_endpoint: string, _payload: unknown, signal: AbortSignal) => Promise.resolve(this.local(signal)) } }, { createSharedFetchHandler: () => { throw new Error('状态订阅不支持命令') } })
    this.task = this.watch().catch(error => {
      if (this.lifetime.signal.aborted) return
      this.failure = error
      for (const fail of this.subscribers.values()) fail(error)
      ctx.logger.warn('本机状态同步失败：%s', String(error))
    })
  }

  async close(): Promise<void> {
    this.lifetime.abort(); this.transport.close()
    for (const peer of this.peers.values()) peer.controller.abort()
    await this.task
    await Promise.allSettled([...this.peers.values()].map(peer => peer.task))
    this.cached.clear(); this.subscribers.clear()
  }

  request(body: Frame, signal: AbortSignal): Promise<unknown> {
    if (body.mode !== 'close' && (body.mode !== 'pull' || body.endpoint !== 'session/control')) throw new Error('本机状态订阅无效')
    return this.transport.request(body, { accountId: this.accountId, createSessionId: '', signal,
      claim: async () => { throw new Error('状态订阅不能创建会话') },
      owned: async ids => new Set(ids.filter(id => this.store.read(id)?.owner === this.instance)),
    })
  }

  /** A reconnected window must not replace a peer's running bit with local idle. */
  projectList(value: unknown): unknown {
    const list = nativeRecord(value)
    if (!Array.isArray(list.items)) return value
    return { ...list, items: list.items.map(item => {
      const row = nativeRecord(item)
      if (typeof row.sessionId !== 'string') return item
      const owner = this.store.read(row.sessionId), cached = this.cached.get(row.sessionId)
      if (!owner || owner.owner === this.instance || !cached || !this.owns(row.sessionId, owner.owner, cached.epoch)) return item
      const status = cached.frames.get('status')
      return typeof status?.running === 'boolean' ? { ...row, running: status.running } : item
    }) }
  }

  private owns(id: string, instance = this.instance, epoch?: number): boolean {
    const owner = this.store.read(id)
    return owner?.owner === instance && owner.phase === 'active' && (epoch === undefined || owner.epoch === epoch)
  }

  private async *local(signal: AbortSignal): AsyncGenerator<Frame> {
    const controller = new AbortController(), scoped = AbortSignal.any([signal, controller.signal, this.lifetime.signal])
    const source = (this.ctx.get('sessionController') as SessionController).control(scoped)
    const stream = controlFrames(scoped, (push, fail) => {
      const publish = (frame: Frame) => {
        const owner = this.store.read(frame.sessionId)
        if (owner?.owner === this.instance && owner.phase === 'active') push({ ...frame, epoch: owner.epoch })
      }
      const off = [
        this.ctx.on('api-session/status', (id, running) => publish({ type: 'status', sessionId: id, running }), { global: true }),
        this.ctx.on('api-session/activity', (id, updatedAt) => publish({ type: 'activity', sessionId: id, updatedAt }), { global: true }),
        this.ctx.on('api-session/added', summary => publish({ type: 'added', sessionId: summary.sessionId, summary }), { global: true }),
      ]
      void (async () => {
        for await (const value of source) {
          const frame = value as unknown as Frame
          if (frame.type !== 'baseline') { publish(frame); continue }
          const epochs: Record<string, number> = {}, running: Record<string, boolean> = {}
          for (const agent of this.ctx.agents.list()) if (this.owns(agent.id)) {
            running[agent.id] = agent.status === 'running'; epochs[agent.id] = this.store.read(agent.id)!.epoch
          }
          for (const id of Object.keys(frame.value.projections)) if (this.owns(id)) epochs[id] = this.store.read(id)!.epoch
          push({ ...frame, epochs, value: { ...frame.value, running } })
        }
        if (!scoped.aborted) fail(new Error('本机原生状态流已结束，请重新连接'))
      })().catch(fail)
      return () => { controller.abort(); for (const dispose of off) dispose() }
    })
    yield* stream
  }

  /** Native control still supplies the opening baseline and local updates. */
  async *stream(open: (signal: AbortSignal) => Promise<AsyncIterable<unknown>>, signal: AbortSignal): AsyncGenerator<Frame> {
    if (this.failure) throw this.failure
    if (this.subscribers.size >= 64) throw new Error('本机状态订阅数量超限')
    const controller = new AbortController(), scoped = AbortSignal.any([signal, controller.signal, this.lifetime.signal])
    let opened = false
    const frames = controlFrames(scoped, (push, fail) => {
      const accept = (frame: Frame) => {
        if (opened) push(frame)
        // The source baseline is first; cached peer state is replayed after it.
      }
      this.subscribers.set(accept, fail)
      void (async () => {
        for await (const raw of await open(scoped)) {
          const frame = raw as Frame
          if (frame.type === 'baseline') {
            const value = Object.fromEntries(Object.entries(frame.value).map(([key, entries]) => [key,
              Object.fromEntries(Object.entries(entries as object).filter(([id]) => { const owner = this.store.read(id); return !owner || owner.owner === this.instance }))]))
            push({ ...frame, value }); opened = true
            for (const [id, entry] of this.cached) {
              const owner = this.store.read(id)
              if (!owner || owner.owner === this.instance || !this.owns(id, owner.owner, entry.epoch)) continue
              for (const item of entry.frames.values()) if (['queue', 'jobs', 'projection'].includes(item.type)) {
                const { epoch: _epoch, ...native } = item; push(native)
              }
            }
          } else if (!this.store.read(frame.sessionId) || this.owns(frame.sessionId)) push(frame)
        }
        if (!scoped.aborted) fail(new Error('本机原生状态流已结束，请重新连接'))
      })().catch(fail)
      return () => { controller.abort(); this.subscribers.delete(accept) }
    })
    yield* frames
  }

  private accept(instance: string, frame: Frame): void {
    if (frame.type === 'baseline') {
      for (const [id, epoch] of Object.entries(frame.epochs ?? {})) {
        if (!this.owns(id, instance, Number(epoch))) continue
        const value = frame.value
        for (const [field, type, key] of [['queues', 'queue', 'items'], ['jobs', 'jobs', 'jobs']] as const) {
          this.accept(instance, { type, sessionId: id, epoch, [key]: value[field]?.[id] ?? [] })
        }
        const block = value.projections?.[id]
        if (block) for (const [key, value] of Object.entries(block.values)) this.accept(instance,
          { type: 'projection', sessionId: id, epoch, key, value, seq: block.asOfSeq })
        if (typeof value.running?.[id] === 'boolean') this.accept(instance, { type: 'status', sessionId: id, epoch, running: value.running[id] })
      }
      return
    }
    const id = frame.sessionId
    if (typeof id !== 'string' || !Number.isSafeInteger(frame.epoch) || !this.owns(id, instance, frame.epoch)) return
    let cached = this.cached.get(id)
    if (!cached || cached.epoch !== frame.epoch) {
      if (!cached && this.cached.size >= 1024) throw new RangeError('本机状态缓存数量超限')
      if (cached) for (const value of cached.frames.values()) this.cacheBytes -= Buffer.byteLength(JSON.stringify(value))
      this.cached.set(id, cached = { epoch: frame.epoch, frames: new Map() })
    }
    const key = frame.type === 'projection' ? `projection:${frame.key}` : frame.type
    if (cached.frames.size >= 256 && !cached.frames.has(key)) throw new RangeError('本机会话投影数量超限')
    const previous = cached.frames.get(key)
    const bytes = Buffer.byteLength(JSON.stringify(frame)) - (previous ? Buffer.byteLength(JSON.stringify(previous)) : 0)
    if (this.cacheBytes + bytes > 32 * 1024 * 1024) throw new RangeError('本机状态缓存大小超限')
    this.cacheBytes += bytes
    cached.frames.set(key, frame)
    if (frame.type === 'status') this.ctx.emit('api-session/status', SessionId(id), frame.running)
    else if (frame.type === 'activity') this.ctx.emit('api-session/activity', SessionId(id), frame.updatedAt)
    else if (frame.type === 'added') this.ctx.emit('api-session/added', frame.summary)
    else if (['projection', 'queue', 'jobs'].includes(frame.type)) {
      const { epoch: _epoch, ...native } = frame
      for (const notify of this.subscribers.keys()) notify(native)
    }
  }

  private async watch(): Promise<void> {
    const signal = this.lifetime.signal
    while (!signal.aborted) {
      try {
        const active = this.store.observationPeers().filter(peer => peer.owner !== this.instance)
        for (const [id, peer] of this.peers) if (!active.some(item => item.owner === id && item.signature === peer.signature)) {
          peer.controller.abort(); await peer.task; this.peers.delete(id)
        }
        for (const peer of active) if (!this.peers.has(peer.owner)) {
          // Bound actual observations, not historical discovery rows. Refused
          // endpoints are retired by requestPeer and free these slots next tick.
          if (this.peers.size >= 8) break
          const controller = new AbortController()
          this.peers.set(peer.owner, { signature: peer.signature, controller,
            task: this.follow(peer.owner, AbortSignal.any([signal, controller.signal])) })
        }
        for (const [id, cached] of this.cached) {
          const owner = this.store.read(id)
          if (!owner || owner.owner === this.instance || owner.epoch !== cached.epoch || !active.some(peer => peer.owner === owner.owner)) {
            for (const value of cached.frames.values()) this.cacheBytes -= Buffer.byteLength(JSON.stringify(value))
            this.cached.delete(id)
          }
        }
      } catch (error) {
        if (signal.aborted) return
        // A transient discovery read must not poison every native subscriber.
        this.ctx.logger.warn('本机状态发现重试：%s', String(error))
      }
      await delay(250, undefined, { signal })
    }
  }

  private async follow(instance: string, signal: AbortSignal): Promise<void> {
    let retry = 250
    while (!signal.aborted) {
      const streamRef = randomUUID()
      try {
        while (!signal.aborted) {
          const response = nativeRecord(await this.coordinator.requestPeer(instance, { observation: true,
            native: { mode: 'pull', streamRef, endpoint: 'session/control', payload: { args: {} } } }, signal))
          if (!Array.isArray(response.items)) throw new Error('本机状态响应无效')
          for (const item of response.items) this.accept(instance, nativeRecord(item))
          retry = 250
          if (response.done) break
        }
      } catch (error) {
        if (error instanceof RangeError) {
          this.failure = error
          for (const fail of this.subscribers.values()) fail(error)
          this.lifetime.abort()
          this.ctx.logger.warn('本机状态同步失败：%s', String(error))
          return
        }
        if (!signal.aborted && retry === 250) this.ctx.logger.warn('本机状态订阅重连：%s', String(error))
      }
      finally {
        await this.coordinator.requestPeer(instance, { observation: true, native: { mode: 'close', streamRef } }, AbortSignal.timeout(1000)).catch(() => undefined)
      }
      if (!signal.aborted) await delay(retry, undefined, { signal }).catch(() => undefined)
      retry = Math.min(retry * 2, 5000)
    }
  }
}
