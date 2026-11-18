import type { ArkmeAiPointsConsumption } from './ai-points.js'

export interface ArkmeAiPointsStatisticsQuery {
  fromDate: string
  untilDate: string
  timezone: 'Asia/Shanghai'
  grain: 'day' | 'week' | 'month'
}
export interface ArkmeAiPointsStatisticsBucket {
  fromDate: string
  untilDate: string
  chargedPoints: string
  types: { businessCode: string; chargedPoints: string }[]
}
export interface ArkmeAiPointsStatistics {
  accountScope: string
  unit: 'ai_points'
  query: ArkmeAiPointsStatisticsQuery
  chargedPoints: string
  observedAt: number
  buckets: ArkmeAiPointsStatisticsBucket[]
}
export interface ArkmeAiPointsRangeQuery {
  fromDate: string
  untilDate: string
  timezone: 'Asia/Shanghai'
  businessCodes?: string[]
  beforeId?: string
  settledBefore?: number
  limit?: number
}
export interface ArkmeAiPointsRangePage {
  accountScope: string
  unit: 'ai_points'
  fromDate: string
  untilDate: string
  chargedPoints: string
  observedAt: number
  items: ArkmeAiPointsConsumption[]
  nextBeforeId: string
}

export function aiPointsDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Invalid points date')
  const result = Date.parse(`${value}T00:00:00+08:00`)
  if (!Number.isSafeInteger(result) || value.slice(0, 4) < '1970' || new Date(result + 28_800_000).toISOString().slice(0, 10) !== value) throw new TypeError('Invalid points date')
  return result
}
export function aiPointsPeriods(query: ArkmeAiPointsStatisticsQuery): { fromDate: string; untilDate: string }[] {
  if (query.timezone !== 'Asia/Shanghai') throw new TypeError('Invalid points timezone')
  const from = aiPointsDate(query.fromDate), until = aiPointsDate(query.untilDate)
  const local = new Date(from + 28_800_000)
  if (until <= from || !['day', 'week', 'month'].includes(query.grain)
    || (query.grain === 'week' && local.getUTCDay() !== 1) || (query.grain === 'month' && local.getUTCDate() !== 1)) throw new TypeError('Invalid points range')
  const maximum = query.grain === 'day' ? 32 : 12, periods = []
  let cursor = from
  while (cursor < until && periods.length < maximum) {
    const next = new Date(cursor + 28_800_000)
    if (query.grain === 'month') next.setUTCMonth(next.getUTCMonth() + 1)
    else next.setUTCDate(next.getUTCDate() + (query.grain === 'week' ? 7 : 1))
    const end = next.getTime() - 28_800_000
    if (end > until) throw new TypeError('Invalid points range')
    periods.push({ fromDate: new Date(cursor + 28_800_000).toISOString().slice(0, 10), untilDate: next.toISOString().slice(0, 10) }); cursor = end
  }
  if (cursor !== until) throw new TypeError('Invalid points range')
  return periods
}
