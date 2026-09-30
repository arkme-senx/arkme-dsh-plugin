import { describe, expect, it, vi } from 'vitest'
import { SpeakerDirectoryService } from '../../src/services/speaker-directory-service.js'
import { UnmarkedSpeakerService } from '../../src/services/unmarked-speaker-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import type { RecordingService } from '../../src/services/recording-service.js'
const base = { state: 'fresh', coverage: 'complete', retry_after_ms: 0 }
const summary = { ...base, total_count: 43, marked_count: 10, unmarked_count: 33, unseen_count: 3, snapshot_version: 'version', seen_version: 2, updated_at: 1, not_modified: false }
const candidate = { person_key: 'person', type: 'unmarked', display_name: '说话人 12', display_number: 12, avatar_ref: '', is_self: false, day_count: 5, last_seen_at: 1790640000000, detail_ref: { type: 'candidate', id: 'opaque-含历史Binary-ID' } }
const page = { ...base, items: [candidate], snapshot_version: 'version', through_cursor: 'seen-opaque', has_more: false, next_cursor: '' }
function fixture() {
  let userId = 7
  const post = vi.fn(async (path: string) => path.endsWith('/summary') ? summary : path.endsWith('/seen') ? { success: true, seen_version: 3 } : page)
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId, accessToken: 'test-token', refreshToken: 'test-refresh' }), authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'synthetic-secret' } } as unknown as ServiceRuntime
  const recording = { directorySpeakerRef: vi.fn(async () => 'speaker-reference') } as unknown as Pick<RecordingService, 'directorySpeakerRef'>
  const unmarked = { directoryCandidateRef: vi.fn(async () => 'candidate-reference') } as unknown as Pick<UnmarkedSpeakerService, 'directoryCandidateRef'>
  return { service: new SpeakerDirectoryService(runtime, recording, unmarked), post, runtime, recording, unmarked, switchUser: () => { userId = 9 } }
}
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
