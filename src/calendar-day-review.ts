import { parseReviewPromptSnapshot, type ReviewPromptSnapshot } from './calendar-day-review-prompts.js'
/** Calendar review v1: separate from recording-only summaries. Durable owner contract. */
export const DAY_REVIEW_SOURCES = ['chat', 'location', 'self', 'call', 'audio'] as const
export type DayReviewSource = typeof DAY_REVIEW_SOURCES[number]
export const DAY_REVIEW_LABELS: Record<DayReviewSource, string> = {
  chat: '对话', location: '位置', self: '发给自己', call: '通话', audio: '录音转写',
}
export interface DayReviewQuery { accountScope: string; bucketDate: string; timezone: string }
export interface DayReviewEvidence { ref: string; kind: DayReviewSource; label: string }
export interface DayReviewPoint { text: string; sourceRefs: string[] }
export interface DayReviewEvent extends DayReviewPoint { title: string; startAtMillis: number | null; endAtMillis: number | null }
export interface DayReviewCoverage {
  kind: DayReviewSource; status: 'complete' | 'partial' | 'unavailable' | 'empty'; count: number; note: string
}
export interface DayReviewResult {
  id: string; snapshotId: string; generatedAtMillis: number; modelName: string; sourceKinds: DayReviewSource[]
  coverage: DayReviewCoverage[]; summary: DayReviewPoint[]; timeline: DayReviewEvent[]; sources: DayReviewEvidence[]
  promptSnapshot?: ReviewPromptSnapshot
}
export interface DayReviewJob {
  id: string; status: 'queued' | 'collecting' | 'organizing' | 'generating' | 'failed'; message: string; failureCode: string; resumable: boolean
}
export interface DayReviewState {
  supported: boolean; job: DayReviewJob | null; result: DayReviewResult | null; freshness: 'changed' | 'unchanged' | 'unknown'; pendingRequestId?: string
  versions: Array<{ id: string; generatedAtMillis: number }>
}
export const emptyDayReviewState = (): DayReviewState => ({ supported: false, job: null, result: null, freshness: 'unknown', versions: [] })

const invalid = (): never => { throw new Error('日历回顾数据格式不完整，请稍后重试') }
export const reviewObject = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid()
export const reviewText = (v: unknown, max = 512): string => typeof v === 'string' && v.trim() && v.length <= max ? v : invalid()
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid()
const number = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid()
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
    const event = reviewObject(x), startAtMillis = event.start_at === null ? null : number(event.start_at), endAtMillis = event.end_at === null ? null : number(event.end_at)
    if ((startAtMillis === null) !== (endAtMillis === null)) invalid()
    if (startAtMillis !== null && endAtMillis !== null && (endAtMillis < startAtMillis || dateAt(startAtMillis) !== q.bucketDate || dateAt(Math.max(startAtMillis, endAtMillis - 1)) !== q.bucketDate)) invalid()
    return { ...point(event), title: reviewText(event.title, 200), startAtMillis, endAtMillis }
  }).sort((a, b) => (a.startAtMillis ?? Infinity) - (b.startAtMillis ?? Infinity))
  return { id: reviewText(v.id), snapshotId: reviewText(v.snapshot_id), generatedAtMillis: number(v.generated_at),
    modelName: reviewText(v.model_name, 200), sourceKinds, coverage, sources, summary: array(v.summary, 500).map(point), timeline,
    ...(v.prompt_snapshot === undefined ? {} : { promptSnapshot: parseReviewPromptSnapshot(v.prompt_snapshot) }) }
}
export function parseDayReviewState(value: unknown, q: DayReviewQuery): DayReviewState {
  const v = reviewObject(value)
  assertDayReviewEnvelope(v, q)
  let job: DayReviewJob | null = null
  if (v.job !== null) {
    const j = reviewObject(v.job), status = j.status as DayReviewJob['status']
    if (!['queued', 'collecting', 'organizing', 'generating', 'failed'].includes(status)) invalid()
    job = { id: reviewText(j.id), status, message: j.message ? reviewText(j.message, 1000) : '', failureCode: typeof j.failure_code === 'string' ? j.failure_code : '', resumable: j.resumable === true }
  }
  const versions = array(v.versions, 30).map(x => {
    const version = reviewObject(x)
    return { id: reviewText(version.id), generatedAtMillis: number(version.generated_at) }
  })
  if (new Set(versions.map(x => x.id)).size !== versions.length) invalid()
  return { supported: true, job, result: v.result === null ? null : parseDayReviewResult(v.result, q),
    freshness: ['changed', 'unchanged', 'unknown'].includes(String(v.freshness)) ? v.freshness as DayReviewState['freshness'] : invalid(), versions }
}

export interface DayReviewCreateInput extends DayReviewQuery { requestId: string; sourceKinds: DayReviewSource[]; promptConfig?: import('./calendar-day-review-prompts.js').ReviewPromptConfig; reuseResultId?: string }
export interface DayReviewEvidenceQuery extends DayReviewQuery { resultId: string; sourceRef: string }
export interface DayReviewOriginalEvidence { ref: string; resultId: string; kind: DayReviewSource; subtype: string; label: string; text: string; startAtMillis: number | null; endAtMillis: number | null }
