import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { LocalSessionCoordinator } from '../src/local-session-coordinator.js'
import { LocalSessionOwnership } from '../src/local-session-ownership.js'
import type LocalSessionRegistry from '../src/local-session-registry.js'
import { DshNativeTransport } from '../src/dsh-remote/native-transport.js'
import type { DshGatewayLike, DshConnectionLike } from '../src/dsh-remote/gateway-api.js'

it('does not retire discovery for timeout cancellation or authentication failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-peer-errors-'))
  const scope = { accountId: '3016', environment: 'test' as const }
  const store = new LocalSessionOwnership(root, scope)
  const peer = { instance: 'peer', port: 12345, token: 'a'.repeat(64) }
  store.publishPeer(peer)
  const coordinator = new LocalSessionCoordinator({ ownership: store,
    registry: {} as LocalSessionRegistry, instance: 'current', scope, authorize: async () => {} })
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  try {
    for (const error of [new DOMException('timeout', 'TimeoutError'),
      new DOMException('cancelled', 'AbortError'), new Error('reset', { cause: { code: 'ECONNRESET' } })]) {
      fetchMock.mockRejectedValueOnce(error)
      await expect(coordinator.requestPeer(peer.instance, {}, new AbortController().signal)).rejects.toThrow()
      expect(store.peer(peer.instance)).toEqual(peer)
    }
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(coordinator.requestPeer(peer.instance, {}, new AbortController().signal)).rejects.toThrow('执行权已改变')
    expect(store.peer(peer.instance)).toEqual(peer)
  } finally { fetchMock.mockRestore(); await coordinator.close(); store.close(); rmSync(root, { recursive: true }) }
})

it('keeps one native iterator across completed HTTP pulls and closes it explicitly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-local-stream-'))
  const scope = { accountId: '3016', environment: 'test' as const }
  const store = new LocalSessionOwnership(root, scope)
  let advance!: () => void
  const opened = vi.fn(async (_endpoint: string, _payload: unknown, signal: AbortSignal) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'cursor', seq: 0 }
      await new Promise<void>(resolve => { advance = resolve; signal.addEventListener('abort', resolve, { once: true }) })
      if (!signal.aborted) yield { type: 'entry', seq: 1 }
    },
  }))
  const native = new DshNativeTransport({ wireStream: { open: opened } } as unknown as DshGatewayLike, {} as DshConnectionLike)
  const peer = new LocalSessionCoordinator({ ownership: store, registry: { coordinate() {} } as unknown as LocalSessionRegistry,
    instance: 'stream-owner', scope, authorize: async () => {},
    native: (body, signal) => native.request(body, { ...scope, signal, createSessionId: 'unused', claim: async () => {}, owned: async ids => new Set(ids) }),
  })
  const body = { mode: 'pull', streamRef: 'one-stream', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'one' } } } } }
  try {
    await peer.start()
    const first = await peer.requestPeer('stream-owner', body, AbortSignal.timeout(5000))
    expect(first).toMatchObject({ items: [{ type: 'cursor', seq: 0 }] })
    advance()
    const next = await peer.requestPeer('stream-owner', body, AbortSignal.timeout(5000))
    expect(next).toMatchObject({ items: [{ type: 'entry', seq: 1 }], done: true })
    expect(opened).toHaveBeenCalledOnce()
    expect(await peer.requestPeer('stream-owner', { mode: 'close', streamRef: 'one-stream' }, AbortSignal.timeout(5000))).toEqual({ done: true })
  } finally {
    native.close(); await peer.close(); store.close(); rmSync(root, { recursive: true })
  }
})

