import { describe, expect, it, vi } from 'vitest'
import { LoginDevicesService } from '../src/services/login-devices-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'
import type { LoginDevicePage, DeviceConfirmation, DeviceOperation } from '../src/login-devices-contract.js'

function fixture() {
  const credentials = { userId: 7, accessToken: 'access', refreshToken: 'refresh' }
  let clock = 1_800_000_000_000
  let revision = 0
  const row = { client_id: 2, session_ref: 'original_login_session_123', revision: 4, name: 'Phone', platform: 'android', is_current: false, presence: 'unknown', last_active_at: clock }
  const page = () => ({ items: [row], total: 1, count_complete: false, next_client_id: 0, server_time: clock, capabilities: { logout: true, trusted: true } })
  const read = vi.fn(async (_path: string, _body: Record<string, unknown>): Promise<unknown> => page())
  const write = vi.fn(async (_path: string, body: Record<string, unknown>): Promise<unknown> => ({ operation: { request_id: body.request_id, kind: 'logout', revision: 5 }, credential_revoked: true, cleanup_state: 'pending' }))
  const runtime = { config: { environment: 'test' }, stateStore: { uniqueCode: async () => 'private-profile-secret' }, requireSession: async () => credentials, authenticatedAuthReadPost: read, authenticatedAuthPost: write,
    requestScope: (user: number) => `test:${user}`, readRevision: () => revision, invalidateKey: () => { revision++ },
  } as unknown as ServiceRuntime
  const service = new LoginDevicesService(runtime, () => clock)
  const list = () => service.execute({ action: 'list', accountScope: 'test:7' }) as Promise<LoginDevicePage>
  const prepare = async () => service.execute({ action: 'prepare', accountScope: 'test:7', ref: (await list()).items[0]!.ref, kind: 'logout' }) as Promise<DeviceConfirmation>
  return { service, credentials, row, read, write, list, prepare, advance: () => { clock += 6 * 60_000 } }
}
describe('login device Host owner', () => {
  it('forget requires confirmed revocation, tracks cleanup and rejects self removal', async () => {
    const f = fixture()
    const p = await f.service.execute({ action: 'prepare', accountScope: 'test:7', ref: (await f.list()).items[0]!.ref, kind: 'forget' }) as DeviceConfirmation
    f.write.mockImplementation(async (_path, body) => ({ operation: { request_id: body.request_id, kind: 'forget', revision: 5 }, credential_revoked: false, cleanup_state: 'not-applicable' }))
    expect(await f.service.execute({ action: 'confirm', accountScope: 'test:7', ticket: p.ticket })).toMatchObject({ state: 'unknown', cleanup: 'pending' })
    f.write.mockImplementation(async (_path, body) => ({ operation: { request_id: body.request_id, kind: 'forget', revision: 5 }, credential_revoked: true, cleanup_state: 'complete' }))
    expect(await f.service.execute({ action: 'confirm', accountScope: 'test:7', ticket: p.ticket })).toMatchObject({ state: 'applied', cleanup: 'complete' })
    f.row.is_current = true
    const self = (await f.list()).items[0]!
    expect(self.canForget).toBe(false)
    await expect(f.service.execute({ action: 'prepare', accountScope: 'test:7', ref: self.ref, kind: 'forget' })).rejects.toThrow()
  })
  it('projects safe fields and does not confuse incomplete inventory with count', async () => {
    const f = fixture(), p = await f.list()
    expect(p.countComplete).toBe(false)
    expect(p.items[0]?.presence).toBe('unknown')
    expect(JSON.stringify(p)).not.toMatch(/client_id|session_ref|original_login|refresh|accessToken/)
    expect(p.items[0]?.notificationsSupported).toBe(false)
  })
  it('rejects another account before I/O', async () => {
    const f = fixture()
    await expect(f.service.execute({ action: 'list', accountScope: 'prod:7' })).rejects.toThrow('账号已切换')
    expect(f.read).not.toHaveBeenCalled()
  })
  it('rejects forged refs, self logout and expired confirmation without mutation', async () => {
    const f = fixture()
    await expect(f.service.execute({ action: 'prepare', accountScope: 'test:7', ref: 'forged', kind: 'logout' })).rejects.toThrow()
    f.row.is_current = true
    await expect(f.prepare()).rejects.toThrow()
    f.row.is_current = false
    const p = await f.prepare(); f.advance()
    await expect(f.service.execute({ action: 'confirm', accountScope: p.accountScope, ticket: p.ticket })).rejects.toThrow()
    expect(f.write).not.toHaveBeenCalled()
  })
  it('cannot replay a reference after same-user re-login', async () => {
    const f = fixture(), p = await f.prepare()
    f.credentials.refreshToken = 'new-login'
    await expect(f.service.execute({ action: 'confirm', accountScope: p.accountScope, ticket: p.ticket })).rejects.toThrow()
    expect(f.write).not.toHaveBeenCalled()
  })
  it('pins revision and operation identity across retries', async () => {
    const f = fixture(), p = await f.prepare()
    const input = { action: 'confirm' as const, accountScope: p.accountScope, ticket: p.ticket }
    expect((await f.service.execute(input) as DeviceOperation).state).toBe('applied')
    await f.service.execute(input)
    expect(f.write.mock.calls[0]?.[1]).toEqual(f.write.mock.calls[1]?.[1])
    expect(f.write.mock.calls[0]?.[1]).toMatchObject({ client_id: 2, session_ref: f.row.session_ref, revision: 4 })
  })
  it('reconciles lost acknowledgement with the original ID', async () => {
    const f = fixture(), p = await f.prepare()
    f.write.mockImplementation(async (_path, body) => {
      f.read.mockResolvedValue({ found: true, operation: { request_id: body.request_id, kind: 'logout', revision: 5 }, credential_revoked: true })
      throw new Error('network lost')
    })
    expect((await f.service.execute({ action: 'confirm', accountScope: p.accountScope, ticket: p.ticket }) as DeviceOperation).state).toBe('applied')
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.read.mock.lastCall?.[1].request_id).toBe(f.write.mock.calls[0]?.[1].request_id)
  })
  it('keeps ambiguous writes unknown and permits read-only reconciliation after expiry', async () => {
    const f = fixture(), p = await f.prepare()
    f.write.mockRejectedValue(new Error('network lost')); f.read.mockRejectedValue(new Error('offline'))
    expect((await f.service.execute({ action: 'confirm', accountScope: p.accountScope, ticket: p.ticket }) as DeviceOperation).state).toBe('unknown')
    f.advance(); f.read.mockResolvedValue({ found: false })
    expect((await f.service.execute({ action: 'operation', accountScope: p.accountScope, ticket: p.ticket }) as DeviceOperation).state).toBe('unknown')
  })
  it('does not report a concurrent replacement conflict as success', async () => {
    const f = fixture(), p = await f.prepare()
    f.write.mockRejectedValue(new ArkmePluginError('conflict', '设备已变化', false, 409))
    await expect(f.service.execute({ action: 'confirm', accountScope: p.accountScope, ticket: p.ticket })).rejects.toThrow('设备已变化')
    expect(f.read).toHaveBeenCalledTimes(1)
  })
  it('rejects wrong receipt and over-sized page', async () => {
    const f = fixture(), p = await f.prepare()
    f.write.mockResolvedValue({ operation: { request_id: 'wrong', kind: 'logout', revision: 5 }, credential_revoked: true })
    await expect(f.service.execute({ action: 'confirm', accountScope: p.accountScope, ticket: p.ticket })).rejects.toThrow()
    f.read.mockResolvedValue({ items: Array(51).fill(f.row), count_complete: true })
    await expect(f.list()).rejects.toThrow()
  })
  it('does not leak a response after account changes in flight', async () => {
    const f = fixture()
    f.read.mockImplementation(async () => { f.credentials.userId = 8; return {} })
    await expect(f.list()).rejects.toThrow('账号已切换')
  })
  it('rejects a pre-mutation response even when the write acknowledgement is lost', async () => {
    const f = fixture(), p = await f.prepare()
    let release!: (value: unknown) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    f.read.mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve }) })
    const stale = f.list()
    const rejected = expect(stale).rejects.toThrow('设备状态已变化')
    await started
    f.write.mockRejectedValue(new Error('lost response'))
    f.read.mockResolvedValue({ found: false })
    await f.service.execute({ action: 'confirm', accountScope: p.accountScope, ticket: p.ticket })
    release({})
    await rejected
  })
})
