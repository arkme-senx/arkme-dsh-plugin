import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArkmeLocalDatabase } from '../../src/local-database.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../../src/keychain-store.js'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../../src/types.js'
import { AuthService } from '../../src/services/auth-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

class Sessions implements ArkmeSessionStore {
  value: ArkmeSessionCredentials | undefined
  async read() { return this.value }
  async write(value: ArkmeSessionCredentials) { this.value = value }
  async delete() { this.value = undefined }
}
const credentials = { userId: 42, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
const runtimes: ServiceRuntime[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose() })
function fixture(mode: unknown = 'none', phone = '', persistedState?: StateStore) {
  const sessions = new Sessions(), pending = new Sessions()
  let cached: ArkmeUserProfileSnapshot = { profile: null, revision: 0, cachedAtMillis: 0 }
  const facts = { mode, phone, userId: 42, registeredAt: 1, fail: false, bindingVisible: true, beforeRead: async () => {} }
  const state = persistedState ?? {
    async uniqueCode() { return 'fixture-device' },
    async cachedProfile() { return cached },
    async cacheProfile(_userId: number, profile: ArkmeUserProfile) {
      cached = { profile, revision: cached.revision + 1, cachedAtMillis: Date.now() }
      return cached
    },
  } as StateStore
  const config = { environment: 'test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000,
    maxTextLength: 1000 } as ArkmeServiceConfig
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    let data: unknown
    if (url.endsWith('/the-best-api-for-testing')) data = { access_token: credentials.accessToken, refresh_token: credentials.refreshToken }
    else if (url.endsWith('/get-user-info')) {
      await facts.beforeRead()
      if (facts.fail) return new Response('', { status: 503 })
      data = { user_id: facts.userId, phone: facts.phone, create_at: facts.registeredAt,
        ...(facts.mode === undefined ? {} : { phone_binding_policy: { mode: facts.mode } }) }
    } else if (url.endsWith('/get-public-users-by-ids')) data = { items: [] }
    else if (url.endsWith('/verify-bind-phone')) { if (facts.bindingVisible) facts.phone = '13800138000'; data = { result: 1 } }
    else throw new Error(`unexpected fixture endpoint: ${url}`)
    return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
  }) as typeof fetch
  const runtime = new ServiceRuntime(config, sessions, state, fetchImpl, pending)
  runtimes.push(runtime)
  const profile = new ProfileService(runtime)
  const service = new AuthService(runtime, profile, { reconnectChatRealtime: vi.fn(), clearAccountState: vi.fn() })
  return { service, profile, runtime, sessions, pending, facts, state, fetchImpl }
}

