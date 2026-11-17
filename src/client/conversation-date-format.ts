import { arkmeIntlLocale } from './locale.js'
import { formatArkmeDateTime } from './display-time-zone.js'

const options = {
  time: { hour: '2-digit', minute: '2-digit', hour12: false },
  weekday: { weekday: 'short' },
  day: { month: '2-digit', day: '2-digit' },
  calendarDay: { month: 'long', day: 'numeric' },
  calendarDate: { year: 'numeric', month: 'long', day: 'numeric' },
  full: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
} satisfies Record<string, Intl.DateTimeFormatOptions>
export function formatConversationDate(date: Date, kind: keyof typeof options): string {
  return formatArkmeDateTime(date, arkmeIntlLocale(), options[kind])
}
