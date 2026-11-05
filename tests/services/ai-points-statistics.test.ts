import { expect, it, vi } from 'vitest'
import { AiPointsService } from '../../src/services/ai-points-service.js'
import { parsePointsRange, parsePointsStatistics } from '../../src/services/ai-points-statistics-contract.js'
import { ArkmePluginError } from '../../src/services/service.js'
import type { ArkmeAiPointsStatisticsQuery } from '../../src/ai-points-statistics.js'
const query: ArkmeAiPointsStatisticsQuery = { fromDate: '2026-11-01', untilDate: '2026-11-02', timezone: 'Asia/Shanghai', grain: 'day' }
const raw = () => ({ unit: 'ai_points', timezone: 'Asia/Shanghai', from_date: query.fromDate, until_date: query.untilDate, grain: 'day', observed_at: Date.now(), charged_points: '0.0000001', buckets: [{ from_date: query.fromDate, until_date: query.untilDate, charged_points: '0.0000001', types: [{ business_code: 'arkme', charged_points: '0.0000001' }] }] })
function fixture() {
  let userId = 11
  const read = vi.fn(async () => raw())
  const service = new AiPointsService({ config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedIntelligentPost: read } as never)
  return { service, read, changeUser: () => { userId = 22 } }
}
it('uses one authenticated read for exact statistical totals and propagates cancellation', async () => {
  const f = fixture(), signal = new AbortController().signal
  const value = await f.service.statistics(query, 'prod:11', signal)
  expect(value.chargedPoints).toBe('0.0000001'); expect(value.accountScope).toBe('prod:11')
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(f.read).toHaveBeenCalledWith('/api/v1/managed-ai/points/consumption/statistics/query', { from_date: query.fromDate, until_date: query.untilDate, grain: 'day', timezone: 'Asia/Shanghai' }, expect.objectContaining({ userId: 11 }), signal, expect.anything())
})
it('rejects a different account before or after the request without returning its data', async () => {
  const f = fixture()
  await expect(f.service.statistics(query, 'prod:22')).rejects.toMatchObject({ code: 'ai-points-account-changed' }); expect(f.read).not.toHaveBeenCalled()
  f.read.mockImplementation(async () => { f.changeUser(); return raw() })
  await expect(f.service.statistics(query, 'prod:11')).rejects.toMatchObject({ code: 'ai-points-account-changed' })
})
it.each([404, 401, 500])('distinguishes missing aggregate routes from HTTP %s failures', async status => {
  const f = fixture(); f.read.mockRejectedValue(new ArkmePluginError('arkme-http-error', 'upstream', true, 502, { upstreamStatus: status }))
  await expect(f.service.statistics(query, 'prod:11')).rejects.toMatchObject({ code: status === 404 ? 'ai-points-statistics-unsupported' : 'arkme-http-error' })
})
it.each([
  { fromDate: '2026-02-30' }, { untilDate: '2027-11-02' }, { timezone: 'UTC' }, { grain: 'hour' },
])('rejects invalid statistical query %j before a network read', async change => {
  const f = fixture(); await expect(f.service.statistics({ ...query, ...change } as ArkmeAiPointsStatisticsQuery, 'prod:11')).rejects.toMatchObject({ code: 'ai-points-query-invalid' }); expect(f.read).not.toHaveBeenCalled()
})
it.each(['unit', 'period', 'total', 'bucket', 'duplicate', 'precision'])('rejects corrupt %s aggregate data', kind => {
  const data = raw()
  if (kind === 'unit') data.unit = 'tokens'
  if (kind === 'period') data.buckets[0]!.until_date = '2026-11-03'
  if (kind === 'total') data.charged_points = '1'
  if (kind === 'bucket') data.buckets[0]!.charged_points = '1'
  if (kind === 'duplicate') data.buckets[0]!.types.push(data.buckets[0]!.types[0]!)
  if (kind === 'precision') data.buckets[0]!.types[0]!.charged_points = '0.00000001'
  expect(() => parsePointsStatistics(data, 'prod:11', query)).toThrow()
})
it('keeps range charges, scope, time and type within the original statistical cutoff', () => {
  const cutoff = Date.now(), request = { fromDate: query.fromDate, untilDate: query.untilDate, timezone: 'Asia/Shanghai' as const, settledBefore: cutoff, businessCodes: ['agent'], beforeId: '20' }
  const item = { business_code: 'agent', request_uid: 'one', operation_uid: 'task', model: 'pro', charged_points: '1', model_points: '1', services: [], granted_points: '0.5', purchased_points: '0.5', created_at: Date.parse('2026-11-01T00:00:00Z'), completed_at: cutoff, tokens: { cache_hit_input: '0', cache_miss_input: '0', output: '0' } }
  const data = { unit: 'ai_points', timezone: 'Asia/Shanghai', from_date: query.fromDate, until_date: query.untilDate, observed_at: cutoff, charged_points: '1', items: [item], next_before_id: '10' }
  expect(parsePointsRange(data, 'prod:11', request).items[0]).toMatchObject({ operationUid: 'task', chargedPoints: '1', grantedPoints: '0.5', purchasedPoints: '0.5' })
  expect(() => parsePointsRange({ ...data, next_before_id: '20' }, 'prod:11', request)).toThrow()
  expect(() => parsePointsRange({ ...data, items: [{ ...item, business_code: 'arkme' }] }, 'prod:11', request)).toThrow()
  expect(() => parsePointsRange({ ...data, items: [{ ...item, completed_at: cutoff + 1 }] }, 'prod:11', request)).toThrow()
  expect(() => parsePointsRange({ ...data, observed_at: cutoff + 1 }, 'prod:11', request)).toThrow()
})
