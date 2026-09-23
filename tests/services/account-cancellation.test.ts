import { describe, expect, it, vi } from 'vitest'
import { AuthService } from '../../src/services/auth-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import type { ProfileService } from '../../src/services/profile-service.js'
import type { ArkmeSessionCredentials } from '../../src/keychain-store.js'

function setup() {
  let session: ArkmeSessionCredentials | undefined = { userId: 7, accessToken: 'access', refreshToken: 'refresh' }
  const requests: Array<{ path: string; body: unknown }> = []
  let response: unknown = { mode: 'immediate', status: 'eligible', cancel_at: 0, has_phone: true }
  let completion: import('../../src/state-store.js').ArkmeCancellationCompletion | undefined
  let failDelete = false
  const runtime = new ServiceRuntime({ environment: 'test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig, {
    read: async () => session,
    write: async value => { session = value },
    delete: async () => { if (failDelete) throw new Error('keychain locked'); session = undefined },
  }, { uniqueCode: async () => 'device', readCancellationCompletion: async () => completion, writeCancellationCompletion: async value => { completion = value } } as StateStore, async (url, init) => {
    requests.push({ path: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(JSON.stringify({ code: 200, data: response }))
  })
  const profile = { invalidate() {}, refreshProfileForSession: async () => ({ profile: { contact: { phoneMasked: '138****1234' } } }) } as unknown as ProfileService
  const service = new AuthService(runtime, profile, { reconnectChatRealtime() {}, clearAccountState() {} })
  return { service, profile, restart: () => new AuthService(runtime, profile, { reconnectChatRealtime() {}, clearAccountState() {} }), requests, session: () => session, setSession: (value: typeof session) => { session = value }, respond: (value: unknown) => { response = value }, failDelete: (value: boolean) => { failDelete = value } }
}

describe('account cancellation', () => {
  it('previews without clearing credentials and submits with the expected mode', async () => {
    const s = setup()
    await expect(s.service.previewCancellation(7)).resolves.toMatchObject({ mode: 'immediate', status: 'eligible' })
    expect(s.session()?.userId).toBe(7)
    s.respond({ mode: 'immediate', status: 'done', cancel_at: 0, has_phone: false })
    await expect(s.service.submitCancellation(7, 'immediate')).resolves.toMatchObject({ status: 'done' })
    expect(s.requests[1]?.body).toEqual({ expected_mode: 'immediate' })
    expect(s.session()).toBeUndefined()
  })
  it('requires reconfirmation when the mode changes and preserves the session', async () => {
    const s = setup()
    s.respond({ mode: 'waiting', status: 'eligible', cancel_at: 0, has_phone: true, changed: true })
    await expect(s.service.submitCancellation(7, 'immediate')).resolves.toMatchObject({ changed: true })
    expect(s.session()?.userId).toBe(7)
  })
  it('retries local cleanup without submitting again after backend success', async () => {
    const s = setup()
    s.respond({ mode: 'immediate', status: 'done', cancel_at: 0, has_phone: false })
    s.failDelete(true)
    await expect(s.service.submitCancellation(7, 'immediate')).rejects.toThrow('keychain locked')
    s.failDelete(false)
    await s.service.submitCancellation(7, 'immediate')
    expect(s.requests).toHaveLength(1)
    expect(s.session()).toBeUndefined()
  })
  it('recovers cleanup after Host restart and preserves the completion notice without repeating the request', async () => {
    const s = setup()
    s.respond({ mode: 'immediate', status: 'done', cancel_at: 0, has_phone: false })
    s.failDelete(true)
    await expect(s.service.submitCancellation(7, 'immediate')).rejects.toThrow('keychain locked')
    s.failDelete(false)
    await expect(s.restart().authStatus()).resolves.toMatchObject({ status: 'logged-out', cancellationNotice: 'done' })
    await expect(s.restart().authStatus()).resolves.toMatchObject({ status: 'logged-out', cancellationNotice: 'done' })
    expect(s.requests).toHaveLength(1)
    expect(s.session()).toBeUndefined()
  })
  it('does not clear another account when local cleanup is retried after a switch', async () => {
    const s = setup()
    s.respond({ mode: 'waiting', status: 'waiting', cancel_at: 1800000000000000, has_phone: true })
    s.failDelete(true)
    await expect(s.service.submitCancellation(7, 'waiting')).rejects.toThrow('keychain locked')
    s.setSession({ userId: 9, accessToken: 'other', refreshToken: 'other' })
    s.failDelete(false)
    await expect(s.service.submitCancellation(7, 'waiting')).rejects.toMatchObject({ code: 'cancellation-session-changed' })
    expect(s.session()?.userId).toBe(9)
    expect(s.requests).toHaveLength(1)
  })
  it('does not clear credentials when the server response is malformed', async () => {
    const s = setup()
    s.respond({ status: 'done' })
    await expect(s.service.submitCancellation(7, 'immediate')).rejects.toMatchObject({ code: 'cancellation-contract-invalid' })
    expect(s.session()?.userId).toBe(7)
  })
  it('does not submit a stale dialog for another account', async () => {
    const s = setup()
    await expect(s.service.submitCancellation(9, 'waiting')).rejects.toMatchObject({ code: 'cancellation-session-changed' })
    expect(s.requests).toHaveLength(0)
  })
  it('holds pending login credentials until the user explicitly aborts cancellation', async () => {
    const s = setup()
    s.setSession(undefined)
    s.respond({ access_token: 'new-access', refresh_token: 'new-refresh', rest_days_cancel: 5 })
    await expect(s.service.testLogin(7)).resolves.toMatchObject({ status: 'cancellation-pending', restDaysCancel: 5 })
    expect(s.session()).toBeUndefined()
    s.respond({})
    await expect(s.service.resolveCancellationLogin(true)).resolves.toMatchObject({ status: 'authenticated' })
    expect(s.requests.at(-1)?.path).toContain('/abort-cancel')
    expect(s.session()?.userId).toBe(7)
  })
  it('does not activate a pending login canceled while its profile is loading', async () => {
    const s = setup()
    s.setSession(undefined)
    s.respond({ access_token: 'new-access', refresh_token: 'new-refresh', rest_days_cancel: 1 })
    await s.service.testLogin(7)
    let resolveProfile!: (value: unknown) => void
    let started!: () => void
    const loading = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(s.profile, 'refreshProfileForSession').mockImplementation(async () => {
      started()
      return await new Promise(resolve => { resolveProfile = resolve }) as never
    })
    s.respond({})
    const resolving = s.service.resolveCancellationLogin(true)
    await loading
    await s.service.resolveCancellationLogin(false)
    resolveProfile({ profile: { contact: { phoneMasked: '138****1234' } } })
    await expect(resolving).rejects.toMatchObject({ code: 'cancellation-login-expired' })
    expect(s.session()).toBeUndefined()
  })
  it('discards a pending login without aborting cancellation', async () => {
    const s = setup()
    s.setSession(undefined)
    s.respond({ access_token: 'new-access', refresh_token: 'new-refresh', rest_days_cancel: 1 })
    await s.service.testLogin(7)
    await expect(s.service.resolveCancellationLogin(false)).resolves.toMatchObject({ status: 'logged-out' })
    expect(s.requests).toHaveLength(1)
    expect(s.session()).toBeUndefined()
  })
})

describe('cancellation login account isolation', () => {
  for (const continueLogin of [true, false]) {
    it(`invalidates account A confirmation after account B logs in (${String(continueLogin)})`, async () => {
      const s = setup()
      s.setSession(undefined)
      s.respond({ access_token: 'A-access', refresh_token: 'A-refresh', rest_days_cancel: 5 })
      await expect(s.service.testLogin(7)).resolves.toMatchObject({ status: 'cancellation-pending' })
      s.respond({ access_token: 'B-access', refresh_token: 'B-refresh', rest_days_cancel: 0 })
      await expect(s.service.testLogin(9)).resolves.toMatchObject({ status: 'authenticated', userId: 9 })
      await expect(s.service.resolveCancellationLogin(continueLogin)).rejects.toMatchObject({ code: 'cancellation-login-expired' })
      expect(s.session()?.userId).toBe(9)
      expect(s.requests.filter(request => request.path.includes('/abort-cancel'))).toHaveLength(0)
    })
  }

  it('does not overwrite B when A continuation finishes loading its profile late', async () => {
    const s = setup()
    s.setSession(undefined)
    s.respond({ access_token: 'A-access', refresh_token: 'A-refresh', rest_days_cancel: 1 })
    await s.service.testLogin(7)
    let resolveA!: (value: unknown) => void
    let started!: () => void
    const loading = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(s.profile, 'refreshProfileForSession').mockImplementationOnce(async () => {
      started()
      return await new Promise(resolve => { resolveA = resolve }) as never
    })
    s.respond({})
    const resolvingA = s.service.resolveCancellationLogin(true)
    await loading
    s.respond({ access_token: 'B-access', refresh_token: 'B-refresh', rest_days_cancel: 0 })
    await s.service.testLogin(9)
    resolveA({ profile: { contact: { phoneMasked: '138****1234' } } })
    await expect(resolvingA).rejects.toMatchObject({ code: 'cancellation-login-expired' })
    expect(s.session()?.userId).toBe(9)
    // The obsolete A resolver must not clear or replace B's established state.
    await expect(s.service.resolveCancellationLogin(false)).rejects.toMatchObject({ code: 'cancellation-login-expired' })
    expect(s.session()?.refreshToken).toBe('B-refresh')
  })
})
