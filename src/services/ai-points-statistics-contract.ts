import { pointsUnits } from '../ai-points.js'
import { aiPointsDate, aiPointsPeriods, type ArkmeAiPointsRangePage, type ArkmeAiPointsRangeQuery, type ArkmeAiPointsStatistics, type ArkmeAiPointsStatisticsQuery } from '../ai-points-statistics.js'
import { parseAiPointsItems } from './ai-points-contract.js'
import { ArkmePluginError, objectValue } from './service.js'

const invalid = (): never => { throw new ArkmePluginError('ai-points-contract-invalid', '积分统计暂时无法确认，请重试', true, 502) }
const queryInvalid = (): never => { throw new ArkmePluginError('ai-points-query-invalid', '请选择有效的统计范围', false, 400) }
function amount(value: unknown): string { if (typeof value !== 'string') return invalid(); try { pointsUnits(value) } catch { return invalid() }; return value }
function time(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid(); return value }

export function validatePointsStatisticsQuery(query: ArkmeAiPointsStatisticsQuery): void {
  try { aiPointsPeriods(query) } catch { queryInvalid() }
}
export function validatePointsRangeQuery(query: ArkmeAiPointsRangeQuery): void {
  try {
    const from = aiPointsDate(query.fromDate), until = aiPointsDate(query.untilDate), anniversary = new Date(from + 28_800_000)
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
    if (query.timezone !== 'Asia/Shanghai' || until <= from || until > anniversary.getTime() - 28_800_000) queryInvalid()
  } catch { queryInvalid() }
  const limit = query.limit ?? 20
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (query.beforeId !== undefined && !/^[1-9]\d*$/.test(query.beforeId))
    || (query.settledBefore !== undefined && (!Number.isSafeInteger(query.settledBefore) || query.settledBefore <= 0 || query.settledBefore > Date.now() + 5000))) queryInvalid()
  if (query.businessCodes !== undefined && (!Array.isArray(query.businessCodes) || query.businessCodes.length > 64 || new Set(query.businessCodes).size !== query.businessCodes.length
    || query.businessCodes.some(code => typeof code !== 'string' || code.length > 64 || code !== code.trim() || /[\r\n\x00]/.test(code)))) queryInvalid()
}

export function parsePointsStatistics(raw: Record<string, unknown>, scope: string, query: ArkmeAiPointsStatisticsQuery): ArkmeAiPointsStatistics {
  const periods = aiPointsPeriods(query)
  if (raw.unit !== 'ai_points' || raw.timezone !== query.timezone || raw.grain !== query.grain || raw.from_date !== query.fromDate || raw.until_date !== query.untilDate || !Array.isArray(raw.buckets) || raw.buckets.length !== periods.length) return invalid()
  const codes = new Set<string>()
  const buckets = raw.buckets.map((value, index) => {
    const row = objectValue(value), period = periods[index]!
    if (row.from_date !== period.fromDate || row.until_date !== period.untilDate || !Array.isArray(row.types) || row.types.length > 64) return invalid()
    const seen = new Set<string>()
    const types = row.types.map(value => {
      const type = objectValue(value)
      if (typeof type.business_code !== 'string' || type.business_code.length > 64 || type.business_code !== type.business_code.trim() || /[\r\n\x00]/.test(type.business_code) || seen.has(type.business_code)) return invalid()
      seen.add(type.business_code); codes.add(type.business_code)
      const chargedPoints = amount(type.charged_points)
      if (pointsUnits(chargedPoints) <= 0n) return invalid()
      return { businessCode: type.business_code, chargedPoints }
    })
    const chargedPoints = amount(row.charged_points)
    if (types.reduce((sum, type) => sum + pointsUnits(type.chargedPoints), 0n) !== pointsUnits(chargedPoints)) return invalid()
    return { ...period, chargedPoints, types }
  })
  const chargedPoints = amount(raw.charged_points)
  if (codes.size > 64 || buckets.reduce((sum, bucket) => sum + pointsUnits(bucket.chargedPoints), 0n) !== pointsUnits(chargedPoints)) return invalid()
  return { accountScope: scope, unit: 'ai_points', query, chargedPoints, observedAt: time(raw.observed_at), buckets }
}

export function parsePointsRange(raw: Record<string, unknown>, scope: string, query: ArkmeAiPointsRangeQuery): ArkmeAiPointsRangePage {
  if (raw.unit !== 'ai_points' || raw.timezone !== query.timezone || raw.from_date !== query.fromDate || raw.until_date !== query.untilDate || typeof raw.next_before_id !== 'string' || !/^(?:|[1-9]\d*)$/.test(raw.next_before_id)) return invalid()
  const items = parseAiPointsItems(raw.items, query.limit ?? 20), observedAt = time(raw.observed_at), chargedPoints = amount(raw.charged_points)
  const from = aiPointsDate(query.fromDate), until = aiPointsDate(query.untilDate)
  if ((query.beforeId && raw.next_before_id && BigInt(raw.next_before_id) >= BigInt(query.beforeId)) || (query.settledBefore !== undefined && observedAt !== query.settledBefore)
    || (raw.next_before_id && items.length === 0) || items.some(item => item.createdAt < from || item.createdAt >= until || item.completedAt > observedAt || (query.businessCodes?.length && !query.businessCodes.includes(item.businessCode)))
    || items.reduce((sum, item) => sum + pointsUnits(item.chargedPoints), 0n) > pointsUnits(chargedPoints)) return invalid()
  return { accountScope: scope, unit: 'ai_points', fromDate: query.fromDate, untilDate: query.untilDate, chargedPoints, observedAt, items, nextBeforeId: raw.next_before_id }
}
