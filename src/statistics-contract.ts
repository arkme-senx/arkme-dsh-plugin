/** Record-owner analytics. Durations describe record creation, never recorded audio. */
export interface StatisticsQuery {
  accountScope: string
  fromStamp: number
  toStamp: number
  timezoneOffsetMinutes: number
  previousFromStamp?: number
  previousToStamp?: number
}
export interface StatisticsDetail {
  firstRecordAt: number | null
  days: number | null
  recordMin: number | null
  recordCount: number | null
  wordsCount: number | null
  subjectCount: number | null
  searchCount: number | null
  viewCount: number | null
  shareCount: number | null
  recordMinIncr: number | null
  recordCountIncr: number | null
  wordsCountIncr: number | null
  keywords: StatisticsKeyword[] | null
}
export interface StatisticsKeyword {
  text: string
  /** Occurrences in the corpus; never substitute the number of matching records. */
  occurrenceCount: number | null
  recordCount: number | null
}
export interface StatisticsPoint { weekday: number; stamp: number; costSec: number }
export interface StatisticsRecord { uid: string; title: string; text: string; sendAt: number; costSec: number }
export interface StatisticsRecordPage { items: StatisticsRecord[]; nextOffset: number | null }

export function statisticsDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function statisticsQuery(accountScope: string, month: string, now = new Date()): StatisticsQuery {
  const q: StatisticsQuery = { accountScope, fromStamp: 0, toStamp: now.getTime(), timezoneOffsetMinutes: -now.getTimezoneOffset() }
  if (!month) return q
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('统计月份无效')
  const [year, m] = month.split('-').map(Number)
  const start = new Date(year!, m! - 1, 1), end = new Date(year!, m!, 1)
  return { ...q, fromStamp: start.getTime(), toStamp: Math.min(end.getTime() - 1, now.getTime()),
    timezoneOffsetMinutes: -start.getTimezoneOffset(), previousFromStamp: new Date(year!, m! - 2, 1).getTime(), previousToStamp: start.getTime() - 1 }
}
export function statisticsDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const value = Math.max(0, Math.round(seconds))
  if (value < 60) return `${value} 秒`
  if (value < 3600) return `${Math.floor(value / 60)} 分钟`
  return `${Math.floor(value / 3600)} 小时${value % 3600 >= 60 ? ` ${Math.floor(value % 3600 / 60)} 分` : ''}`
}
