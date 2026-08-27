import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { AuthService, jiwoScanLoginAvailable } from '../../src/services/auth-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

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
