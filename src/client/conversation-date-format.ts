import { arkmeIntlLocale } from './locale.js'

const options = {
  time: { hour: '2-digit', minute: '2-digit', hour12: false },
  weekday: { weekday: 'short' },
  day: { month: '2-digit', day: '2-digit' },
  calendarDay: { month: 'long', day: 'numeric' },
  calendarDate: { year: 'numeric', month: 'long', day: 'numeric' },
  full: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
} satisfies Record<string, Intl.DateTimeFormatOptions>
let locale = ''
const formatters = new Map<keyof typeof options, Intl.DateTimeFormat>()

/** Bounded by format kinds; never cache timestamps or freeze the system timezone. */
export function formatConversationDate(date: Date, kind: keyof typeof options): string {
  const nextLocale = arkmeIntlLocale()
  if (locale !== nextLocale) { locale = nextLocale; formatters.clear() }
  let formatter = formatters.get(kind)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options[kind], timeZone: 'UTC' })
    formatters.set(kind, formatter)
  }
  // Format the date's current local wall time through UTC. Its own offset (not
  // today's offset) preserves DST and reacts immediately to system zone changes.
  return formatter.format(date.getTime() - date.getTimezoneOffset() * 60_000)
}
