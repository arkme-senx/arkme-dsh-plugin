/** Public evidence contract: opaque references only; never biometric vectors. */
export interface RecordingEvidenceQuery {
  action: 'capabilities' | 'consistency' | 'compare' | 'members' | 'candidates' | 'build'
  groupRefs?: string[]
  itemRefs?: string[]
  referenceA?: string[]
  referenceB?: string[]
  selections?: Array<{ itemRef: string; startAt: number; endAt: number }>
  version?: string
  cursor?: string
  sort?: 'time' | 'deviation'
  limit?: number
}
export interface RecordingEvidenceDeviation { client_index: number; status: 'ready' | 'insufficient'; deviation: number | null; reason?: string }
export interface RecordingEvidenceGroup {
  client_index: number; version: string; model_version: string; score_definition: string; reference_method: string
  state: 'ready' | 'partial' | 'insufficient' | 'building'; score: number | null
  analyzed_count: number; total_count: number; review_count: number | null; suspected_voices?: number
  analyzed_speech_ms: number; total_speech_ms: number | null; items: RecordingEvidenceDeviation[]
}
export type RecordingEvidenceResult =
  | { supported: false }
  | { supported: true; schema_version: 1; actions: string[] }
  | { supported: true; schema_version: 1; metric: 'cosine_distance'; groups: RecordingEvidenceGroup[] }
  | { supported: true; schema_version: 1; metric: 'cosine_distance'; version: string; model_version: string; aggregation: 'mean_reference'; state: 'ready' | 'building'; items: Array<{ client_index: number; status: 'ready' | 'insufficient'; distance_a: number | null; distance_b: number | null; effective_speech_ms: number | null; reason?: string }> }
  | { version: string; totalCount: number; items: Array<{ itemRef: string; groupKey: string; startAtMillis: number; endAtMillis: number; text: string; deviation: number | null }>; nextCursor: string; hasMore: boolean }
  | { state: 'ready' | 'building' | 'insufficient' | 'failed'; queuedCount: number; missingMaterialChildren: number }

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const finite = (value: unknown, max = Infinity): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value)
const nullable = (value: unknown, max = Infinity): value is number | null => value === null || finite(value, max)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
function invalid(): never { throw new TypeError('说话人证据响应不符合协议') }
/** Reconstruct allowed fields; even an upstream bug cannot pass vectors through. */
export function parseRecordingEvidence(raw: unknown, query: RecordingEvidenceQuery): RecordingEvidenceResult {
  const value = object(raw)
  if (value.supported === false) return { supported: false }
  if (query.action === 'build') {
    if (!['ready', 'building', 'insufficient', 'failed'].includes(String(value.state)) || !Array.isArray(value.job_ids) || !count(value.missing_material_children) || !count(value.active_jobs) || !count(value.failed_jobs) || value.active_jobs + value.failed_jobs > value.job_ids.length) invalid()
    return { state: value.state as 'ready' | 'building' | 'insufficient' | 'failed', queuedCount: value.active_jobs, missingMaterialChildren: value.missing_material_children }
  }
  if (value.supported !== true || value.schema_version !== 1) invalid()
  if (query.action === 'capabilities') {
    if (!Array.isArray(value.actions) || !value.actions.every(text)) invalid()
    return { supported: true, schema_version: 1, actions: value.actions as string[] }
  }
  if (value.metric !== 'cosine_distance') invalid()
  const indices = (rows: unknown, expected: number): Record<string, unknown>[] => {
    if (!Array.isArray(rows) || rows.length !== expected) invalid()
    const list = rows.map(object), seen = new Set<number>()
    for (const row of list) { if (!count(row.client_index) || row.client_index >= expected || seen.has(row.client_index)) invalid(); seen.add(row.client_index) }
    return list
  }
  if (query.action === 'consistency') {
    const groups = indices(value.groups, query.groupRefs?.length ?? 0).map(group => {
      if (![group.version, group.model_version, group.score_definition, group.reference_method].every(text)
        || !count(group.total_count) || !count(group.analyzed_count) || group.analyzed_count > group.total_count
        || !nullable(group.score, 100) || !(group.review_count === null || (count(group.review_count) && group.review_count <= group.analyzed_count))
        || !['ready', 'partial', 'building', 'insufficient'].includes(String(group.state))
        || (group.state === 'ready' && (group.analyzed_count < 2 || group.analyzed_count !== group.total_count || group.score === null))
        || (group.state === 'partial' && (group.analyzed_count < 2 || group.analyzed_count >= group.total_count || group.score === null))
        || (['building', 'insufficient'].includes(String(group.state)) && group.score !== null)
        || !count(group.analyzed_speech_ms) || !nullable(group.total_speech_ms)) invalid()
      const items = indices(group.items, query.itemRefs?.length ?? 0).map(row => {
        if (!['ready', 'insufficient'].includes(String(row.status)) || !nullable(row.deviation, 2) || (row.status === 'ready') !== (row.deviation !== null)) invalid()
        return { client_index: row.client_index as number, status: row.status as 'ready' | 'insufficient', deviation: row.deviation as number | null, ...(text(row.reason) ? { reason: row.reason } : {}) }
      })
      if (group.suspected_voices !== undefined && (!count(group.suspected_voices) || group.suspected_voices < 1 || group.suspected_voices > group.analyzed_count)) invalid()
      return { client_index: group.client_index, version: group.version, model_version: group.model_version, score_definition: group.score_definition, reference_method: group.reference_method, state: group.state, score: group.score, analyzed_count: group.analyzed_count, total_count: group.total_count, review_count: group.review_count, ...(group.suspected_voices === undefined ? {} : { suspected_voices: group.suspected_voices }), analyzed_speech_ms: group.analyzed_speech_ms, total_speech_ms: group.total_speech_ms, items } as RecordingEvidenceGroup
    })
    return { supported: true, schema_version: 1, metric: 'cosine_distance', groups }
  }
  if (query.action !== 'compare' || !text(value.version) || !text(value.model_version) || value.aggregation !== 'mean_reference' || !['ready', 'building'].includes(String(value.state))) invalid()
  const items = indices(value.items, query.itemRefs?.length ?? 0).map(row => {
    const hasB = (query.referenceB?.length ?? 0) > 0
    if (!['ready', 'insufficient'].includes(String(row.status)) || !nullable(row.distance_a, 2) || !nullable(row.distance_b, 2) || !nullable(row.effective_speech_ms)
      || (row.status === 'ready' && (row.distance_a === null || (hasB && row.distance_b === null)))
      || (row.status === 'insufficient' && (row.distance_a !== null || row.distance_b !== null)) || (!hasB && row.distance_b !== null)) invalid()
    return { client_index: row.client_index as number, status: row.status as 'ready' | 'insufficient', distance_a: row.distance_a as number | null, distance_b: row.distance_b as number | null, effective_speech_ms: row.effective_speech_ms as number | null, ...(text(row.reason) ? { reason: row.reason } : {}) }
  })
  return { supported: true, schema_version: 1, metric: 'cosine_distance', version: value.version, model_version: value.model_version, aggregation: 'mean_reference', state: value.state as 'ready' | 'building', items }
}
