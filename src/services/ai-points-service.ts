import type { ArkmeAiPointsAccount, ArkmeAiPointsPage, ArkmeAiPointsQuery } from '../ai-points.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import type { ArkmeAiPointsRangeQuery, ArkmeAiPointsStatisticsQuery } from '../ai-points-statistics.js'
import { parseAiPointsAccount, parseAiPointsPage } from './ai-points-contract.js'
import { parsePointsRange, parsePointsStatistics, validatePointsRangeQuery, validatePointsStatisticsQuery } from './ai-points-statistics-contract.js'
export { parseAiPointsAccount, parseAiPointsPage, parseAiPointsItems } from './ai-points-contract.js'

/** One owner for UI, SDK and Tools. It never reads raw usage telemetry. */
export class AiPointsService {
  constructor(private readonly runtime: ServiceRuntime) {}

  private async session(expectedScope?: string) {
    const session = await this.runtime.requireSession()
    const scope = `${this.runtime.config.environment}:${session.userId}`
    if (expectedScope !== undefined && expectedScope !== scope) throw new ArkmePluginError('ai-points-account-changed', '账号已切换，请重新读取积分', false, 409)
    return { session, scope }
  }
  async account(expectedScope?: string, signal?: AbortSignal): Promise<ArkmeAiPointsAccount> {
    const { session, scope } = await this.session(expectedScope)
    const raw = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/managed-ai/points/query', {}, session, signal, { lane: 'interactive-read', bypassCache: true })
    await this.session(scope)
    return parseAiPointsAccount(raw, scope)
  }
  async consumption(query: ArkmeAiPointsQuery, expectedScope?: string, signal?: AbortSignal): Promise<ArkmeAiPointsPage> {
    const limit = query.limit ?? 20
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(query.month) || (query.beforeId !== undefined && !/^[1-9]\d*$/.test(query.beforeId))
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ArkmePluginError('ai-points-query-invalid', '请选择有效月份和分页范围', false, 400)
    const { session, scope } = await this.session(expectedScope)
    const raw = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/managed-ai/points/consumption/query', { month: query.month, before_id: query.beforeId ?? '', limit }, session, signal, { lane: 'interactive-read', bypassCache: true })
    await this.session(scope)
    return parseAiPointsPage(raw, scope, query.month, limit)
  }
  async statistics(query: ArkmeAiPointsStatisticsQuery, expectedScope?: string, signal?: AbortSignal) {
    validatePointsStatisticsQuery(query)
    const { session, scope } = await this.session(expectedScope)
    let raw: Record<string, unknown>
    try {
      raw = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/managed-ai/points/consumption/statistics/query', { from_date: query.fromDate, until_date: query.untilDate, timezone: query.timezone, grain: query.grain }, session, signal, { lane: 'interactive-read', bypassCache: true })
    } catch (error) {
      if (error instanceof ArkmePluginError && (error.httpStatus === 404 || error.upstreamStatus === 404)) throw new ArkmePluginError('ai-points-statistics-unsupported', '当前服务尚未提供积分汇总', false, 404)
      throw error
    }
    await this.session(scope)
    return parsePointsStatistics(raw, scope, query)
  }
  async consumptionRange(query: ArkmeAiPointsRangeQuery, expectedScope?: string, signal?: AbortSignal) {
    validatePointsRangeQuery(query)
    const { session, scope } = await this.session(expectedScope)
    const raw = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/managed-ai/points/consumption/range/query', {
      from_date: query.fromDate, until_date: query.untilDate, timezone: query.timezone, before_id: query.beforeId ?? '', limit: query.limit ?? 20,
      ...(query.businessCodes ? { business_codes: query.businessCodes } : {}), ...(query.settledBefore !== undefined ? { settled_before: query.settledBefore } : {}),
    }, session, signal, { lane: 'interactive-read', bypassCache: true })
    await this.session(scope)
    return parsePointsRange(raw, scope, query)
  }
}
