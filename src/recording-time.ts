import type { ArkmeRecordingWindow } from './types.js'

export const RECORDING_MINIMUM_YEAR = 1970
const DAY = 86_400_000
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

/** UTC offset at a recording instant in the named civil timezone. */
export function recordingBatchOffset(at: number, timeZone: string): number {
  let formatter = offsetFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    if (offsetFormatters.size >= 64) offsetFormatters.clear()
    offsetFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(at)
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)!.value)
  return Date.UTC(number('year'), number('month') - 1, number('day'), number('hour'), number('minute'), number('second')) - Math.floor(at / 1000) * 1000
}

export function recordingZonedDate(value: number, timeZone: string): string {
  let formatter = dateFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    if (dateFormatters.size >= 64) dateFormatters.clear()
    dateFormatters.set(timeZone, formatter)
  }
  return formatter.format(value)
}

export function offsetRecordingDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
}

function recordingZonedDayStart(date: string, timeZone: string): number {
  const midnight = Date.parse(`${date}T00:00:00Z`)
  // When midnight repeats, prefer the earlier occurrence.
  const candidates = new Set([midnight - DAY, midnight, midnight + DAY]
    .map(probe => midnight - recordingBatchOffset(probe, timeZone)))
  const matching = [...candidates].filter(value => value + recordingBatchOffset(value, timeZone) === midnight)
  if (matching.length) return Math.min(...matching)

  // A transition may skip midnight or an entire date. Find the first instant
  // on or after the civil date so adjacent windows still share one boundary.
  let low = midnight - 2 * DAY, high = midnight + 2 * DAY
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2)
    if (recordingZonedDate(middle, timeZone) >= date) high = middle
    else low = middle
  }
  return high
}

export function recordingZonedWindow(date: string, timeZone: string): ArkmeRecordingWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || offsetRecordingDate(date, 0) !== date) throw new Error('录音日期无效')
  return {
    date,
    timeZone,
    dateStamp: recordingZonedDayStart(date, timeZone),
    endStamp: recordingZonedDayStart(offsetRecordingDate(date, 1), timeZone),
  }
}

export function recordingMinimumLocalDateMillis(): number {
  return new Date(RECORDING_MINIMUM_YEAR, 0, 1).getTime()
}

export function isRecordingLocalDateOnOrAfterMinimum(value: number): boolean {
  return Number.isSafeInteger(value) && value >= recordingMinimumLocalDateMillis()
}

export function isRecordingInstantOnOrAfterUnixEpoch(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}
