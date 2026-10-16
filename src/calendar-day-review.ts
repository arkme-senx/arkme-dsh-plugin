import { parseReviewPromptSnapshot, type ReviewPromptSnapshot } from './calendar-day-review-prompts.js'
/** Calendar review v1: separate from recording-only summaries. Provider-owned durable jobs and source access checks. */
export const DAY_REVIEW_SOURCES = ['chat', 'location', 'self', 'call', 'audio'] as const
export type DayReviewSource = typeof DAY_REVIEW_SOURCES[number]
export const DAY_REVIEW_LABELS: Record<DayReviewSource, string> = {
  chat: '对话', location: '位置', self: '发给自己', call: '通话', audio: '录音转写',
}
export interface DayReviewQuery { accountScope: string; bucketDate: string; timezone: string }
export interface DayReviewEvidence { ref: string; kind: DayReviewSource; label: string }
export interface DayReviewPoint { text: string; sourceRefs: string[] }
export interface DayReviewEvent extends DayReviewPoint { title: string; startAtMillis: number; endAtMillis: number; scene?: string; roles?: string[]; events?: string[]; mood?: string; todos?: string[]; quotes?: string[] }
export interface DayReviewCoverage {
  kind: DayReviewSource; status: 'complete' | 'partial' | 'unavailable' | 'empty'; count: number; note: string
}
export interface DayReviewResult {
  id: string; snapshotId: string; generatedAtMillis: number; modelName: string; sourceKinds: DayReviewSource[]
  coverage: DayReviewCoverage[]; summary: DayReviewPoint[]; timeline: DayReviewEvent[]; sources: DayReviewEvidence[]
  sourceScope?: DayReviewSource[]; timeZoneOffsetMillis?: number
  promptSnapshot?: ReviewPromptSnapshot
}
export interface DayReviewJob {
  id: string; status: 'queued' | 'running' | 'collecting' | 'organizing' | 'generating' | 'ready' | 'failed'; message: string; stage?: string; errorCode?: string; requestId?: string
}
export interface DayReviewState {
  supported: boolean; generationEnabled?: boolean; sourceKinds?: DayReviewSource[]; job: DayReviewJob | null; result: DayReviewResult | null; hasNewContent: boolean
  resultUnavailableReason?: 'source_access_changed'
  versions: Array<{ id: string; generatedAtMillis: number }>
}
export const emptyDayReviewState = (): DayReviewState => ({ supported: false, job: null, result: null, hasNewContent: false, versions: [] })

