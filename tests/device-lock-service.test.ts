import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceLockService } from '../src/services/device-lock-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
import { DeviceControlRealtime } from '../src/services/device-control-realtime.js'
const owners: DeviceLockService[] = []
beforeEach(() => { vi.spyOn(DeviceControlRealtime.prototype, 'connect').mockImplementation(() => undefined) })
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); vi.useRealTimers() })
const sid = 'session_00000000000001'
const token = (sessionId = sid) => `e30.${Buffer.from(JSON.stringify({user_id: 1, client_id: 2, session_id: sessionId})).toString('base64url')}.signature`
function fixture() {
  let session: ArkmeSessionCredentials | undefined = { userId: 1, accessToken: token(), refreshToken: 'refresh' }
  let legacy = false, fail = false, locks = 0, cleanups = 0
  let native = { supported: true, locked: false, sessionEnded: false, needsCredentials: false, message: '', userId: 1, clientId: 2, sessionId: sid }
  const fetchImpl = vi.fn(async (_: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    if (body.action === 'capabilities.get') return new Response(JSON.stringify({ok: true, value: {capabilities: {deviceLock: legacy ? undefined : {version: 1}}}}))
    if (fail && body.action === 'device.lock.logout') return new Response('', {status: 503})
    if (body.action === 'device.lock.bind') { Object.assign(native, {sessionId: JSON.parse(Buffer.from(body.payload.accessToken.split('.')[1], 'base64url').toString()).session_id, sessionEnded: false}); }
    if (body.action === 'device.lock.lock') { locks++; native.locked = true }
    if (body.action === 'device.lock.logout') native.sessionEnded = true
    if (body.action === 'device.lock.cleanup') { cleanups++; native.sessionEnded = false; native.locked = false }
    return new Response(JSON.stringify({ ok: true, value: native }))
  })
  const logout = vi.fn(async (expected: ArkmeSessionCredentials) => { expect(session).toBe(expected); session = undefined })
  const runtime = { config: {}, fetchImpl, accountScopedSession: async () => session, sessionStore: {read: async () => session}, refreshAccessToken: vi.fn(async (current: ArkmeSessionCredentials) => current) } as unknown as ServiceRuntime
  const owner = new DeviceLockService(runtime, logout, { endpoint: 'http://127.0.0.1:1234/v1/actions', token: 'host-token', sessionId: 'harness-session' }); owners.push(owner)
  return { owner, fetchImpl, logout, native, getSession: () => session, legacy: () => { legacy = true }, failRevoke: () => { fail = true }, replace: () => { session = {...session!, accessToken: token('replacement_session_001')} }, locks: () => locks, cleanups: () => cleanups }
}
describe('device lock Host lifecycle', () => {
  it('reconciles an idle healthy realtime connection once a minute', async () => {
    vi.useFakeTimers()
    vi.spyOn(DeviceControlRealtime.prototype, 'connected', 'get').mockReturnValue(true)
    const f = fixture(); await f.owner.refresh()
    const count = f.fetchImpl.mock.calls.length
    await vi.advanceTimersByTimeAsync(59000)
    expect(f.fetchImpl).toHaveBeenCalledTimes(count)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fetchImpl.mock.calls.length).toBeGreaterThan(count)
  })
  it('does not reconnect after disposal while a native response is pending', async () => {
    const connect = vi.spyOn(DeviceControlRealtime.prototype, 'connect')
    const f = fixture(); const original = f.fetchImpl.getMockImplementation()!
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let started = false
    f.fetchImpl.mockImplementation(async (url, init) => {
      if (JSON.parse(String(init?.body)).action === 'device.lock.sync') { started = true; await pending }
      return original(url, init)
    })
    const work = f.owner.refresh()
    while (!started) await new Promise(resolve => setTimeout(resolve, 1))
    f.owner.dispose(); release(); await work
    expect(connect).not.toHaveBeenCalled()
  })
  it('coalesces concurrent snapshot refreshes and delegates locking only to native authority', async () => {
    const f = fixture(); await Promise.all([f.owner.refresh(), f.owner.refresh(), f.owner.refresh()]);
    expect(f.fetchImpl.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).action === 'device.lock.bind')).toHaveLength(1)
    expect(await f.owner.lock()).toMatchObject({available: true, locked: true}); expect(f.locks()).toBe(1)
    expect(f.owner.peek()).not.toHaveProperty('sessionId')
  })
  it('clears only the revoked login before sending cleanup acknowledgement', async () => {
    const f = fixture(); await f.owner.refresh(); f.native.sessionEnded = true; f.native.locked = true
    await f.owner.refresh(); expect(f.logout).toHaveBeenCalledTimes(1); expect(f.getSession()).toBeUndefined(); expect(f.cleanups()).toBe(1)
  })
  it('does not delete a new login because the previous login ended', async () => {
    const f = fixture(); await f.owner.refresh(); f.native.sessionEnded = true; f.replace()
    await f.owner.refresh(); expect(f.logout).not.toHaveBeenCalled(); expect(f.getSession()).toBeDefined()
  })
  it('preserves old native host logout compatibility', async () => {
    const f = fixture(); f.legacy(); expect(await f.owner.refresh()).toMatchObject({available: false}); expect(await f.owner.beforeLogout()).toBe(false)
  })
  it('reaches native unlock without requiring remote refresh', async () => {
    const f = fixture(); f.native.locked = true
    const original = f.fetchImpl.getMockImplementation()!
    f.fetchImpl.mockImplementation(async (url, init) => {
      const action = JSON.parse(String(init?.body)).action
      if (action === 'device.lock.sync' || action === 'device.lock.bind') throw new Error('remote unavailable')
      return original(url, init)
    })
    expect(await f.owner.requestUnlock()).toMatchObject({available: true, locked: true})
    const actions = f.fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).action)
    expect(actions).toContain('device.lock.unlock')
    expect(actions).not.toContain('device.lock.sync'); expect(actions).not.toContain('device.lock.bind')
  })
  it('does not route a replaced account to the previous native binding', async () => {
    const f = fixture(); f.native.locked = true; f.replace()
    await expect(f.owner.requestUnlock()).rejects.toThrow('登录状态已变化')
    expect(f.fetchImpl.mock.calls.some(([, init]) => JSON.parse(String(init?.body)).action === 'device.lock.unlock')).toBe(false)
  })
  it('does not label a server revocation failure as successful logout', async () => {
    const f = fixture(); await f.owner.refresh(); f.failRevoke(); await expect(f.owner.beforeLogout()).rejects.toThrow(); expect(f.getSession()).toBeDefined(); expect(f.cleanups()).toBe(0)
  })
})
