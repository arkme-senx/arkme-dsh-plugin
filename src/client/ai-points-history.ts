import { nanoCnyToPoints, pointsUnits, type ArkmeAiPointsConsumption, type ArkmeAiPointsPage } from '../ai-points.js'
import type { ArkmeAiPointsRangePage, ArkmeAiPointsRangeQuery, ArkmeAiPointsStatistics, ArkmeAiPointsStatisticsQuery } from '../ai-points-statistics.js'

export type PointsGrain = 'day' | 'week' | 'month'
export const pointsCategories = [
  ['dsh', 'DSH 对话'], ['arko', 'Arko 对话'], ['arrangement', '安排识别'], ['profile', '个人档案识别'],
  ['summary', '录音总结'], ['timeline', '录音时间轴'], ['goal', '目标识别'], ['entity', '录音实体识别'],
  ['record_thought', '快记分析'], ['chat_thought', '聊天分析'], ['offline', '线下交流关联'],
  ['voice_trigger', '录音口令记事'], ['other', '其他'],
] as const
export type PointsCategory = typeof pointsCategories[number][0]
const categories: Record<string, PointsCategory> = {
  arkme: 'dsh', agent: 'arko', arrangement_recognition: 'arrangement', personal_profile: 'profile',
  recording_summary: 'summary', recording_timeline: 'timeline', goal_insight: 'goal', audio_entity: 'entity',
  record_thought: 'record_thought', chat_thought: 'chat_thought', offline_context: 'offline',
  offline_context_manual: 'offline', recording_voice_trigger: 'voice_trigger',
}
// Only explicit billing attribution is classified. Models and telemetry cannot identify a purpose.
export const pointsCategory = (code: string): PointsCategory => categories[code] ?? 'other'
export const pointsCategoryLabel = (category: PointsCategory): string => pointsCategories.find(item => item[0] === category)![1]
export const pointsBusinessLabel = (code: string): string => pointsCategoryLabel(pointsCategory(code))
const dayMs = 86_400_000, zoneMs = 8 * 3_600_000
export interface PointsPeriod { key: string; from: number; until: number }
export interface PointsWindow { grain: PointsGrain; periods: PointsPeriod[]; from: number; until: number }
export interface PointsBucket extends PointsPeriod { chargedPoints: string }
export interface PointsStatistics {
  buckets: PointsBucket[]; chargedPoints: string; selectedPoints: string
  categories: { category: PointsCategory; chargedPoints: string }[]
  items: ArkmeAiPointsConsumption[]; observedAt: number
  source?: 'aggregate'
  snapshot?: ArkmeAiPointsStatistics
}
const monthKey = (time: number) => new Date(time + zoneMs).toISOString().slice(0, 7)
const monthStart = (year: number, month: number) => Date.UTC(year, month, 1) - zoneMs
export function pointsWindow(grain: PointsGrain, offset = 0, now = Date.now()): PointsWindow {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 500) throw new Error('Invalid points window')
  const local = new Date(now + zoneMs), count = grain === 'day' ? 15 : grain === 'week' ? 8 : 12
  const today = Math.floor((now + zoneMs) / dayMs) * dayMs - zoneMs
  const latest = grain === 'week' ? today - (local.getUTCDay() + 6) % 7 * dayMs : today
  const periods = Array.from({ length: count }, (_, index) => {
    const back = count - 1 - index + offset * count
    const from = grain === 'month' ? monthStart(local.getUTCFullYear(), local.getUTCMonth() - back) : latest - back * dayMs * (grain === 'week' ? 7 : 1)
    const until = grain === 'month' ? monthStart(local.getUTCFullYear(), local.getUTCMonth() - back + 1) : from + dayMs * (grain === 'week' ? 7 : 1)
    return { key: grain === 'month' ? monthKey(from) : new Date(from + zoneMs).toISOString().slice(0, 10), from, until }
  })
  return { grain, periods, from: periods[0]!.from, until: periods.at(-1)!.until }
}
function monthsIn(from: number, until: number): string[] {
  const start = new Date(from + zoneMs), last = monthKey(until - 1), result: string[] = []
  for (let index = 0; index < 13; index++) {
    const key = monthKey(monthStart(start.getUTCFullYear(), start.getUTCMonth() + index))
    result.push(key); if (key === last) return result
  }
  throw new Error('Invalid points range')
}
export class PointsHistoryError extends Error {
  constructor(readonly reason: 'changed' | 'invalid' | 'too-large') { super(reason) }
}
type ReadPage = (month: string, beforeId: string, signal: AbortSignal, limit: number) => Promise<ArkmeAiPointsPage>
type Month = { page: ArkmeAiPointsPage; items?: ArkmeAiPointsConsumption[]; observedAt: number }
type Budget = { pages: number; rows: number }
type AggregateApi = {
  summary(query: ArkmeAiPointsStatisticsQuery, signal: AbortSignal): Promise<ArkmeAiPointsStatistics>
  range(query: ArkmeAiPointsRangeQuery, signal: AbortSignal): Promise<ArkmeAiPointsRangePage>
}
export const pointsDateKey = (stamp: number): string => new Date(stamp + zoneMs).toISOString().slice(0, 10)

