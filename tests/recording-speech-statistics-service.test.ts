import { describe, expect, it, vi } from 'vitest'
import { parseSpeechState, parseSpeechOccurrences, speechEnvelope, speechRate, type SpeechQuery } from '../src/recording-speech-statistics.js'
import { RecordingSpeechStatisticsService } from '../src/services/recording-speech-statistics-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'

const q: SpeechQuery = { accountScope: 'prod:7', date: '2026-10-16', timezone: 'Asia/Shanghai' }
const env = speechEnvelope(q)
const capability = { schema_version: 2, scope: 'self_speech_day', supported: true, audio_verbatim: true, self_only: true, source_navigation: true, idempotent_create: true }
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
  const media = { issueSpeechPlaybackMediaRef: vi.fn(async () => 'opaque-media') }
  const service = new RecordingSpeechStatisticsService(runtime, recording as never, media)
  return { service, post, recording, media, change: () => { userId = 8; epoch() } }
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
  it('uses exact original evidence for optional navigation and requires current range authority', async () => {
    const f = fixture(), owner = { container_id: 's', child_id: 'c', item_ordinal: 0, start_at: Date.parse('2026-10-16T12:00:00+08:00'), transcript_source: 'system' }
    const start = Date.parse('2026-10-16T12:00:00+08:00')
    const response = { ...env, available: true, self_range: true, result_id: 'r1', source_ref: 'ref',
      playback: { start_at_millis: start, end_at_millis: start + 5000, focus_at_millis: start + 1000, content_type: 'audio/flac', content_path: '/api/v1/speech-statistics/audio/ref' },
      target: { original_quote: '同生', owner_ref: owner, window: {dateStamp:Date.parse('2026-10-16T00:00:00+08:00'),endStamp:Date.parse('2026-10-17T00:00:00+08:00'),timeZone:q.timezone,date:q.date} } }
    f.post.mockResolvedValue(response)
    await f.service.source({ ...q, resultId: 'r1', sourceRef: 'ref', action: 'locate' })
    expect(f.recording.exploreRecordingEvidence).toHaveBeenCalledWith(owner, '同生', undefined, expect.objectContaining({date:q.date,timeZone:q.timezone}))
    f.post.mockResolvedValue({ ...response, self_range: false })
    await expect(f.service.source({ ...q, resultId: 'r1', sourceRef: 'ref', action: 'play' })).rejects.toThrow('已变化')
    f.post.mockResolvedValue({ ...env, available: true, result_id: 'r2', source_ref: 'ref' })
    await expect(f.service.source({ ...q, resultId: 'r1', sourceRef: 'ref', action: 'play' })).rejects.toThrow('已变化')
  })
  it('plays a verified source range even when original ASR omitted the expression', async () => {
    const f = fixture(), start = Date.parse('2026-10-16T00:00:00+08:00')
    f.post.mockResolvedValue({ ...env, available: true, self_range: true, result_id: 'r1', source_ref: 'ref',
      playback: { start_at_millis: start - 1000, end_at_millis: start + 3000, focus_at_millis: start + 500, content_type: 'audio/flac', content_path: '/api/v1/speech-statistics/audio/ref' }, target: null })
    const source = await f.service.source({ ...q, resultId: 'r1', sourceRef: 'ref', action: 'play' })
    expect(source).toMatchObject({ focusAtMillis: start + 500, mediaStartAtMillis: start - 1000, target: null, playback: { playbackRef: 'opaque-media' } })
    expect(f.recording.exploreRecordingEvidence).not.toHaveBeenCalled()
  })
  it.each([['Asia/Shanghai', '+08:00'], ['Pacific/Kiritimati', '+14:00'], ['America/New_York', '-04:00']])('keeps occurrence time separate from the original transcript window in %s', async (timezone, offset) => {
    const f = fixture(), query = { ...q, timezone }, focus = Date.parse(`2026-10-16T00:00:00.500${offset}`)
    const window = { dateStamp: Date.parse(`2026-10-15T00:00:00${offset}`), endStamp: Date.parse(`2026-10-16T00:00:00${offset}`), timeZone: timezone, date: '2026-10-15' }
    const owner = { container_id: 's', child_id: 'c', item_ordinal: 0, start_at: focus - 2000, transcript_source: 'system' }
    f.post.mockResolvedValue({ ...speechEnvelope(query), available: true, self_range: true, result_id: 'r1', source_ref: 'ref',
      playback: { start_at_millis: focus - 2000, end_at_millis: focus + 3000, focus_at_millis: focus, content_type: 'audio/flac', content_path: '/api/v1/speech-statistics/audio/ref' },
      target: { window, original_quote: '原句', owner_ref: owner } })
    f.recording.exploreRecordingEvidence.mockResolvedValueOnce({ kind: 'recording', dateStamp: window.dateStamp, focusItemId: 'item', items: [{ itemId: 'item', isSelf: true, startAtMillis: focus - 2000 }] })
    await expect(f.service.source({ ...query, resultId: 'r1', sourceRef: 'ref', action: 'locate' })).resolves.toMatchObject({ focusAtMillis: focus, target: { window } })
    expect(f.recording.exploreRecordingEvidence).toHaveBeenCalledWith(owner, '原句', undefined, window)
  })
})

it('keeps an old stale result separate from a current non-stale job', () => {
  const parsed = parseSpeechState({ ...state, stale: true, job: { id: 'new', stage: 'recognizing', completed: 1, total: 2, stale: false } }, q)
  expect(parsed.stale).toBe(true)
  expect(parsed.job?.stale).toBe(false)
})
it('exposes a closed quota failure only on a failed job', () => {
  const job = { id: 'partial', stage: 'failed', completed: 50, total: 100, stale: false, failureCode: 'insufficient_balance' }
  expect(parseSpeechState({ ...state, job }, q).job?.failureCode).toBe('insufficient_balance')
  expect(() => parseSpeechState({ ...state, job: { ...job, stage: 'counting' } }, q)).toThrow()
  expect(() => parseSpeechState({ ...state, job: { ...job, failureCode: 'provider-internal-detail' } }, q)).toThrow()
})
it('rejects v1 source negotiation without accepting an invented v2 payload', async () => {
  const f = fixture(); f.post.mockResolvedValueOnce({ ...capability, schema_version: 1 })
  await expect(f.service.capabilities()).rejects.toThrow('不兼容')
})

it('acknowledges the same completed receipt while withdrawn source content stays hidden', async () => {
  const f=fixture(), requestId='revoked-111111111111'
  f.post.mockResolvedValueOnce(capability).mockResolvedValueOnce({...env,request_id:requestId,result:null,job:null,stale:true})
  await expect(f.service.create({...q,requestId})).resolves.toMatchObject({stale:true,result:null,job:null})
  expect(f.post).toHaveBeenLastCalledWith('/api/v1/speech-statistics/create', {...env,request_id:requestId},expect.any(Object),undefined,expect.any(Object))
})
