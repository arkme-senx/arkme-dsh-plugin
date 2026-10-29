import { recordingOwnerResponse, recordingId, childId, recordingRevision } from '../fixtures/recording-owner.js'
import { describe, expect, it, vi } from 'vitest'
import { SpeakerDirectoryService } from '../../src/services/speaker-directory-service.js'
import { UnmarkedSpeakerService } from '../../src/services/unmarked-speaker-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import { ArkmePluginError } from '../../src/services/service.js'
import type { RecordingService } from '../../src/services/recording-service.js'
const base = { state: 'fresh', coverage: 'complete', retry_after_ms: 0 }
const summary = { ...base, total_count: 43, marked_count: 10, unmarked_count: 33, unseen_count: 3, snapshot_version: 'version', seen_version: 2, updated_at: 1, not_modified: false }
const candidate = { person_key: 'person', type: 'unmarked', display_name: '说话人 12', display_number: 12, avatar_ref: '', is_self: false, day_count: 5, last_seen_at: 1790640000000, detail_ref: { type: 'candidate', id: 'opaque-含历史Binary-ID' } }
const page = { ...base, items: [candidate], snapshot_version: 'version', through_cursor: 'seen-opaque', has_more: false, next_cursor: '' }
function fixture() {
  let userId = 7
  const post = vi.fn(async (path: string) => path.endsWith('/summary') ? summary : path.endsWith('/seen') ? { success: true, seen_version: 3 } : page)
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId, accessToken: 'test-token', refreshToken: 'test-refresh' }), authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'synthetic-secret' } } as unknown as ServiceRuntime
  const recording = { directorySpeakerRef: vi.fn(async () => 'speaker-reference'), directorySpeakerAvatars: vi.fn(async () => new Map([['speaker-id', 'avatar-sealed']])) } as unknown as Pick<RecordingService, 'directorySpeakerRef' | 'directorySpeakerAvatars'>
  const unmarked = { directoryCandidateRef: vi.fn(async () => 'candidate-reference') } as unknown as Pick<UnmarkedSpeakerService, 'directoryCandidateRef'>
  return { service: new SpeakerDirectoryService(runtime, recording, unmarked), post, runtime, recording, unmarked, switchUser: () => { userId = 9 } }
}
const consistency = { state: 'ready', score: 93, analyzed_count: 8, total_count: 8, review_count: 0 }
const similarResponse = () => ({ supported: true, schema_version: 1, metric: 'cosine_distance', state: 'ready', version: 'e1', model_version: 'model1', aggregation: 'robust', score_definition: 'cohesion-v1',
  anchor: candidate, anchor_consistency: consistency, searched_count: 100, total_count: 1000,
  items: [{ person: { ...candidate, person_key: 'other', detail_ref: { type: 'candidate', id: 'other-id' } }, distance: .12, consistency }], has_more: false, next_cursor: '' })