const invalid = (): never => { throw new Error('日历回顾数据格式不完整，请稍后重试') }
export const reviewObject = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid()
export const reviewText = (v: unknown, max = 512): string => typeof v === 'string' && v.trim() && v.length <= max ? v : invalid()
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid()
const number = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid()
const flag = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid()
export function reviewKinds(v: unknown): DayReviewSource[] {
  const values = array(v, 5)
  if (!values.length || new Set(values).size !== values.length || values.some(x => !DAY_REVIEW_SOURCES.includes(x as DayReviewSource))) invalid()
  return DAY_REVIEW_SOURCES.filter(x => values.includes(x))
}
export function parseDayReviewQuery(value: unknown): DayReviewQuery {
  const v = reviewObject(value), bucketDate = reviewText(v.bucketDate, 10), timezone = reviewText(v.timezone, 100)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bucketDate) || new Date(`${bucketDate}T00:00:00Z`).toISOString().slice(0, 10) !== bucketDate) invalid()
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  return { accountScope: reviewText(v.accountScope, 200), bucketDate, timezone }
}
export function assertDayReviewEnvelope(v: Record<string, unknown>, q: DayReviewQuery): void {
  if (v.schema_version !== 1 || v.scope !== 'calendar_day' || v.date !== q.bucketDate || v.time_zone !== q.timezone) invalid()
}
export function parseDayReviewResult(value: unknown, q: DayReviewQuery): DayReviewResult {
  const v = reviewObject(value)
  assertDayReviewEnvelope(v, q)
  const sourceKinds = reviewKinds(v.source_kinds)
  const sources = array(v.sources, 5000).map(x => {
    const item = reviewObject(x), kind = item.kind as DayReviewSource
    if (!sourceKinds.includes(kind)) invalid()
    return { ref: reviewText(item.ref, 4096), kind, label: reviewText(item.label, 200) }
  })
  const refs = new Set(sources.map(x => x.ref))
  if (refs.size !== sources.length) invalid()
  const point = (value: unknown): DayReviewPoint => {
    const p = reviewObject(value), sourceRefs = array(p.source_refs, 100).map(x => reviewText(x, 4096))
    if (!sourceRefs.length || new Set(sourceRefs).size !== sourceRefs.length || sourceRefs.some(x => !refs.has(x))) invalid()
    return { text: reviewText(p.text, 10000), sourceRefs }
  }
  const coverage = array(v.coverage, 5).map(x => {
    const item = reviewObject(x), kind = item.kind as DayReviewSource, status = item.status as DayReviewCoverage['status']
    if (!sourceKinds.includes(kind) || !['complete', 'partial', 'unavailable', 'empty'].includes(status)) invalid()
    const count = number(item.count)
    if (status === 'empty' && count !== 0) invalid()
    return { kind, status, count, note: item.note ? reviewText(item.note, 1000) : '' }
  })
  if (coverage.length !== sourceKinds.length || new Set(coverage.map(x => x.kind)).size !== sourceKinds.length) invalid()
  const dateAt = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: q.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
  const timeline = array(v.timeline, 500).map(x => {
    const event = reviewObject(x), startAtMillis = number(event.start_at), endAtMillis = number(event.end_at)
    if (endAtMillis < startAtMillis || dateAt(startAtMillis) !== q.bucketDate || dateAt(Math.max(startAtMillis, endAtMillis - 1)) !== q.bucketDate) invalid()
    return { ...point(event), title: reviewText(event.title, 200), startAtMillis, endAtMillis,
      ...(event.scene === undefined ? {} : { scene: reviewText(event.scene), mood: reviewText(event.mood),
        ...Object.fromEntries(['roles','events','todos','quotes'].map(key => [key, array(event[key], 100).map(x => reviewText(x, 10000))])) }) }
  }).sort((a, b) => a.startAtMillis - b.startAtMillis)
  return { id: reviewText(v.id), snapshotId: reviewText(v.snapshot_id), generatedAtMillis: number(v.generated_at),
    modelName: reviewText(v.model_name, 200), sourceKinds, coverage, sources, summary: array(v.summary, 100).map(point), timeline,
    ...(v.source_scope === undefined ? {} : { sourceScope: array(v.source_scope, 5).map(x => { if (!sourceKinds.includes(x as DayReviewSource)) invalid(); return x as DayReviewSource }) }),
    ...(v.time_zone_offset_millis === undefined ? {} : { timeZoneOffsetMillis: typeof v.time_zone_offset_millis === 'number' && Number.isSafeInteger(v.time_zone_offset_millis) && Math.abs(v.time_zone_offset_millis) <= 86400000 ? v.time_zone_offset_millis : invalid() }),
    ...(v.prompt_snapshot === undefined ? {} : { promptSnapshot: parseReviewPromptSnapshot(v.prompt_snapshot) }) }
}
export function parseDayReviewState(value: unknown, q: DayReviewQuery): DayReviewState {
  const v = reviewObject(value)
  assertDayReviewEnvelope(v, q)
  let job: DayReviewJob | null = null
  if (v.job !== null) {
    const j = reviewObject(v.job), status = j.status as DayReviewJob['status']
    if (!['queued', 'running', 'collecting', 'organizing', 'generating', 'ready', 'failed'].includes(status)) invalid()
    job = { id: reviewText(j.id), status, message: j.message ? reviewText(j.message, 1000) : '', ...(j.stage ? { stage: reviewText(j.stage) } : {}), ...(j.error_code ? { errorCode: reviewText(j.error_code) } : {}), ...(j.request_id ? { requestId: reviewText(j.request_id) } : {}) }
  }
  const versions = array(v.versions, 30).map(x => {
    const version = reviewObject(x)
    return { id: reviewText(version.id), generatedAtMillis: number(version.generated_at) }
  })
  if (new Set(versions.map(x => x.id)).size !== versions.length) invalid()
  if (v.result_unavailable_reason !== undefined && (v.result_unavailable_reason !== 'source_access_changed' || v.result !== null)) invalid()
  return { supported: true, ...(v.generation_enabled === undefined ? {} : { generationEnabled: flag(v.generation_enabled) }), job, result: v.result === null ? null : parseDayReviewResult(v.result, q),
    ...(v.result_unavailable_reason === undefined ? {} : { resultUnavailableReason: 'source_access_changed' as const }),
    hasNewContent: flag(v.has_new_content), versions }
}
