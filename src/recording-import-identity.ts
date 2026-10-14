import { randomBytes } from 'node:crypto'
import type { RecordingImportBatch } from './recording-workflow-contract.js'

/** Persist once with the job; replay this identity even after a lost HTTP response. */
export function recordingCreateRequestUID(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now <= 0 || now >= 2 ** 48) throw new RangeError('Invalid creation time')
  const bytes = randomBytes(16)
  bytes.writeUIntBE(now, 0, 6)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function validRecordingCreateRequestUID(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}
export function sameRecordingImportBatch(a?: RecordingImportBatch, b?: RecordingImportBatch): boolean {
  return a === undefined || b === undefined ? a === b : a.batchId === b.batchId && a.itemIndex === b.itemIndex
    && a.itemCount === b.itemCount && a.timeZone === b.timeZone
}
/** JS's offset at the recording instant, but in the frozen batch timezone. */
export function recordingBatchOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)!.value)
  return Date.UTC(number('year'), number('month') - 1, number('day'), number('hour'), number('minute'), number('second')) - Math.floor(at / 1000) * 1000
}
