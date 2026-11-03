import { describe, expect, it } from 'vitest'
import { legacyRecordExportAvailable, recordExportDateError, recordExportDatePreset } from '../src/client/record-export-selection.js'

describe('calendar export choices', () => {
  it('uses seven calendar dates including today across month boundaries', () => {
    expect(recordExportDatePreset('week', new Date(2026, 2, 2, 23, 59))).toEqual({ start: '2026-02-24', end: '2026-03-02' })
  })
  it('handles leap years and the previous year without UTC date shifting', () => {
    expect(recordExportDatePreset('last-month', new Date(2024, 2, 31))).toEqual({ start: '2024-02-01', end: '2024-02-29' })
    expect(recordExportDatePreset('last-month', new Date(2026, 0, 1))).toEqual({ start: '2025-12-01', end: '2025-12-31' })
    expect(recordExportDatePreset('month', new Date(2026, 10, 3, 0, 1))).toEqual({ start: '2026-11-01', end: '2026-11-03' })
  })
  it.each([
    [{ start: '', end: '2026-11-03' }, '请选择开始日期和结束日期。'],
    [{ start: '2026-02-30', end: '2026-11-03' }, '日期无效，请重新选择。'],
    [{ start: '2026-13-01', end: '2026-11-03' }, '日期无效，请重新选择。'],
    [{ start: '26-01-01', end: '2026-11-03' }, '日期无效，请重新选择。'],
    [{ start: '2026-11-04', end: '2026-11-03' }, '结束日期不能早于开始日期。'],
    [{ start: '2026-11-03', end: '2026-11-03' }, ''],
  ])('validates calendar ranges without normalizing impossible dates: %j', (range, error) => {
    expect(recordExportDateError(range)).toBe(error)
  })
  it('allows only the exact legacy selection without an implicit scope downgrade', () => {
    expect(legacyRecordExportAvailable('all', true)).toBe(true)
    for (const range of ['dates', 'incremental'] as const) {
      expect(legacyRecordExportAvailable(range, true)).toBe(false)
      expect(legacyRecordExportAvailable(range, false)).toBe(false)
    }
    expect(legacyRecordExportAvailable('all', false)).toBe(false)
  })
})
