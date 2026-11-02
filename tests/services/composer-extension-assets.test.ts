import { describe, expect, it, vi } from 'vitest'
import { ArkmeService } from '../../src/arkme-service.js'
const asset = (id: string) => ({ fileAssetUid: id, fileName: `${id}.pdf`, mimeType: 'application/pdf', size: 1, fileKind: 4 as const })
describe('composer cloud attachments in extensions', () => {
  it('merges existing assets and newly uploaded files in the selected order', async () => {
    const uploadRefs = vi.fn(async () => [asset('uploaded')])
    const send = vi.fn(async () => ({ recordUid: 'new' }))
    const facade = { config: {}, chat: { sourceMessageExtensionContext: async () => ({ parentRecordUid: 'parent', extensions: [] }), extendSourceMessage: send }, filesOwner: () => ({ uploadRefs }) }
    await ArkmeService.prototype.extendSourceMessage.call(facade as never, 'source', 'action', '', 'new', ['local-ref'], { assets: [asset('cloud')], attachmentOrder: ['local-ref', 'cloud'] })
    expect(send).toHaveBeenCalledWith('source', 'action', '', 'new', [asset('uploaded'), asset('cloud')], expect.anything())
    expect(uploadRefs).toHaveBeenCalledWith(['local-ref'], undefined)
  })
  it('enforces the combined limit before uploads and revalidates the selected parent', async () => {
    const uploadRefs = vi.fn(), send = vi.fn()
    const facade = { config: {}, chat: { sourceMessageExtensionContext: async () => ({ parentRecordUid: 'parent', extensions: [] }), extendSourceMessage: send }, filesOwner: () => ({ uploadRefs }) }
    await expect(ArkmeService.prototype.extendSourceMessage.call(facade as never, 'source', 'action', '', 'new', ['local'], { assets: Array.from({ length: 9 }, (_, i) => asset(String(i))) })).rejects.toThrow('数量超限')
    await expect(ArkmeService.prototype.extendSourceMessage.call(facade as never, 'source', 'action', '', 'new', [], { assets: [asset('cloud')], parentRecordUid: 'deleted-parent' })).rejects.toThrow('延展目标已变化')
    expect(uploadRefs).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })
})
