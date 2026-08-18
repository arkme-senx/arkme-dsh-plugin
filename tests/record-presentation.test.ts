import { describe, expect, it } from 'vitest'
import {
  chronologicalRecords, mergeRecordPages, recordDayKey, recordDayLabel, recordTimeLabel,
} from '../src/client/record-presentation.js'
import type { ArkmeSelfRecordItem } from '../src/types.js'

function record(recordUid: string, sendAtMillis: number): ArkmeSelfRecordItem {
  return { recordUid, sendAtMillis, title: '', textContent: recordUid, templateKind: 1, status: 1, version: 1 }
}

describe('record presentation', () => {
  it('renders server pages as a stable chronological message flow', () => {
    expect(chronologicalRecords([
      record('newest', 300), record('same-b', 200), record('oldest', 100), record('same-a', 200),
    ]).map(item => item.recordUid)).toEqual(['oldest', 'same-a', 'same-b', 'newest'])
  })

  it('provides stable day grouping and display labels', () => {
    const millis = new Date(2026, 7, 14, 16, 52).getTime()
    expect(recordDayKey(millis)).toMatch(/^2026-08-14$/)
    expect(recordDayLabel(millis)).toContain('2026')
    expect(recordTimeLabel(millis)).toContain('16:52')
    expect(recordDayKey(0)).toBe('unknown')
  })

  it('merges refreshed pages by record uid without dropping cached history', () => {
    const merged = mergeRecordPages(
      [record('older', 100), { ...record('same', 200), textContent: 'cached', localState: 'pending' }],
      [{ ...record('same', 200), textContent: 'server' }, record('newer', 300)],
    )
    expect(chronologicalRecords(merged).map(item => [item.recordUid, item.textContent, item.localState])).toEqual([
      ['older', 'older', undefined],
      ['same', 'server', undefined],
      ['newer', 'newer', undefined],
    ])
  })
})
