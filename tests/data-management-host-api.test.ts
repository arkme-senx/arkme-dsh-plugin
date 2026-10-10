import { describe, expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'

describe('data management host operations', () => {
  it('forwards account scope, cancellation and explicit restore identity', async () => {
    const service = {
      dataDeletedRecords: vi.fn(async () => ({ items: [] })),
      dataExportPreflight: vi.fn(async () => ({ canExport: true })),
      dataRecoverRecord: vi.fn(async () => ({ recordUid: 'record1' })),
    } as unknown as ArkmeService
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation(service, 'data.deleted', { expectedAccountScope: 'prod:11' }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'data.export.preflight', { expectedAccountScope: 'prod:11' }, undefined, undefined, undefined, undefined, signal)
    await dispatchArkmeHostOperation(service, 'data.recover', { expectedAccountScope: 'prod:11', recordUid: 'record1', version: 3 })
    expect(service.dataDeletedRecords).toHaveBeenCalledWith('prod:11', signal)
    expect(service.dataExportPreflight).toHaveBeenCalledWith('prod:11', signal)
    expect(service.dataRecoverRecord).toHaveBeenCalledWith('prod:11', 'record1', 3)
  })
})
