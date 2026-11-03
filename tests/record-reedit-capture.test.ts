import { describe, expect, it } from 'vitest'
import { parseArkmeRecordReeditCapture } from '../src/record-reedit-contract.js'

const valid = { completedAtMillis: 1700000001000, startedAtMillis: 1700000000000, durationMillis: 1000,
  captureContext: { clientName: 'Mac', electric: 0, charge: 0 } }
describe('durable edit capture boundary', () => {
  it('keeps recorded zero values and drops unrelated fields', () => {
    expect(parseArkmeRecordReeditCapture({ ...valid, secret: 'ignored', captureContext: { ...valid.captureContext, secret: 'ignored' } })).toEqual(valid)
  })
  it.each([
    { completedAtMillis: 0 }, { startedAtMillis: valid.completedAtMillis + 1 }, { durationMillis: -1 }, { durationMillis: Infinity },
    { backgroundSound: { fileRefs: ['/tmp/private'], amplitudes: [] } },
    { backgroundSound: { fileRefs: ['arkme-file-v1.11111111-1111-4111-8111-111111111111'], amplitudes: [NaN] } },
    { location: { latitude: 91, longitude: 0, capturedAtMillis: 1700000001000 } },
  ])('rejects malformed capture metadata: %j', change => {
    expect(() => parseArkmeRecordReeditCapture({ ...valid, ...change })).toThrow()
  })
})
