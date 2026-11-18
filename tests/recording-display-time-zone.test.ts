import { expect, it } from 'vitest'
import { recordingZonedDate, recordingZonedWindow } from '../src/recording-time.js'
import { recordingCalendarDate, recordingCivilKey } from '../src/client/display-time-zone.js'
import { recordingMonthDays } from '../src/client/recordings/recording-month-totals.js'

it('puts an unchanged instant on the selected timezone’s civil date', () => {
  const value = Date.parse('2026-11-16T16:30:00Z')
  expect(recordingZonedDate(value, 'Asia/Shanghai')).toBe('2026-11-17')
  expect(recordingZonedDate(value, 'America/Los_Angeles')).toBe('2026-11-16')
  expect(recordingCivilKey(recordingCalendarDate(value, 'Asia/Shanghai'))).toBe('2026-11-17')
  expect(recordingMonthDays(new Date(2026, 10, 1).getTime(), value, 'Asia/Shanghai')).toHaveLength(17)
  expect(recordingMonthDays(new Date(2026, 10, 1).getTime(), value, 'America/Los_Angeles')).toHaveLength(16)
})

it.each([['2026-03-08', 23], ['2026-11-01', 25]])('builds a %s day with %d elapsed hours', (date, hours) => {
  const window = recordingZonedWindow(date, 'America/Los_Angeles')
  expect(window.endStamp - window.dateStamp).toBe(hours * 3_600_000)
  expect(recordingZonedDate(window.dateStamp, window.timeZone)).toBe(date)
  expect(recordingZonedDate(window.endStamp - 1, window.timeZone)).toBe(date)
})

it('shares one boundary across a skipped civil date and rejects invalid civil dates', () => {
  const skipped = recordingZonedWindow('2011-12-30', 'Pacific/Apia')
  expect(skipped.dateStamp).toBe(skipped.endStamp)
  expect(() => recordingZonedWindow('2026-02-30', 'Asia/Shanghai')).toThrow()
  expect(() => recordingZonedWindow('2026-02-28', 'Asia/NotAZone')).toThrow()
})
