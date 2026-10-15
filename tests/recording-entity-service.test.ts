import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingEntityService } from '../src/services/recording-entity-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeSessionStore } from '../src/keychain-store.js'
import type { ArkmeRecordingPrivateTranscriptItem } from '../src/recording-presentation.js'

const date = new Date(2026, 9, 13).getTime()
const day = () => ({ day_stamp: date, transcript_source: 'system', status: 'succeeded', view_mode: 'official',
  state_revision: 3, projection_revision: 2, job_id: 'private-job', result_version: 'private-version', pollable: false,
  recognition_progress: { stage: 'succeeded', completed_units: 2, total_units: 2 },
  entities: [{ entity_key: 'private-entity', official_entity_id: 'private-entity', canonical_name: '武汉', type: 3, occurrence_count: 1 }] })
const occurrence = () => ({ occurrence_id: 'private-mention', row_id: 'session:child:0:system', session_id: 'session', child_id: 'child',
  item_index: 0, transcript_source: 'system', start_ms: date + 1000, end_ms: date + 2000, rune_start: 9, rune_end: 11, observed_text: '武汉' })
const row = { sessionId: 'session', childId: 'child', asrItemIndex: 0, transcriptSource: 'system', startAtMillis: date + 1000, endAtMillis: date + 2000,
  rawTranscriptText: '  (背景音) 🙂武汉  ', text: '🙂武汉' } as ArkmeRecordingPrivateTranscriptItem
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()) })
function fixture() {
  let credentials = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
  const store: ArkmeSessionStore = { read: async () => credentials, write: async next => { credentials = next }, delete: async () => {} }
  const state = { day: day() as Record<string, unknown>, occurrences: [occurrence()] as Record<string, unknown>[], rows: [row], start: { status: 'accepted', job_id: 'private-job' } as Record<string, unknown>, fail: false, afterOccurrences: (() => {}) as () => void }
  const paths: string[] = []
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const runtime = new ServiceRuntime({ environment: 'test', relationBaseUrl: 'https://relation.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    store, { uniqueCode: async () => 'isolated-entity-key' } as StateStore, async (url, init) => {
      init?.signal?.throwIfAborted()
      const path = new URL(String(url)).pathname; paths.push(path)
      if (state.fail) throw new Error('offline')
      const body = JSON.parse(String(init?.body)); requests.push({ path, body })
      const data = path.endsWith('/feedback/undo') ? { status: 'undone' } : path.endsWith('/feedback') ? { status: 'applied', receipt_id: 'private-receipt', undo_expires_at: Date.now() + 60_000 } : path.endsWith('/ensure') ? state.start : path.endsWith('/list') ? state.day : { job_id: body.job_id, view_mode: body.result_version ? 'official' : 'provisional',
        official_entity_id: body.official_entity_id, result_version: body.result_version, projection_entity_id: body.projection_entity_id,
        projection_revision: body.projection_revision, personalization: state.day.personalization, occurrences: state.occurrences }
      if (path.endsWith('/occurrences')) state.afterOccurrences()
      return new Response(JSON.stringify({ code: 200, data }), { headers: { 'content-type': 'application/json' } })
    })
  const reader = { entityTranscriptRows: vi.fn(async () => state.rows) }
  const service = new RecordingEntityService(runtime, reader)
  cleanup.push(() => service.dispose())
  return { runtime, service, state, reader, paths, requests }
}
describe('recording entity Host owner', () => {
  it('reads mentions and original text together, then checks the live version once', async () => {
    const f = fixture(), initial = await f.service.recordingEntities({ dateStamp: date })
    f.paths.length = 0
    let release!: (rows: ArkmeRecordingPrivateTranscriptItem[]) => void
    f.reader.entityTranscriptRows.mockImplementationOnce(() => new Promise(done => { release = done }))
    const result = f.service.recordingEntityOccurrences({ entityRef: initial.entities![0]!.entityRef })
    await vi.waitFor(() => { expect(f.reader.entityTranscriptRows).toHaveBeenCalledOnce(); expect(f.paths).toContain('/api/v1/entity/audio-day/occurrences') })
    expect(f.paths).not.toContain('/api/v1/entity/audio-day/list')
    release([row])
    expect((await result).items[0]?.target).toBeDefined()
    expect(f.paths).toEqual(['/api/v1/entity/audio-day/occurrences', '/api/v1/entity/audio-day/list'])
  })
  it('cancels the parallel original-text read when the occurrence request fails', async () => {
    const f = fixture(), initial = await f.service.recordingEntities({ dateStamp: date })
    let readSignal: AbortSignal | undefined
    f.reader.entityTranscriptRows.mockImplementationOnce((...args: unknown[]) => {
      readSignal = args[3] as AbortSignal
      return new Promise((_, reject) => readSignal!.addEventListener('abort', () => reject(readSignal!.reason), { once: true }))
    })
    f.state.fail = true
    await expect(f.service.recordingEntityOccurrences({ entityRef: initial.entities![0]!.entityRef })).rejects.toThrow()
    expect(readSignal?.aborted).toBe(true)
  })
  it('reads only existing recognition, seals internal identifiers and maps exact raw Unicode evidence', async () => {
    const f = fixture(), result = await f.service.recordingEntities({ dateStamp: date })
    expect(result.entities).toHaveLength(1)
    expect(JSON.stringify(result)).not.toMatch(/private-job|private-entity|private-version/)
    const refs = { entityRef: result.entities![0]!.entityRef }
    const mentions = await f.service.recordingEntityOccurrences(refs)
    expect(mentions.items[0]).toMatchObject({ observedText: '武汉', text: '🙂武汉', target: { start: 1, length: 2, transcriptSource: 'system' } })
    expect(JSON.stringify(mentions)).not.toMatch(/private-mention|session:child/)
    expect(f.paths.every(path => !path.endsWith('/ensure'))).toBe(true)
  })
  it('rejects cross-account, tampered and obsolete projection references', async () => {
    const f = fixture(), initial = await f.service.recordingEntities({ dateStamp: date }), ref = initial.entities![0]!.entityRef
    await expect(f.service.recordingEntityOccurrences({ entityRef: ref + 'tamper' })).rejects.toMatchObject({ code: 'recording-entities-invalid' })
    f.state.day.result_version = 'next-version'
    await expect(f.service.recordingEntityOccurrences({ entityRef: ref })).rejects.toMatchObject({ code: 'recording-entities-stale' })
    await f.runtime.writeSession({ userId: 43, accessToken: 'new', refreshToken: 'new' })
    await expect(f.service.recordingEntityOccurrences({ entityRef: ref })).rejects.toMatchObject({ code: 'recording-entities-stale' })
  })
  it('keeps missing or text-changed evidence non-locatable without timestamp fallback', async () => {
    const f = fixture(), result = await f.service.recordingEntities({ dateStamp: date })
    f.state.rows = [{ ...row, rawTranscriptText: '🙂北京', text: '🙂北京' }]
    expect((await f.service.recordingEntityOccurrences({ entityRef: result.entities![0]!.entityRef })).items[0]?.target).toBeUndefined()
  })
  it('retains omitted incremental projections, but explicitly clears owner invalidation', async () => {
    const f = fixture()
    delete f.state.day.entities
    expect((await f.service.recordingEntities({ dateStamp: date, knownStateRevision: 3, knownProjectionRevision: 2 })).entities).toBeUndefined()
    f.state.day = { ...f.state.day, status: 'processing', job_id: '', projection_revision: 0 }
    expect((await f.service.recordingEntities({ dateStamp: date, knownStateRevision: 3, knownProjectionRevision: 2 })).entities).toEqual([])
  })
  it('paginates mentions, rejects malformed/oversized payloads and aborts', async () => {
    const f = fixture(), result = await f.service.recordingEntities({ dateStamp: date }), entityRef = result.entities![0]!.entityRef
    f.state.occurrences = Array.from({ length: 51 }, (_, i) => ({ ...occurrence(), occurrence_id: String(i) }))
    expect(await f.service.recordingEntityOccurrences({ entityRef, offset: 50 })).toMatchObject({ offset: 50, total: 51, hasMore: false, items: [expect.any(Object)] })
    await expect(f.service.recordingEntityOccurrences({ entityRef, limit: 51 })).rejects.toThrow()
    f.state.day.entities = Array(5001).fill(day().entities[0])
    await expect(f.service.recordingEntities({ dateStamp: date })).rejects.toThrow()
    await expect(f.service.recordingEntities({ dateStamp: date }, AbortSignal.abort())).rejects.toThrow()
  })
  it('rejects publication changes and account switches while resolving mentions', async () => {
    const f = fixture(), initial = await f.service.recordingEntities({ dateStamp: date }), entityRef = initial.entities![0]!.entityRef
    f.state.afterOccurrences = () => { f.state.day.result_version = 'published-next' }
    await expect(f.service.recordingEntityOccurrences({ entityRef })).rejects.toMatchObject({ code: 'recording-entities-stale' })
    f.state.afterOccurrences = () => {}
    f.state.day = day()
    f.reader.entityTranscriptRows.mockImplementationOnce(async () => {
      await f.runtime.writeSession({ userId: 43, accessToken: 'new', refreshToken: 'new' })
      return [row]
    })
    await expect(f.service.recordingEntityOccurrences({ entityRef })).rejects.toMatchObject({ code: 'recording-entities-stale' })
  })
  it('reads provisional results then invalidates old references after official publication', async () => {
    const f = fixture()
    f.state.day = { ...day(), status: 'processing', view_mode: 'provisional', result_version: '', pollable: true,
      entities: [{ ...day().entities[0], projection_entity_id: 'projection-one' }] }
    const pending = await f.service.recordingEntities({ dateStamp: date })
    expect(pending).toMatchObject({ viewMode: 'provisional', pollable: true })
    const entityRef = pending.entities![0]!.entityRef
    expect((await f.service.recordingEntityOccurrences({ entityRef })).items[0]?.target).toBeDefined()
    f.state.day = day()
    const published = await f.service.recordingEntities({ dateStamp: date })
    expect(published.version).not.toBe(pending.version)
    await expect(f.service.recordingEntityOccurrences({ entityRef })).rejects.toMatchObject({ code: 'recording-entities-stale' })
    f.state.day = { ...day(), status: 'source_mismatch', entities: [] }
    expect((await f.service.recordingEntities({ dateStamp: date })).entities).toEqual([])
  })
})

