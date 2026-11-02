import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { expect, it, vi } from 'vitest'
import { LocalSessionControl, controlFrames } from '../src/local-session-control.js'
import { LocalSessionOwnership } from '../src/local-session-ownership.js'
import { LocalSessionCoordinator } from '../src/local-session-coordinator.js'
import type { Context } from '@deepseek-ai/cordis'
import type LocalSessionRegistry from '../src/local-session-registry.js'

it('retired discovery peers do not poison native control or change their writer ownership', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme stale peers '))
  const scope = { accountId: '3016', environment: 'test' as const }
  const store = new LocalSessionOwnership(root, scope)
  const closed = createServer()
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))
  const port = (closed.address() as { port: number }).port
  await new Promise<void>(resolve => closed.close(() => resolve()))
  for (let index = 0; index < 8; index++) {
    store.publishPeer({ instance: `retired_${index}`, port, token: 'a'.repeat(64) })
    store.register(`session_${index}`, `retired_${index}`)
  }
  const coordinator = new LocalSessionCoordinator({ ownership: store,
    registry: { coordinate() {} } as unknown as LocalSessionRegistry, instance: 'current', scope,
    authorize: async () => {}, native: async () => ({ items: [], done: true }),
  })
  const liveRequest = vi.fn(async () => ({ items: [], done: true }))
  const live = new LocalSessionCoordinator({ ownership: store,
    registry: { coordinate() {} } as unknown as LocalSessionRegistry, instance: 'z-live', scope,
    authorize: async () => {}, native: liveRequest,
  })
  await live.start(); store.register('live-session', 'z-live')
  await coordinator.start(); store.register('current-session', 'current')
  const ctx = { logger: { warn: vi.fn() } } as unknown as Context
  const control = new LocalSessionControl(ctx, store, coordinator, 'current', scope.accountId)
  const abort = new AbortController()
  const stream = control.stream(async signal => controlFrames(signal, push => {
    push({ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } })
    return () => {}
  }), abort.signal)[Symbol.asyncIterator]()
  try {
    await expect(stream.next()).resolves.toMatchObject({ value: { type: 'baseline' } })
    await vi.waitFor(() => {
      for (let index = 0; index < 8; index++) expect(store.peer(`retired_${index}`)).toBeUndefined()
      expect(liveRequest).toHaveBeenCalled()
    })
    for (let index = 0; index < 8; index++) expect(store.read(`session_${index}`)).toMatchObject({ owner: `retired_${index}`, epoch: 1, phase: 'active' })
    expect(store.peer('current')).toBeDefined()
  } finally {
    abort.abort(); await stream.return?.(); await control.close(); await coordinator.close(); await live.close()
    store.close(); rmSync(root, { recursive: true })
  }
})

it('a transient discovery read cannot permanently reject native subscriptions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme discovery retry '))
  const scope = { accountId: '3016', environment: 'test' as const }
  const store = new LocalSessionOwnership(root, scope)
  const discovery = vi.spyOn(store, 'observationPeers').mockImplementationOnce(() => { throw new Error('temporarily busy') })
  const ctx = { logger: { warn: vi.fn() } } as unknown as Context
  const control = new LocalSessionControl(ctx, store, {} as LocalSessionCoordinator, 'current', scope.accountId)
  const abort = new AbortController()
  const open = async (signal: AbortSignal) => controlFrames(signal, push => {
    push({ type: 'baseline', value: {} }); return () => {}
  })
  const first = control.stream(open, abort.signal)[Symbol.asyncIterator]()
  const second = control.stream(open, abort.signal)[Symbol.asyncIterator]()
  try {
    await expect(first.next()).resolves.toMatchObject({ value: { type: 'baseline' } })
    await vi.waitFor(() => expect(discovery).toHaveBeenCalledTimes(2))
    await expect(second.next()).resolves.toMatchObject({ value: { type: 'baseline' } })
  } finally {
    abort.abort(); await first.return?.(); await second.return?.(); await control.close()
    store.close(); rmSync(root, { recursive: true })
  }
})

