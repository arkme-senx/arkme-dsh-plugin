import { describe, expect, it } from 'vitest'
import { DesktopSessionPresence, DESKTOP_SESSION_LEASE_MS } from '../src/dsh-remote/desktop-session-presence.js'

describe('desktop session selection lease', () => {
  it('clears hidden sessions, rejects stale reports, and expires crashed windows', () => {
    const state = new DesktopSessionPresence()
    state.report({ windowRef: 'window', revision: 1, sessionRef: 'session-A' }, 1)
    expect(state.current(2)).toBe('session-A')
    state.report({ windowRef: 'window', revision: 3, sessionRef: null }, 3)
    state.report({ windowRef: 'window', revision: 2, sessionRef: 'session-A' }, 4)
    expect(state.current(5)).toBeUndefined()
    state.report({ windowRef: 'window', revision: 4, sessionRef: 'session-B' }, 6)
    expect(state.current(6 + DESKTOP_SESSION_LEASE_MS)).toBeUndefined()
  })

  it('heartbeats do not steal selection from a more recently changed window', () => {
    const state = new DesktopSessionPresence()
    state.report({ windowRef: 'one', revision: 1, sessionRef: 'A' }, 1)
    state.report({ windowRef: 'two', revision: 1, sessionRef: 'B' }, 2)
    state.report({ windowRef: 'one', revision: 2, sessionRef: 'A' }, 3)
    expect(state.current(4)).toBe('B')
    state.clear()
    expect(state.current(5)).toBeUndefined()
  })

  it('selection versions advance on changes and lease expiry but not heartbeat renewal', () => {
    const state = new DesktopSessionPresence()
    expect(state.snapshot(0)).toEqual({ sessionRef: undefined, revision: 0 })
    state.report({ windowRef: 'one', revision: 1, sessionRef: 'A' }, 1)
    expect(state.snapshot(1)).toEqual({ sessionRef: 'A', revision: 1 })
    state.report({ windowRef: 'one', revision: 2, sessionRef: 'A' }, 10)
    expect(state.snapshot(10).revision).toBe(1)
    expect(state.expiryDelay(10)).toBe(DESKTOP_SESSION_LEASE_MS)
    expect(state.snapshot(10 + DESKTOP_SESSION_LEASE_MS)).toEqual({ sessionRef: undefined, revision: 2 })
  })

  it('bounds windows and validates opaque refs and sequence numbers', () => {
    const state = new DesktopSessionPresence()
    for (let i = 0; i < 8; i++) state.report({ windowRef: `client${i}`, revision: 1, sessionRef: 'A' }, 1)
    expect(() => state.report({ windowRef: 'ninth', revision: 1, sessionRef: 'A' }, 2)).toThrow()
    expect(() => state.report({ windowRef: 'client0', revision: NaN, sessionRef: 'A' }, 2)).toThrow()
    expect(() => state.report({ windowRef: 'client0', revision: 2, sessionRef: '' }, 2)).toThrow()
    state.report({ windowRef: 'ninth', revision: 1, sessionRef: 'A' }, 30_001)
    expect(state.current(30_002)).toBe('A')
  })
})
