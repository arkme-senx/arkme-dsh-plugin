import { recordingImportBatchID, recordingImportDeadline, RECORDING_IMPORT_RECOVERY_MILLIS } from '../src/recording-workflow-contract.js'
import { expect, it } from 'vitest'
import { recordingCreateRequestUID, recordingBatchOffset, sameRecordingImportBatch, validRecordingCreateRequestUID } from '../src/recording-import-identity.js'
it('encodes the persisted creation timestamp as a canonical random UUIDv7', () => {
  const now = 1791849600123, id = recordingCreateRequestUID(now)
  expect(validRecordingCreateRequestUID(id)).toBe(true)
  expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(now)
  expect(recordingCreateRequestUID(now)).not.toBe(id)
})
it('separates cross-batch and cross-index retries', () => {
  const batch = { batchId: 'batch-0001', itemIndex: 0, itemCount: 2, timeZone: 'Asia/Shanghai' }
  expect(sameRecordingImportBatch(batch, { ...batch })).toBe(true)
  expect(sameRecordingImportBatch(batch, { ...batch, batchId: 'batch-0002' })).toBe(false)
  expect(sameRecordingImportBatch(batch, { ...batch, itemIndex: 1 })).toBe(false)
  expect(sameRecordingImportBatch(batch, undefined)).toBe(false)
})
it('does not use the current computer timezone when replaying a batch', () => {
  expect(recordingBatchOffset(Date.parse('2026-03-08T06:30:00Z'), 'America/New_York')).toBe(-5 * 3600_000)
  expect(recordingBatchOffset(Date.parse('2026-03-08T07:30:00Z'), 'America/New_York')).toBe(-4 * 3600_000)
  expect(recordingBatchOffset(Date.parse('2026-03-08T07:30:00Z'), 'Asia/Shanghai')).toBe(8 * 3600_000)
})

it('encodes the submission time in a browser-safe UUIDv7 and rejects unbounded batch IDs', () => {
  const now = Date.now(), id = recordingImportBatchID(now)
  expect(recordingImportDeadline(id)).toBe(now + RECORDING_IMPORT_RECOVERY_MILLIS)
  expect(recordingImportBatchID(now)).not.toBe(id)
  expect(recordingImportDeadline('batch-0001')).toBeUndefined()
})
