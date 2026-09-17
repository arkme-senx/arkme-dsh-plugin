import { expect, it, vi } from 'vitest'
import { lockDisconnectedComposer } from '../src/client/harness-session-client.js'

function store<T>(value: T) {
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
    set(next: T) { value = next; [...listeners].forEach(fn => fn()) }, listeners }
}
it('disables native input through connecting/offline, retains the draft, and restores only its own gate on reconnect/dispose', () => {
  const connection = store<string | undefined>(undefined)
  const list = store({ current: 'windows-A' })
  const values = new Map<string, ReturnType<typeof store<{ reason: string } | undefined>>>()
  const storeFor = (id: string) => { if (!values.has(id)) values.set(id, store<{ reason: string } | undefined>(undefined)); return values.get(id)! }
  const blocks = { storeFor, set: vi.fn((id: string, value: { reason: string } | undefined) => storeFor(id).set(value)) }
  const stop = lockDisconnectedComposer({ list } as never, connection, () => blocks)
  expect(storeFor('windows-A').getSnapshot()?.reason).toBe('源电脑未连接')
  connection.set('connected'); expect(storeFor('windows-A').getSnapshot()).toBeUndefined()
  connection.set('disconnected'); expect(storeFor('windows-A').getSnapshot()).toBeDefined()
  connection.set('connecting'); expect(blocks.set).toHaveBeenCalledTimes(3)
  list.set({ current: 'windows-B' })
  expect(storeFor('windows-A').getSnapshot()).toBeUndefined(); expect(storeFor('windows-B').getSnapshot()).toBeDefined()
  const modelBlock = { reason: '选择模型' }
  blocks.set('windows-B', modelBlock)
  connection.set('connected'); expect(storeFor('windows-B').getSnapshot()).toBe(modelBlock)
  connection.set('disconnected'); blocks.set('windows-B', undefined)
  expect(storeFor('windows-B').getSnapshot()?.reason).toBe('源电脑未连接')
  stop()
  expect(storeFor('windows-B').getSnapshot()).toBeUndefined()
  expect(connection.listeners.size + list.listeners.size + [...values.values()].reduce((n, s) => n + s.listeners.size, 0)).toBe(0)
})