export function aggregatePointsView(snapshot: ArkmeAiPointsStatistics, window: PointsWindow, selected: string | null): PointsStatistics {
  if (snapshot.query.fromDate !== pointsDateKey(window.from) || snapshot.query.untilDate !== pointsDateKey(window.until) || snapshot.query.grain !== window.grain || snapshot.buckets.length !== window.periods.length) throw new PointsHistoryError('invalid')
  const buckets = window.periods.map((period, index) => ({ ...period, chargedPoints: snapshot.buckets[index]!.chargedPoints }))
  const selectedKey = selected === null ? null : window.periods.find(period => period.key === selected)?.key ?? window.periods.at(-1)!.key
  const chosen = snapshot.buckets.filter((_, index) => selectedKey === null || window.periods[index]!.key === selectedKey)
  const byCategory = new Map<PointsCategory, bigint>()
  for (const bucket of chosen) for (const item of bucket.types) {
    const category = pointsCategory(item.businessCode)
    byCategory.set(category, (byCategory.get(category) ?? 0n) + pointsUnits(item.chargedPoints))
  }
  const categories = pointsCategories.map(([category]) => ({ category, chargedPoints: nanoCnyToPoints((byCategory.get(category) ?? 0n).toString()) }))
    .sort((a, b) => { const left = pointsUnits(a.chargedPoints), right = pointsUnits(b.chargedPoints); return left === right ? 0 : left > right ? -1 : 1 })
  return { buckets, categories, chargedPoints: snapshot.chargedPoints, selectedPoints: nanoCnyToPoints(chosen.reduce((sum, bucket) => sum + pointsUnits(bucket.chargedPoints), 0n).toString()), observedAt: snapshot.observedAt, items: [], source: 'aggregate', snapshot }
}

/** Dialog-local statements; Refresh/reopen replaces this reader. Never publishes a partial aggregate. */
export class PointsHistoryReader {
  private readonly cache = new Map<string, Month>()
  private readonly summaries = new Map<string, ArkmeAiPointsStatistics>()
  private aggregateSupported = true
  constructor(private readonly scope: string, private readonly readPage: ReadPage, private readonly now = Date.now, private readonly aggregate?: AggregateApi) {}

  private remember(month: string, value: Month): void {
    this.cache.delete(month); this.cache.set(month, value)
    let rows = [...this.cache.values()].reduce((sum, entry) => sum + (entry.items?.length ?? entry.page.items.length), 0)
    while (this.cache.size > 24 || rows > 50_000) {
      const key = this.cache.keys().next().value!
      const entry = this.cache.get(key)!
      rows -= entry.items?.length ?? entry.page.items.length
      this.cache.delete(key)
    }
  }

