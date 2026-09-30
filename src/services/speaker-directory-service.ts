import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { SpeakerDirectoryDetail, SpeakerDirectoryPage, SpeakerDirectorySeen, SpeakerDirectoryStatus, SpeakerDirectorySummary } from '../speaker-directory-contract.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
import type { RecordingService } from './recording-service.js'
import type { UnmarkedSpeakerService } from './unmarked-speaker-service.js'

const prefix = 'arkme-speaker-directory-detail-v1'
const invalid = () => new ArkmePluginError('speaker-directory-contract-invalid', '说话人目录响应无效，请稍后重试', true, 502)
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid()
  return value
}
function str(value: unknown): string { if (typeof value !== 'string') throw invalid(); return value }
function status(data: Record<string, unknown>): SpeakerDirectoryStatus {
  if (!['fresh', 'stale', 'building', 'failed', 'disabled', 'snapshot_expired'].includes(String(data.state))
    || !['complete', 'unknown'].includes(String(data.coverage))) throw invalid()
  return {
    state: data.state as SpeakerDirectoryStatus['state'], coverage: data.coverage as SpeakerDirectoryStatus['coverage'],
    retryAfterMs: integer(data.retry_after_ms ?? 0), processingSessionCount: integer(data.processing_session_count ?? 0),
    pendingIdentityAggregationCount: integer(data.pending_identity_aggregation_count ?? 0),
    insufficientEvidenceCount: integer(data.insufficient_evidence_count ?? 0), scanTruncated: data.scan_truncated === true,
  }
}
function inputString(value: unknown, maxBytes: number, fallback = ''): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxBytes) throw new ArkmePluginError('speaker-directory-input-invalid', '说话人查询条件过长或无效', false)
  return value
}

export class SpeakerDirectoryService {
  constructor(private readonly runtime: ServiceRuntime, private readonly recording: Pick<RecordingService, 'directorySpeakerRef'>,
    private readonly unmarked: Pick<UnmarkedSpeakerService, 'directoryCandidateRef'>) {}

