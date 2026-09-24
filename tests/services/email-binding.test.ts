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
  const profile = { invalidate: vi.fn(), refreshProfileForSession: async () => ({ profile: { contact: { phoneMasked: '138****1234' } } }) } as unknown as ProfileService
  const service = new AuthService(runtime, profile, { reconnectChatRealtime() {}, clearAccountState() {} })
  return { service, profile, restart: () => new AuthService(runtime, profile, { reconnectChatRealtime() {}, clearAccountState() {} }), requests, session: () => session, setSession: (value: typeof session) => { session = value }, respond: (value: unknown) => { response = value }, failDelete: (value: boolean) => { failDelete = value } }
}

describe('email binding', () => {
  it('uses authenticated email endpoints and preserves the session', async () => {
    const s = setup(); s.respond({ result: 1 })
    await expect(s.service.sendEmailBindCode(7, ' person@example.com ')).resolves.toEqual({ sent: true })
    await expect(s.service.bindEmail(7, 'person@example.com', '1234')).resolves.toEqual({ bound: true })
    expect(s.requests.map(r => new URL(r.path).pathname)).toEqual(['/api/v1/auth/email-bind-send-code', '/api/v1/auth/email-bind'])
    expect(s.requests[1]?.body).toEqual({ email: 'person@example.com', code: '1234' })
    expect(s.session()?.userId).toBe(7)
    expect(s.profile.invalidate).toHaveBeenCalledWith(7)
  })
  it.each([[2, '其他账号'], [3, '当前账号已绑定'], [4, '验证码错误'], [99, '响应异常']])('rejects binding result %s', async (result, message) => {
    const s = setup(); s.respond({ result })
    await expect(s.service.bindEmail(7, 'a@example.com', '1234')).rejects.toThrow(String(message))
    expect(s.profile.invalidate).not.toHaveBeenCalled()
  })
  it('rejects bad input and stale account before issuing requests', async () => {
    const s = setup()
    await expect(s.service.sendEmailBindCode(7, 'bad')).rejects.toThrow('邮箱地址')
    await expect(s.service.sendEmailBindCode(8, 'a@example.com')).rejects.toThrow('账号已切换')
    await expect(s.service.bindEmail(7, 'a@example.com', '123456')).rejects.toThrow('4位')
    expect(s.requests).toHaveLength(0)
  })
})
