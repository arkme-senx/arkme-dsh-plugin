import { describe, expect, it, vi } from 'vitest'
import { parseSpeechState, parseSpeechOccurrences, speechEnvelope, speechRate, type SpeechQuery } from '../src/recording-speech-statistics.js'
import { RecordingSpeechStatisticsService } from '../src/services/recording-speech-statistics-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'

const q: SpeechQuery = { accountScope: 'prod:7', date: '2026-10-16', timezone: 'Asia/Shanghai' }
const env = speechEnvelope(q)
const capability = { schema_version: 1, scope: 'self_speech_day', supported: true, audio_verbatim: true, self_only: true, source_navigation: true, idempotent_create: true }
const term = { key: 'k1', text: '那个', verifiedCount: 6, habitCount: 2, pendingCount: 3 }
const result = { id: 'r1', evidence_basis: 'audio_verbatim', speaker_scope: 'self', generatedAtMillis: 100, identityVersion: 'i1', audioVersion: 'a1',
  coverage: { analyzedMillis: 600000, eligibleMillis: 1200000, pendingSegments: 3, missingAudioSegments: 2, uncertainSpeakerSegments: 4 }, terms: [term] }
const state = { ...env, stale: false, job: null, result }
function fixture() {
  let userId = 7, epoch = () => {}
  const post = vi.fn(async (path: string, _body: unknown, _session: unknown, _signal: unknown, _options: unknown): Promise<unknown> => path.endsWith('/capabilities') ? capability : state)
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedAudioPost: post,
    subscribeAccountScope: (fn: () => void) => { epoch = fn; return () => {} } } as unknown as ServiceRuntime
  const recording = { exploreRecordingEvidence: vi.fn(async () => ({ kind: 'recording' as const, dateStamp: 1, focusItemId: 'item', items: [{ itemId: 'item', isSelf: true, startAtMillis: Date.parse('2026-10-16T12:00:00+08:00') }] })) }
  const service = new RecordingSpeechStatisticsService(runtime, recording as never)
  return { service, post, recording, change: () => { userId = 8; epoch() } }
}
describe('audio grounded speech statistics contract', () => {
  it('keeps verified, contextual filler, and pending counts distinct; normalizes to analyzed speech', () => {
    const parsed = parseSpeechState(state, q)
    expect(parsed.result?.terms[0]).toEqual(term)
    expect(speechRate(term, 'habit', 600000)).toBe('2.0')
    expect(speechRate(term, 'all', 600000)).toBe('6.0')
    expect(speechRate(term, 'all', 0)).toBeNull()
  })
  it.each([
    { ...result, evidence_basis: 'asr_text' },
    { ...result, speaker_scope: 'uploader' },
    { ...result, terms: [{ ...term, habitCount: 7 }] },
    { ...result, terms: [{ ...term, verifiedCount: null }] },
    { ...result, terms: [term, term] },
    { ...result, coverage: { ...result.coverage, analyzedMillis: 0 } },
  ])('rejects ungrounded or contradictory results', result => {
    expect(() => parseSpeechState({ ...state, result }, q)).toThrow()
  })
  it('binds result and occurrence pages to exact day, version, term and classification', () => {
    expect(() => parseSpeechState({ ...state, date: '2026-10-15' }, q)).toThrow()
    const page = { ...env, result_id: 'r1', term_key: 'k1', mode: 'habit', items: [], total: 0, next_cursor: null }
    expect(parseSpeechOccurrences(page, q, 'r1', 'k1', 'habit').items).toEqual([])
    expect(() => parseSpeechOccurrences(page, q, 'r2', 'k1', 'habit')).toThrow()
    expect(() => parseSpeechOccurrences(page, q, 'r1', 'k2', 'habit')).toThrow()
  })
})
describe('plugin speech owner adapter', () => {
  it.each([404, 501])('treats only explicit %s capability absence as unsupported', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'missing', false, status))
    expect(await f.service.state(q)).toMatchObject({ supported: false, result: null })
    await expect(f.service.create({ ...q, requestId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow('尚未接通')
    expect(f.post.mock.calls.every(x => x[0].endsWith('/capabilities'))).toBe(true)
  })
  it.each([401, 503])('preserves %s failures', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'network/auth failure', false, status))
    await expect(f.service.state(q)).rejects.toThrow('network/auth failure')
  })
  it('requires raw audio support and never sends visible transcript fragments for generation', async () => {
    const f = fixture(); f.post.mockResolvedValueOnce({ ...capability, audio_verbatim: false })
    await expect(f.service.state(q)).rejects.toThrow('不兼容')
    const requestId = '00000000-0000-4000-8000-000000000000'
    f.post.mockResolvedValueOnce(capability).mockResolvedValueOnce({ ...state, request_id: requestId })
    await f.service.create({ ...q, requestId, text: 'do not submit this' })
    expect(f.post).toHaveBeenLastCalledWith('/api/v1/speech-statistics/create', { ...env, request_id: requestId }, expect.any(Object), undefined, expect.objectContaining({ lane: 'write' }))
    f.post.mockResolvedValueOnce(capability).mockResolvedValueOnce({ ...state, request_id: 'different' })
    await expect(f.service.create({ ...q, requestId })).rejects.toThrow('尚未确认')
  })
  it('rejects wrong or switched accounts including late responses', async () => {
    const f = fixture()
    await expect(f.service.state({ ...q, accountScope: 'prod:8' })).rejects.toThrow('账号已变化')
    expect(f.post).not.toHaveBeenCalled()
    f.post.mockImplementationOnce(async () => { f.change(); return capability })
    await expect(f.service.state(q)).rejects.toThrow('账号已变化')
  })
  it('uses original ASR evidence for navigation and refuses a no-longer-self source', async () => {
    const f = fixture(), owner = { container_id: 's', child_id: 'c', item_ordinal: 0, start_at: 1, transcript_source: 'system' }
    f.post.mockResolvedValue({ ...env, available: true, result_id: 'r1', source_ref: 'ref', original_quote: '同生', owner_ref: owner })
    await f.service.source({ ...q, resultId: 'r1', sourceRef: 'ref' })
    expect(f.recording.exploreRecordingEvidence).toHaveBeenCalledWith(owner, '同生', undefined)
    f.recording.exploreRecordingEvidence.mockResolvedValueOnce({ kind: 'recording', dateStamp: 1, focusItemId: 'item', items: [{ itemId: 'item', isSelf: false, startAtMillis: 1 }] })
    await expect(f.service.source({ ...q, resultId: 'r1', sourceRef: 'ref' })).rejects.toThrow('不再标记为本人')
    f.post.mockResolvedValue({ ...env, available: true, result_id: 'r2', source_ref: 'ref' })
    await expect(f.service.source({ ...q, resultId: 'r1', sourceRef: 'ref' })).rejects.toThrow('已变化')
  })
})