  private async page(month: string, cursor: string, signal: AbortSignal, budget: Budget, limit = 100): Promise<ArkmeAiPointsPage> {
    signal.throwIfAborted()
    if (++budget.pages > 240) throw new PointsHistoryError('too-large')
    const page = await this.readPage(month, cursor, signal, limit)
    signal.throwIfAborted()
    if (page.accountScope !== this.scope || page.unit !== 'ai_points' || page.month !== month
      || !Array.isArray(page.items) || !/^(?:|[1-9]\d*)$/.test(page.nextBeforeId)
      || (cursor && page.nextBeforeId && BigInt(page.nextBeforeId) >= BigInt(cursor))) throw new PointsHistoryError('invalid')
    pointsUnits(page.chargedPoints)
    budget.rows += page.items.length
    if (budget.rows > 25_000) throw new PointsHistoryError('too-large')
    if (page.nextBeforeId && !page.items.length) throw new PointsHistoryError('invalid')
    for (const item of page.items) {
      if (!item.requestUid || !Number.isSafeInteger(item.createdAt) || monthKey(item.createdAt) !== month
        || pointsUnits(item.chargedPoints) <= 0n) throw new PointsHistoryError('invalid')
    }
    return page
  }

  async month(month: string, complete: boolean, signal: AbortSignal, budget: Budget): Promise<Month> {
    signal.throwIfAborted()
    const cached = this.cache.get(month)
    if (cached && (!complete || cached.items)) { this.remember(month, cached); return cached }
    for (let attempt = 0; attempt < 2; attempt++) {
      const reuse = attempt === 0 && cached
      const first = reuse
        ? cached.page : await this.page(month, '', signal, budget, complete ? 100 : 1)
      const observedAt = reuse ? cached.observedAt : this.now()
      if (!complete) {
        const value = { page: first, observedAt }; this.remember(month, value); return value
      }
      try {
        const items: ArkmeAiPointsConsumption[] = [], seen = new Set<string>()
        let page = first, pageCount = 0, sum = 0n
        while (true) {
          signal.throwIfAborted()
          if (++pageCount > 160) throw new PointsHistoryError('too-large')
          // The ledger is append-only and cursors use stable MIN(id) operation anchors.
          // Newer groups may settle above our cursor. Keep the first total and
          // require the final, duplicate-free traversal to reconcile exactly to it.
          if (pointsUnits(page.chargedPoints) < pointsUnits(first.chargedPoints)) throw new PointsHistoryError('changed')
          for (const item of page.items) {
            if (seen.has(item.requestUid)) throw new PointsHistoryError('changed')
            seen.add(item.requestUid); items.push(item); sum += pointsUnits(item.chargedPoints)
          }
          if (!page.nextBeforeId) break
          page = await this.page(month, page.nextBeforeId, signal, budget)
        }
        if (sum !== pointsUnits(first.chargedPoints)) throw new PointsHistoryError('changed')
        const value = { page: first, items, observedAt }; this.remember(month, value); return value
      } catch (error) {
        this.cache.delete(month)
        if (!(error instanceof PointsHistoryError) || error.reason !== 'changed' || attempt) throw error
      }
    }
    throw new PointsHistoryError('changed')
  }

