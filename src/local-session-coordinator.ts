import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { DshRemoteError } from './dsh-remote/errors.js'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type LocalSessionRegistry from './local-session-registry.js'
import { LocalSessionOwnership, type LocalSessionOwner, type LocalSessionPeer } from './local-session-ownership.js'
export { LocalSessionOwnership } from './local-session-ownership.js'

/** Private same-user IPC. The OS-protected ownership database is the discovery
 * and authentication boundary; neither a desktop name nor cloud presence is.
 * This owner is opt-in until native admission and cloud aliases are connected. */
export class LocalSessionCoordinator {
  private readonly server: Server
  private peer: LocalSessionPeer | undefined
  private readonly acquiring = new Map<string, Promise<AgentHandle>>()
  private readonly lifetime = new AbortController()
  private closing: Promise<void> | undefined
  private readonly requests = new Set<Promise<void>>()
  private starting = false

  constructor(private readonly options: {
    ownership: LocalSessionOwnership
    registry: LocalSessionRegistry
    instance: string
    scope: { accountId: string; environment: 'test' | 'prod' }
    authorize: () => Promise<void>
    native?: (body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>
  }) {
    options.ownership.assertScope(options.scope)
    this.server = createServer({ maxHeaderSize: 4096, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
      if (this.requests.size >= 16 || this.closing) { response.writeHead(503).end('{}'); request.resume(); return }
      const task = (async () => {
        response.setHeader('cache-control', 'no-store')
        response.setHeader('content-type', 'application/json')
        const credential = request.headers.authorization
        const expected = this.peer ? `Bearer ${this.peer.token}` : ''
        if (request.method !== 'POST' || !['/release', '/native'].includes(request.url ?? '') || !expected
          || typeof credential !== 'string' || Buffer.byteLength(credential) !== Buffer.byteLength(expected)
          || !timingSafeEqual(Buffer.from(credential), Buffer.from(expected))) {
          response.writeHead(403).end('{}'); request.resume(); return
        }
        let body = ''
        for await (const chunk of request) {
          body += String(chunk)
          if (Buffer.byteLength(body) > (request.url === '/native' ? 5 * 1024 * 1024 : 8192)) { response.writeHead(413).end('{}'); request.destroy(); return }
        }
        const input = JSON.parse(body) as Record<string, unknown>
        const { accountId, environment } = this.options.scope
        if (request.url === '/native') {
          if (input.accountId !== accountId || input.environment !== environment || !this.options.native
            || !input.body || typeof input.body !== 'object' || Array.isArray(input.body)) throw new Error('本机调用作用域无效')
          await this.options.authorize()
          const abort = new AbortController()
          // A successful long-poll response ends one pull, not its leased
          // iterator. Only a disconnected request cancels work; close/TTL and
          // the coordinator lifetime still dispose established subscriptions.
          response.once('close', () => { if (!response.writableFinished) abort.abort() })
          const result = await this.options.native(input.body as Record<string, unknown>, AbortSignal.any([abort.signal, this.lifetime.signal]))
          response.end(JSON.stringify(result))
          return
        }
        if (input.accountId !== accountId || input.environment !== environment
          || typeof input.sessionId !== 'string' || typeof input.target !== 'string'
          || !Number.isSafeInteger(input.epoch)) throw new Error('交接作用域无效')
        await this.options.authorize()
        this.lifetime.signal.throwIfAborted()
        const current = this.options.ownership.read(input.sessionId)
        if (!current || current.owner !== this.options.instance || current.epoch !== input.epoch
          || !this.options.ownership.peer(input.target)) throw new Error('会话执行权已改变')
        const prepared = this.options.ownership.prepare(current, input.target)
        try {
          await this.options.registry.release(input.sessionId as SessionId)
          this.options.ownership.released(prepared)
        } catch (error) {
          // A failed dispose is uncertain. Only a still-published, unfenced
          // lifecycle permits rolling back the prepare record.
          if (this.options.registry.get(input.sessionId as SessionId)) this.options.ownership.cancel(prepared)
          throw error
        }
        response.end(JSON.stringify({ released: true }))
      })().catch(() => {
        // Transport carries no paths, credentials, stack traces or tool data.
        if (!response.headersSent) response.writeHead(409)
        response.end(JSON.stringify({ error: '会话尚不能交接，请等待当前工作结束后重试' }))
      })
      this.requests.add(task)
      void task.finally(() => this.requests.delete(task))
    })
    this.server.maxConnections = 16
    this.server.keepAliveTimeout = 1000
  }

  async requestPeer(instance: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    await this.options.authorize()
    const peer = this.options.ownership.peer(instance)
    if (!peer) throw new DshRemoteError('RUNTIME_OFFLINE', '会话执行实例已经退出', true)
    const response = await fetch(`http://127.0.0.1:${peer.port}/native`, {
      method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${peer.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...this.options.scope, body }),
      signal: AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(25_000)]),
    }).catch(error => {
      // A refused loopback listener retires this exact discovery endpoint only.
      // Timeout/cancellation/auth failures prove nothing about the DSH writer.
      if (!signal.aborted && !this.lifetime.signal.aborted &&
          error instanceof Error && (error.cause as { code?: string } | undefined)?.code === 'ECONNREFUSED') {
        this.options.ownership.removePeer(peer)
        throw new DshRemoteError('RUNTIME_OFFLINE', '会话执行实例已经退出', true)
      }
      throw error
    })
    if (!response.ok) { await response.body?.cancel(); throw new DshRemoteError('REMOTE_NOT_FOUND', '会话执行权已改变，请重新连接', true) }
    // Bound IPC replies independently of HTTP content-length.
    const reader = response.body?.getReader()
    if (!reader) throw new Error('本机实例响应为空')
    const chunks: Uint8Array[] = []; let bytes = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.length
        if (bytes > 64 * 1024 * 1024) throw new Error('本机实例响应超限')
        chunks.push(part.value)
      }
    } finally { await reader.cancel() }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  async start(): Promise<void> {
    if (this.peer || this.closing || this.starting) throw new Error('实例协调器已经启动或关闭')
    this.starting = true
    await this.options.authorize()
    this.lifetime.signal.throwIfAborted()
    this.options.registry.coordinate(this.options.ownership, this.options.instance)
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { this.server.off('listening', ready); reject(error) }
      const ready = () => { this.server.off('error', fail); resolve() }
      this.server.once('error', fail).once('listening', ready).listen(0, '127.0.0.1')
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('本机交接通道未启动')
    const peer = { instance: this.options.instance, port: address.port, token: randomBytes(32).toString('hex') }
    try { this.lifetime.signal.throwIfAborted(); this.options.ownership.publishPeer(peer); this.peer = peer }
    catch (error) { await new Promise<void>(resolve => this.server.close(() => resolve())); throw error }
  }

  /** Activate through the original controller/registry composition. The registry
   * commits ownership at the public AgentSetup boundary, after the DSH writer
   * is acquired and before publication. Submit input only after this resolves. */
  async acquire(id: SessionId, activate: (signal: AbortSignal) => Promise<unknown>, signal?: AbortSignal, exitedOwner?: LocalSessionOwner): Promise<AgentHandle> {
    if (!this.peer || this.closing) throw new Error('本机交接通道未就绪')
    signal?.throwIfAborted()
    let operation = this.acquiring.get(id)
    if (!operation) {
      if (this.acquiring.size >= 16) throw new Error('同时交接的会话过多')
      operation = this.activateOwned(id, activate, exitedOwner).finally(() => this.acquiring.delete(id))
      this.acquiring.set(id, operation)
    }
    if (!signal) return operation
    // One atomic handoff serves all concurrent sends. A departing caller stops
    // waiting without cancelling the writer transfer needed by its peers.
    return new Promise<AgentHandle>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      operation!.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      if (signal.aborted) abort()
    })
  }

  private async activateOwned(id: SessionId, activate: (signal: AbortSignal) => Promise<unknown>, exitedOwner?: LocalSessionOwner): Promise<AgentHandle> {
    const scoped = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(30_000)])
    await this.options.authorize()
    scoped.throwIfAborted()
    let expected = this.options.ownership.read(id)
    // Observation recovery carries the exact exited owner. It must never
    // turn a concurrent successor into a new, live handoff request.
    if (exitedOwner && !sameOwner(exitedOwner, expected)) throw new Error('会话执行权已改变')
    if (!exitedOwner && expected && expected.owner !== this.options.instance && expected.phase === 'active') {
      const peer = this.options.ownership.peer(expected.owner)
      if (peer) {
        try {
          const response = await fetch(`http://127.0.0.1:${peer.port}/release`, {
            method: 'POST', redirect: 'error',
            headers: { authorization: `Bearer ${peer.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ ...this.options.scope, sessionId: id, epoch: expected.epoch, target: this.options.instance }),
            signal: AbortSignal.any([scoped, AbortSignal.timeout(5000)]),
          })
          // A responsive owner denying handoff is authoritative; do not retry
          // its activation or cancel running work on the caller's behalf.
          if (response.status === 409) { await response.body?.cancel(); throw new HandoffDenied() }
          await response.body?.cancel()
        } catch (error) {
          scoped.throwIfAborted()
          if (error instanceof HandoffDenied) throw error
          // An unreachable peer is NOT proof of release. Activation below
          // still has to acquire DSH's real cross-process writer lock.
        }
        expected = this.options.ownership.read(id)
      }
    }
    scoped.throwIfAborted()
    let committed = false
    const observed = expected
    const handle = await this.options.registry.acquireOwned(id, () => {
      scoped.throwIfAborted()
      if (committed) throw new Error('会话执行权不能重复提交')
      const store = this.options.ownership
      if (!observed) store.register(id, this.options.instance)
      else if (observed.owner === this.options.instance && observed.phase === 'active') {
        const current = store.read(id)
        if (!sameOwner(observed, current)) throw new Error('会话执行权已改变')
      } else if (observed.phase === 'released' && observed.target === this.options.instance) store.acquired(observed, this.options.instance)
      else store.recovered(observed, this.options.instance)
      committed = true
    }, () => activate(scoped))
    if (!committed) { await handle.dispose(); throw new Error('恢复流程未提交执行权') }
    if (scoped.aborted) { await handle.dispose(); scoped.throwIfAborted() }
    return handle
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.lifetime.abort(new Error('本机交接通道已关闭'))
      if (this.peer) this.options.ownership.removePeer(this.peer)
      await new Promise<void>(resolve => {
        this.server.close(() => resolve())
        this.server.closeAllConnections()
      })
      await Promise.allSettled([...this.requests, ...this.acquiring.values()])
    })()
  }
}

export class HandoffDenied extends Error {
  constructor() { super('会话尚不能交接，请等待当前工作结束后重试') }
}

function sameOwner(expected: LocalSessionOwner, actual: LocalSessionOwner | undefined): boolean {
  return actual?.owner === expected.owner && actual.epoch === expected.epoch && actual.phase === 'active'
}
