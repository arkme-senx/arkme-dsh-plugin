import { describe, expect, it, vi } from 'vitest'
import { adaptSessionPersistence } from '../src/dsh-remote/session-persistence.js'

describe('session persistence compatibility', () => {
  it('preserves the legacy service and its legacy-message fallback even when both APIs exist', () => {
    const legacy = { listSnapshots: vi.fn(), readFrom: vi.fn(), loadStored: vi.fn(), list: vi.fn(), open: vi.fn() }
    expect(adaptSessionPersistence(legacy)).toBe(legacy)
    expect(adaptSessionPersistence(undefined)).toBeUndefined()
  })

  it('adapts snapshots and read-only handles, preserves receivers, offsets and cancellation', async () => {
    const signal = new AbortController().signal
    const snapshots = [{ header: { id: 'session' }, revision: 'revision' }]
    const events = [{ seq: 0, type: 'turn/start' }]
    const handle = {
      header: snapshots[0]!.header,
      read: vi.fn(async function (this: unknown) { expect(this).toBe(handle); return { events } }),
      close: vi.fn(async () => {}),
    }
    const service = {
      list: vi.fn(async function (this: unknown) { expect(this).toBe(service); return snapshots }),
      open: vi.fn(async function (this: unknown) { expect(this).toBe(service); return handle }),
    }
    const adapter = adaptSessionPersistence(service)!
    expect(await adapter.listSnapshots(signal)).toEqual(snapshots)
    expect(service.list).toHaveBeenCalledWith({ signal })
    expect(await adapter.readFrom('session', 4, signal)).toEqual({ meta: handle.header, events })
    expect(service.open).toHaveBeenCalledWith('session', 'read', { signal })
    expect(handle.read).toHaveBeenCalledWith(4, undefined, { signal })
    expect(handle.close).toHaveBeenCalledTimes(1)
  })

  it.each(['failure', 'abort'] as const)('closes the read handle on %s', async mode => {
    const controller = new AbortController()
    const handle = {
      header: { id: 'session' },
      read: vi.fn(async () => {
        if (mode === 'failure') throw new Error('read failed')
        controller.abort()
        return { events: [] }
      }),
      close: vi.fn(async () => {}),
    }
    const adapter = adaptSessionPersistence({ list: vi.fn(), open: async () => handle })!
    await expect(adapter.readFrom('session', 0, controller.signal)).rejects.toThrow()
    expect(handle.close).toHaveBeenCalledTimes(1)
  })

  it('does not open a handle for an already cancelled read', async () => {
    const open = vi.fn()
    const signal = AbortSignal.abort()
    await expect(adaptSessionPersistence({ list: vi.fn(), open })!.readFrom('session', 0, signal)).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })

  it('reports unsupported history APIs without preventing remote host startup', async () => {
    const adapter = adaptSessionPersistence({})!
    await expect(adapter.listSnapshots()).rejects.toThrow('Unsupported DSH session persistence API')
  })
})
