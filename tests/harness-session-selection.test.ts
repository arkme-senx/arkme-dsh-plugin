import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, expect, it, vi } from 'vitest'
import { observeHarnessSessionSelection } from '../src/client/harness-session-selection.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
function fixture() {
  let state = { phase: 'pending', current: undefined as string | undefined, byId: {} as Record<string, object> }
  const listeners = new Set<() => void>()
  return {
    sessions: { list: { getSnapshot: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) } } } as unknown as Pick<ISessions, 'list'>,
    set(current: string | undefined, phase = 'ready') {
      state = { phase, current, byId: current ? { [current]: {} } : {} }
      for (const fn of listeners) fn()
    },
    listeners,
  }
}

it('persists only real ready selections, including a blank session, and ignores transient clears', async () => {
  const f = fixture()
  const saved: string[] = []
  const stop = observeHarnessSessionSelection(f.sessions, { save: async id => { saved.push(id); return true } })
  f.set('A', 'pending'); f.set(undefined); f.set('A')
  await vi.waitFor(() => expect(saved).toEqual(['A']))
  f.set('A'); f.set(undefined); f.set('A')
  await Promise.resolve()
  expect(saved).toEqual(['A'])
  f.set('blank-session')
  await vi.waitFor(() => expect(saved).toEqual(['A', 'blank-session']))
  stop()
  f.set('B')
  expect(saved).toEqual(['A', 'blank-session'])
  expect(f.listeners.size).toBe(0)
})

it('submits each switch immediately even while a previous disk write is pending', async () => {
  const f = fixture()
  f.set('A')
  const gate = Promise.withResolvers<boolean>()
  const saved: string[] = []
  const stop = observeHarnessSessionSelection(f.sessions, { save: async id => { saved.push(id); return saved.length === 1 ? gate.promise : true } })
  f.set('B'); f.set('C')
  expect(saved).toEqual(['A', 'B', 'C'])
  gate.resolve(true)
  await Promise.resolve()
  stop()
})

it('retries a failed disk write but stops when the main process rejects an expired account lease', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const f = fixture()
  const saved: string[] = []
  let outcome: 'error' | 'ok' | 'stale' = 'error'
  const stop = observeHarnessSessionSelection(f.sessions, { save: async id => {
    saved.push(id)
    if (outcome === 'error') throw new Error('disk busy')
    return outcome === 'ok'
  } })
  f.set('A')
  await vi.advanceTimersByTimeAsync(0)
  outcome = 'ok'
  await vi.advanceTimersByTimeAsync(1000)
  expect(saved).toEqual(['A', 'A'])
  outcome = 'stale'
  f.set('B')
  await vi.advanceTimersByTimeAsync(0)
  f.set('C')
  await vi.advanceTimersByTimeAsync(10000)
  expect(saved).toEqual(['A', 'A', 'B'])
  stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('does not subscribe in browsers or after an unmounted page has a pending retry', async () => {
  const f = fixture()
  observeHarnessSessionSelection(f.sessions, undefined)()
  expect(f.listeners.size).toBe(0)
  const gate = Promise.withResolvers<boolean>()
  const saved: string[] = []
  const stop = observeHarnessSessionSelection(f.sessions, { save: async id => { saved.push(id); return gate.promise } })
  f.set('A'); f.set('B'); stop()
  gate.resolve(true)
  await Promise.resolve(); await Promise.resolve()
  expect(saved).toEqual(['A', 'B'])
})