describe('speaker similarity read adapter', () => {
  it('unseals the anchor, binds the returned identity, and seals candidate details', async () => {
    const f = fixture(), ref = (await f.service.list({})).items[0]!.detailRef
    f.post.mockResolvedValue(similarResponse() as never)
    const result = await f.service.similar({ detailRef: ref })
    expect(f.post).toHaveBeenLastCalledWith('/api/v1/audio/speaker-directory/similar', expect.objectContaining({ detail_ref: { type: 'candidate', id: candidate.detail_ref.id, expected_version: undefined }, limit: 20, cursor: '', version: '' }), expect.any(Object), undefined, expect.any(Object))
    expect(result).toMatchObject({ items: [{ distance: .12, consistency: { score: 93 } }] })
    expect(result.supported && result.items[0]!.person.detailRef).toMatch(/^arkme-speaker-directory-detail-v1\./)
    f.switchUser()
    await expect(f.service.similar({ detailRef: ref })).rejects.toMatchObject({ code: 'speaker-directory-account-mismatch' })
  })
  it.each([404, 501, 503])('classifies HTTP %s without hiding network failures', async status => {
    const f = fixture(), ref = (await f.service.list({})).items[0]!.detailRef
    f.post.mockRejectedValue(new ArkmePluginError('upstream', 'error', true, status))
    if (status === 503) await expect(f.service.similar({ detailRef: ref })).rejects.toThrow()
    else expect(await f.service.similar({ detailRef: ref })).toEqual({ supported: false })
  })
  it('rejects a changed version, wrong anchor and late account response', async () => {
    const f = fixture(), ref = (await f.service.list({})).items[0]!.detailRef
    f.post.mockResolvedValue(similarResponse() as never)
    await expect(f.service.similar({ detailRef: ref, version: 'e0', cursor: 'next' })).rejects.toMatchObject({ code: 'speaker-similarity-stale' })
    f.post.mockResolvedValue({ ...similarResponse(), anchor: { ...candidate, detail_ref: { type: 'candidate', id: 'wrong' } } } as never)
    await expect(f.service.similar({ detailRef: ref })).rejects.toThrow()
    f.post.mockImplementation(async () => { f.switchUser(); return similarResponse() as never })
    await expect(f.service.similar({ detailRef: ref })).rejects.toMatchObject({ code: 'speaker-directory-account-changed' })
  })
  it('uses existing account-bound unmarked clips when representative samples are unavailable', async () => {
    const f = fixture(), ref = (await f.service.list({})).items[0]!.detailRef
    const segments = vi.fn(async () => ({ items: [{ segmentRef: 'segment', date: '2026-10-14', timeRange: '12:00', durationMillis: 4000, transcript: '片段', mediaRef: 'sealed-media' }], total: 1, hasMore: false }))
    const service = new SpeakerDirectoryService(f.runtime, f.recording, { ...f.unmarked, segments })
    f.post.mockRejectedValue(new ArkmePluginError('missing', 'missing', false, 404))
    expect(await service.voiceSamples({ detailRef: ref })).toMatchObject({ supported: true, items: [{ sampleKey: 'segment', mediaRef: 'sealed-media' }] })
    expect(segments).toHaveBeenCalledWith('candidate-reference', { limit: 3 })
  })
  it('issues media through the existing scoped signer and never forwards backend URLs', async () => {
    const f = fixture(), ref = (await f.service.list({})).items[0]!.detailRef
    const media = { issueRecordingPlaybackMediaRef: vi.fn(async () => 'sealed-playback') }
    const service = new SpeakerDirectoryService(f.runtime, f.recording, f.unmarked, media)
    f.post.mockImplementation(async (path, body) => (recordingOwnerResponse(path, body, [{startAt:1000000, items:[{text:'片段', start:1000,end:5000,edit:{s:1000,e:5000,revision:recordingRevision,source_number:7,assignment_number:7}}]}]) ?? { supported: true, schema_version: 1, detail_ref: candidate.detail_ref, items: [{ sample_key: 's1', time_label: '10月14日', transcript: '片段', remote_url: 'https://untrusted.invalid', locator: { session_id: recordingId, child_id: childId, start_at: 1000, end_at: 5000, num: 7 } }] }) as never)
    const result = await service.voiceSamples({ detailRef: ref })
    expect(media.issueRecordingPlaybackMediaRef).toHaveBeenCalledWith({ viewerUserId: 7, locator: {child_id:childId,source:'primary',ordinal:0} }, undefined)
    expect(result).toMatchObject({ items: [{ durationMillis: 4000, mediaRef: 'sealed-playback' }] })
    expect(JSON.stringify(result)).not.toContain('untrusted.invalid')
  })
})
describe('speaker-directory owner contract', () => {
  it('uses existing authenticated audio transport, empty JSON and authoritative counts', async () => {
    const { service, post } = fixture()
    expect(await service.summary({})).toMatchObject({ totalCount: 43, unseenCount: 3, snapshotVersion: 'version' })
    expect(post).toHaveBeenCalledWith('/api/v1/audio/speaker-directory/summary', {}, expect.objectContaining({ userId: 7 }), undefined, expect.any(Object))
  })
  it.each(['building', 'failed', 'disabled', 'snapshot_expired'])('accepts unknown/simplified %s without manufacturing zero', async state => {
    const { service, post } = fixture(); post.mockResolvedValue({ state, coverage: 'unknown', retry_after_ms: 2000 } as never)
    expect(await service.summary({})).toMatchObject({ state, totalCount: null, unseenCount: null })
    expect(await service.list({})).toMatchObject({ state, items: [], throughCursor: '' })
  })
  it('preserves opaque cursors/version, normalizes query and issues details without scanning old lists', async () => {
    const { service, post, unmarked } = fixture()
    const result = await service.list({ filter: 'unmarked', sort: 'recent', query: ' Abc ', cursor: 'opaque-next', snapshotVersion: 'version', limit: 50 })
    expect(post).toHaveBeenCalledWith('/api/v1/audio/speaker-directory/list', { filter: 'unmarked', sort: 'recent', query: 'abc', cursor: 'opaque-next', snapshot_version: 'version', limit: 50 }, expect.any(Object), undefined, expect.any(Object))
    expect(result.items[0]?.detailRef).not.toContain('opaque-含历史Binary-ID')
    expect(unmarked.directoryCandidateRef).not.toHaveBeenCalled()
    expect(await service.open({ detailRef: result.items[0]!.detailRef })).toEqual({ type: 'candidate', candidateRef: 'candidate-reference' })
    expect(unmarked.directoryCandidateRef).toHaveBeenCalledWith('opaque-含历史Binary-ID', undefined)
  })
  it('keeps presence expected_version separate from directory version', async () => {
    const { service, post, recording } = fixture()
    post.mockResolvedValue({ ...page, items: [{ ...candidate, type: 'marked', detail_ref: { type: 'speaker', id: 'speaker-id', expected_version: 'presence-v9' } }] } as never)
    const result = await service.list({})
    expect(await service.open({ detailRef: result.items[0]!.detailRef })).toEqual({ type: 'speaker', speakerRef: 'speaker-reference', expectedVersion: 'presence-v9' })
    expect(recording.directorySpeakerRef).toHaveBeenCalledWith('speaker-id', 7)
  })
  it('resolves avatars using only account-verified marked detail references', async () => {
    const { service, post, recording, switchUser } = fixture()
    post.mockResolvedValue({ ...page, items: [{ ...candidate, type: 'marked', detail_ref: { type: 'speaker', id: 'speaker-id' } }] } as never)
    const detailRef = (await service.list({})).items[0]!.detailRef
    expect(recording.directorySpeakerAvatars).not.toHaveBeenCalled()
    expect(await service.avatars({ detailRefs: [detailRef, detailRef] })).toEqual([{ detailRef, avatarRef: 'avatar-sealed' }])
    expect(recording.directorySpeakerAvatars).toHaveBeenCalledWith(['speaker-id'], 7, undefined)
    await expect(service.avatars({ detailRefs: ['speaker-id'] })).rejects.toMatchObject({ code: 'speaker-directory-detail-invalid' })
    await expect(service.avatars({ detailRefs: Array(51).fill(detailRef) })).rejects.toMatchObject({ code: 'speaker-directory-input-invalid' })
    switchUser()
    await expect(service.avatars({ detailRefs: [detailRef] })).rejects.toMatchObject({ code: 'speaker-directory-account-mismatch' })
    expect(recording.directorySpeakerAvatars).toHaveBeenCalledTimes(1)
  })
  it('never opens a candidate detail for an avatar request', async () => {
    const { service, recording, unmarked } = fixture()
    const detailRef = (await service.list({})).items[0]!.detailRef
    await expect(service.avatars({ detailRefs: [detailRef] })).rejects.toMatchObject({ code: 'speaker-directory-input-invalid' })
    expect(recording.directorySpeakerAvatars).not.toHaveBeenCalled()
    expect(unmarked.directoryCandidateRef).not.toHaveBeenCalled()
  })
  it('rejects cross-account or tampered details before invoking existing detail services', async () => {
    const { service, switchUser, unmarked } = fixture()
    const ref = (await service.list({})).items[0]!.detailRef
    await expect(service.open({ detailRef: ref + '.bad' })).rejects.toMatchObject({ code: 'speaker-directory-detail-invalid' })
    switchUser()
    await expect(service.open({ detailRef: ref })).rejects.toMatchObject({ code: 'speaker-directory-account-mismatch' })
    expect(unmarked.directoryCandidateRef).not.toHaveBeenCalled()
  })
  it.each([{ query: '汉'.repeat(86) }, { limit: 101 }, { filter: 'invalid' }, { sort: 'invalid' }])('rejects invalid input before network work %j', async input => {
    const { service, post } = fixture()
    await expect(service.list(input)).rejects.toMatchObject({ code: 'speaker-directory-input-invalid' }); expect(post).not.toHaveBeenCalled()
  })
  it('forwards only the displayed through_cursor and requires success=true', async () => {
    const { service, post } = fixture()
    expect(await service.seen({ throughCursor: 'seen-v1' })).toEqual({ success: true, seenVersion: 3 })
    expect(post).toHaveBeenCalledWith('/api/v1/audio/speaker-directory/seen', { through_cursor: 'seen-v1' }, expect.any(Object), undefined, expect.objectContaining({ lane: 'write' }))
    post.mockResolvedValue({ state: 'disabled', coverage: 'unknown' } as never)
    expect(await service.seen({ throughCursor: 'seen-v1' })).toMatchObject({ success: false, state: 'disabled' })
  })
  it('hydrates candidate details on selection and handles candidate_not_found', async () => {
    const { runtime, post } = fixture(); const unmarked = new UnmarkedSpeakerService(runtime)
    post.mockResolvedValue({ candidate: { candidate_id: 'opaque', status: 'single_day', speaker_display_number: 12, day_count: 1 }, candidate_version: 'candidate-version', sessions: [], segments: [] } as never)
    expect(await unmarked.directoryCandidateRef('opaque')).toMatch(/^arkme-unmarked-candidate-v1\./)
    expect(post).toHaveBeenCalledWith('/api/v1/audio/unmarked-speakers/detail', { candidate_id: 'opaque' }, expect.any(Object), undefined)
    post.mockResolvedValue({ outcome: 'candidate_not_found' } as never)
    await expect(unmarked.directoryCandidateRef('opaque')).rejects.toMatchObject({ code: 'unmarked-candidate-not-found' })
  })
})
