import { pointsUnits, type ArkmeAiPointsAccount, type ArkmeAiPointsPage, type ArkmeAiPointsQuery } from '../ai-points.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

function invalid(): never { throw new ArkmePluginError('ai-points-contract-invalid', '积分数据暂时无法确认，请重试', true, 502) }
function points(value: unknown): string {
  if (typeof value !== 'string') return invalid()
  try { pointsUnits(value) } catch { return invalid() }
  return value
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) return invalid(); return value }
function integerString(value: unknown): string { if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return invalid(); return value }
function unit(raw: Record<string, unknown>): void { if (raw.unit !== 'ai_points') invalid() }

export function parseAiPointsAccount(raw: Record<string, unknown>, accountScope: string): ArkmeAiPointsAccount {
  unit(raw)
  if (raw.points_per_cny !== 100 || !Array.isArray(raw.grants)) return invalid()
  const result: ArkmeAiPointsAccount = {
    accountScope, unit: 'ai_points', availablePoints: points(raw.available_points), reservedPoints: points(raw.reserved_points),
    grantedPoints: points(raw.granted_points), purchasedPoints: points(raw.purchased_points), observedAt: timestamp(raw.observed_at),
    grants: raw.grants.map(value => { const row = objectValue(value); return { source: text(row.source), availablePoints: points(row.available_points), expiresAt: timestamp(row.expires_at) } }),
  }
  if (pointsUnits(result.availablePoints) !== pointsUnits(result.grantedPoints) + pointsUnits(result.purchasedPoints)
    || result.grants.reduce((total, grant) => total + pointsUnits(grant.availablePoints), 0n) !== pointsUnits(result.grantedPoints)) return invalid()
  return result
}

export function parseAiPointsPage(raw: Record<string, unknown>, accountScope: string, month: string): ArkmeAiPointsPage {
  unit(raw)
  if (raw.month !== month || !Array.isArray(raw.items) || raw.items.length > 20) return invalid()
  const nextBeforeId = raw.next_before_id === '' ? '' : integerString(raw.next_before_id)
  return { accountScope, unit: 'ai_points', month, chargedPoints: points(raw.charged_points), nextBeforeId,
    items: raw.items.map(value => {
      const row = objectValue(value), tokens = objectValue(row.tokens)
      const chargedPoints = points(row.charged_points), grantedPoints = points(row.granted_points), purchasedPoints = points(row.purchased_points)
      if (pointsUnits(chargedPoints) <= 0n || pointsUnits(chargedPoints) !== pointsUnits(grantedPoints) + pointsUnits(purchasedPoints)) return invalid()
      const modelPoints = points(row.model_points)
      if (!Array.isArray(row.services) || row.services.length > 16) return invalid()
      const services = row.services.map(value => {
        const service = objectValue(value)
        const quantity = integerString(service.quantity), chargedPoints = points(service.charged_points)
        if (quantity === '0' || pointsUnits(chargedPoints) === 0n) return invalid()
        return { code: text(service.code), quantity, chargedPoints }
      })
      if (new Set(services.map(service => service.code)).size !== services.length
        || pointsUnits(modelPoints) + services.reduce((sum, service) => sum + pointsUnits(service.chargedPoints), 0n) !== pointsUnits(chargedPoints)) return invalid()
      if (typeof row.business_code !== 'string') return invalid()
      return { requestUid: text(row.request_uid), businessCode: row.business_code, model: text(row.model), chargedPoints, modelPoints, services, grantedPoints, purchasedPoints,
        createdAt: timestamp(row.created_at), completedAt: timestamp(row.completed_at),
        tokens: { cacheHitInput: integerString(tokens.cache_hit_input), cacheMissInput: integerString(tokens.cache_miss_input), output: integerString(tokens.output) } }
    }),
  }
}

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
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(query.month) || (query.beforeId !== undefined && !/^[1-9]\d*$/.test(query.beforeId))) throw new ArkmePluginError('ai-points-query-invalid', '请选择有效月份', false, 400)
    const { session, scope } = await this.session(expectedScope)
    const raw = await this.runtime.authenticatedIntelligentPost<Record<string, unknown>>('/api/v1/managed-ai/points/consumption/query', { month: query.month, before_id: query.beforeId ?? '', limit: 20 }, session, signal, { lane: 'interactive-read', bypassCache: true })
    await this.session(scope)
    return parseAiPointsPage(raw, scope, query.month)
  }
}
