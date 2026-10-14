import { expect, it } from 'vitest'
import { arrangementDateTimeMillis, arrangementDayBounds } from '../src/client/arrangement-date.js'

it('interprets an explicit appointment in the selected timezone, including year boundaries', () => {
  expect(arrangementDateTimeMillis('2027-01-01', '09:00', 'Asia/Shanghai')).toBe(Date.parse('2027-01-01T01:00:00Z'))
  expect(arrangementDayBounds('2026-12-31', 'Asia/Shanghai')).toEqual([Date.parse('2026-12-30T16:00:00Z'), Date.parse('2026-12-31T16:00:00Z')])
})
it('uses local day boundaries over DST instead of assuming a 24-hour day', () => {
  const [start, end] = arrangementDayBounds('2026-03-08', 'America/New_York')
  expect(end - start).toBe(23 * 60 * 60 * 1000)
  expect(() => arrangementDateTimeMillis('2026-03-08', '02:30', 'America/New_York')).toThrow()
  expect(() => arrangementDateTimeMillis('2026-02-30', '09:00', 'Asia/Shanghai')).toThrow()
  expect(() => arrangementDateTimeMillis('2026-10-20', '24:00', 'Asia/Shanghai')).toThrow()
})
