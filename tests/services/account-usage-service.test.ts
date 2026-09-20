import { describe, expect, it, vi } from 'vitest'
import { AccountUsageService, parseStorageUsage, parseTokenUsage, parseVoiceUsage } from '../../src/services/account-usage-service.js'

describe('account usage contracts', () => {
  it('keeps QToken used and remaining separate from monetary balance', () => {
    expect(parseTokenUsage({ used_token: 10, able_token: 90 }, 'prod:11')).toEqual({ accountScope: 'prod:11', used: 10, remaining: 90 })
    expect(parseTokenUsage({ used_token: 0, able_token: 0 }, 'prod:11')).toMatchObject({ used: 0, remaining: 0 })
  })
  it.each([{}, { used_token: 0 }, { used_token: -1, able_token: 5 }, { used_token: '1', able_token: 5 }, { used_token: 1.2, able_token: 5 }, { used_token: 1, able_token: Infinity }, { used_token: Number.MAX_SAFE_INTEGER, able_token: 1 }])('rejects invalid tokens rather than inventing a zero %j', raw => {
    expect(() => parseTokenUsage(raw, 'prod:11')).toThrow()
  })
  it('uses bytes or binary MB using the mobile field precedence', () => {
    expect(parseStorageUsage({ file_size_mb: 100 }, { size: 1024 }, 'prod:11')).toEqual({ accountScope: 'prod:11', totalBytes: 100 * 1024 ** 2, usedBytes: 1024 })
    expect(parseStorageUsage({ file_size: 80, file_size_mb: 100 }, { used_file_size: 90, size: 10 }, 'prod:11')).toMatchObject({ totalBytes: 80, usedBytes: 90 })
    expect(parseStorageUsage({ file_size: 0 }, { size: 0 }, 'prod:11')).toMatchObject({ totalBytes: 0, usedBytes: 0 })
  })
  it('preserves voice seconds and remaining semantics, including zero allowance', () => {
    expect(parseVoiceUsage({ used_sec: 61, able_sec: 119 }, 'prod:11')).toEqual({ accountScope: 'prod:11', usedSeconds: 61, remainingSeconds: 119 })
    expect(parseVoiceUsage({ used_sec: 0, able_sec: 0 }, 'prod:11')).toMatchObject({ usedSeconds: 0, remainingSeconds: 0 })
  })
  it.each([{}, { used_sec: 0 }, { used_sec: -1, able_sec: 5 }, { used_sec: '1', able_sec: 5 }, { used_sec: 1.2, able_sec: 5 }, { used_sec: 1, able_sec: Infinity }, { used_sec: Number.MAX_SAFE_INTEGER, able_sec: 1 }])('rejects invalid voice seconds instead of silently returning zero %j', raw => {
    expect(() => parseVoiceUsage(raw, 'prod:11')).toThrow()
  })
  it.each([[{}, { size: 2 }], [{ file_size_mb: 2 }, {}], [{ file_size: -1 }, { size: 2 }], [{ file_size_mb: Number.MAX_SAFE_INTEGER }, { size: 2 }], [{ file_size: null }, { size: 2 }]])('rejects missing, unsafe or invalid storage fields', (member, usage) => {
    expect(() => parseStorageUsage(member, usage, 'prod:11')).toThrow()
  })
  function fixture() {
    const config = { environment: 'prod' }
    let userId = 11
    const read = vi.fn(async (path: string) => {
      if (path.endsWith('q-token-limited-opt')) return { used_token: 10, able_token: 90 }
      if (path.endsWith('vop-limited-opt')) return { used_sec: 60, able_sec: 120 }
      if (path.endsWith('member')) return { file_size_mb: 100 }
      return { size: 2048 }
    })
    const service = new AccountUsageService({ config, requireSession: async () => ({ userId }), authenticatedAuthReadPost: read } as never)
    return { service, read, config, setUser: (id: number) => { userId = id } }
  }
  it('reads monthly VOP separately from Token/storage without debiting or querying recordings', async () => {
    const { service, read } = fixture()
    await expect(service.tokens('prod:11')).resolves.toMatchObject({ used: 10, remaining: 90 })
    await expect(service.storage('prod:11')).resolves.toMatchObject({ usedBytes: 2048 })
    await expect(service.voice('prod:11')).resolves.toMatchObject({ usedSeconds: 60, remainingSeconds: 120 })
    expect(read.mock.calls.map(c => c[0])).toEqual(['/api/v1/premium/get/q-token-limited-opt', '/api/v1/premium/get/member', '/api/v1/premium/get/used-size', '/api/v1/premium/get/vop-limited-opt'])
  })
  it('rejects stale user/environment and empty scopes before fetching', async () => {
    const { service, read } = fixture()
    for (const scope of ['prod:12', 'test:11', '']) {
      await expect(service.tokens(scope)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
      await expect(service.storage(scope)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
      await expect(service.voice(scope)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
    }
    expect(read).not.toHaveBeenCalled()
  })
  it.each(['user', 'environment'])('discards voice results when %s changes during reading', async kind => {
    const f = fixture()
    f.read.mockImplementation(async () => {
      if (kind === 'user') f.setUser(12)
      else f.config.environment = 'test'
      return { used_sec: 60, able_sec: 120 }
    })
    await expect(f.service.voice('prod:11')).rejects.toMatchObject({ code: 'account-usage-account-changed' })
  })
  it.each(['user', 'environment'])('discards results when %s changes during reading', async kind => {
    const f = fixture()
    f.read.mockImplementation(async () => {
      if (kind === 'user') f.setUser(12)
      else f.config.environment = 'test'
      return { used_token: 10, able_token: 90 }
    })
    await expect(f.service.tokens('prod:11')).rejects.toMatchObject({ code: 'account-usage-account-changed' })
  })
  it('preserves Token reading when storage fails', async () => {
    const f = fixture()
    f.read.mockImplementation(async path => {
      if (path.endsWith('q-token-limited-opt')) return { used_token: 10, able_token: 90 }
      throw new Error('offline')
    })
    await expect(f.service.storage('prod:11')).rejects.toThrow('offline')
    await expect(f.service.tokens('prod:11')).resolves.toMatchObject({ remaining: 90 })
  })
})
