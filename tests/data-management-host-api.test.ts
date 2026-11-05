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

it('validates range selection and requires an explicit saved confirmation before forwarding', async () => {
 const service={dataExportRangePreview:vi.fn(async()=>({supported:true})),dataExportSaved:vi.fn(async()=>({chainVersion:1}))} as unknown as ArkmeService
 const selection={mode:'dates',startDate:'2026-11-01',endDate:'2026-11-03',timeZone:'Asia/Shanghai',includeAttachments:true}
 const signal=new AbortController().signal
 await dispatchArkmeHostOperation(service,'data.export.range.preview',{expectedAccountScope:'prod:11',selection,orderKind:1},undefined,undefined,undefined,undefined,signal)
 expect(service.dataExportRangePreview).toHaveBeenCalledWith('prod:11',selection,1,signal,undefined)

 await dispatchArkmeHostOperation(service,'data.export.range.preview',{expectedAccountScope:'prod:11',selection,orderKind:1,destinationRef:'account-bound-folder'},undefined,undefined,undefined,undefined,signal)
 expect(service.dataExportRangePreview).toHaveBeenLastCalledWith('prod:11',selection,1,signal,'account-bound-folder')
 await expect(dispatchArkmeHostOperation(service,'data.export.saved',{expectedAccountScope:'prod:11',confirmationRef:'sealed'})).rejects.toMatchObject({code:'record-export-confirmation-required'})
 expect(service.dataExportSaved).not.toHaveBeenCalled()
 await dispatchArkmeHostOperation(service,'data.export.saved',{expectedAccountScope:'prod:11',confirmationRef:'sealed',confirmed:true},undefined,undefined,undefined,undefined,signal)
 expect(service.dataExportSaved).toHaveBeenCalledWith('prod:11','sealed',signal)
 await expect(dispatchArkmeHostOperation(service,'data.export.range.preview',{expectedAccountScope:'prod:11',selection:{...selection,startDate:'2026-02-30'},orderKind:1})).rejects.toBeDefined()
})
