import type { SpeakerDirectoryPerson } from './speaker-directory-contract.js'

export interface SpeakerGroupConsistency {
  state: 'ready' | 'partial' | 'building' | 'insufficient'
  score: number | null
  analyzedCount: number
  totalCount: number
  reviewCount: number | null
}
export interface SimilarSpeaker {
  person: SpeakerDirectoryPerson
  distance: number | null
  consistency: SpeakerGroupConsistency
  reason: string
}
export type SpeakerSimilarityResult = { supported: false } | {
  supported: true
  state: 'ready' | 'building' | 'insufficient'
  version: string
  modelVersion: string
  scoreDefinition: string
  aggregation: string
  anchor: SpeakerDirectoryPerson
  anchorConsistency: SpeakerGroupConsistency
  searchedCount: number
  totalCount: number
  items: SimilarSpeaker[]
  hasMore: boolean
  nextCursor: string
}
export interface SpeakerVoiceSample {
  sampleKey: string
  timeLabel: string
  durationMillis: number
  transcript: string
  mediaRef?: string
}
export type SpeakerVoiceSamples = { supported: false } | { supported: true; items: SpeakerVoiceSample[] }

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const invalid = (): never => { throw new Error('相似声音证据不完整，请重新读取') }
function count(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid(); return value }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 512) return invalid(); return value }
export function parseGroupConsistency(value: unknown): SpeakerGroupConsistency {
  const raw = object(value), analyzedCount = count(raw.analyzed_count), totalCount = count(raw.total_count)
  if (!['ready', 'partial', 'building', 'insufficient'].includes(String(raw.state)) || analyzedCount > totalCount) return invalid()
  const scored = raw.state === 'ready' || raw.state === 'partial'
  if (scored ? typeof raw.score !== 'number' || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > 100 || analyzedCount < 2 : raw.score !== null) return invalid()
  if (raw.state === 'ready' && analyzedCount !== totalCount || raw.state === 'partial' && analyzedCount >= totalCount) return invalid()
  const reviewCount = raw.review_count === null ? null : count(raw.review_count)
  if (reviewCount !== null && reviewCount > analyzedCount) return invalid()
  return { state: raw.state as SpeakerGroupConsistency['state'], score: raw.score as number | null, analyzedCount, totalCount, reviewCount }
}
export function speakerGroupConsistencyLabel(group?: SpeakerGroupConsistency): string {
  if (!group) return '待计算'
  if (group.state === 'building') return '计算中'
  if (group.state === 'insufficient') return '证据不足'
  return `${group.score!.toFixed(0)}${group.state === 'partial' ? '（局部）' : ''}`
}
/** Parse before presenting. Raw vectors, URLs and unbounded server metadata never reach the UI. */
export function parseSpeakerSimilarity(value: unknown, person: (raw: unknown) => SpeakerDirectoryPerson): SpeakerSimilarityResult {
  const raw = object(value)
  if (raw.supported === false) return { supported: false }
  if (raw.supported !== true || raw.schema_version !== 1 || raw.metric !== 'cosine_distance'
    || !['ready', 'building', 'insufficient'].includes(String(raw.state)) || !Array.isArray(raw.items) || raw.items.length > 20
    || typeof raw.has_more !== 'boolean' || typeof raw.next_cursor !== 'string' || raw.next_cursor.length > 4096 || raw.has_more && !raw.next_cursor) return invalid()
  const anchor = person(raw.anchor), searchedCount = count(raw.searched_count), totalCount = count(raw.total_count)
  if (searchedCount > totalCount || raw.state !== 'ready' && (raw.items.length || raw.has_more)) return invalid()
  const seen = new Set([anchor.personKey])
  const items = raw.items.map(value => {
    const item = object(value), candidate = person(item.person)
    if (seen.has(candidate.personKey) || candidate.type !== 'unmarked'
      || item.distance !== null && (typeof item.distance !== 'number' || !Number.isFinite(item.distance) || item.distance < 0 || item.distance > 2)) return invalid()
    seen.add(candidate.personKey)
    return { person: candidate, distance: item.distance as number | null, consistency: parseGroupConsistency(item.consistency), reason: typeof item.reason === 'string' ? item.reason.slice(0, 300) : '' }
  })
  return { supported: true, state: raw.state as 'ready' | 'building' | 'insufficient', version: text(raw.version), modelVersion: text(raw.model_version),
    scoreDefinition: text(raw.score_definition), aggregation: text(raw.aggregation), anchor, anchorConsistency: parseGroupConsistency(raw.anchor_consistency), searchedCount, totalCount, items, hasMore: raw.has_more, nextCursor: raw.next_cursor }
}
