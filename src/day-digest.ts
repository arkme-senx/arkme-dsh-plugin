import { parseDayReviewQuery, reviewObject, type DayReviewSource, type DayReviewState } from './calendar-day-review.js'

export type ArkmeDayDigestKind = 'summary' | 'timeline'
export interface ArkmeDayDigestQuery {
  /** Absolute milliseconds at the start of the selected local day. */
  dateStamp: number
  /** East-positive UTC offset at day start; the IANA zone defines DST/day end. */
  timeZoneOffsetMillis: number
  timeZone: string
}
export interface ArkmeDayDigestGenerateInput extends ArkmeDayDigestQuery {
  kinds?: ArkmeDayDigestKind[]
  sources?: DayReviewSource[]
  routeKey?: string
  idempotencyKey: string
}
export type ArkmeDayDigestState = DayReviewState

export function dayDigestQuery(input: unknown, accountScope: string) {
  const v = reviewObject(input)
  if (!Number.isSafeInteger(v.dateStamp) || Number(v.dateStamp) < 0 || !Number.isSafeInteger(v.timeZoneOffsetMillis)
    || Math.abs(Number(v.timeZoneOffsetMillis)) > 86400000 || typeof v.timeZone !== 'string') throw new Error('日总结日期、时区或偏移无效')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: v.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(Number(v.dateStamp))
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const date = `${p.year}-${p.month}-${p.day}`
  if (p.hour !== '00' || p.minute !== '00' || p.second !== '00'
    || Date.parse(`${date}T00:00:00Z`) - Number(v.dateStamp) !== v.timeZoneOffsetMillis) throw new Error('日期必须为所选时区的自然日零点，偏移必须与时区一致')
  return parseDayReviewQuery({ accountScope, bucketDate: date, timezone: v.timeZone })
}