it('relays authoritative control and status once per peer, rejects stale epochs, and cancels subscriptions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arkme control '))
  const scope = { accountId: '3016', environment: 'test' as const }
  const store = new LocalSessionOwnership(root, scope)
  store.register('session', 'B')
  function context(owner: boolean) {
    const events = new EventEmitter(), controls = new EventEmitter()
    const ctx = {
      on: (name: string, listener: (...args: any[]) => void) => { events.on(name, listener); return () => { events.off(name, listener) } },
      emit: vi.fn((name: string, ...args: any[]) => { events.emit(name, ...args) }),
      agents: { list: () => owner ? [{ id: 'session', status: 'idle' }] : [] }, logger: { warn: vi.fn() },
      get: () => ({ control: (signal: AbortSignal) => controlFrames(signal, push => {
        controls.on('frame', push)
        push({ type: 'baseline', value: { queues: {}, jobs: {}, projections: owner ? { session: { asOfSeq: 1, values: { usage: { turns: 1 } } } } : {} } })
        return () => { controls.off('frame', push) }
      }) }),
    }
    return { ctx, controls }
  }
  const a = context(false), b = context(true)
  let A!: LocalSessionControl, B!: LocalSessionControl
  const coordinator = (instance: string, relay: () => LocalSessionControl) => new LocalSessionCoordinator({
    ownership: store, registry: { coordinate() {} } as unknown as LocalSessionRegistry, instance, scope,
    authorize: async () => {}, native: (body, signal) => relay().request(body.native as Record<string, any>, signal),
  })
  const ca = coordinator('A', () => A), cb = coordinator('B', () => B)
  await ca.start(); await cb.start()
  const pulls = vi.spyOn(ca, 'requestPeer')
  B = new LocalSessionControl(b.ctx as unknown as Context, store, cb, 'B', scope.accountId)
  A = new LocalSessionControl(a.ctx as unknown as Context, store, ca, 'A', scope.accountId)
  const abort = new AbortController()
  const open = (signal: AbortSignal) => Promise.resolve(a.ctx.get().control(signal))
  const s1 = A.stream(open, abort.signal)[Symbol.asyncIterator]()
  const s2 = A.stream(open, abort.signal)[Symbol.asyncIterator]()
  const s3 = A.stream(open, abort.signal)[Symbol.asyncIterator]()
  const until = async (stream: AsyncIterator<any>, predicate: (frame: any) => boolean) => {
    for (let i = 0; i < 20; i++) { const result = await stream.next(); if (predicate(result.value)) return result.value }
    throw new Error('frame not found')
  }
  try {
    expect((await s1.next()).value.type).toBe('baseline')
    expect((await s2.next()).value.type).toBe('baseline')
    expect(await until(s1, frame => frame.type === 'projection')).toMatchObject({ key: 'usage', value: { turns: 1 }, seq: 1 })
    await until(s2, frame => frame.type === 'projection')
    b.ctx.emit('api-session/status', 'session', true)
    b.controls.emit('frame', { type: 'projection', sessionId: 'session', key: 'usage', value: { turns: 2 }, seq: 4 })
    for (const stream of [s1, s2]) {
      const value = await until(stream, frame => frame.type === 'projection')
      expect(value).toMatchObject({ value: { turns: 2 }, seq: 4 }); expect(value).not.toHaveProperty('epoch')
    }
    expect(a.ctx.emit).toHaveBeenCalledWith('api-session/status', 'session', true)
    const list = { items: [{ sessionId: 'session', running: false }] }
    expect(A.projectList(list)).toEqual({ items: [{ sessionId: 'session', running: true }] })
    expect((await s3.next()).value.type).toBe('baseline')
    expect(await until(s3, frame => frame.type === 'projection')).toMatchObject({ value: { turns: 2 }, seq: 4 })
    await expect((async () => {
      for await (const _frame of A.stream(async () => (async function* () {
        yield { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }
      })(), abort.signal)) { /* an ended native source must not leave the consumer waiting */ }
    })()).rejects.toThrow('原生状态流已结束')
    const refs = pulls.mock.calls.filter(call => (call[1].native as any)?.mode === 'pull').map(call => (call[1].native as any).streamRef)
    expect(new Set(refs).size).toBe(1)
    const prepared = store.prepare(store.read('session')!, 'A'); store.released(prepared); store.acquired(store.read('session')!, 'A')
    expect(A.projectList(list)).toEqual(list)
    a.ctx.emit.mockClear()
    b.ctx.emit('api-session/status', 'session', false)
    expect(a.ctx.emit).not.toHaveBeenCalled()
  } finally {
    abort.abort(); await s1.return?.(); await s2.return?.(); await s3.return?.(); await A.close(); await B.close()
    await ca.close(); await cb.close(); store.close(); rmSync(root, { recursive: true })
  }
  expect(a.controls.listenerCount('frame')).toBe(0)
  expect(b.controls.listenerCount('frame')).toBe(0)
})

it('fails a slow consumer with a bounded queue and removes listeners', async () => {
  const dispose = vi.fn()
  const iterator = controlFrames(new AbortController().signal, push => { for (let i = 0; i < 257; i++) push({ i }); return dispose })
  await expect(iterator.next()).rejects.toThrow('积压超限')
  expect(dispose).toHaveBeenCalledOnce()
})
