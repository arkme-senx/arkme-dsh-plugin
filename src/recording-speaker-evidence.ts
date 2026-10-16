import type { ArkmeRecordingSpeakerEvidence, ArkmeRecordingSpeakerEvidenceInput, ArkmeRecordingSpeakerConsistency, ArkmeRecordingSpeakerConsistencyInput } from './types.js'

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const distance = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2

export function parseRecordingSpeakerConsistency(value: unknown, input: ArkmeRecordingSpeakerConsistencyInput): ArkmeRecordingSpeakerConsistency {
  const raw = record(value)
  if (raw.supported === false) return { supported: false }
  const invalid = (): never => { throw new Error('一致性证据格式不完整') }
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (raw.supported !== true || raw.schema_version !== 1 || raw.metric !== 'cosine_distance' || !Array.isArray(raw.groups)
    || raw.groups.length !== input.anchorRefs.length) return invalid()
  const seen = new Set<number>()
  const groups = raw.groups.map(value => {
    const group = record(value), index = group.client_index
    if (!count(index) || index >= input.anchorRefs.length || seen.has(index)
      || !['version', 'model_version', 'score_definition', 'reference_method'].every(key => typeof group[key] === 'string' && String(group[key]).trim())
      || !['ready', 'partial', 'building', 'insufficient'].includes(String(group.state))
      || !count(group.analyzed_count) || !count(group.total_count) || group.analyzed_count > group.total_count
      || (group.review_count !== null && (!count(group.review_count) || group.review_count > group.analyzed_count))
      || (group.suspected_voices !== undefined && (!count(group.suspected_voices) || group.suspected_voices < 1 || group.suspected_voices > group.analyzed_count))
      || !Array.isArray(group.items) || group.items.length !== input.itemRefs.length) return invalid()
    const scored = group.state === 'ready' || group.state === 'partial'
    if (scored ? (typeof group.score !== 'number' || !Number.isFinite(group.score) || group.score < 0 || group.score > 100 || group.analyzed_count < 2)
      : group.score !== null) return invalid()
    if (group.state === 'ready' && group.analyzed_count !== group.total_count) return invalid()
    if (group.state === 'partial' && group.analyzed_count >= group.total_count) return invalid()
    seen.add(index)
    const itemSeen = new Set<number>()
    const items = group.items.map(value => {
      const row = record(value), i = row.client_index
      if (!count(i) || i >= input.itemRefs.length || itemSeen.has(i) || !['ready', 'insufficient'].includes(String(row.status))
        || (row.status === 'ready' ? !distance(row.deviation) : row.deviation !== null)) return invalid()
      itemSeen.add(i)
      return { itemRef: input.itemRefs[i]!, deviation: row.deviation as number | null, status: row.status as 'ready' | 'insufficient',
        ...(typeof row.reason === 'string' && row.reason.trim() ? { reason: row.reason.slice(0, 200) } : {}) }
    })
    return { anchorRef: input.anchorRefs[index]!, version: String(group.version), modelVersion: String(group.model_version),
      scoreDefinition: String(group.score_definition), referenceMethod: String(group.reference_method),
      state: group.state as 'ready' | 'partial' | 'building' | 'insufficient', score: group.score as number | null,
      analyzedCount: group.analyzed_count, totalCount: group.total_count, reviewCount: group.review_count as number | null,
      ...(group.suspected_voices === undefined ? {} : { suspectedVoices: group.suspected_voices as number }), items }
  })
  return { supported: true, groups }
}

/** Strict proposed v1 contract: omissions, duplicate rows and unknown metrics cannot become reassuring scores. */
export function parseRecordingSpeakerEvidence(value: unknown, input: ArkmeRecordingSpeakerEvidenceInput): ArkmeRecordingSpeakerEvidence {
  const raw = record(value)
  if (raw.supported === false) return { supported: false }
  const invalid = () => { throw new Error('声纹证据格式不完整，暂不能用于判断') }
  if (raw.supported !== true || raw.schema_version !== 1 || typeof raw.version !== 'string' || !raw.version.trim()
    || typeof raw.model_version !== 'string' || !raw.model_version.trim() || raw.metric !== 'cosine_distance'
    || !['nearest_reference', 'mean_reference', 'centroid'].includes(String(raw.aggregation))
    || !['ready', 'building'].includes(String(raw.state)) || !Array.isArray(raw.items)
    || (raw.review_threshold !== undefined && !distance(raw.review_threshold))
    || (raw.ambiguity_margin !== undefined && !distance(raw.ambiguity_margin))) return invalid()
  const seen = new Set<number>()
  const items = raw.items.map(value => {
    const row = record(value), index = row.client_index
    if (!Number.isInteger(index) || typeof index !== 'number' || index < 0 || index >= input.itemRefs.length || seen.has(index)
      || !['ready', 'insufficient'].includes(String(row.status))
      || typeof row.effective_speech_ms !== 'number' || !Number.isFinite(row.effective_speech_ms) || row.effective_speech_ms < 0
      || (row.distance_a !== null && !distance(row.distance_a)) || (row.distance_b !== null && !distance(row.distance_b))
      || (input.referenceA.length === 0 && row.distance_a !== null) || (input.referenceB.length === 0 && row.distance_b !== null)
      || (row.status === 'insufficient' && (row.distance_a !== null || row.distance_b !== null))
      || (row.status === 'ready' && (row.distance_a === null || (input.referenceB.length > 0 && row.distance_b === null)))) return invalid()
    seen.add(index)
    return { itemRef: input.itemRefs[index]!, status: row.status as 'ready' | 'insufficient', distanceA: row.distance_a as number | null,
      distanceB: row.distance_b as number | null, effectiveSpeechMillis: row.effective_speech_ms,
      ...(typeof row.reason === 'string' && row.reason.trim() ? { reason: row.reason.slice(0, 200) } : {}) }
  })
  if (items.length !== input.itemRefs.length) return invalid()
  return { supported: true, version: raw.version, modelVersion: raw.model_version, metric: 'cosine_distance',
    aggregation: raw.aggregation as 'nearest_reference' | 'mean_reference' | 'centroid', state: raw.state as 'ready' | 'building', items,
    ...(raw.review_threshold === undefined ? {} : { reviewThreshold: raw.review_threshold as number }),
    ...(raw.ambiguity_margin === undefined ? {} : { ambiguityMargin: raw.ambiguity_margin as number }) }
}
