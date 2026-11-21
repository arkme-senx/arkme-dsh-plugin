import { describe, expect, it } from 'vitest'
import { formatArrangementLocalTime, resolveArrangementDueTime } from '../src/arrangement-due-time.js'

const now = Date.parse('2026-11-20T07:30:15Z') // 15:30:15 in Asia/Shanghai

describe('arrangement due time', () => {
  it('resolves relative delays from the host clock, not the model', () => {
    expect(resolveArrangementDueTime({ afterSeconds: 120 }, now, 'Asia/Shanghai')).toEqual({ dueAtMillis: now + 120_000, timeZone: 'Asia/Shanghai' })
  })

  it('resolves a local date and time in the default or an explicit zone', () => {
    expect(resolveArrangementDueTime({ at: { date: '2026-11-20', time: '16:05' } }, now, 'Asia/Shanghai'))
      .toEqual({ dueAtMillis: Date.parse('2026-11-20T08:05:00Z'), timeZone: 'Asia/Shanghai' })
    expect(resolveArrangementDueTime({ at: { date: '2026-11-21', time: '09:00:30', time_zone: 'America/New_York' } }, now, 'Asia/Shanghai'))
      .toEqual({ dueAtMillis: Date.parse('2026-11-21T14:00:30Z'), timeZone: 'America/New_York' })
  })

  it('accepts only offset RFC 3339 strings', () => {
    expect(resolveArrangementDueTime({ at: '2026-11-20T16:00:00+08:00' }, now, 'Asia/Shanghai')?.dueAtMillis).toBe(Date.parse('2026-11-20T08:00:00Z'))
    expect(resolveArrangementDueTime({ at: '2026-11-20T08:00:00.5Z' }, now, 'UTC')?.dueAtMillis).toBe(Date.parse('2026-11-20T08:00:00.500Z'))
    for (const at of ['2026-11-20T16:00:00', '2026-11-20 16:00', '2026-02-30T16:00:00+08:00', '2026-11-20T24:00:00Z', 'tomorrow']) {
      expect(() => resolveArrangementDueTime({ at }, now, 'Asia/Shanghai')).toThrow(expect.objectContaining({ code: 'invalid_due_time' }))
    }
  })

  it('returns no time when none was requested', () => {
    expect(resolveArrangementDueTime({}, now, 'Asia/Shanghai')).toBeUndefined()
  })

  it.each([
    [{ afterSeconds: 120, at: { date: '2026-11-20', time: '16:00' } }, 'invalid_due_time'],
    [{ afterSeconds: 0 }, 'invalid_due_time'],
    [{ afterSeconds: 1.5 }, 'invalid_due_time'],
    [{ afterSeconds: 5 }, 'due_time_past'],
    [{ at: { date: '2026-11-20', time: '15:30' } }, 'due_time_past'],
    [{ at: { date: '2026-11-20', time: '25:00' } }, 'invalid_due_time'],
    [{ at: { date: '2026-11-31', time: '10:00' } }, 'invalid_due_time'],
    [{ at: { date: '2026-11-21', time: '10:00', time_zone: 'Mars/Olympus' } }, 'invalid_time_zone'],
    [{ afterSeconds: 6 * 366 * 86_400 }, 'due_time_too_far'],
  ])('rejects %j with %s', (input, code) => {
    expect(() => resolveArrangementDueTime(input as never, now, 'Asia/Shanghai')).toThrow(expect.objectContaining({ code }))
  })

  it('names the current local time when a target is already past', () => {
    expect(() => resolveArrangementDueTime({ at: { date: '2026-11-20', time: '09:00' } }, now, 'Asia/Shanghai')).toThrow('当前时间是 2026-11-20 15:30')
  })

  it('rejects skipped DST wall times and takes the earlier instant of repeated ones', () => {
    const before = Date.parse('2026-01-01T00:00:00Z')
    expect(() => resolveArrangementDueTime({ at: { date: '2026-03-08', time: '02:30', time_zone: 'America/New_York' } }, before, 'UTC'))
      .toThrow(expect.objectContaining({ code: 'invalid_due_time' }))
    expect(resolveArrangementDueTime({ at: { date: '2026-11-01', time: '01:30', time_zone: 'America/New_York' } }, before, 'UTC')?.dueAtMillis)
      .toBe(Date.parse('2026-11-01T05:30:00Z'))
  })

  it('formats the camellia YYYY-MM-DD HH:mm shape in the given zone', () => {
    expect(formatArrangementLocalTime(Date.parse('2026-11-20T16:05:59Z'), 'Asia/Shanghai')).toBe('2026-11-21 00:05')
  })
})
