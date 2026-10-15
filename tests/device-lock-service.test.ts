import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceLockService } from '../src/services/device-lock-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
const owners: DeviceLockService[] = []
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose() })
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
  it('does not label a server revocation failure as successful logout', async () => {
    const f = fixture(); await f.owner.refresh(); f.failRevoke(); await expect(f.owner.beforeLogout()).rejects.toThrow(); expect(f.getSession()).toBeDefined(); expect(f.cleanups()).toBe(0)
  })
})
