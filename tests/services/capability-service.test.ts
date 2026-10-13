import { describe, expect, it, vi } from 'vitest'
import { CapabilityService, parseCapability } from '../../src/services/capability-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const row = () => ({ key: 'record_thought', title: '快记建议', enabled: false, version: 0, enabled_at: 0 })
function fixture() {
  let userId = 1
  const state = row()
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/query')) return [{ ...state }]
    if (state.version !== body.expected_version) throw new Error('conflict')
    if (state.enabled !== body.enabled) { state.version++; state.enabled = body.enabled as boolean; state.enabled_at = state.enabled ? 1 : 0 }
    return { ...state }
  })
  const service = new CapabilityService({ config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedPost: post } as never)
  return { service, post, state, changeUser: () => { userId++ } }
}

describe('automatic capability owner', () => {
  it.each([
    ['query', 429], ['query', 503], ['update', 429], ['update', 503],
  ] as const)('%s HTTP %s does not delay ordinary Record or Chat requests', async (method, status) => {
    vi.useFakeTimers()
    const session = { userId: 1, accessToken: 'fixture', refreshToken: 'fixture' }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ code: String(input).startsWith('https://chat.test/') ? 200 : 0, data: {} })))
    const runtime = new ServiceRuntime({ environment: 'test', recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', requestTimeoutMs: 5_000 } as ArkmeServiceConfig,
      { read: async () => session, write: async () => {}, delete: async () => {} }, {} as StateStore, fetchImpl)
    const service = new CapabilityService(runtime)
    const controller = new AbortController()
    const pending: Array<Promise<unknown>> = []
    try {
      fetchImpl.mockResolvedValueOnce(new Response('{}', { status, headers: { 'Retry-After': '5' } }))
      const setting = method === 'query' ? service.query('test:1')
        : service.update({ key: 'record_thought', enabled: true, expectedVersion: 0, billingConsent: true }, 'test:1')
      await expect(setting).rejects.toMatchObject({ upstreamStatus: status, retryAfterMillis: 5_000 })
      for (const path of ['/api/v1/records/create', '/api/v1/records/detail']) {
        pending.push(runtime.authenticatedPost(path, {}, session, controller.signal).catch(error => error))
      }
      pending.push(runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, session, controller.signal).catch(error => error))
      await vi.advanceTimersByTimeAsync(100)
      expect(fetchImpl).toHaveBeenCalledTimes(4)
      await expect(Promise.all(pending)).resolves.toEqual([{}, {}, {}])
    } finally {
      controller.abort()
      await Promise.all(pending)
      runtime.requestCoordinator.dispose()
      vi.useRealTimers()
    }
  })
  it('requires consent and an exact observed version; duplicate delivery never toggles twice', async () => {
    const f = fixture()
    const input = { key: 'record_thought' as const, enabled: true, expectedVersion: 0, billingConsent: false }
    await expect(f.service.update(input, 'prod:1')).rejects.toMatchObject({ code: 'capability-update-invalid' })
    expect(f.post).not.toHaveBeenCalled()
    await f.service.update({ ...input, billingConsent: true }, 'prod:1')
    await expect(f.service.update({ ...input, billingConsent: true }, 'prod:1')).rejects.toThrow('conflict')
    expect(f.state).toMatchObject({ enabled: true, version: 1 })
    await f.service.update({ ...input, enabled: false, expectedVersion: 1 }, 'prod:1')
    expect(f.state).toMatchObject({ enabled: false, version: 2 })
    await expect(f.service.update({ ...input, billingConsent: true }, 'prod:1')).rejects.toThrow('conflict')
    expect(f.state.enabled).toBe(false)
  })
  it('isolates account before dispatch and after response without automatic write retry', async () => {
    const f = fixture()
    await expect(f.service.query('prod:2')).rejects.toMatchObject({ code: 'capability-account-changed' })
    expect(f.post).not.toHaveBeenCalled()
    f.post.mockImplementationOnce(async () => { f.changeUser(); return [row()] })
    await expect(f.service.query('prod:1')).rejects.toMatchObject({ code: 'capability-account-changed' })
    expect(f.post).toHaveBeenCalledOnce()
  })
  it('never invents enabled state from incomplete or duplicate owner data', async () => {
    expect(() => parseCapability({ ...row(), enabled: true })).toThrow()
    expect(() => parseCapability({ ...row(), version: 1.1 })).toThrow()
    const f = fixture()
    f.post.mockResolvedValueOnce([row(), row()])
    await expect(f.service.query('prod:1')).rejects.toMatchObject({ code: 'capability-contract-invalid' })
  })
})