it('authenticates peer handoff, retains a busy owner, and commits only at the writer publication boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-local-ipc-'))
  const scope = { accountId: '3016', environment: 'test' as const }
  const a = new LocalSessionOwnership(root, scope), b = new LocalSessionOwnership(root, scope)
  let busy = true, live = true
  const source = {
    coordinate: vi.fn(),
    release: vi.fn(async () => { if (busy) throw new Error('busy'); live = false }),
    get: () => live ? {} : undefined,
    allowAcquisition: vi.fn(),
  } as unknown as LocalSessionRegistry
  let skipCommit = false
  const destination = { coordinate: vi.fn(), acquireOwned: vi.fn(async (_id: string, commit: () => void, activate: () => Promise<AgentHandle>) => {
    const result = await activate(); if (!skipCommit) commit(); return result
  }) } as unknown as LocalSessionRegistry
  const A = new LocalSessionCoordinator({ ownership: a, registry: destination, instance: 'A', scope, authorize: async () => {} })
  const B = new LocalSessionCoordinator({ ownership: b, registry: source, instance: 'B', scope, authorize: async () => {} })
  const id = SessionId('shared')
  const initial = b.register(id, 'B')
  const dispose = vi.fn(async () => {})
  const handle = { agent: { id }, dispose } as unknown as AgentHandle
  const activate = vi.fn(async () => { expect(a.read(id)?.phase).toBe('released'); return handle })
  try {
    await A.start(); await B.start()
    const peer = b.peer('B')!
    const denied = await fetch(`http://127.0.0.1:${peer.port}/release`, { method: 'POST', body: '{}' })
    expect(denied.status).toBe(403)
    await denied.body?.cancel()
    const foreign = await fetch(`http://127.0.0.1:${peer.port}/release`, {
      method: 'POST', headers: { authorization: `Bearer ${peer.token}` },
      body: JSON.stringify({ ...scope, accountId: '3017', sessionId: id, epoch: 1, target: 'A' }),
    })
    expect(foreign.status).toBe(409); await foreign.body?.cancel()
    expect(source.release).not.toHaveBeenCalled()
    await expect(A.acquire(id, activate)).rejects.toThrow('尚不能交接')
    expect(activate).not.toHaveBeenCalled()
    expect(a.read(id)).toMatchObject({ owner: 'B', epoch: 1, phase: 'active' })
    busy = false
    expect(await A.acquire(id, activate)).toBe(handle)
    expect(a.read(id)).toMatchObject({ conversationRef: initial.conversationRef, owner: 'A', epoch: 2, phase: 'active' })
    expect(destination.acquireOwned).toHaveBeenCalledWith(id, expect.any(Function), expect.any(Function))
    const stale = await fetch(`http://127.0.0.1:${peer.port}/release`, {
      method: 'POST', headers: { authorization: `Bearer ${peer.token}` },
      body: JSON.stringify({ ...scope, sessionId: id, epoch: 1, target: 'B' }),
    })
    expect(stale.status).toBe(409); await stale.body?.cancel()
    skipCommit = true
    await expect(A.acquire(SessionId('missing-commit'), async () => handle)).rejects.toThrow('未提交执行权')
    expect(dispose).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([A.close(), B.close()])
    expect(a.peer('A')).toBeUndefined(); expect(b.peer('B')).toBeUndefined()
    a.close(); b.close(); rmSync(root, { recursive: true })
  }
})

it('coalesces concurrent acquisition without one cancelled sender cancelling its peers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-concurrent-handoff-'))
  const scope = { accountId: '3016', environment: 'test' as const }, store = new LocalSessionOwnership(root, scope)
  const id = SessionId('burst'), handle = { agent: { id }, dispose: vi.fn() } as unknown as AgentHandle
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  const registry = { coordinate() {}, acquireOwned: vi.fn(async (_id: string, commit: () => void, activate: () => Promise<unknown>) => {
    await activate(); commit(); return handle
  }) } as unknown as LocalSessionRegistry
  const coordinator = new LocalSessionCoordinator({ ownership: store, registry, instance: 'A', scope, authorize: async () => {} })
  const activate = vi.fn(async () => { await gate })
  try {
    await coordinator.start()
    const cancel = new AbortController()
    const one = coordinator.acquire(id, activate, cancel.signal).catch(error => error)
    const two = coordinator.acquire(id, activate), three = coordinator.acquire(id, activate)
    cancel.abort()
    expect((await one).name).toBe('AbortError')
    finish()
    expect(await Promise.all([two, three])).toEqual([handle, handle])
    expect(activate).toHaveBeenCalledTimes(1)
    expect(registry.acquireOwned).toHaveBeenCalledTimes(1)
    expect(store.read(id)).toMatchObject({ owner: 'A', phase: 'active', epoch: 1 })
  } finally { finish(); await coordinator.close(); store.close(); rmSync(root, { recursive: true }) }
})


it.each(['changed-before', 'writer-locked', 'changed-at-commit'])('does not release or overwrite a successor during cold recovery: %s', async state => {
  const root = mkdtempSync(join(tmpdir(), 'arkme-recovery-fence-')), scope = { accountId: '3016', environment: 'test' as const }
  const store = new LocalSessionOwnership(root, scope), id = SessionId('cold')
  const exited = store.register(id, 'exited')
  const registry = { coordinate() {}, acquireOwned: vi.fn(async (_id: string, commit: () => void) => {
    if (state === 'writer-locked') throw new Error('official writer is locked')
    store.recovered(exited, 'successor'); commit(); throw new Error('commit must reject')
  }) }
  const coordinator = new LocalSessionCoordinator({ ownership: store, registry: registry as any, instance: 'current', scope, authorize: async () => {} })
  try {
    await coordinator.start()
    if (state === 'changed-before') store.recovered(exited, 'successor')
    const activate = vi.fn(async () => {})
    await expect(coordinator.acquire(id, activate, undefined, exited)).rejects.toThrow()
    expect(store.read(id)).toMatchObject({ owner: state === 'writer-locked' ? 'exited' : 'successor', epoch: state === 'writer-locked' ? 1 : 2 })
    if (state === 'changed-before') expect(registry.acquireOwned).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
  } finally { await coordinator.close(); store.close(); rmSync(root, { recursive: true }) }
})
