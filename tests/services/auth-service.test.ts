import { describe, expect, it, vi } from 'vitest'
import { ArkmeAccountSessionOwner, type ArkmeAccountScopeBridge } from '../../src/account-session-owner.js'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { AuthService, jiwoScanLoginAvailable } from '../../src/services/auth-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ArkmePluginError, ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://jotmo.senguo.me', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
  shareWebsite: 'https://jotmo-app.senguo.me',
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('AuthService', () => {
  it('reports a logged-out state without touching upstream services', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return undefined }, async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn() as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const service = new AuthService(runtime, new ProfileService(runtime), {
      reconnectChatRealtime() {}, clearAccountState() {},
    })

    await expect(service.authStatus()).resolves.toEqual({ status: 'logged-out', environment: 'test' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps backend ticket and poll secret inside Host attempts', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return undefined }, async write() {}, async delete() {},
    }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const expiresAt = 1_700_000_300_000
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/start')) return json({
        ticket: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        poll_secret: 'SeCrEtGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        expires_at: expiresAt,
      })
      if (url.endsWith('/poll')) return json({ status: 'pending' })
      if (url.endsWith('/cancel')) return json({ status: 'canceled' })
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'desktop-device-1' },
    } as StateStore, fetchImpl)
    const service = new AuthService(runtime, new ProfileService(runtime), {
      reconnectChatRealtime() {}, clearAccountState() {},
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const begun = await service.beginJiwoLogin()
      expect(begun).toMatchObject({
        status: 'pending',
        qrContent: 'https://jotmo-app.senguo.me/login/desktop?ticket=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        expiresAtMillis: expiresAt,
      })
      expect(JSON.stringify(begun)).not.toContain('poll_secret')
      expect(JSON.stringify(begun)).not.toContain('SeCrEt')
      expect(begun.attemptId).toBeTypeOf('string')

      const pending = await service.pollJiwoLogin(begun.attemptId ?? '')
      expect(pending).toEqual(begun)
      expect(requests[1]?.body).toEqual({
        ticket: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        poll_secret: 'SeCrEtGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
      })

      await expect(service.cancelJiwoLogin(begun.attemptId ?? '')).resolves.toEqual({ canceled: true })
      expect(requests[2]?.body).toEqual(requests[1]?.body)
    } finally {
      now.mockRestore()
    }
  })

  it('enables Jiwo scan login without a feature flag when the Jiwo account domain matches', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return undefined }, async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn() as typeof fetch
    expect(jiwoScanLoginAvailable(config)).toBe(true)

    const wrongDomainRuntime = new ServiceRuntime({
      ...config,
      authBaseUrl: 'https://api.arkme.ai',
    }, sessions, {} as StateStore, fetchImpl)
    const wrongDomainService = new AuthService(wrongDomainRuntime, new ProfileService(wrongDomainRuntime), {
      reconnectChatRealtime() {}, clearAccountState() {},
    })
    await expect(wrongDomainService.beginJiwoLogin()).rejects.toMatchObject({ code: 'jiwo-scan-login-disabled' })
    expect(jiwoScanLoginAvailable({ ...config, authBaseUrl: 'http://jotmo.senguo.me' })).toBe(false)
    expect(jiwoScanLoginAvailable({ ...config, shareWebsite: 'https://jotmo-app.senguo.me:8443' })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not treat an empty attempt ID as cancel all', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return undefined }, async write() {}, async delete() {},
    }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/start')) return json({
        ticket: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        poll_secret: 'SeCrEtGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        expires_at: 1_700_000_300_000,
      })
      if (url.endsWith('/poll')) return json({ status: 'pending' })
      if (url.endsWith('/cancel')) return json({ status: 'canceled' })
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'desktop-device-1' },
    } as StateStore, fetchImpl)
    const service = new AuthService(runtime, new ProfileService(runtime), {
      reconnectChatRealtime() {}, clearAccountState() {},
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      const begun = await service.beginJiwoLogin()
      await service.cancelJiwoLogin('')

      await expect(service.pollJiwoLogin(begun.attemptId ?? '')).resolves.toEqual(begun)
      expect(requests.some(request => request.url.endsWith('/cancel'))).toBe(false)
    } finally {
      now.mockRestore()
    }
  })

  it('cancels an active app ticket when WeChat login starts directly through Host', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return undefined }, async write() {}, async delete() {},
    }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/start')) return json({
        ticket: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        poll_secret: 'SeCrEtGhIjKlMnOpQrStUvWxYz0123456789_-abc12',
        expires_at: 1_700_000_300_000,
      })
      if (url.endsWith('/cancel')) return json({ status: 'canceled' })
      if (url.endsWith('/wechat-oauth-login-qrcode')) return json({
        url: 'https://weixin.qq.com/q/example',
        scene_str: 'scene-example',
        poll_token: 'poll-token-example',
        expire_seconds: 300,
      })
      throw new Error(`unexpected URL ${url}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'desktop-device-1' },
    } as StateStore, fetchImpl)
    const service = new AuthService(runtime, new ProfileService(runtime), {
      reconnectChatRealtime() {}, clearAccountState() {},
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    try {
      await service.beginJiwoLogin()
      await service.beginWechatLogin()

      expect(requests.map(request => request.url)).toEqual([
        'https://jotmo.senguo.me/api/public/v1/auth/app-scan-login/start',
        'https://jotmo.senguo.me/api/public/v1/auth/app-scan-login/cancel',
        'https://jotmo.senguo.me/api/public/v1/auth/wechat-oauth-login-qrcode',
      ])
    } finally {
      now.mockRestore()
    }
  })
})

describe('phone unbind', () => {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  const captcha = { lot_number: 'lot', captcha_output: 'output', pass_token: 'pass', gen_time: 'time' }
  function setup(result: number) {
    const runtime = { config, sessionStore: { read: vi.fn(async () => session) }, readPendingBindingSession: vi.fn(async () => undefined), requireSession: vi.fn(async () => session), post: vi.fn(async () => ({ result })),
      authenticatedAuthGet: vi.fn(async () => ({ user_id: 42, phone: '' })),
      authenticatedRequestOptions: vi.fn((_session, _service, _lane, options) => options),
      writePendingBindingSession: vi.fn(), moveSessionToPendingBinding: vi.fn(async () => true),
      invalidateScope: vi.fn(), requestScope: vi.fn(() => '42') } as unknown as ServiceRuntime
    const profile = { invalidate: vi.fn(), refreshProfileForSession: vi.fn(), profileForSession: vi.fn() } as unknown as ProfileService
    const service = new AuthService(runtime, profile, { reconnectChatRealtime() {}, clearAccountState() {} })
    return { service, runtime, profile }
  }
  it.each([true, false])('reads backend eligibility %s without sending SMS or mutating the account', async allowed => {
    const { service, runtime } = setup(2)
    vi.mocked(runtime.authenticatedAuthGet).mockResolvedValue({ user_id: 42, can_unbind_phone: allowed })
    await expect(service.checkPhoneUnbindEligibility(42)).resolves.toEqual({ allowed })
    expect(runtime.authenticatedAuthGet).toHaveBeenCalledWith(
      '/api/v1/auth/get-user-info?include_phone_unbind_eligibility=true', session, undefined,
      { lane: 'auth', bypassCache: true },
    )
    expect(runtime.post).not.toHaveBeenCalled()
  })
  it.each([{ user_id: 42 }, { user_id: 43, can_unbind_phone: true }, { user_id: 42, can_unbind_phone: 'true' }])('rejects ambiguous eligibility %j', async data => {
    const { service, runtime } = setup(2)
    vi.mocked(runtime.authenticatedAuthGet).mockResolvedValue(data)
    await expect(service.checkPhoneUnbindEligibility(42)).rejects.toMatchObject({ code: 'phone-unbind-eligibility-unknown' })
    expect(runtime.post).not.toHaveBeenCalled()
  })
  it('rejects an entry from another account before checking eligibility', async () => {
    const { service, runtime } = setup(2)
    await expect(service.checkPhoneUnbindEligibility(43)).rejects.toMatchObject({ code: 'phone-unbind-session-changed' })
    expect(runtime.authenticatedAuthGet).not.toHaveBeenCalled()
  })
  it('rejects eligibility returned after the session changed', async () => {
    const { service, runtime } = setup(2)
    vi.mocked(runtime.authenticatedAuthGet).mockImplementation(async () => {
      vi.mocked(runtime.requireSession).mockResolvedValue({ ...session, refreshToken: 'other-session' })
      return { user_id: 42, can_unbind_phone: true }
    })
    await expect(service.checkPhoneUnbindEligibility(42)).rejects.toMatchObject({ code: 'phone-unbind-eligibility-unknown' })
  })
  it('sends captcha only and never accepts a client supplied phone target', async () => {
    const { service, runtime } = setup(2)
    await expect(service.sendPhoneUnbindCode(captcha)).resolves.toEqual({ sent: true })
    expect(runtime.post).toHaveBeenCalledWith(config.authBaseUrl, '/api/v1/auth/phone-unbind-send-code', captcha, 'access', [200])
  })
  it.each([3, 4, 999])('rejects backend result %s without invalidating profile', async result => {
    const { service, profile } = setup(result)
    await expect(service.unbindPhone('123456')).rejects.toThrow()
    expect(profile.invalidate).not.toHaveBeenCalled()
  })
  it.each([1, 2])('keeps mandatory phone binding after unlink result %s and parks the existing session', async result => {
    const { service, runtime, profile } = setup(result)
    const unbound = { profile: { contact: {} } } as Awaited<ReturnType<ProfileService['profileForSession']>>
    vi.mocked(profile.refreshProfileForSession).mockResolvedValue(unbound)
    vi.mocked(profile.profileForSession).mockResolvedValue(unbound)
    await expect(service.unbindPhone('123456')).resolves.toEqual({
      status: 'binding-required', environment: 'test', userId: 42,
    })
    expect(runtime.moveSessionToPendingBinding).toHaveBeenCalledWith(session)
    expect(runtime.post).toHaveBeenCalledTimes(1)
  })
  it('does not park old credentials if another account replaced the session', async () => {
    const { service, runtime, profile } = setup(2)
    const unbound = { profile: { contact: {} } } as Awaited<ReturnType<ProfileService['profileForSession']>>
    vi.mocked(profile.refreshProfileForSession).mockResolvedValue(unbound)
    vi.mocked(runtime.moveSessionToPendingBinding).mockResolvedValue(false)
    await expect(service.unbindPhone('123456')).rejects.toMatchObject({ code: 'phone-unbind-session-changed' })
    expect(runtime.writePendingBindingSession).not.toHaveBeenCalled()
    expect(profile.profileForSession).not.toHaveBeenCalled()
  })
  it('never resends a mutation when the previous result is still unknown', async () => {
    const { service, runtime, profile } = setup(2)
    vi.mocked(runtime.post).mockRejectedValue(new ArkmePluginError('arkme-timeout', 'timeout', true))
    vi.mocked(runtime.authenticatedAuthGet).mockRejectedValue(new Error('offline'))
    await expect(service.unbindPhone('123456')).rejects.toMatchObject({ code: 'phone-unbind-outcome-unknown' })
    await expect(service.unbindPhone('123456')).rejects.toMatchObject({ code: 'phone-unbind-outcome-unknown' })
    expect(runtime.post).toHaveBeenCalledTimes(1)
    expect(runtime.authenticatedAuthGet).toHaveBeenCalledTimes(2)
  })
  it.each([{ user_id: 42 }, { user_id: 42, phone: null }, { user_id: 43, phone: '' }])('does not treat malformed or foreign owner facts as unbound: %j', async data => {
    const { service, runtime } = setup(2)
    vi.mocked(runtime.authenticatedAuthGet).mockResolvedValue(data)
    await expect(service.unbindPhone('123456')).rejects.toMatchObject({ code: 'phone-unbind-outcome-unknown' })
    expect(runtime.moveSessionToPendingBinding).not.toHaveBeenCalled()
  })
  it('does not park a still-bound account after an unknown write', async () => {
    const { service, runtime } = setup(2)
    vi.mocked(runtime.post).mockRejectedValue(new ArkmePluginError('arkme-timeout', 'timeout', true))
    vi.mocked(runtime.authenticatedAuthGet).mockResolvedValue({ user_id: 42, phone: '13800138000' })
    await expect(service.unbindPhone('123456')).rejects.toMatchObject({ code: 'phone-unbind-not-completed' })
    expect(runtime.moveSessionToPendingBinding).not.toHaveBeenCalled()
  })
  it('does not reuse an unknown result across a new login for the same account', async () => {
    const { service, runtime } = setup(2)
    vi.mocked(runtime.authenticatedAuthGet).mockRejectedValue(new Error('offline'))
    await expect(service.unbindPhone('123456')).rejects.toThrow()
    vi.mocked(runtime.requireSession).mockResolvedValue({ ...session, refreshToken: 'new-login' })
    await expect(service.unbindPhone('654321')).rejects.toThrow()
    expect(runtime.post).toHaveBeenCalledTimes(2)
  })
  it('does not publish pending credentials if durable storage rejects the write', async () => {
    const sessions: ArkmeSessionStore = { read: vi.fn(async () => session), write: vi.fn(), delete: vi.fn() }
    const pending: ArkmeSessionStore = { read: vi.fn(async () => undefined), write: vi.fn(async () => { throw new Error('disk full') }), delete: vi.fn() }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, vi.fn(), pending)
    await expect(runtime.moveSessionToPendingBinding(session)).rejects.toThrow('disk full')
    expect(await runtime.readPendingBindingSession()).toBeUndefined()
    expect(await sessions.read()).toEqual(session)
    expect(sessions.delete).not.toHaveBeenCalled()
  })

  function realRuntimeFixture(commitFails = false, upstreamStatus = 200) {
    let active: typeof session | undefined = session
    let parked: typeof session | undefined
    const sessions: ArkmeSessionStore = { read: async () => active, write: async value => { active = value }, delete: async () => { active = undefined } }
    const pending: ArkmeSessionStore = { read: async () => parked, write: async value => { parked = value }, delete: async () => { parked = undefined } }
    const bridge: ArkmeAccountScopeBridge = {
      attest: async () => ({ status: 'ready' }), prepare: async () => ({ transitionRef: 'test-transition' }),
      commit: async () => { if (commitFails) throw new Error('bridge commit unavailable'); return { status: 'ready' } },
      abort: async () => ({ status: 'ready' }),
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/phone-unbind')) return upstreamStatus === 200 ? json({ result: 2 }) : new Response('upstream failed', { status: upstreamStatus })
      if (String(input).endsWith('/get-user-info')) return json({ user_id: 42, phone: '' })
      throw new Error('unexpected request')
    }) as typeof fetch
    const owner = new ArkmeAccountSessionOwner(sessions, bridge)
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl, pending, owner)
    const service = new AuthService(runtime, new ProfileService(runtime), { reconnectChatRealtime() {}, clearAccountState() {} })
    return { service, runtime, fetchImpl, sessions, pending }
  }

  it('recovers a persisted handoff after desktop commit failure without another unlink', async () => {
    const { service, runtime, fetchImpl, sessions, pending } = realRuntimeFixture(true)
    await expect(service.unbindPhone('123456')).rejects.toThrow('bridge commit unavailable')
    expect(await sessions.read()).toBeUndefined()
    expect(await pending.read()).toEqual(session)
    await expect(service.unbindPhone('123456')).resolves.toEqual({ status: 'binding-required', environment: 'test', userId: 42 })
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith('/phone-unbind'))).toHaveLength(1)
    runtime.dispose()
  })

  it('reconciles an HTTP 500 write through the owner instead of repeating it', async () => {
    const { service, runtime, fetchImpl } = realRuntimeFixture(false, 500)
    await expect(service.unbindPhone('123456')).resolves.toEqual({ status: 'binding-required', environment: 'test', userId: 42 })
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith('/phone-unbind'))).toHaveLength(1)
    runtime.dispose()
  })

  it.each([undefined, { userId: 43, accessToken: 'other-access', refreshToken: 'other-refresh' }])('does not recover an unlink through missing or replaced credentials: %j', async active => {
    const { service, runtime } = setup(2)
    vi.mocked(runtime.requireSession).mockRejectedValue(new ArkmePluginError('login-required', 'login required', false))
    runtime.sessionStore.read = vi.fn(async () => active)
    vi.mocked(runtime.readPendingBindingSession).mockResolvedValue(active === undefined ? undefined : session)
    await expect(service.unbindPhone('123456')).rejects.toMatchObject({ code: 'login-required' })
    expect(runtime.post).not.toHaveBeenCalled()
  })

  it('retries a failed active-credential delete without repeating the backend mutation', async () => {
    const { service, runtime, fetchImpl, sessions } = realRuntimeFixture()
    const remove = sessions.delete.bind(sessions)
    sessions.delete = vi.fn().mockRejectedValueOnce(new Error('keychain unavailable')).mockImplementation(remove)
    await expect(service.unbindPhone('123456')).rejects.toThrow('keychain unavailable')
    expect(await sessions.read()).toEqual(session)
    await expect(service.unbindPhone('123456')).resolves.toMatchObject({ status: 'binding-required', userId: 42 })
    expect(await sessions.read()).toBeUndefined()
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith('/phone-unbind'))).toHaveLength(1)
    runtime.dispose()
  })

})
