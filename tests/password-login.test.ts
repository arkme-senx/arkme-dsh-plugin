import { describe, expect, it, vi } from 'vitest'
import { AuthService } from '../src/services/auth-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'
import type { ProfileService } from '../src/services/profile-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { consumerPluginContract } from '../src/tools/system/plugin-contract.js'
import type { ArkmeProviderCapabilities } from '../src/types.js'

function fixture(bindingRequired = false) {
  const runtime = {
    config: { environment: 'test', authBaseUrl: 'https://auth.example' },
    stateStore: { uniqueCode: vi.fn(async () => 'device-fixture'), writeCancellationCompletion: vi.fn() },
    post: vi.fn(async () => ({ user_id: 42, access_token: 'access-fixture', refresh_token: 'refresh-fixture' })),
    requestScope: vi.fn(), invalidateScope: vi.fn(),
    clearPendingBindingSession: vi.fn(), writeSession: vi.fn(),
    writePendingBindingSession: vi.fn(), deleteSession: vi.fn(),
  }
  const profile = { invalidate: vi.fn(), refreshProfileForSession: vi.fn(async () => ({
    profile: { contact: { phoneMasked: bindingRequired ? '' : '138****0000' }, phoneBindingRequired: bindingRequired },
  })) }
  const lifecycle = { reconnectChatRealtime: vi.fn(), clearAccountState: vi.fn() }
  const auth = new AuthService(runtime as unknown as ServiceRuntime, profile as unknown as ProfileService, lifecycle)
  return { auth, runtime, profile, lifecycle }
}

describe('password login', () => {
  it('uses the mobile contract, preserves password whitespace and returns no credentials', async () => {
    const { auth, runtime } = fixture()
    const signal = new AbortController().signal
    const result = await auth.loginByPassword(' review-account ', ' pass phrase ', signal)
    expect(runtime.post).toHaveBeenCalledExactlyOnceWith('https://auth.example', '/api/public/v1/auth/login-by-pwd', {
      account: 'review-account', pwd: ' pass phrase ', unique_code: 'device-fixture', keep_cancel: true,
    }, undefined, [200], signal)
    expect(runtime.writeSession).toHaveBeenCalledWith({ userId: 42, accessToken: 'access-fixture', refreshToken: 'refresh-fixture' })
    expect(result).toEqual({ status: 'authenticated', userId: 42, environment: 'test' })
  })

  it('keeps the existing required-phone gate', async () => {
    const { auth, runtime } = fixture(true)
    await expect(auth.loginByPassword('review', 'pwd')).resolves.toMatchObject({ status: 'binding-required' })
    expect(runtime.writeSession).not.toHaveBeenCalled()
    expect(runtime.writePendingBindingSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 42 }))
  })

  it('keeps cancellation pending until the user explicitly chooses', async () => {
    const { auth, runtime } = fixture()
    runtime.post.mockResolvedValue({ user_id: 42, access_token: 'access-fixture', refresh_token: 'refresh-fixture', rest_days_cancel: 8 } as never)
    await expect(auth.loginByPassword('review', 'pwd')).resolves.toEqual({ status: 'cancellation-pending', restDaysCancel: 8, environment: 'test' })
    expect(runtime.writeSession).not.toHaveBeenCalled()
    await expect(auth.resolveCancellationLogin(false)).resolves.toMatchObject({ status: 'logged-out' })
    expect(runtime.post).toHaveBeenCalledTimes(1)
  })

  it.each([['', 'pwd'], ['review', ''], ['a'.repeat(255), 'pwd'], ['review', 'p'.repeat(1025)]])('rejects invalid credentials locally', async (account, password) => {
    const { auth, runtime } = fixture()
    await expect(auth.loginByPassword(account, password)).rejects.toBeInstanceOf(ArkmePluginError)
    expect(runtime.post).not.toHaveBeenCalled()
  })

  it('normalizes invalid credentials without replaying or replacing the current session', async () => {
    const { auth, runtime } = fixture()
    runtime.post.mockRejectedValue(new ArkmePluginError('arkme-code-1001', 'untrusted upstream detail', false))
    await expect(auth.loginByPassword('review', 'pwd')).rejects.toMatchObject({ code: 'password-login-rejected', message: '账号或密码错误，请重新输入', retryable: false })
    expect(runtime.post).toHaveBeenCalledTimes(1)
    expect(runtime.writeSession).not.toHaveBeenCalled()
    expect(runtime.deleteSession).not.toHaveBeenCalled()
  })

  it('rejects incomplete success and canceled responses before saving credentials', async () => {
    const { auth, runtime } = fixture()
    runtime.post.mockResolvedValue({ user_id: 42, access_token: '', refresh_token: '' })
    await expect(auth.loginByPassword('review', 'pwd')).rejects.toMatchObject({ code: 'login-contract-invalid' })
    const controller = new AbortController(); controller.abort()
    await expect(auth.loginByPassword('review', 'pwd', controller.signal)).rejects.toThrow()
    expect(runtime.writeSession).not.toHaveBeenCalled()
  })

  it('passes the request signal and unmodified password through the Host adapter', async () => {
    const service = { loginByPassword: vi.fn(async () => ({ status: 'authenticated' })) }
    await dispatchArkmeHostOperation(service as never, 'auth.password.login', { account: 'review', password: ' pwd ' })
    expect(service.loginByPassword).toHaveBeenCalledWith('review', ' pwd ', undefined)
  })

  it('exposes typed SDK capability discovery, safe results and abort without persisting input', async () => {
    const calls: unknown[] = []
    const signal = new AbortController().signal
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); calls.push(request)
      expect(init?.signal).toBe(signal)
      return new Response(JSON.stringify({ ok: true, value: request.operation === 'provider.capabilities'
        ? { contractVersion: 1, features: { passwordLogin: true } } : { status: 'authenticated', userId: 42, environment: 'test' } }), { headers: { 'Content-Type': 'application/json' } })
    } })
    await expect(sdk.loginByPassword(' review ', ' pwd ', signal)).resolves.toMatchObject({ status: 'authenticated' })
    expect(calls).toEqual([{ operation: 'provider.capabilities' }, { operation: 'auth.password.login', params: { account: 'review', password: ' pwd ' } }])
    const older = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
    await expect(older.loginByPassword('review', 'pwd')).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
  })

  it('provides a credential-free human handoff through the existing Tool contract', () => {
    const contract = JSON.parse(consumerPluginContract({ features: { passwordLogin: true } } as unknown as ArkmeProviderCapabilities))
    expect(contract.passwordLogin).toMatchObject({ interaction: 'human-only', sdkMethod: 'loginByPassword', entry: '登录即我 → 手机号登录 → 账号密码登录' })
    expect(contract.passwordLogin.instruction).toContain('Never request, accept, store, or submit passwords')
  })
})