  async statistics(window: PointsWindow, selected: string | null, signal: AbortSignal): Promise<PointsStatistics> {
    const controller = new AbortController(), abort = () => controller.abort(signal.reason)
    signal.throwIfAborted()
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (this.aggregate && this.aggregateSupported) {
        const query: ArkmeAiPointsStatisticsQuery = { fromDate: pointsDateKey(window.from), untilDate: pointsDateKey(window.until), timezone: 'Asia/Shanghai', grain: window.grain }
        const key = `${query.grain}:${query.fromDate}:${query.untilDate}`
        try {
          let snapshot = this.summaries.get(key)
          if (!snapshot) {
            snapshot = await this.aggregate.summary(query, controller.signal)
            controller.signal.throwIfAborted()
            if (snapshot.accountScope !== this.scope) throw new PointsHistoryError('invalid')
            this.summaries.set(key, snapshot)
            if (this.summaries.size > 8) this.summaries.delete(this.summaries.keys().next().value!)
          }
          return aggregatePointsView(snapshot, window, selected)
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
          if (code !== 'ai-points-statistics-unsupported' && code !== 'operation-unknown') throw error
          this.aggregateSupported = false
        }
      }
      return await this.readStatistics(window, selected, controller.signal)
    }
    catch (error) { controller.abort(); throw error }
    finally { signal.removeEventListener('abort', abort) }
  }

  async details(query: ArkmeAiPointsRangeQuery, expectedTotal: string, signal: AbortSignal): Promise<ArkmeAiPointsRangePage> {
    if (!this.aggregate || !this.aggregateSupported) throw new PointsHistoryError('invalid')
    const page = await this.aggregate.range(query, signal)
    signal.throwIfAborted()
    if (page.accountScope !== this.scope || page.fromDate !== query.fromDate || page.untilDate !== query.untilDate || page.observedAt !== query.settledBefore) throw new PointsHistoryError('invalid')
    if (pointsUnits(page.chargedPoints) !== pointsUnits(expectedTotal)) throw new PointsHistoryError('changed')
    return page
  }

  private async readStatistics(window: PointsWindow, selected: string | null, signal: AbortSignal): Promise<PointsStatistics> {
    const budget: Budget = { pages: 0, rows: 0 }, months = monthsIn(window.from, window.until)
    const statements = new Map<string, Month>()
    let next = 0
    // Two reads at most; the year chart initially reads totals, not twelve complete ledgers.
    await Promise.all([0, 1].map(async () => {
      while (next < months.length) {
        const month = months[next++]!
        statements.set(month, await this.month(month, window.grain !== 'month', signal, budget))
      }
    }))
    const period = selected === null ? window : window.periods.find(period => period.key === selected) ?? window.periods.at(-1)!
    if (window.grain === 'month') {
      const selectedMonths = monthsIn(period.from, period.until)
      next = 0
      await Promise.all([0, 1].map(async () => {
        while (next < selectedMonths.length) {
          const month = selectedMonths[next++]!
          statements.set(month, await this.month(month, true, signal, budget))
        }
      }))
    }
    signal.throwIfAborted()
    const allItems = [...statements.values()].flatMap(value => value.items ?? [])
    if (new Set(allItems.map(item => item.requestUid)).size !== allItems.length) throw new PointsHistoryError('invalid')
    const buckets = window.periods.map(period => ({ ...period, chargedPoints: window.grain === 'month'
      ? statements.get(monthKey(period.from))!.page.chargedPoints
      : nanoCnyToPoints(allItems.filter(item => item.createdAt >= period.from && item.createdAt < period.until).reduce((sum, item) => sum + pointsUnits(item.chargedPoints), 0n).toString()) }))
    const items = allItems.filter(item => item.createdAt >= period.from && item.createdAt < period.until)
      .sort((a, b) => b.createdAt - a.createdAt || a.requestUid.localeCompare(b.requestUid))
    const byCategory = new Map<PointsCategory, bigint>()
    for (const item of items) {
      const category = pointsCategory(item.businessCode)
      byCategory.set(category, (byCategory.get(category) ?? 0n) + pointsUnits(item.chargedPoints))
    }
    const categories = pointsCategories.map(([category]) => ({ category, chargedPoints: nanoCnyToPoints((byCategory.get(category) ?? 0n).toString()) }))
      .sort((a, b) => { const left = pointsUnits(a.chargedPoints), right = pointsUnits(b.chargedPoints); return left === right ? 0 : left > right ? -1 : 1 })
    return {
      buckets, items, categories, observedAt: Math.min(...[...statements.values()].map(value => value.observedAt)),
      chargedPoints: nanoCnyToPoints(buckets.reduce((sum, bucket) => sum + pointsUnits(bucket.chargedPoints), 0n).toString()),
      selectedPoints: nanoCnyToPoints(items.reduce((sum, item) => sum + pointsUnits(item.chargedPoints), 0n).toString()),
    }
  }
}
