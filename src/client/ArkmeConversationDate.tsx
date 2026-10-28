import { useSyncExternalStore } from 'react'
import { dayLabel } from './conversation-message-presentation.js'
import { formatConversationDate } from './conversation-date-format.js'
import { useArkmeLocale } from './locale.js'

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
const localToday = () => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

function refreshDay() {
  if (timer !== undefined) clearTimeout(timer)
  for (const listener of listeners) listener()
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  timer = setTimeout(refreshDay, next.getTime() - now.getTime() + 50)
}

function subscribeDay(listener: () => void) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const view = window, doc = document
  listeners.add(listener)
  if (listeners.size === 1) {
    refreshDay()
    view.addEventListener('focus', refreshDay)
    doc.addEventListener('visibilitychange', refreshDay)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      clearTimeout(timer)
      timer = undefined
      view.removeEventListener('focus', refreshDay)
      doc.removeEventListener('visibilitychange', refreshDay)
    }
  }
}

/** One midnight timer for all mounted separators; also refresh after sleep. */
export function ArkmeConversationDate({ at }: { at: number }) {
  useArkmeLocale()
  const today = useSyncExternalStore(subscribeDay, localToday, localToday)
  const label = dayLabel(at, today)
  if (!label) return null
  const date = new Date(at)
  const fullDate = formatConversationDate(date, 'calendarDate')
  const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return <time dateTime={isoDate} title={fullDate} aria-label={fullDate}>{label}</time>
}
