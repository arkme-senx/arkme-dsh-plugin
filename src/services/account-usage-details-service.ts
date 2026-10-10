import type { ArkmeTokenUsageCall, ArkmeTokenUsageOperation, ArkmeTokenUsagePage, ArkmeTokenUsageQuery, ArkmeTokenUsageSummary, ArkmeUsageTokens } from '../account-usage-details.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/
function invalid() { return new ArkmePluginError('account-usage-details-invalid', '用量明细暂时无法确认，请重试', true, 502) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid()
  return value
}
function text(value: unknown, max = 16384): string {
  if (typeof value !== 'string' || value.length > max) throw invalid()
  return value
}
function tokens(value: unknown): ArkmeUsageTokens {
  const raw = object(value)
  return { promptTokens: count(raw.prompt_tokens), completionTokens: count(raw.completion_tokens), totalTokens: count(raw.total_tokens),
    cachedTokens: count(raw.cached_tokens), cacheMissTokens: count(raw.cache_miss_tokens), cacheCreationInputTokens: count(raw.cache_creation_input_tokens) }
}
function partial(value: unknown): boolean {
  if (value == null) return true
  const raw = object(value)
  return count(raw.partial) > 0 || count(raw.unavailable) > 0 || count(raw.invalid) > 0
}
function status(value: unknown): number { return [1, 2, 3, 4].includes(value as number) ? value as number : 1 }
export function parseTokenSummary(value: unknown, accountScope: string): ArkmeTokenUsageSummary {
  const raw = object(value), monthKey = text(raw.month_key, 7)
  if (!monthPattern.test(monthKey) || !Array.isArray(raw.available_months)) throw invalid()
  const availableMonths = [...new Set(raw.available_months.map(value => {
    const month = text(value, 7); if (!monthPattern.test(month)) throw invalid(); return month
  }))].sort().reverse()
  const timezone = text(raw.timezone, 100)
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { throw invalid() }
  return { accountScope, monthKey, timezone, availableMonths,
    windowStartMs: count(raw.window_start_ms), windowEndMs: count(raw.window_end_ms), availableFromMs: count(raw.available_from_ms),
    callCount: count(raw.call_count), tokens: tokens(raw.tokens), partialUsage: partial(raw.usage) }
}
export function parseTokenPage<T extends ArkmeTokenUsageOperation | ArkmeTokenUsageCall>(value: unknown, accountScope: string, kind: 'operations' | 'calls'): ArkmeTokenUsagePage<T> {
  const raw = object(value)
  if (!Array.isArray(raw.items) || raw.items.length > 100) throw invalid()
  const items = raw.items.map(value => {
    const item = object(value)
    const common = { occurredAtMs: count(item.occurred_at_ms), cacheStatus: status(item.cache_status), tokens: tokens(item.tokens) }
    if (kind === 'calls') return { ...common, model: text(item.model, 512), usageStatus: status(item.usage_status) }
    const operationUid = text(item.operation_uid, 256), displayName = text(item.display_name, 2048)
    if (!operationUid.trim() || !displayName.trim() || !Array.isArray(item.models)) throw invalid()
    return { ...common, operationUid, displayName, bizCode: count(item.biz_code), callCount: count(item.call_count),
      models: item.models.map(value => text(value, 512)), partialUsage: partial(item.usage) }
  }) as T[]
  return { accountScope, items, nextCursor: text(raw.next_cursor) }
}

export class AccountUsageDetailsService {
  constructor(private readonly runtime: ServiceRuntime) {}
  private async session(scope: string) {
    const session = await this.runtime.requireSession()
    if (scope !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('account-usage-account-changed', '账号已切换，请重新打开用量卡片', false, 409)
    return session
  }
  private async read(scope: string, kind: 'summary' | 'operations' | 'calls', query: ArkmeTokenUsageQuery, signal?: AbortSignal) {
    const session = await this.session(scope)
    const month = text(query.monthKey, 7), timezone = text(query.timezone, 100) || 'Asia/Shanghai'
    if (month && !monthPattern.test(month)) throw invalid()
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { throw invalid() }
    const body: Record<string, unknown> = { month_key: month, timezone }
    if (kind !== 'summary') { body.cursor = text(query.cursor ?? ''); body.limit = 20 }
    if (kind === 'calls') {
      const uid = text(query.operationUid, 256), biz = count(query.bizCode)
      if (!uid.trim() || biz > 32767) throw invalid()
      body.operation_uid = uid; body.biz_code = biz
    }
    const raw = await this.runtime.authenticatedIntelligentPost<unknown>(`/api/v1/llm-usage/me/${kind}`, body, session, signal, { lane: 'interactive-read' })
    await this.session(scope)
    return raw
  }
  async summary(scope: string, query: ArkmeTokenUsageQuery, signal?: AbortSignal) {
    const result = parseTokenSummary(await this.read(scope, 'summary', query, signal), scope)
    if (query.monthKey && result.monthKey !== query.monthKey) throw invalid()
    return result
  }
  async operations(scope: string, query: ArkmeTokenUsageQuery, signal?: AbortSignal) {
    return parseTokenPage<ArkmeTokenUsageOperation>(await this.read(scope, 'operations', query, signal), scope, 'operations')
  }
  async calls(scope: string, query: ArkmeTokenUsageQuery, signal?: AbortSignal) {
    return parseTokenPage<ArkmeTokenUsageCall>(await this.read(scope, 'calls', query, signal), scope, 'calls')
  }
}
