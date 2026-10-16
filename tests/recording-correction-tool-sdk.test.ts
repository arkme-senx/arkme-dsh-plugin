import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog, type ArkmeCoreToolPorts } from '../src/tools/index.js'
import type { ArkmeService } from '../src/arkme-service.js'

it('SDK and Host read the same receipt, including a missing receipt, without invoking a write', async () => {
  const owner = { recordingSpeakerCorrectionResult: vi.fn(async () => null), applyRecordingSpeakerCorrection: vi.fn(), undoRecordingSpeakerCorrection: vi.fn() }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const { operation, params } = JSON.parse(String(init?.body))
    const value = await dispatchArkmeHostOperation(owner as unknown as ArkmeService, operation, params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const signal = new AbortController().signal
  const query = { itemRef: 'opaque', action: 'undo' as const, idempotencyKey: 'receipt-query-0001' }
  expect(await sdk.recordingSpeakerCorrectionResult(query, signal)).toBeNull()
  expect(owner.recordingSpeakerCorrectionResult).toHaveBeenCalledExactlyOnceWith(query, signal)
  expect(owner.applyRecordingSpeakerCorrection).not.toHaveBeenCalled()
  expect(owner.undoRecordingSpeakerCorrection).not.toHaveBeenCalled()
})

it('the existing read tool can inspect receipts without requiring or invoking a write grant', async () => {
  const ports = { recordingSpeakerCorrectionResult: vi.fn(async () => null), applyRecordingSpeakerCorrection: vi.fn(), undoRecordingSpeakerCorrection: vi.fn() }
  const tool = createArkmeCoreToolDefinitions(ports as unknown as ArkmeCoreToolPorts).find(tool => tool.name === 'arkme_recording_speaker_correction_context')!
  expect(arkmeToolCatalog.modulesFor('business').find(module => module.meta.toolName === tool.name)?.meta.effect).toBe('read')
  const signal = new AbortController().signal
  await tool.execute({ item_ref: 'opaque', action: 'apply', idempotency_key: 'receipt-query-0001' }, { signal } as never)
  expect(ports.recordingSpeakerCorrectionResult).toHaveBeenCalledExactlyOnceWith({ itemRef: 'opaque', action: 'apply', idempotencyKey: 'receipt-query-0001' }, signal)
  await expect(tool.execute({ action: 'apply' }, { signal } as never)).rejects.toThrow()
  expect(ports.applyRecordingSpeakerCorrection).not.toHaveBeenCalled()
  expect(ports.undoRecordingSpeakerCorrection).not.toHaveBeenCalled()
})
