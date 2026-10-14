import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingEntityService } from '../src/services/recording-entity-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeSessionStore } from '../src/keychain-store.js'
import type { RecordingEntityTranscriptRow } from '../src/services/recording-entity-service.js'

const date = new Date(2026, 9, 13).getTime()
const day = () => ({ day_stamp: date, transcript_source: 'system', status: 'succeeded', view_mode: 'official',
  state_revision: 3, projection_revision: 2, job_id: 'private-job', result_version: 'private-version', pollable: false,
  recognition_progress: { stage: 'succeeded', completed_units: 2, total_units: 2 },
  entities: [{ entity_key: 'private-entity', official_entity_id: 'private-entity', canonical_name: '武汉', type: 3, occurrence_count: 1 }] })
const occurrence = () => ({ occurrence_id: 'private-mention', row_id: 'session:child:0:system', session_id: 'session', child_id: 'child',
  item_index: 0, transcript_source: 'system', start_ms: date + 1000, end_ms: date + 2000, rune_start: 9, rune_end: 11, observed_text: '武汉' })
const row = { sessionId: 'session', childId: 'child', asrItemIndex: 0, transcriptSource: 'system', startAtMillis: date + 1000, endAtMillis: date + 2000,
  rawTranscriptText: '  (背景音) 🙂武汉  ', text: '🙂武汉' } as RecordingEntityTranscriptRow
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(fn => fn()) })
function fixture() {
  let credentials = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
  const store: ArkmeSessionStore = { read: async () => credentials, write: async next => { credentials = next }, delete: async () => {} }
  const state = { day: day() as Record<string, unknown>, occurrences: [occurrence()] as Record<string, unknown>[], rows: [row], start: { status: 'accepted', job_id: 'private-job' } as Record<string, unknown>, fail: false, afterOccurrences: (() => {}) as () => void }
  const paths: string[] = []
  const runtime = new ServiceRuntime({ environment: 'test', relationBaseUrl: 'https://relation.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    store, { uniqueCode: async () => 'isolated-entity-key' } as StateStore, async (url, init) => {
      init?.signal?.throwIfAborted()
      const path = new URL(String(url)).pathname; paths.push(path)
      if (state.fail) throw new Error('offline')
      const body = JSON.parse(String(init?.body))
      const data = path.endsWith('/ensure') ? state.start : path.endsWith('/list') ? state.day : { job_id: body.job_id, view_mode: body.result_version ? 'official' : 'provisional',
        official_entity_id: body.official_entity_id, result_version: body.result_version, projection_entity_id: body.projection_entity_id,
        projection_revision: body.projection_revision, occurrences: state.occurrences }
      if (path.endsWith('/occurrences')) state.afterOccurrences()
      return new Response(JSON.stringify({ code: 200, data }), { headers: { 'content-type': 'application/json' } })
    })
  const reader = { entityTranscriptRows: vi.fn(async () => state.rows) }
  const service = new RecordingEntityService(runtime, reader)
  cleanup.push(() => service.dispose())
  return { runtime, service, state, reader, paths }
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
