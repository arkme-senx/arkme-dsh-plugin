import { nanoCnyToPoints, pointsUnits, type ArkmeAiPointsConsumption } from '../ai-points.js'
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
export class PointsHistoryError extends Error {
  constructor(readonly reason: 'changed' | 'invalid' | 'too-large') { super(reason) }
}
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
  private readonly summaries = new Map<string, ArkmeAiPointsStatistics>()
  constructor(private readonly scope: string, private readonly aggregate: AggregateApi) {}
  async statistics(window: PointsWindow, selected: string | null, signal: AbortSignal): Promise<PointsStatistics> {
    signal.throwIfAborted()
    const query: ArkmeAiPointsStatisticsQuery = { fromDate: pointsDateKey(window.from), untilDate: pointsDateKey(window.until), timezone: 'Asia/Shanghai', grain: window.grain }
    const key = `${query.grain}:${query.fromDate}:${query.untilDate}`
    let snapshot = this.summaries.get(key)
    if (!snapshot) {
      snapshot = await this.aggregate.summary(query, signal)
      signal.throwIfAborted()
      if (snapshot.accountScope !== this.scope) throw new PointsHistoryError('invalid')
      this.summaries.set(key,snapshot)
      if(this.summaries.size>8)this.summaries.delete(this.summaries.keys().next().value!)
    }
    return aggregatePointsView(snapshot,window,selected)
  }
  async details(query: ArkmeAiPointsRangeQuery, expectedTotal: string, signal: AbortSignal): Promise<ArkmeAiPointsRangePage> {
    signal.throwIfAborted()
    const page=await this.aggregate.range(query,signal)
    signal.throwIfAborted()
    if(page.accountScope!==this.scope||page.fromDate!==query.fromDate||page.untilDate!==query.untilDate||page.observedAt!==query.settledBefore)throw new PointsHistoryError('invalid')
    if(pointsUnits(page.chargedPoints)!==pointsUnits(expectedTotal))throw new PointsHistoryError('changed')
    return page
  }
}
