import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'

describe('account usage host operations', () => {
  it('passes only scoped month/cursor/operation fields and cancellation to detail readers', async () => {
    const service = { accountTokenUsageSummary: vi.fn(), accountTokenUsageOperations: vi.fn(), accountTokenUsageCalls: vi.fn() } as unknown as ArkmeService
    const params = { expectedAccountScope: 'prod:11', monthKey: '2026-09', timezone: 'Asia/Shanghai', cursor: 'opaque', operationUid: 'operation-1', bizCode: 12, userId: 99 }
    await dispatchArkmeHostOperation(service, 'account.usage.token.summary', params)
    await dispatchArkmeHostOperation(service, 'account.usage.token.operations', params)
    await dispatchArkmeHostOperation(service, 'account.usage.token.calls', params)
    expect(service.accountTokenUsageSummary).toHaveBeenCalledWith('prod:11', { monthKey: '2026-09', timezone: 'Asia/Shanghai' }, undefined)
    expect(service.accountTokenUsageOperations).toHaveBeenCalledWith('prod:11', { monthKey: '2026-09', timezone: 'Asia/Shanghai', cursor: 'opaque' }, undefined)
    expect(service.accountTokenUsageCalls).toHaveBeenCalledWith('prod:11', { monthKey: '2026-09', timezone: 'Asia/Shanghai', cursor: 'opaque', operationUid: 'operation-1', bizCode: 12 }, undefined)
  })
  it('passes explicit account scope to independent read owners', async () => {
    const service = { accountTokenUsage: vi.fn(async () => ({ used: 1 })), accountStorageUsage: vi.fn(async () => ({ usedBytes: 1 })), accountVoiceUsage: vi.fn(async () => ({ usedSeconds: 60 })) } as unknown as ArkmeService
    await expect(dispatchArkmeHostOperation(service, 'account.usage.tokens', { expectedAccountScope: 'prod:11' })).resolves.toEqual({ used: 1 })
    await expect(dispatchArkmeHostOperation(service, 'account.usage.storage', { expectedAccountScope: 'prod:11' })).resolves.toEqual({ usedBytes: 1 })
    expect(service.accountTokenUsage).toHaveBeenCalledWith('prod:11')
    expect(service.accountStorageUsage).toHaveBeenCalledWith('prod:11')
    await expect(dispatchArkmeHostOperation(service, 'account.usage.voice', { expectedAccountScope: 'prod:11' })).resolves.toEqual({ usedSeconds: 60 })
    expect(service.accountVoiceUsage).toHaveBeenCalledWith('prod:11')
  })
})
