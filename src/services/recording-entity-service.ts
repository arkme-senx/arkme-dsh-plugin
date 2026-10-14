import { createHmac } from 'node:crypto'
import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeRecordingTranscriptSource } from '../types.js'
import type { RecordingEntityStartQuery, RecordingEntityStartResult, RecordingEntityDay, RecordingEntityQuery, RecordingEntityOccurrenceQuery, RecordingEntityOccurrences, RecordingEntityPort } from '../recording-entity-contract.js'
import { recordingEntityDisplayRange } from '../recording-entity-range.js'
import { recordingSearchIdentityHash, recordingSearchVersion } from '../recording-search-version.js'
import { ArkmePluginError, ServiceRuntime, objectValue } from './service.js'

const PREFIX = 'arkme-recording-entity-v1'
const invalid = () => new ArkmePluginError('recording-entities-invalid', '实体数据无效，请刷新重试', true, 502)
const stale = () => new ArkmePluginError('recording-entities-stale', '录音内容或实体结果已更新，请刷新实体列表', true, 409)
function integer(value: unknown, fallback = 0): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid()
  return Number(value)
}
function string(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || value.length > max) throw invalid()
  return value
}
function array(value: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalid()
  return value.map(objectValue)
}
export interface RecordingEntityTranscriptRow {
 sessionId: string; childId: string; asrItemIndex: number; transcriptSource: ArkmeRecordingTranscriptSource
 startAtMillis: number; endAtMillis: number; text: string; rawTranscriptText?: string; searchVersion?: string
}
export interface RecordingEntityTranscriptReader {
  entityTranscriptRows(dateStamp: number, source: ArkmeRecordingTranscriptSource, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<RecordingEntityTranscriptRow[]>
}

/** Only transport/projection: Relation remains the recognition and publication owner. */
export class RecordingEntityService implements RecordingEntityPort {
  private readonly codec: EncryptedReferenceCodec
  private revision = 0
  private readonly unsubscribe: () => void
  private seed: Promise<string> | undefined
  constructor(private readonly runtime: ServiceRuntime, private readonly transcripts: RecordingEntityTranscriptReader) {
    this.codec = new EncryptedReferenceCodec(() => this.key(), invalid)
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.revision += 1 })
  }
  dispose(): void { this.revision += 1; this.unsubscribe() }
  private key(): Promise<string> { return this.seed ??= this.runtime.stateStore.uniqueCode() }
  private async hash(value: unknown): Promise<string> { return createHmac('sha256', await this.key()).update(JSON.stringify(value)).digest('hex') }
  private async assertCurrent(session: ArkmeSessionCredentials, revision: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || revision !== this.revision) throw stale()
    signal?.throwIfAborted()
  }
  private query(query: RecordingEntityQuery): { dateStamp: number; source: ArkmeRecordingTranscriptSource } {
    const dateStamp = integer(query.dateStamp)
    const source = query.transcriptSource ?? 'system'
    if (!dateStamp || !Number.isFinite(new Date(dateStamp).getTime()) || !['system', 'doubao'].includes(source)) throw invalid()
    return { dateStamp, source }
  }
  private async read(query: RecordingEntityQuery, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const { dateStamp, source } = this.query(query)
    return this.runtime.authenticatedRelationPost('/api/v1/entity/audio-day/list', {
      day_stamp: dateStamp, transcript_source: source, active_transcript_source: source,
      known_state_revision: integer(query.knownStateRevision), known_projection_revision: integer(query.knownProjectionRevision),
    }, session, signal, { bypassCache: true, cacheMs: 0 })
  }
  private identity(raw: Record<string, unknown>): unknown[] {
    return [raw.day_stamp, raw.transcript_source, raw.job_id ?? '', raw.view_mode, raw.projection_revision ?? 0, raw.result_version ?? '']
  }
  async startRecordingEntities(query: RecordingEntityStartQuery, signal?: AbortSignal): Promise<RecordingEntityStartResult> {
    const { dateStamp, source } = this.query(query)
    signal?.throwIfAborted()
    const session = await this.runtime.requireSession(), revision = this.revision
    const raw = await this.runtime.authenticatedRelationPost<Record<string, unknown>>('/api/v1/entity/audio-day/ensure', {
      day_stamp: dateStamp, transcript_source: source,
    }, session, signal, { lane: 'write', bypassCache: true, cacheMs: 0 })
    await this.assertCurrent(session, revision, signal)
    if (raw.status === 'failed') throw new ArkmePluginError('recording-entities-start-failed', '未能开始识别，请刷新后重试', raw.retryable === true, 503)
    if (!['accepted', 'processing', 'succeeded'].includes(String(raw.status))) throw invalid()
    return { status: raw.status as RecordingEntityStartResult['status'] }
  }
  async recordingEntities(query: RecordingEntityQuery, signal?: AbortSignal): Promise<RecordingEntityDay> {
    const scope = this.query(query)
    const session = await this.runtime.requireSession(), revision = this.revision
    const raw = await this.read(query, session, signal)
    if (raw.day_stamp !== scope.dateStamp || raw.transcript_source !== scope.source
      || !['not_started', 'processing', 'succeeded', 'failed', 'source_mismatch'].includes(String(raw.status))
      || !['provisional', 'official'].includes(String(raw.view_mode)) || typeof raw.pollable !== 'boolean') throw invalid()
    const version = await this.hash([session.userId, this.runtime.config.environment, ...this.identity(raw)])
    const progress = objectValue(raw.recognition_progress)
    const result: RecordingEntityDay = {
      dateStamp: scope.dateStamp, transcriptSource: scope.source, status: raw.status as RecordingEntityDay['status'],
      viewMode: raw.view_mode as RecordingEntityDay['viewMode'], version,
      stateRevision: integer(raw.state_revision), projectionRevision: integer(raw.projection_revision),
      pollable: raw.pollable, stage: typeof progress.stage === 'string' ? string(progress.stage, 100) : 'not_started',
      completedUnits: integer(progress.completed_units), totalUnits: integer(progress.total_units),
    }
    if (raw.can_start !== undefined && typeof raw.can_start !== 'boolean') throw invalid()
    result.canStart = raw.can_start === true || (raw.can_start === undefined && result.status === 'not_started')
    if (raw.transcript_health !== undefined) {
      const health = objectValue(raw.transcript_health)
      result.transcriptHealth = { pendingUnits: integer(health.pending_units), processingUnits: integer(health.processing_units),
        readyUnits: integer(health.ready_units), failedUnits: integer(health.failed_units), unavailableUnits: integer(health.unavailable_units) }
      if (result.transcriptHealth.unavailableUnits > result.transcriptHealth.pendingUnits + result.transcriptHealth.processingUnits) throw invalid()
    } else if (raw.transcript_progress !== undefined) {
      const health = objectValue(raw.transcript_progress)
      result.transcriptHealth = { pendingUnits: integer(health.pending_units), processingUnits: integer(health.processing_units),
        readyUnits: integer(health.ready_units), failedUnits: integer(health.failed_units), unavailableUnits: 0 }
    }
    if (result.completedUnits > result.totalUnits) throw invalid()
    if (raw.entities !== undefined) {
      result.entities = []
      for (const entity of array(raw.entities, 5000)) {
        const type = integer(entity.type), name = string(entity.canonical_name)
        if (type < 1 || type > 9 || !name.trim() || !string(entity.entity_key)) throw invalid()
        const ref = {
          viewerUserId: session.userId, environment: this.runtime.config.environment,
          dateStamp: scope.dateStamp, source: scope.source, version, jobId: string(raw.job_id),
          viewMode: result.viewMode, projectionRevision: result.projectionRevision,
          resultVersion: typeof raw.result_version === 'string' ? string(raw.result_version) : '',
          entityId: string(result.viewMode === 'official' ? entity.official_entity_id : entity.projection_entity_id),
        }
        if (!ref.jobId || !ref.entityId || (ref.viewMode === 'official' ? !ref.resultVersion : !ref.projectionRevision)) throw invalid()
        result.entities.push({ key: await this.hash([session.userId, entity.entity_key]), entityRef: await this.codec.seal(PREFIX, ref),
          name, type, typeLabel: typeof entity.llm_type === 'string' ? string(entity.llm_type, 100) : '', occurrenceCount: integer(entity.occurrence_count) })
      }
    } else if (!query.knownStateRevision && !query.knownProjectionRevision || ['not_started', 'source_mismatch'].includes(result.status) || !raw.job_id) {
      result.entities = []
    }
    await this.assertCurrent(session, revision, signal)
    return result
  }
  async recordingEntityOccurrences(query: RecordingEntityOccurrenceQuery, signal?: AbortSignal): Promise<RecordingEntityOccurrences> {
    const offset = integer(query.offset), limit = integer(query.limit, 50)
    if (offset > 10000 || limit < 1 || limit > 50 || typeof query.entityRef !== 'string') throw invalid()
    const session = await this.runtime.requireSession(), revision = this.revision
    const ref = await this.codec.open(PREFIX, query.entityRef)
    if (ref.viewerUserId !== session.userId || ref.environment !== this.runtime.config.environment) throw stale()
    const dayQuery = { dateStamp: integer(ref.dateStamp), transcriptSource: ref.source as ArkmeRecordingTranscriptSource }
    const check = async () => {
      const current = await this.read(dayQuery, session, signal)
      if (!['processing', 'succeeded', 'failed'].includes(String(current.status))
        || await this.hash([session.userId, this.runtime.config.environment, ...this.identity(current)]) !== ref.version) throw stale()
    }
    // Independent owner reads run together; the final live version check fences both.
    // Cancel the sibling on failure without retaining a second result cache.
    const controller = new AbortController()
    const readSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const [raw, rows] = await Promise.all([
      this.runtime.authenticatedRelationPost<Record<string, unknown>>('/api/v1/entity/audio-day/occurrences', {
        job_id: ref.jobId, ...(ref.viewMode === 'official' ? { official_entity_id: ref.entityId, result_version: ref.resultVersion }
          : { projection_entity_id: ref.entityId, projection_revision: ref.projectionRevision }),
      }, session, readSignal, { bypassCache: true, cacheMs: 0 }),
      this.transcripts.entityTranscriptRows(dayQuery.dateStamp, dayQuery.transcriptSource, session, readSignal),
    ]).finally(() => controller.abort())
    if (raw.replaced_by || raw.job_id !== ref.jobId || raw.view_mode !== ref.viewMode
      || (ref.viewMode === 'official' ? raw.result_version !== ref.resultVersion || raw.official_entity_id !== ref.entityId
        : raw.projection_revision !== ref.projectionRevision || raw.projection_entity_id !== ref.entityId)) throw stale()
    const occurrences = array(raw.occurrences, 10000)
    const page = occurrences.slice(offset, offset + limit)
    const byIdentity = new Map(rows.map(row => [`${row.sessionId}:${row.childId}:${row.asrItemIndex}:${row.transcriptSource}`, row]))
    const items: RecordingEntityOccurrences['items'] = []
    for (const occurrence of page) {
      const rowId = string(occurrence.row_id), observedText = string(occurrence.observed_text, 20000)
      if (rowId !== `${string(occurrence.session_id)}:${string(occurrence.child_id)}:${integer(occurrence.item_index)}:${occurrence.transcript_source}`
        || occurrence.transcript_source !== dayQuery.transcriptSource) throw invalid()
      const start = integer(occurrence.rune_start), end = integer(occurrence.rune_end), startAtMillis = integer(occurrence.start_ms)
      if (end <= start || integer(occurrence.end_ms) < startAtMillis || !observedText) throw invalid()
      const row = byIdentity.get(rowId)
      const range = row && recordingEntityDisplayRange(row.rawTranscriptText ?? row.text, row.text, start, end, observedText)
      const target = row && range ? {
        identityHash: recordingSearchIdentityHash({ sessionId: row.sessionId, childId: row.childId, itemIndex: row.asrItemIndex, transcriptSource: row.transcriptSource }),
        transcriptVersion: row.searchVersion ?? recordingSearchVersion({ ...row, text: row.rawTranscriptText ?? row.text }), transcriptSource: row.transcriptSource, ...range,
      } : undefined
      const excerpt = row && range ? Array.from(row.text).slice(Math.max(0, range.start - 30), range.start + range.length + 60).join('') : observedText
      items.push({ key: await this.hash([ref.version, occurrence.occurrence_id, rowId, start, end]), startAtMillis, observedText, text: excerpt,
        ...(target ? { target } : {}) })
    }
    await check()
    await this.assertCurrent(session, revision, signal)
    return { version: string(ref.version), items, total: occurrences.length, offset, hasMore: offset + limit < occurrences.length }
  }
}
