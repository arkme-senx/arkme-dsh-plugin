/** Proposed audio-owner v1 contract. Counts must come from audio evidence, never client ASR text. */
export interface SpeechQuery { accountScope: string; date: string; timezone: string }
export type SpeechMode = 'habit' | 'all'
export interface SpeechTerm { key: string; text: string; verifiedCount: number; habitCount: number; pendingCount: number }
export interface SpeechResult {
  id: string; generatedAtMillis: number; identityVersion: string; audioVersion: string
  coverage: { analyzedMillis: number; eligibleMillis: number; pendingSegments: number; missingAudioSegments: number; uncertainSpeakerSegments: number }
  terms: SpeechTerm[]
}
export interface SpeechState {
  supported: boolean; stale: boolean; result: SpeechResult | null
  job: { id: string; stage: 'queued' | 'recognizing' | 'verifying' | 'counting' | 'failed'; completed: number; total: number } | null
}
export interface SpeechOccurrence {
  key: string; startAtMillis: number; endAtMillis: number; text: string; originalText: string
  verification: 'verified' | 'pending'; use: 'habit' | 'lexical' | 'uncertain'; sourceRef: string | null
}
export interface SpeechOccurrences { items: SpeechOccurrence[]; total: number; nextCursor: string | null }
const invalid = (): never => { throw new Error('说话统计数据不完整或版本不匹配，请刷新后重试') }
export const speechObject = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid()
export const speechText = (v: unknown, max = 512): string => typeof v === 'string' && v.trim() && v.length <= max ? v : invalid()
const count = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid()
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid()
const list = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid()
export function parseSpeechQuery(input: unknown): SpeechQuery {
  const v = speechObject(input), date = speechText(v.date, 10), timezone = speechText(v.timezone, 100)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) invalid()
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
  return { accountScope: speechText(v.accountScope, 100), date, timezone }
}
export function speechEnvelope(q: SpeechQuery) { return { schema_version: 1, scope: 'self_speech_day', date: q.date, time_zone: q.timezone } }
export function assertSpeechEnvelope(v: Record<string, unknown>, q: SpeechQuery) {
  if (v.schema_version !== 1 || v.scope !== 'self_speech_day' || v.date !== q.date || v.time_zone !== q.timezone) invalid()
}
export const unavailableSpeechState = (): SpeechState => ({ supported: false, stale: false, result: null, job: null })
export function parseSpeechState(value: unknown, q: SpeechQuery): SpeechState {
  const v = speechObject(value); assertSpeechEnvelope(v, q)
  let result: SpeechResult | null = null, job: SpeechState['job'] = null
  if (v.result !== null) {
    const r = speechObject(v.result), c = speechObject(r.coverage)
    if (r.evidence_basis !== 'audio_verbatim' || r.speaker_scope !== 'self') invalid()
    const coverage = { analyzedMillis: count(c.analyzedMillis), eligibleMillis: count(c.eligibleMillis), pendingSegments: count(c.pendingSegments), missingAudioSegments: count(c.missingAudioSegments), uncertainSpeakerSegments: count(c.uncertainSpeakerSegments) }
    if (coverage.analyzedMillis > coverage.eligibleMillis) invalid()
    const terms = list(r.terms, 5000).map(value => {
      const t = speechObject(value)
      const term = { key: speechText(t.key), text: speechText(t.text, 100), verifiedCount: count(t.verifiedCount), habitCount: count(t.habitCount), pendingCount: count(t.pendingCount) }
      if (term.habitCount > term.verifiedCount) invalid()
      return term
    })
    if (new Set(terms.map(t => t.key)).size !== terms.length || (!coverage.analyzedMillis && terms.some(t => t.verifiedCount))) invalid()
    result = { id: speechText(r.id), generatedAtMillis: count(r.generatedAtMillis), identityVersion: speechText(r.identityVersion), audioVersion: speechText(r.audioVersion), coverage, terms }
  }
  if (v.job !== null) {
    const j = speechObject(v.job), stage = speechText(j.stage) as NonNullable<SpeechState['job']>['stage']
    if (!['queued', 'recognizing', 'verifying', 'counting', 'failed'].includes(stage)) invalid()
    job = { id: speechText(j.id), stage, completed: count(j.completed), total: count(j.total) }
    if (job.completed > job.total) invalid()
  }
  return { supported: true, stale: bool(v.stale), result, job }
}
export function parseSpeechOccurrences(value: unknown, q: SpeechQuery, resultId: string, termKey: string, mode: SpeechMode): SpeechOccurrences {
  const v = speechObject(value); assertSpeechEnvelope(v, q)
  if (v.result_id !== resultId || v.term_key !== termKey || v.mode !== mode) invalid()
  const items = list(v.items, 50).map(value => {
    const x = speechObject(value), verification = x.verification as SpeechOccurrence['verification'], use = x.use as SpeechOccurrence['use']
    const start = count(x.startAtMillis), end = count(x.endAtMillis)
    if (end <= start || !['verified', 'pending'].includes(verification) || !['habit', 'lexical', 'uncertain'].includes(use)
      || (mode === 'habit' && use === 'lexical')) invalid()
    return { key: speechText(x.key), startAtMillis: start, endAtMillis: end, text: speechText(x.text, 10000), originalText: typeof x.originalText === 'string' && x.originalText.length <= 10000 ? x.originalText : invalid(), verification, use, sourceRef: x.sourceRef === null ? null : speechText(x.sourceRef, 4096) }
  })
  const total = count(v.total)
  if (items.length > total || new Set(items.map(x => x.key)).size !== items.length) invalid()
  return { items, total, nextCursor: v.next_cursor === null ? null : speechText(v.next_cursor, 4096) }
}
export const speechFrequency = (term: SpeechTerm, mode: SpeechMode) => mode === 'habit' ? term.habitCount : term.verifiedCount
export function speechRate(term: SpeechTerm, mode: SpeechMode, analyzedMillis: number): string | null {
  return analyzedMillis > 0 ? (speechFrequency(term, mode) * 600_000 / analyzedMillis).toFixed(1) : null
}
