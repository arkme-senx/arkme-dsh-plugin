import { useSyncExternalStore } from 'react'
import { dayLabel } from './conversation-message-presentation.js'
import { formatConversationDate } from './conversation-date-format.js'
import { useArkmeLocale } from './locale.js'
import { arkmeDayKey, getArkmeEffectiveTimeZone, subscribeArkmeTimeZone } from './display-time-zone.js'
import { recordingZonedWindow } from '../recording-time.js'

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let stopZone: (() => void) | undefined
const localToday = () => arkmeDayKey(Date.now())

function refreshDay() {
  if (timer !== undefined) clearTimeout(timer)
  for (const listener of listeners) listener()
  const timeZone = getArkmeEffectiveTimeZone()
  const now = Date.now()
  const next = recordingZonedWindow(arkmeDayKey(now, timeZone), timeZone).endStamp
  timer = setTimeout(refreshDay, Math.max(50, next - now + 50))
}

function subscribeDay(listener: () => void) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const view = window, doc = document
  listeners.add(listener)
  if (listeners.size === 1) {
    refreshDay()
    stopZone = subscribeArkmeTimeZone(refreshDay)
    view.addEventListener('focus', refreshDay)
    doc.addEventListener('visibilitychange', refreshDay)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearTimeout(timer)
      timer = undefined
      stopZone?.()
      stopZone = undefined
      view.removeEventListener('focus', refreshDay)
      doc.removeEventListener('visibilitychange', refreshDay)
    }
  }
}

export function useConversationCivilDay() {
  return useSyncExternalStore(subscribeDay, localToday, localToday)
}

/** One midnight timer for all mounted separators; also refresh after sleep. */
export function ArkmeConversationDate({ at }: { at: number }) {
  useArkmeLocale()
  useConversationCivilDay()
  const label = dayLabel(at)
  if (!label) return null
  const date = new Date(at)
  const fullDate = formatConversationDate(date, 'calendarDate')
  const isoDate = arkmeDayKey(at)
  return <time dateTime={isoDate} title={fullDate} aria-label={fullDate}>{label}</time>
}