describe('account-owned phone binding login decision', () => {
  it.each(['none', 'required'])('retains the fresh decision across real SQLite profile persistence: %s', async mode => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-phone-policy-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const f = fixture(mode, '', database)
    try {
      await expect(f.service.testLogin(42)).resolves.toMatchObject({ status: mode === 'none' ? 'authenticated' : 'binding-required' })
      expect((await database.cachedProfile(42)).profile?.phoneBindingRequired).toBeUndefined()
      expect((await f.profile.profileForSession(credentials)).profile?.phoneBindingRequired).toBe(mode === 'required')
      if (mode === 'none') {
        vi.mocked(f.fetchImpl).mockClear(); f.facts.fail = true
        await expect(f.service.authStatus()).resolves.toMatchObject({ status: 'authenticated' })
        expect(f.fetchImpl).not.toHaveBeenCalled()
        // Simulate a new profile owner over the same persisted cache.
        f.facts.fail = false
        const restarted = new AuthService(f.runtime, new ProfileService(f.runtime), { reconnectChatRealtime: vi.fn(), clearAccountState: vi.fn() })
        await expect(restarted.authStatus()).resolves.toMatchObject({ status: 'authenticated' })
        expect(f.fetchImpl).toHaveBeenCalled()
      }
    } finally {
      runtimes.splice(runtimes.indexOf(f.runtime), 1); f.runtime.dispose()
      database.close(); await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['none', 'remind'])('accepts an unbound account when the server permits %s', async mode => {
    const f = fixture(mode)
    await expect(f.service.testLogin(42)).resolves.toMatchObject({ status: 'authenticated', userId: 42 })
    expect(f.sessions.value).toEqual(credentials)
    expect(f.pending.value).toBeUndefined()
    expect((await f.state.cachedProfile(42)).profile?.contact.phoneMasked).toBeUndefined()
    expect((await f.state.cachedProfile(42)).profile?.phoneBindingRequired).toBe(false)
  })
  it('does not recompute the server decision using the plugin clock or registration date', async () => {
    const f = fixture('required')
    f.facts.registeredAt = 1 // Even this apparent old date cannot override the owner.
    await expect(f.service.testLogin(42)).resolves.toMatchObject({ status: 'binding-required' })
    expect(f.sessions.value).toBeUndefined()
    expect(f.pending.value).toEqual(credentials)
    await expect(f.service.verifyPhoneCode('13800138000', '123456')).resolves.toMatchObject({ status: 'authenticated' })
    expect(f.sessions.value).toEqual(credentials)
    expect(f.pending.value).toBeUndefined()
  })
  it.each([undefined, 'unavailable', 'unknown'])('does not activate an unbound login with unknown policy %s', async mode => {
    const f = fixture(); f.facts.mode = mode
    await expect(f.service.testLogin(42)).rejects.toMatchObject({ code: 'phone-binding-policy-unavailable' })
    expect(f.sessions.value).toBeUndefined()
  })
  it('does not mistake an old-account login exemption for completed phone binding', async () => {
    const f = fixture(); f.sessions.value = credentials; f.facts.bindingVisible = false
    await expect(f.service.verifyPhoneCode('13800138000', '123456')).rejects.toMatchObject({ code: 'phone-bind-outcome-unknown' })
    expect(f.sessions.value).toEqual(credentials)
    expect((await f.state.cachedProfile(42)).profile?.contact.phoneMasked).toBeUndefined()
  })
  it('restores an old account already parked at the binding page without sending SMS', async () => {
    const f = fixture()
    f.pending.value = credentials
    await expect(f.service.authStatus()).resolves.toMatchObject({ status: 'authenticated', userId: 42 })
    expect(f.sessions.value).toEqual(credentials)
    expect(f.pending.value).toBeUndefined()
    expect(vi.mocked(f.fetchImpl).mock.calls.some(([url]) => String(url).includes('phone'))).toBe(false)
  })
  it('cooperates with concurrent status readers restoring the same pending account', async () => {
    const f = fixture(); f.pending.value = credentials
    const outcomes = await Promise.all([f.service.authStatus(), f.service.authStatus(), f.service.authStatus()])
    expect(outcomes.every(value => value.status === 'authenticated')).toBe(true)
    expect(f.sessions.value).toEqual(credentials); expect(f.pending.value).toBeUndefined()
  })
  it('keeps new accounts parked across process restart', async () => {
    const f = fixture('required'); f.pending.value = credentials
    await expect(f.service.authStatus()).resolves.toMatchObject({ status: 'binding-required' })
    expect(f.sessions.value).toBeUndefined()
    expect(f.pending.value).toEqual(credentials)
  })
  it('keeps active old accounts logged in after refreshing an old cache without policy', async () => {
    const f = fixture(); f.sessions.value = credentials
    await expect(f.service.authStatus()).resolves.toMatchObject({ status: 'authenticated' })
    expect(f.sessions.value).toEqual(credentials)
  })
  it('keeps bound cached startup offline and never requests a second profile to authorize it', async () => {
    const f = fixture('required', '13800138000'); f.sessions.value = credentials
    await f.profile.refreshProfile()
    vi.mocked(f.fetchImpl).mockClear(); f.facts.fail = true
    await expect(f.service.authStatus()).resolves.toMatchObject({ status: 'authenticated' })
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('keeps pending credentials on failed policy reads and succeeds on retry', async () => {
    const f = fixture(); f.pending.value = credentials; f.facts.mode = 'unavailable'
    await expect(f.service.authStatus()).rejects.toMatchObject({ code: 'phone-binding-policy-unavailable' })
    expect(f.pending.value).toEqual(credentials)
    f.facts.mode = 'none'
    f.profile.invalidate(42); f.runtime.invalidateScope(f.runtime.requestScope(42))
    await expect(f.service.authStatus()).resolves.toMatchObject({ status: 'authenticated' })
  })
  it('rejects a response for another account without clearing the existing pending session', async () => {
    const f = fixture(); f.pending.value = credentials; f.facts.userId = 99
    await expect(f.service.authStatus()).rejects.toMatchObject({ code: 'profile-contract-invalid' })
    expect(f.sessions.value).toBeUndefined(); expect(f.pending.value).toEqual(credentials)
  })
  it('does not revive a parked account when logout wins during the profile request', async () => {
    const f = fixture(); f.pending.value = credentials
    f.facts.beforeRead = async () => { await f.runtime.clearPendingBindingSession() }
    await expect(f.service.authStatus()).rejects.toMatchObject({ code: 'login-context-changed' })
    expect(f.sessions.value).toBeUndefined(); expect(f.pending.value).toBeUndefined()
  })
  it('does not replace another account selected during a pending profile request', async () => {
    const f = fixture(); f.pending.value = credentials
    const next = { ...credentials, userId: 99, refreshToken: 'other-fixture' }
    f.facts.beforeRead = async () => { await f.runtime.writeSession(next) }
    await expect(f.service.authStatus()).rejects.toMatchObject({ code: 'login-context-changed' })
    expect(f.sessions.value).toEqual(next)
  })
})