it('starts explicitly through an uncached owner command and hides internal IDs', async () => {
  const f = fixture()
  expect(await f.service.startRecordingEntities({ dateStamp: date })).toEqual({ status: 'accepted' })
  expect(await f.service.startRecordingEntities({ dateStamp: date })).toEqual({ status: 'accepted' })
  expect(f.paths).toEqual(['/api/v1/entity/audio-day/ensure', '/api/v1/entity/audio-day/ensure'])
  f.state.start = { status: 'failed', retryable: true, error_code: 'private-detail' }
  await expect(f.service.startRecordingEntities({ dateStamp: date })).rejects.toMatchObject({ code: 'recording-entities-start-failed', retryable: true })
  await expect(f.service.startRecordingEntities({ dateStamp: date }, AbortSignal.abort())).rejects.toThrow()
})
it('forwards live health independently of projection versions and supports legacy progress', async () => {
  const f = fixture()
  f.state.day = { ...f.state.day, can_start: false, transcript_health: { ready_units: 1, processing_units: 1, unavailable_units: 1 } }
  const first = await f.service.recordingEntities({ dateStamp: date })
  expect(first.transcriptHealth).toMatchObject({ readyUnits: 1, unavailableUnits: 1 })
  delete f.state.day.transcript_health
  f.state.day.transcript_progress = { ready_units: 1, failed_units: 1 }
  const next = await f.service.recordingEntities({ dateStamp: date })
  expect(next.version).toBe(first.version)
  expect(next.transcriptHealth).toMatchObject({ failedUnits: 1, unavailableUnits: 0 })
  expect(next.entities).toHaveLength(1)
  f.state.day.transcript_health = { unavailable_units: 1 }
  await expect(f.service.recordingEntities({ dateStamp: date })).rejects.toThrow()
})

