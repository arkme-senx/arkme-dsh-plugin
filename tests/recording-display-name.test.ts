import { afterEach, expect, it, vi } from 'vitest'
import { connectArkmeLocale } from '../src/client/locale.js'
import { setArkmeDisplayTimeZone } from '../src/client/display-time-zone.js'
import { recordingDisplayName } from '../src/client/recordings/recording-display-name.js'
import { dayActivityMetadata } from '../src/client/day-activity-presentation.js'

const locale = (active: string) => connectArkmeLocale({ getLocale: () => ({ active }), subscribe: () => () => {} })()
afterEach(() => { setArkmeDisplayTimeZone('system'); locale('zh'); vi.restoreAllMocks(); vi.unstubAllEnvs() })

it('keeps the original filename unchanged, including user-authored whitespace', () => {
  expect(recordingDisplayName({ fileName: ' 会议录音.m4a ', startAtMillis: 0 })).toBe(' 会议录音.m4a ')
})

it.each(['', ' \t\n '])('names an unnamed recording by its local start time (%j)', fileName => {
  const row = Object.freeze({ fileName, startAtMillis: new Date(2026, 10, 16, 18, 35, 12).getTime() })
  expect(recordingDisplayName(row)).toBe('录音 2026/11/16 18:35:12')
  expect(row.fileName).toBe(fileName)
})

it.each([NaN, Infinity, -1, 9e15])('does not invent a date for an invalid timestamp (%s)', startAtMillis => {
  expect(recordingDisplayName({ fileName: '', startAtMillis })).toBe('未命名录音')
})

it('localizes only the generated label, never the original filename', () => {
  locale('en')
  expect(recordingDisplayName({ fileName: '', startAtMillis: new Date(2026, 10, 16, 18, 35, 12).getTime() }))
    .toBe('Recording 11/16/2026, 18:35:12')
  expect(recordingDisplayName({ fileName: '', startAtMillis: NaN })).toBe('Unnamed recording')
  expect(recordingDisplayName({ fileName: '录音', startAtMillis: 0 })).toBe('录音')
})

it('uses bounded formatter allocation for a long list without retaining record labels', () => {
  // Use a cold, explicit zone so the shared formatter allocation is measurable.
  setArkmeDisplayTimeZone('Asia/Tokyo')
  const DateTimeFormat = Intl.DateTimeFormat
  const constructors = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
    return new DateTimeFormat(locales, options)
  })
  recordingDisplayName({ fileName: '会议.m4a', startAtMillis: 0 })
  recordingDisplayName({ fileName: '', startAtMillis: NaN })
  expect(constructors).not.toHaveBeenCalled()
  const row = { fileName: '', startAtMillis: Date.parse('2026-11-16T09:35:12Z') }
  for (let i = 0; i < 500; i++) recordingDisplayName({ ...row, startAtMillis: row.startAtMillis + i * 1000 })
  expect(constructors).toHaveBeenCalledTimes(1)
  row.startAtMillis += 1000
  expect(recordingDisplayName(row)).toBe('录音 2026/11/16 18:35:13')
  row.fileName = '已命名.m4a'
  expect(recordingDisplayName(row)).toBe('已命名.m4a')
})

it('picks up the current language and timezone on the next render', () => {
  vi.stubEnv('TZ', 'UTC')
  const row = { fileName: '', startAtMillis: Date.parse('2026-11-16T18:35:12Z') }
  expect(recordingDisplayName(row)).toBe('录音 2026/11/16 18:35:12')
  locale('en'); vi.stubEnv('TZ', 'Asia/Shanghai')
  expect(recordingDisplayName(row)).toBe('Recording 11/17/2026, 02:35:12')
})

it('uses the selected display zone on both sides of midnight', () => {
  vi.stubEnv('TZ', 'UTC')
  setArkmeDisplayTimeZone('Asia/Shanghai')
  const row = { fileName: '', startAtMillis: Date.parse('2026-11-16T16:00:00Z') }
  expect(recordingDisplayName({ ...row, startAtMillis: row.startAtMillis - 1000 })).toBe('录音 2026/11/16 23:59:59')
  expect(recordingDisplayName(row)).toBe('录音 2026/11/17 00:00:00')
  setArkmeDisplayTimeZone('UTC')
  expect(recordingDisplayName(row)).toBe('录音 2026/11/16 16:00:00')
})

it('does not change the existing English calendar recording-duration label', () => {
  locale('en')
  const start = Date.parse('2026-11-16T10:00:00Z')
  expect(dayActivityMetadata({
    id: 'recording', kind: 'recording', title: '', sourceName: '', sourceIdentity: 'recording',
    access: 'available', participation: 'self', preview: '', recordCount: 0,
    startAtMillis: start, endAtMillis: start + 5000,
  }, 'UTC', start, start + 86400000)).toBe('Recorded 0:05')
  expect(recordingDisplayName({ fileName: '', startAtMillis: start })).toMatch(/^Recording /)
})
