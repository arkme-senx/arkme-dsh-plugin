import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceRegistrationService } from '../src/services/device-registration-service.js'
import type { ServiceRuntime } from '../src/services/service.js'

function session(userId = 42, clientId = 35) {
  return { userId, accessToken: `header.${Buffer.from(JSON.stringify({ client_id: clientId })).toString('base64url')}.sig`, refreshToken: `refresh-${userId}` }
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve() }
function setup() {
  let current: ReturnType<typeof session> | undefined = session()
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('/list')) return { items: [], next_cursor: '' }
    if (path === '/api/v1/device/register') return { device: { registration_generation: 'g1', client_id: 35 } }
    if (path.endsWith('/im-binding/register')) return { binding_generation: 'b1' }
    return { device: { registration_generation: 'g1' } }
  })
  const cleanup = vi.fn(async () => ({}))
  const runtime = { config: { appVersion: '3.0.test', webrtcBaseUrl: 'https://test.invalid' },
    accountScopedSession: async () => current, requireSession: async () => current!, authenticatedWebrtcPost: post, post: cleanup }
  const service = new DeviceRegistrationService(runtime as unknown as ServiceRuntime)
  return { service, post, cleanup, setSession(value: typeof current) { current = value } }
}
afterEach(() => vi.useRealTimers())
describe('device registration lifecycle', () => {
  it('registers platform 5 but waits for SDK readiness before binding', async () => {
    vi.useFakeTimers();const { service, post } = setup()
    service.start(session());await settle()
    expect(post).toHaveBeenCalledWith('/api/v1/device/register', expect.objectContaining({ platform: 5, expected_generation: '' }), expect.anything(), expect.anything())
    expect(post.mock.calls.some(([p]) => p.includes('im-binding'))).toBe(false)
    await service.ready(42, 'test_alice__cz');await settle()
    expect(post).toHaveBeenCalledWith('/api/v1/device/im-binding/register', expect.objectContaining({ registration_id: 'test_alice__cz', registration_generation: 'g1' }), expect.anything(), expect.anything())
    await vi.advanceTimersByTimeAsync(30_000)
    const heartbeats = post.mock.calls.filter(([p]) => p.endsWith('/heartbeat'))
    expect(heartbeats.at(-1)?.[1]).toMatchObject({ event: 'heartbeat' })
    service.activity();await vi.advanceTimersByTimeAsync(30_000)
    expect(post.mock.calls.filter(([p]) => p.endsWith('/heartbeat')).at(-1)?.[1]).toMatchObject({ event: 'app_active' })
    service.dispose()
  })
  it('keeps the binding idempotency key across a failed acknowledgement without logging into SDK', async () => {
    vi.useFakeTimers();const { service, post } = setup();const original = post.getMockImplementation()!;let failed = false
    post.mockImplementation(async (...args) => { if (args[0].endsWith('/im-binding/register') && !failed) { failed = true; throw new Error('response lost') };return original(...args) })
    service.start(session());await settle();await service.ready(42, 'test_alice__cz');await settle()
    await vi.advanceTimersByTimeAsync(5000)
    const binds = post.mock.calls.filter(([p]) => p.endsWith('/im-binding/register'))
    expect(binds).toHaveLength(2);expect(binds[0]?.[1]).toEqual(binds[1]?.[1])
    service.dispose()
  })
  it('refreshes credentials without re-registering, and cleans up using old account credentials', async () => {
    vi.useFakeTimers();const { service, post, cleanup, setSession } = setup()
    service.start(session());await settle();await service.ready(42, 'test_alice__cz');await settle()
    const refreshed = { ...session(), accessToken: session().accessToken + 'new' }
    setSession(refreshed);service.start(refreshed);await settle()
    expect(post.mock.calls.filter(([p]) => p === '/api/v1/device/register')).toHaveLength(1)
    service.clearUser(42);setSession(session(43));await settle()
    expect(cleanup).toHaveBeenCalledWith('https://test.invalid', '/api/v1/device/im-binding/unregister', expect.objectContaining({ binding_generation: 'b1' }), refreshed.accessToken, [200], expect.anything())
    await vi.advanceTimersByTimeAsync(120_000)
    expect(post.mock.calls.filter(([p]) => p === '/api/v1/device/register')).toHaveLength(1)
  })
  it('re-registers and rebinds once after generation loss, then fences a competing owner', async () => {
    vi.useFakeTimers(); const { service, post } = setup(); const original = post.getMockImplementation()!
    service.start(session()); await settle(); await service.ready(42, 'test_alice__cz'); await settle()
    post.mockImplementation(async (...args) => { if (args[0].endsWith('/heartbeat')) throw { responseData: { reason: 'stale_generation' } }; return original(...args) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(post.mock.calls.filter(([p]) => p === '/api/v1/device/register')).toHaveLength(2)
    expect(post.mock.calls.filter(([p]) => p.endsWith('/im-binding/register'))).toHaveLength(2)
    const count = post.mock.calls.length; await vi.advanceTimersByTimeAsync(120_000); expect(post.mock.calls).toHaveLength(count)
    service.dispose()
  })
  it('does not invent client IDs and ignores readiness from an old account', async () => {
    vi.useFakeTimers();const { service, post } = setup()
    service.start({ ...session(), accessToken: 'invalid' });await settle();expect(post).not.toHaveBeenCalled()
    await service.ready(99, 'wrong');await settle();expect(post).not.toHaveBeenCalled();service.dispose()
  })
})
