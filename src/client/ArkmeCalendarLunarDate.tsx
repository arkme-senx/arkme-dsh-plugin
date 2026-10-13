import { useArkmeLocale, type ArkmeLocale } from './locale.js'

const days = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']

export function formatCalendarLunarDate(date: string, locale: ArkmeLocale): string {
  if (locale !== 'zh' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const stamp = new Date(`${date}T12:00:00Z`)
  if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== date) return ''
  try {
    // Convert the selected civil day, independent of the computer's time zone.
    const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    if (formatter.resolvedOptions().calendar !== 'chinese') return ''
    const parts = formatter.formatToParts(stamp)
    const month = parts.find(part => part.type === 'month')?.value
    const day = days[Number(parts.find(part => part.type === 'day')?.value) - 1]
    return month && day ? `农历${month}${day}` : ''
  } catch { return '' }
}

export function ArkmeCalendarLunarDate({ date }: { date: string }) {
  const lunar = formatCalendarLunarDate(date, useArkmeLocale())
  return lunar ? <span className="arkme-calendar-lunar-date"> · {lunar}</span> : null
}
