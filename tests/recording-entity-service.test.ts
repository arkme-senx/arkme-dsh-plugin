import { createHash } from 'node:crypto'
import { recordingSearchIdentityHash, recordingSearchVersion } from '../src/recording-search-version.js'
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
  const state = { referenceError: undefined as {code:number;message:string;data?:unknown} | undefined, references: [] as Record<string, unknown>[], referenceHash: undefined as string | undefined, day: day() as Record<string, unknown>, occurrences: [occurrence()] as Record<string, unknown>[], rows: [row], start: { status: 'accepted', job_id: 'private-job' } as Record<string, unknown>, fail: false, afterOccurrences: (() => {}) as () => void }
  const paths: string[] = []
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const runtime = new ServiceRuntime({ environment: 'test', relationBaseUrl: 'https://relation.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
    store, { uniqueCode: async () => 'isolated-entity-key' } as StateStore, async (url, init) => {
      init?.signal?.throwIfAborted()
      const path = new URL(String(url)).pathname; paths.push(path)
      if (state.fail) throw new Error('offline')
      const body = JSON.parse(String(init?.body)); requests.push({ path, body })
      if (path.endsWith('/person-references') && state.referenceError) return new Response(JSON.stringify(state.referenceError), {headers:{'content-type':'application/json'}})
      const data = path.endsWith('/person-references') ? { job_id: body.job_id, result_version: body.result_version, rows: [{ row_id: (body.row_ids as string[])[0], content_hash: state.referenceHash ?? createHash('sha256').update(state.rows[0]!.rawTranscriptText ?? state.rows[0]!.text).digest('hex'), status: 'complete', references: state.references }] } : path.endsWith('/feedback/undo') ? { status: 'undone' } : path.endsWith('/feedback') ? { status: 'applied', receipt_id: 'private-receipt', undo_expires_at: Date.now() + 60_000 } : path.endsWith('/start') ? state.start : path.endsWith('/list') ? state.day : { job_id: body.job_id, view_mode: body.result_version ? 'official' : 'provisional',
        official_entity_id: body.official_entity_id, result_version: body.result_version, projection_entity_id: body.projection_entity_id,
        projection_revision: body.projection_revision, personalization: state.day.personalization, occurrences: state.occurrences }
      if (path.endsWith('/occurrences') || path.endsWith('/person-references')) state.afterOccurrences()
      return new Response(JSON.stringify({ code: 200, data }), { headers: { 'content-type': 'application/json' } })
    })
  const reader = { entityTranscriptRows: vi.fn(async () => state.rows) }
  const service = new RecordingEntityService(runtime, reader)
  cleanup.push(() => service.dispose())
  return { runtime, service, state, reader, paths, requests }
}
describe('recording entity Host owner', () => {
  it('returns a verified midnight source preview without an extra day fetch or timestamp fallback', async () => {
    const f = fixture(), initial = await f.service.recordingEntities({ dateStamp: date })
    const nextDay = new Date(date); nextDay.setDate(nextDay.getDate() + 1)
    f.state.rows = [{ ...row, startAtMillis: nextDay.getTime() + 1000, endAtMillis: nextDay.getTime() + 2000 }]
    f.state.occurrences = [{ ...occurrence(), start_ms: nextDay.getTime() + 1000, end_ms: nextDay.getTime() + 2000 }]
    const result = await f.service.recordingEntityOccurrences({ entityRef: initial.entities![0]!.entityRef })
    expect(result.items[0]?.target).toMatchObject({ sourceText: '🙂武汉', start: 1, length: 2 })
    expect(f.reader.entityTranscriptRows).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toMatch(/session:child|private-mention/)
    f.state.rows = [{ ...f.state.rows[0]!, rawTranscriptText: '原文已修改', text: '原文已修改' }]
    expect((await f.service.recordingEntityOccurrences({ entityRef: initial.entities![0]!.entityRef })).items[0]?.target).toBeUndefined()
  })
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
    expect(f.paths.every(path => !path.endsWith('/start'))).toBe(true)
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
  expect(f.paths).toEqual(['/api/v1/entity/audio-day/start', '/api/v1/entity/audio-day/start'])
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

it('projects complete participant counts without raw IDs and filters all mentions before pagination', async () => {
  const f = fixture(); personalize(f)
  f.state.day.entities = [{ ...day().entities[0], occurrence_count: 62, participation: { contract_version: 1,
    participants: [
      { speaker_key: 'private-self', speaker_label: 'Tison', is_self: true, occurrence_count: 60, playback_count: 0 },
      { speaker_key: 'private-other', speaker_label: '周鹏', is_self: false, occurrence_count: 2, playback_count: 1 },
    ], unattributed_count: 0, conversation_count: 1, meaningful_count: 61 } }]
  f.state.occurrences = Array.from({ length: 62 }, (_, i) => ({ ...occurrence(), occurrence_id: String(i), start_ms: date + 1000 + i,
    context: { speaker_key: i < 60 ? 'private-self' : 'private-other', speaker_label: i < 60 ? 'Tison' : '周鹏', relevance: 'other', accuracy: 'unverified', sound_source: i === 61 ? 'playback' : 'in_person' } }))
  const result = await f.service.recordingEntities({ dateStamp: date }), item = result.entities![0]!
  expect(item.participation!.participants.map(p => p.occurrenceCount)).toEqual([60, 2])
  expect(JSON.stringify(result)).not.toMatch(/private-self|private-other/)
  const filtered = await f.service.recordingEntityOccurrences({ entityRef: item.entityRef, participantKey: item.participation!.participants[1]!.key })
  expect(filtered).toMatchObject({ total: 2, offset: 0, hasMore: false })
  expect(filtered.items).toHaveLength(2)
  expect(filtered.items[0]!.startAtMillis).toBe(date + 1060)
  expect(filtered.items.every(o => o.context?.participantKey === item.participation!.participants[1]!.key)).toBe(true)
  expect(filtered.items[1]!.context?.soundSource).toBe('playback')
  expect(JSON.stringify(filtered)).not.toContain('private-other')
})
it('rejects incomplete counts and duplicate speaker identities instead of presenting partial totals', async () => {
  const f = fixture(); personalize(f)
  const participant = { speaker_key: 'speaker', speaker_label: '同名', is_self: false, occurrence_count: 1, playback_count: 0 }
  const participation = { contract_version: 1, participants: [participant], unattributed_count: 1, conversation_count: 0, meaningful_count: 1 }
  f.state.day.entities = [{ ...day().entities[0], participation }]
  await expect(f.service.recordingEntities({ dateStamp: date })).rejects.toThrow()
  participation.unattributed_count = 0; participation.participants.push(participant)
  f.state.day.entities = [{ ...day().entities[0], occurrence_count: 2, participation }]
  await expect(f.service.recordingEntities({ dateStamp: date })).rejects.toThrow()
  participation.participants[1] = { ...participant, speaker_key: 'distinct-speaker' }
  expect((await f.service.recordingEntities({ dateStamp: date })).entities![0]!.participation?.participants).toHaveLength(2)
})

it('passes owner system speakers through while keeping unknown audio source and identities private', async () => {
  const f = fixture(); personalize(f)
  f.state.occurrences = [{ ...occurrence(), context: { speaker_key: 'private-system-track', speaker_label: '说话人 3', relevance: 'unknown', accuracy: 'unverified', sound_source: 'unknown' } }]
  const list = await f.service.recordingEntities({ dateStamp: date })
  const detail = await f.service.recordingEntityOccurrences({ entityRef: list.entities![0]!.entityRef })
  expect(detail.items[0]!.context).toMatchObject({ speakerLabel: '说话人 3', soundSource: 'unknown', relevance: 'unknown' })
  expect(JSON.stringify(detail)).not.toContain('private-system-track')
})

function personReferenceFixture() {
  const f = fixture()
  const raw = '  (背景音) 🙂他问你，我们说其他  ', visible = '🙂他问你，我们说其他'
  f.state.rows = [{ ...row, rawTranscriptText: raw, text: visible }]
  const start = Array.from(raw).indexOf('他')
  f.state.references = [{ start, end: start + 1, text: '他', status: 'resolved', target_name: '正式人物' },
    { start: start + 2, end: start + 3, text: '你', status: 'unresolved' },
    { start: start + 4, end: start + 6, text: '我们', status: 'group' }]
  const current = f.state.rows[0]!
  const query = { dateStamp: date, identityHash: recordingSearchIdentityHash({sessionId:current.sessionId,childId:current.childId,itemIndex:current.asrItemIndex,transcriptSource:current.transcriptSource}),transcriptVersion:recordingSearchVersion({...current,text:raw}) }
  return { ...f, query }
}
it('reads source-bound pronouns through the same owner without inference or internal IDs', async () => {
  const f = personReferenceFixture(), result = await f.service.recordingPersonReferences(f.query)
  expect(result).toMatchObject({status:'complete', references:[{start:1,length:1,text:'他',status:'resolved',targetName:'正式人物'},{start:3,length:1,text:'你',status:'unresolved'},{start:5,length:2,text:'我们',status:'group'}]})
  expect(JSON.stringify(result)).not.toMatch(/private-|session:child|source.*hash/)
  expect(f.paths).toEqual(['/api/v1/entity/audio-day/list','/api/v1/entity/audio-day/person-references','/api/v1/entity/audio-day/list'])
})
it('keeps unrecognized/processing rows distinct from completed empty results', async () => {
  const f=personReferenceFixture()
  f.state.day.status='not_started';expect((await f.service.recordingPersonReferences(f.query)).status).toBe('not_analyzed')
  f.state.day.status='processing';expect((await f.service.recordingPersonReferences(f.query)).status).toBe('processing')
  expect(f.paths.some(p=>p.endsWith('/person-references'))).toBe(false)
})
it('rejects edited, stale, cross-account and malformed pronoun projections', async () => {
  for (const mutate of [
    (f:ReturnType<typeof personReferenceFixture>)=>{f.query.transcriptVersion='0'.repeat(64)},
    (f:ReturnType<typeof personReferenceFixture>)=>{f.state.referenceHash='0'.repeat(64)},
    (f:ReturnType<typeof personReferenceFixture>)=>{f.state.afterOccurrences=()=>{f.state.day.result_version='changed'}},
    (f:ReturnType<typeof personReferenceFixture>)=>{f.state.afterOccurrences=()=>{void f.runtime.writeSession({userId:43,accessToken:'new',refreshToken:'new'})}},
    (f:ReturnType<typeof personReferenceFixture>)=>{f.state.references[1]!.target_name='invented'},
    (f:ReturnType<typeof personReferenceFixture>)=>{f.state.references[0]!.end=999},
  ]) {const f=personReferenceFixture();mutate(f);await expect(f.service.recordingPersonReferences(f.query)).rejects.toThrow()}
})

it('maps the owner stale contract for UI Tool and SDK without treating outages as stale', async () => {
 for (const [code,message,data,want] of [
  [1001,'参数错误','audio_person_references_stale','recording-entities-stale'],
  [1001,'audio_person_references_stale',undefined,'recording-entities-stale'],
  [1002,'服务器繁忙','audio_person_references_stale','arkme-code-1002'],
  [1001,'参数错误','other_parameter','arkme-code-1001'],
  [1001,'参数错误',{message:'audio_person_references_stale'},'arkme-code-1001'],
 ] as const) {
  const f=personReferenceFixture();f.state.referenceError={code,message,data}
  await expect(f.service.recordingPersonReferences(f.query)).rejects.toMatchObject({code:want})
  expect(f.requests.filter(x=>x.path.endsWith('/person-references'))).toHaveLength(1)
 }
})