  private async request(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(`/api/v1/audio/speaker-directory/${path}`, body, session, signal,
      { lane: path === 'seen' ? 'write' : 'interactive-read', cacheMs: 0, cancelWhenUnobserved: true })
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken) throw new ArkmePluginError('speaker-directory-account-changed', '账号已切换，请重新打开目录', false, 409)
    return { data: objectValue(data), session }
  }

  async summary(input: Record<string, unknown>, signal?: AbortSignal): Promise<SpeakerDirectorySummary> {
    const body: Record<string, unknown> = {}
    if (input.snapshotVersion !== undefined) body.snapshot_version = inputString(input.snapshotVersion, 128)
    if (input.seenVersion !== undefined) {
      if (typeof input.seenVersion !== 'number' || !Number.isSafeInteger(input.seenVersion) || input.seenVersion < 0) throw new ArkmePluginError('speaker-directory-input-invalid', '查看版本无效', false)
      body.seen_version = input.seenVersion
    }
    const { data } = await this.request('summary', body, signal)
    const state = status(data)
    const count = (value: unknown) => value === null || value === undefined ? null : integer(value)
    const result = { ...state, totalCount: count(data.total_count), markedCount: count(data.marked_count), unmarkedCount: count(data.unmarked_count),
      unseenCount: count(data.unseen_count), snapshotVersion: str(data.snapshot_version ?? ''), seenVersion: integer(data.seen_version ?? 0),
      updatedAt: integer(data.updated_at ?? 0), notModified: data.not_modified === true }
    if (state.coverage === 'complete' && state.state !== 'disabled' && state.state !== 'snapshot_expired'
      && (result.totalCount === null || result.markedCount === null || result.unmarkedCount === null || result.unseenCount === null
        || result.totalCount !== result.markedCount + result.unmarkedCount || result.snapshotVersion === '')) throw invalid()
    return result
  }

  async list(input: Record<string, unknown>, signal?: AbortSignal): Promise<SpeakerDirectoryPage> {
    const filter = input.filter ?? 'all', sort = input.sort ?? 'frequent'
    const query = inputString(input.query, 4096).trim().toLowerCase()
    inputString(query, 256)
    const limit = input.limit === undefined || input.limit === 0 ? 50 : input.limit
    if (!['all', 'marked', 'unmarked'].includes(String(filter)) || !['frequent', 'recent'].includes(String(sort))
      || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ArkmePluginError('speaker-directory-input-invalid', '说话人查询条件无效', false)
    const { data, session } = await this.request('list', { filter, sort, query, limit,
      snapshot_version: inputString(input.snapshotVersion, 128), cursor: inputString(input.cursor, 4096) }, signal)
    const state = status(data)
    if (state.state === 'disabled' || state.state === 'snapshot_expired' || state.coverage === 'unknown') return { ...state, items: [], hasMore: false, nextCursor: '', snapshotVersion: '', throughCursor: '' }
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw invalid()
    const snapshotVersion = str(data.snapshot_version), throughCursor = str(data.through_cursor), nextCursor = str(data.next_cursor)
    if (!snapshotVersion || !throughCursor || (data.has_more && !nextCursor)) throw invalid()
    const key = await this.key()
    const items = data.items.map(value => {
      const raw = objectValue(value), ref = objectValue(raw.detail_ref)
      if (!['marked', 'unmarked'].includes(String(raw.type)) || typeof raw.is_self !== 'boolean'
        || ref.type !== (raw.type === 'marked' ? 'speaker' : 'candidate') || !str(ref.id) || !str(raw.person_key)) throw invalid()
      if (ref.expected_version !== undefined) str(ref.expected_version)
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ userId: session.userId, environment: this.runtime.config.environment,
        type: ref.type, id: ref.id, expectedVersion: ref.expected_version })), cipher.final()])
      return { personKey: str(raw.person_key), type: raw.type as 'marked' | 'unmarked', displayName: str(raw.display_name),
        displayNumber: integer(raw.display_number), isSelf: raw.is_self, dayCount: integer(raw.day_count), lastSeenAt: integer(raw.last_seen_at),
        detailRef: [prefix, iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.') }
    })
    signal?.throwIfAborted()
    return { ...state, items, hasMore: data.has_more, nextCursor, snapshotVersion, throughCursor }
  }

  async seen(input: Record<string, unknown>, signal?: AbortSignal): Promise<SpeakerDirectorySeen> {
    const cursor = inputString(input.throughCursor, 4096)
    if (!cursor) throw new ArkmePluginError('speaker-directory-input-invalid', '缺少目录查看凭据', false)
    const { data } = await this.request('seen', { through_cursor: cursor }, signal)
    if (data.success === true) return { success: true, seenVersion: integer(data.seen_version) }
    if (data.state === 'disabled' || data.state === 'snapshot_expired') return { success: false, state: data.state, retryAfterMs: integer(data.retry_after_ms ?? 0) }
    throw invalid()
  }

  async open(input: Record<string, unknown>, signal?: AbortSignal): Promise<SpeakerDirectoryDetail> {
    const session = await this.runtime.requireSession()
    const [kind, iv, bytes, tag, ...extra] = inputString(input.detailRef, 16_384).split('.')
    let ref: Record<string, unknown>
    try {
      if (kind !== prefix || !iv || !bytes || !tag || extra.length) throw new Error('invalid reference')
      const decipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(iv, 'base64url'))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      ref = objectValue(JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes, 'base64url')), decipher.final()]).toString('utf8')))
    } catch { throw new ArkmePluginError('speaker-directory-detail-invalid', '人物引用已失效，请刷新目录', false, 400) }
    if (ref.userId !== session.userId || ref.environment !== this.runtime.config.environment) throw new ArkmePluginError('speaker-directory-account-mismatch', '人物引用与当前账号不匹配', false, 403)
    signal?.throwIfAborted()
    if (ref.type === 'candidate') return { type: 'candidate', candidateRef: await this.unmarked.directoryCandidateRef(str(ref.id), signal) }
    if (ref.type !== 'speaker') throw invalid()
    return { type: 'speaker', speakerRef: await this.recording.directorySpeakerRef(str(ref.id), session.userId),
      ...(ref.expectedVersion === undefined ? {} : { expectedVersion: str(ref.expectedVersion) }) }
  }

  private async key() { return createHash('sha256').update(await this.runtime.stateStore.uniqueCode()).update(`\0${prefix}`).digest() }
}