function personalize(f: ReturnType<typeof fixture>) {
  f.state.day.personalization = { contract_version: 1, revision: 4, feedback_supported: true }
  f.state.day.entities = [{ ...day().entities[0], relevance: 'concerned', accuracy: 'needs_confirmation' }]
  f.state.occurrences = [{ ...occurrence(), feedback_version: 'feedback-v1', context: {
    relevance: 'concerned', accuracy: 'needs_confirmation', sound_source: 'playback', speaker_label: '周鹏',
  } }]
}
it('keeps legacy and unknown-contract results usable without inventing metadata or writable refs', async () => {
  const f = fixture(); personalize(f)
  f.state.day.personalization = { contract_version: 2, revision: 4, feedback_supported: true }
  const data = await f.service.recordingEntities({ dateStamp: date })
  expect(data.personalization).toBeUndefined(); expect(data.entities![0]!.relevance).toBeUndefined()
  const mentions = await f.service.recordingEntityOccurrences({ entityRef: data.entities![0]!.entityRef })
  expect(mentions.items[0]!.context).toBeUndefined(); expect(mentions.items[0]!.feedbackRef).toBeUndefined()
})
it('keeps relevance independent of playback source and accuracy, and versions metadata changes', async () => {
  const f = fixture(); personalize(f)
  const data = await f.service.recordingEntities({ dateStamp: date, knownPersonalizationRevision: 3 })
  expect(f.requests[0]!.body.known_personalization_revision).toBe(3)
  expect(data.entities![0]).toMatchObject({ relevance: 'concerned', accuracy: 'needs_confirmation' })
  const mentions = await f.service.recordingEntityOccurrences({ entityRef: data.entities![0]!.entityRef })
  expect(mentions.items[0]!.context).toMatchObject({ relevance: 'concerned', soundSource: 'playback', accuracy: 'needs_confirmation' })
  expect(mentions.items[0]!.feedbackRef).toBeTruthy()
  expect(JSON.stringify(mentions)).not.toMatch(/private-mention|feedback-v1|session:child/)
  f.state.day.personalization = { contract_version: 1, revision: 5, feedback_supported: true }
  const updated = await f.service.recordingEntities({ dateStamp: date })
  expect(updated.version).not.toBe(data.version)
  await expect(f.service.recordingEntityOccurrences({ entityRef: data.entities![0]!.entityRef })).rejects.toMatchObject({ code: 'recording-entities-stale' })
})
it('only permits feedback on exactly locatable occurrences with an owner concurrency version', async () => {
  const f = fixture(); personalize(f)
  const data = await f.service.recordingEntities({ dateStamp: date }), query = { entityRef: data.entities![0]!.entityRef }
  delete f.state.occurrences[0]!.feedback_version
  expect((await f.service.recordingEntityOccurrences(query)).items[0]!.feedbackRef).toBeUndefined()
  f.state.occurrences[0]!.feedback_version = 'v1'; f.state.rows = []
  expect((await f.service.recordingEntityOccurrences(query)).items[0]!.feedbackRef).toBeUndefined()
  f.state.day.personalization = { contract_version: 1, revision: -1, feedback_supported: true }
  await expect(f.service.recordingEntities({ dateStamp: date })).rejects.toMatchObject({ code: 'recording-entities-invalid' })
})
it('scopes feedback to one occurrence, forwards stable retry ids and returns an opaque undo receipt', async () => {
  const f = fixture(); personalize(f)
  const data = await f.service.recordingEntities({ dateStamp: date })
  const mentions = await f.service.recordingEntityOccurrences({ entityRef: data.entities![0]!.entityRef })
  const input = { feedbackRef: mentions.items[0]!.feedbackRef!, action: 'playback' as const, requestId: 'isolated-request-123' }
  const result = await f.service.recordingEntityFeedback(input)
  const writes = f.requests.filter(r => r.path.endsWith('/feedback'))
  expect(writes[0]!.body).toEqual({ job_id: 'private-job', view_mode: 'official', projection_revision: 2, result_version: 'private-version',
    occurrence_id: 'private-mention', expected_feedback_version: 'feedback-v1', expected_personalization_revision: 4,
    action: 'playback', scope: 'occurrence', idempotency_key: input.requestId })
  expect(JSON.stringify(result)).not.toContain('private-receipt')
  // Unknown-outcome recovery must reach the owner receipt even after the projection changes.
  f.state.day.result_version = 'changed-after-write'
  await f.service.recordingEntityFeedback(input)
  expect(f.requests.filter(r => r.path.endsWith('/feedback')).map(r => r.body.idempotency_key)).toEqual([input.requestId, input.requestId])
  await expect(f.service.undoRecordingEntityFeedback({ undoRef: result.undoRef, requestId: 'isolated-undo-1234' })).resolves.toEqual({ status: 'undone' })
  expect(f.requests.at(-1)!.body).toEqual({ receipt_id: 'private-receipt', idempotency_key: 'isolated-undo-1234' })
  const before = f.requests.length
  await expect(f.service.recordingEntityFeedback({ ...input, feedbackRef: data.entities![0]!.entityRef })).rejects.toThrow()
  await expect(f.service.recordingEntityFeedback({ ...input, requestId: 'bad' })).rejects.toThrow()
  await f.runtime.writeSession({ userId: 43, accessToken: 'new', refreshToken: 'new' })
  await expect(f.service.recordingEntityFeedback(input)).rejects.toMatchObject({ code: 'recording-entities-stale' })
  await expect(f.service.undoRecordingEntityFeedback({ undoRef: result.undoRef, requestId: 'isolated-undo-1234' })).rejects.toMatchObject({ code: 'recording-entities-stale' })
  expect(f.requests).toHaveLength(before)
})

it('rejects an omitted snapshot after personalization changes, instead of hiding the previous entities', async () => {
  const f = fixture(); personalize(f); delete f.state.day.entities
  await expect(f.service.recordingEntities({ dateStamp: date, knownPersonalizationRevision: 3 })).rejects.toMatchObject({ code: 'recording-entities-invalid' })
  expect((await f.service.recordingEntities({ dateStamp: date, knownStateRevision: 3, knownProjectionRevision: 2, knownPersonalizationRevision: 4 })).entities).toBeUndefined()
})
