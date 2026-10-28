import { expect, it, vi } from 'vitest'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'

it('routes UI/SDK archive requests to one owner and rejects incomplete CAS writes', async () => {
  const service = { listArchives: vi.fn(), getArchiveStates: vi.fn(), setArchiveState: vi.fn() }
  const dispatch = (operation: 'archives.list' | 'archives.state' | 'archives.set', params: Record<string, unknown>) => dispatchArkmeHostOperation(service as unknown as ArkmeService, operation, params)
  await dispatch('archives.list', { cursor: 'opaque-page' })
  expect(service.listArchives).toHaveBeenCalledWith('opaque-page', undefined)
  await dispatch('archives.state', { sourceRefs: ['opaque'] })
  expect(service.getArchiveStates).toHaveBeenCalledWith(['opaque'], undefined)
  for (const params of [{ sourceRef: 'opaque', selfArchived: true }, { sourceRef: 'opaque', selfArchived: 'true', expectedRevision: 0 }, { sourceRef: 'opaque', selfArchived: true, expectedRevision: -1 }]) {
    await expect(dispatch('archives.set', params)).rejects.toThrow()
  }
  expect(service.setArchiveState).not.toHaveBeenCalled()
  await dispatch('archives.set', { sourceRef: 'opaque', selfArchived: true, expectedRevision: 0 })
  expect(service.setArchiveState).toHaveBeenCalledExactlyOnceWith({ sourceRef: 'opaque', selfArchived: true, expectedRevision: 0 }, undefined)
})
