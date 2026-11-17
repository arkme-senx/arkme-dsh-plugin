import { useSyncExternalStore } from 'react'
import { recordingBatchOffset, recordingZonedDate, recordingZonedWindow } from '../recording-time.js'

const key = 'arkme.display-time-zone.v1'
const listeners = new Set<() => void>()
let preference = readPreference()
let systemZone = readSystemZone()

function readSystemZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function normalize(value: string | null): string {
  if (!value || value === 'system' || value.length > 80) return 'system'
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone }
  catch { return 'system' }
}

function readPreference() {
  try { return normalize(localStorage.getItem(key)) } catch { return 'system' }
}

function publish(value: string) {
  if (preference === value) return
  preference = value
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key === key || event.key === null) publish(readPreference())
}

function refreshSystemZone() {
  const zone = readSystemZone()
  if (systemZone === zone) return
  systemZone = zone
  if (preference === 'system') for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener?.('storage', onStorage)
    window.addEventListener?.('focus', refreshSystemZone)
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', refreshSystemZone)
    refreshSystemZone()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener?.('storage', onStorage)
      window.removeEventListener?.('focus', refreshSystemZone)
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', refreshSystemZone)
    }
  }
}

export function setArkmeDisplayTimeZone(value: string) {
  const next = normalize(value)
  try { localStorage.setItem(key, next) } catch { /* Keep the current session usable. */ }
  publish(next)
}

export const getArkmeDisplayTimeZone = () => preference === 'system' ? undefined : preference
export const subscribeArkmeTimeZone = subscribe
export const useArkmeDisplayTimeZone = () => useSyncExternalStore(subscribe, getArkmeDisplayTimeZone, () => undefined)
export const getArkmeEffectiveTimeZone = () => getArkmeDisplayTimeZone() ?? systemZone
export const useArkmeEffectiveTimeZone = () => useSyncExternalStore(subscribe, getArkmeEffectiveTimeZone, readSystemZone)

/** A calendar date in the display zone. The returned Date is a civil-date carrier. */
export function arkmeCivilDay(value: Date | number, timeZone = getArkmeDisplayTimeZone()): Date {
  return recordingCalendarDate(typeof value === 'number' ? value : value.getTime(), timeZone)
}

export function arkmeDayKey(value: Date | number, timeZone = getArkmeDisplayTimeZone()): string {
  const stamp = typeof value === 'number' ? value : value.getTime()
  if (!Number.isFinite(stamp) || Number.isNaN(new Date(stamp).getTime())) return ''
  return timeZone ? recordingZonedDate(stamp, timeZone) : recordingCivilKey(new Date(stamp))
}

export function arkmeDayDelta(value: Date | number, reference: Date | number = Date.now(), timeZone = getArkmeDisplayTimeZone()): number {
  return (Date.parse(arkmeDayKey(value, timeZone)) - Date.parse(arkmeDayKey(reference, timeZone))) / 86_400_000
}

export function arkmeWallClockIso(stamp: number, timeZone = getArkmeDisplayTimeZone()): string {
  const offset = timeZone ? recordingBatchOffset(stamp, timeZone) : -new Date(stamp).getTimezoneOffset() * 60_000
  return new Date(stamp + offset).toISOString()
}

type Instant = Date | number
type Locales = string | string[] | undefined
const dateFields = { year: 'numeric', month: 'numeric', day: 'numeric' } as const
const timeFields = { hour: 'numeric', minute: '2-digit', second: '2-digit' } as const
const instantFormatters = new Map<string, Intl.DateTimeFormat>()

function formatInstant(value: Instant, defaults: Intl.DateTimeFormatOptions, locales: Locales, options?: Intl.DateTimeFormatOptions): string {
  const stamp = typeof value === 'number' ? value : value.getTime()
  if (!Number.isFinite(stamp) || Number.isNaN(new Date(stamp).getTime())) return 'Invalid Date'
  const format = { ...options }
  if (!format.dateStyle && !format.timeStyle && !format.weekday && !format.year && !format.month && !format.day
    && !format.hour && !format.minute && !format.second && !format.dayPeriod && !format.fractionalSecondDigits) {
    Object.assign(format, defaults)
  }
  if (!format.hourCycle && format.hour12 !== true) {
    delete format.hour12
    format.hourCycle = 'h23'
  }
  const timeZone = format.timeZone ?? getArkmeDisplayTimeZone() ?? (format.timeZoneName ? getArkmeEffectiveTimeZone() : undefined)
  if (timeZone) format.timeZone = timeZone
  // For system time use the instant's offset, so an OS timezone change takes
  // effect even when a formatter for the current language is already cached.
  else format.timeZone = 'UTC'
  const cacheKey = JSON.stringify([locales, format])
  let formatter = instantFormatters.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locales, format)
    if (instantFormatters.size >= 96) instantFormatters.clear()
    instantFormatters.set(cacheKey, formatter)
  }
  return formatter.format(timeZone ? stamp : stamp - new Date(stamp).getTimezoneOffset() * 60_000)
}

export const formatArkmeDate = (value: Instant, locales?: Locales, options?: Intl.DateTimeFormatOptions) =>
  formatInstant(value, dateFields, locales, options)
export const formatArkmeTime = (value: Instant, locales?: Locales, options?: Intl.DateTimeFormatOptions) =>
  formatInstant(value, timeFields, locales, options)
export const formatArkmeDateTime = (value: Instant, locales?: Locales, options?: Intl.DateTimeFormatOptions) =>
  formatInstant(value, { ...dateFields, ...timeFields }, locales, options)

export function recordingCivilKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Calendar cells carry a civil date, without representing a recording instant. */
export function recordingCalendarDate(value: number, timeZone?: string): Date {
  if (!timeZone) {
    const local = new Date(value)
    return new Date(local.getFullYear(), local.getMonth(), local.getDate())
  }
  const [year, month, day] = recordingZonedDate(value, timeZone).split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

export function recordingDisplayWindow(date: Date, timeZone?: string) {
  return timeZone ? recordingZonedWindow(recordingCivilKey(date), timeZone) : undefined
}
