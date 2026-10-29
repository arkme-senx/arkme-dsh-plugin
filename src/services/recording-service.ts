import { parseRecordingEvidence, validateRecordingEvidenceQuery, type RecordingEvidenceQuery, type RecordingEvidenceResult } from '../recording-evidence-contract.js'
import { RecordingStrategyService } from './recording-strategy-service.js'
import { recordingStrategy } from '../recording-strategy-contract.js'
import { recordingUploadedByViewer } from '../recording-coverage.js'
import { projectRecordingDailyMetrics } from '../recording-daily-metrics.js'
import { recordingPlaybackLocator, type RecordingPlaybackLocator } from '../recording-playback-ref.js'
import { RecordingReadOwner, type RecordingReadView, type RecordingDayReadCursor, type RecordingOwnerFragment, type RecordingOwnerDayPage } from './recording-read-owner.js'
import { createMessageCopyLink } from './message-copy-link-create.js'
import type { ArkmeRecordingWindow } from '../types.js'
import { recordingCreateRequestUID, sameRecordingImportBatch, recordingBatchOffset } from '../recording-import-identity.js'
import { validRecordingImportBatch, type RecordingImportBatch } from '../recording-workflow-contract.js'
import { parseRecordingHistory, type RecordingHistoryPage } from '../recording-history.js'
import { parseRecordingTotalMetrics } from '../recording-total-metrics.js'
import type { RecordingTotalsIndexPage } from '../recording-total-metrics.js'
import { projectRecordingTotalsBucket } from '../recording-total-projection.js'
import { parseRecordingPresence, type RecordingPresenceSnapshot } from '../recording-presence.js'
import { recordingSearchVersion, recordingSearchIdentityHash } from '../recording-search-version.js'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import {
  recordingImportCanonicalMimeType,
  sameRecordingImportIdentity,
  isUnresolvedRecordingImportJob,
  toPublicRecordingImportJob,
  type PublicRecordingImportJob,
  type PublicRecordingImportCurrentSnapshot,
  type PublicRecordingImportHistoryItem,
  type PublicRecordingImportHistoryPage,
  type PublicRecordingImportOwnerTask,
  type RecordingImportDisplayStatus,
  type RecordingImportJob,
  type RecordingImportOwnerProgress,
  type RecordingImportOwnerSession,
  type RecordingImportOwnerTaskSnapshot,
  type RecordingImportOwnerGateway,
  type RecordingImportSource,
  type RecordingDirectoryCandidate,
  type RecordingDirectorySnapshot,
} from '../recording-import-contract.js'
import { RecordingImportQueue } from '../recording-import-queue.js'
import { RecordingImportCoordinator, type RecordingImportGateway } from '../recording-import-coordinator.js'
import { openRecordingImportRef, sealRecordingImportRef } from '../recording-import-ref.js'
import { recordingImportFileNameKey } from '../recording-import-shared.js'
import {
  isRecordingInstantOnOrAfterUnixEpoch,
  isRecordingLocalDateOnOrAfterMinimum,
} from '../recording-time.js'
import {
  buildRecordingGenerationTranscript,
  projectRecordingSummaryModelConfig,
  projectRecordingVersions,
} from '../recording-presentation.js'
import { parseRecordingSpeakerEvidence, parseRecordingSpeakerConsistency } from '../recording-speaker-evidence.js'
import type {
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingComparison,
  ArkmeRecordingTranscriptSource,
  ArkmeRecordingTranscriptPage,
  ArkmeRecordingTranscriptPageOptions,
  ArkmeRecordingDay,
  ArkmeRecordingPlayback,
  ArkmeRecordingProjectionKind,
  ArkmeRecordingSection,
  ArkmeRecordingSummaryModelConfig,
  ArkmeRecordingSummaryModelRouteUpdate,
  ArkmeRecordingSpeakerMutationResult,
  ArkmeRecordingTranscriptSection,
  ArkmeRecordingTranscriptItem,
  ArkmeRecordingWorkbenchItem,
  ArkmeRecordingSpeakerCandidate,
  ArkmeRecordingSpeakerMembers,
  ArkmeRecordingSpeakerPresence,
  ArkmeRecordingSpeakerRecommendation,
  ArkmeRecordingSpeakerCorrectionContext,
  ArkmeRecordingSpeakerCorrectionInput,
  ArkmeRecordingSpeakerCorrectionUndoInput,
  ArkmeRecordingSpeakerCorrectionResult,
  ArkmeRecordingSpeakerCorrectionResultQuery,
  ArkmeRecordingVersion,
} from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import type { ArkmePublicProfile } from './profile-service.js'
import { RECORDING_FORWARD_MAX_SEGMENTS, type RecordingForwardGateway, type RecordingForwardInput } from '../recording-forward-contract.js'

export interface ArkmeRecordingProfileReader {
  publicProfileSummariesByUserIds(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    maxAgeMillis?: number,
    lane?: 'interactive-read' | 'background-read',
  ): Promise<Map<number, ArkmePublicProfile>>
  sealProfileImageRef(viewerUserId: number, targetUserId: number): Promise<string>
}

export interface ArkmeRecordingMediaIssuer {
  issueRecordingPlaybackMediaRef(input: { viewerUserId: number; locator: RecordingPlaybackLocator }, signal?: AbortSignal): Promise<string>
}

export interface ArkmeRecordingUserCandidateReader {
  listRecordingSpeakerUsers(
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<Array<{ userId: number; label: string; avatarRef?: string }>>
}

export interface RecordingServiceDependencies {
  recordingImportGateway: RecordingImportGateway
  recordingImportOwnerGateway: RecordingImportOwnerGateway
  recordingImportSource: RecordingImportSource
  profile?: ArkmeRecordingProfileReader
  media?: ArkmeRecordingMediaIssuer
  userCandidates?: ArkmeRecordingUserCandidateReader
  forwardGateway: RecordingForwardGateway
}

interface RecordingCorrectionItemRefPayload {
  speakerIdentity: string
  sourceSpeakerNumber: number
  assignmentSpeakerNumber: number
  formalSpeakerId: string
  childAsrItemStartAt: number
  childAsrItemEndAt: number

  speakerRevision?: string
  version: 1
  window?: ArkmeRecordingWindow
  viewerUserId: number
  dateStamp: number
  sessionId: string
  childId: string
  asrItemIndex: number
  transcriptSource: 'system' | 'doubao'
  startAtMillis: number
  endAtMillis: number
}
interface RecordingItemRefPayload extends RecordingCorrectionItemRefPayload {
  speakerReference: string
  revision: string
}
interface ArkmeRecordingPrivateTranscriptItem extends ArkmeRecordingTranscriptItem {
  speakerRevision?: string
  rawTranscriptText?: string
  sourceSpeakerNumber: number
  assignmentSpeakerNumber: number
  formalSpeakerId: string
  childAsrItemStartAt: number
  childAsrItemEndAt: number

  searchVersion?: string
  recordingBelongsToViewer?: boolean
  readView: RecordingReadView
  playbackLocator: RecordingPlaybackLocator
  speakerReference: string
  speakerIdentity: string
  generationText: string
  event: string
  textStartOffset: number
  textEndOffset: number
  textTotalLength: number
}

interface RecordingSpeakerRefPayload {
  version: 1
  viewerUserId: number
  target:
    | { kind: 'speaker'; speakerId: string }
    | { kind: 'arkme-user'; userId: number }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function positiveUserId(value: unknown): number | undefined {
  const numeric = numberValue(value)
  const userId = Math.trunc(numeric)
  return Number.isSafeInteger(userId) && userId > 0 ? userId : undefined
}

function speakerUserIds(speakerData: readonly unknown[]): number[] {
  return [...new Set(speakerData.flatMap(raw => {
    const speaker = objectValue(raw)
    const userId = positiveUserId(speaker.ref_usr_id ?? speaker.ref_user_id ?? speaker.user_id)
    return userId === undefined ? [] : [userId]
  }))]
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof ArkmePluginError) return error.message
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return '未知错误'
}

function recordingImportErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

const RECORDING_IMPORT_VISIBLE_LIMIT = 20
const RECORDING_IMPORT_UPLOAD_CONCURRENCY = 2
const RECORDING_IMPORT_HISTORY_MAX_PAGE_SIZE = 50
const RECORDING_IMPORT_SESSION_REF_PREFIX = 'arkme-recording-import-session-v1'
type ArkmeRecordingPrivateTranscriptSection = ArkmeRecordingTranscriptSection<ArkmeRecordingPrivateTranscriptItem>

interface RecordingImportSessionRefPayload {
  version: 1
  viewerUserId: number
  sessionId: string
}

function recordingImportOwnerStatus(
  task: RecordingImportOwnerTaskSnapshot,
): { status: RecordingImportDisplayStatus; statusDetail: string } {
  const owner = task.session
  const ownerProgress = task.progress
  if ((ownerProgress?.pausedCount ?? 0) > 0) {
    const completed = ownerProgress?.completedCount ?? 0
    return { status: completed > 0 ? 'partial' : 'paused', statusDetail: completed > 0
      ? `${completed} 个文件已完成，${ownerProgress!.pausedCount} 个文件因额度不足暂停`
      : '已保存到云端 · 转写已暂停，本月录音转写额度不足' }
  }
  if (ownerProgress?.serviceUnavailable) return { status: 'waiting', statusDetail: '服务暂时不可用，稍后自动重试' }
  if (!owner.hasFinishedUpload) return { status: 'uploading', statusDetail: '上传中' }
  if (task.processingCompleted) {
    if (ownerProgress?.displayStatus === 'partial') return { status: 'partial', statusDetail: '部分完成' }
    if (ownerProgress?.displayStatus === 'failed') return { status: 'failed', statusDetail: '处理失败' }
    if (ownerProgress?.displayStatus === 'completed') return { status: 'completed', statusDetail: '导入完成' }
    return { status: 'completed', statusDetail: '已完成' }
  }
  if (['completed', 'partial', 'failed'].includes(ownerProgress?.displayStatus ?? '')) {
    return { status: 'processing', statusDetail: '处理中' }
  }
  switch (ownerProgress?.displayStatus) {
    case 'speaker-waiting': return { status: 'speaker-waiting', statusDetail: '等待识别说话人' }
    case 'speaker-recognizing': return { status: 'speaker-recognizing', statusDetail: '说话人识别中' }
    case 'transcript-waiting': return { status: 'transcript-waiting', statusDetail: '等待转写' }
    case 'transcribing': return { status: 'transcribing', statusDetail: '转写中' }
    case 'unavailable': return { status: 'unavailable', statusDetail: '状态不可用' }
    default: return { status: 'waiting', statusDetail: '等待中' }
  }
}

export class RecordingService {
  private readonly readOwner: RecordingReadOwner
  private readonly recordingImports: RecordingImportCoordinator
  private readonly importRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly importRetryAttempts = new Map<string, number>()
  private readonly importCommands = new Set<string>()
  private readonly importQueue = new RecordingImportQueue(RECORDING_IMPORT_UPLOAD_CONCURRENCY)
  private importDisposed = false
  private readonly importRuns = new Map<string, {
    controller: AbortController
    promise: Promise<void>
    startedRevision: number
  }>()
  private readonly profile: ArkmeRecordingProfileReader | undefined
  private readonly media: ArkmeRecordingMediaIssuer | undefined
  private readonly userCandidates: ArkmeRecordingUserCandidateReader | undefined
  private readonly recordingImportSource: RecordingImportSource
  private readonly recordingImportOwnerGateway: RecordingImportOwnerGateway
  private speakerCacheRevision = 0
  private readonly unsubscribeSpeakerAccount: () => void
  private readonly forwardGateway: RecordingForwardGateway

  constructor(
    private readonly runtime: ServiceRuntime,
    dependencies: RecordingServiceDependencies,
  ) {
    this.readOwner = new RecordingReadOwner(runtime)
    this.unsubscribeSpeakerAccount = runtime.subscribeAccountScope(() => {
      this.speakerCacheRevision++
      for (const run of this.importRuns.values()) run.controller.abort()
      for (const timer of this.importRetryTimers.values()) clearTimeout(timer)
      this.importRetryTimers.clear()
    })
    this.profile = dependencies.profile
    this.media = dependencies.media
    this.userCandidates = dependencies.userCandidates
    this.forwardGateway = dependencies.forwardGateway
    this.recordingImportSource = dependencies.recordingImportSource
    this.recordingImportOwnerGateway = dependencies.recordingImportOwnerGateway
    this.recordingImports = new RecordingImportCoordinator(
      runtime.stateStore,
      dependencies.recordingImportGateway,
      dependencies.recordingImportSource,
      async () => (await runtime.requireSession()).userId,
    )
  }

  dispose(): void {
    this.importDisposed = true
    this.speakerCacheRevision++
    this.unsubscribeSpeakerAccount()
    for (const timer of this.importRetryTimers.values()) clearTimeout(timer)
    this.importRetryTimers.clear()
    for (const run of this.importRuns.values()) run.controller.abort()
  }

  async recordingForwardCapabilities(signal?: AbortSignal): Promise<{ recordTargetsSupported: boolean }> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    return { recordTargetsSupported: await this.forwardGateway.supportsRecordTargets(session, signal) }
  }

  async forwardRecording(input: RecordingForwardInput, signal?: AbortSignal) {
    this.assertWorkbenchEnabled()
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if ((input.commentText?.trim().length ?? 0) > this.runtime.config.maxTextLength
      || (input.commentText?.trim() && (!uuid.test(input.commentRecordUid ?? '') || input.commentRecordUid === input.recordUid))) {
      throw new ArkmePluginError('recording-forward-input-invalid', '录音附言过长或参数无效', false, 400)
    }
    if (!uuid.test(input.requestId) || !uuid.test(input.recordUid) || !Number.isSafeInteger(input.sendAtMillis) || input.sendAtMillis <= 0 || input.targetSourceRef.trim() === '') {
      throw new ArkmePluginError('recording-forward-input-invalid', '录音转发参数无效', false, 400)
    }
    const { selection, session } = await this.recordingCommandSelection(input.itemRefs)
    return await this.forwardGateway.forward(selection, input, session, signal)
  }

  async copyRecordingLink(itemRefs: readonly string[], signal?: AbortSignal) {
    this.assertWorkbenchEnabled()
    const { selection, session } = await this.recordingCommandSelection(itemRefs)
    const result = await createMessageCopyLink(this.runtime, [{
      kind: 'audio_session', session_id: selection.sessionId,
      selection: { kind: 'long_recording_segments', segments: selection.segments.map(item => ({
        child_id: item.childId, asr_item_index: item.asrItemIndex, transcript_source: item.transcriptSource,
      })) },
    }], session, signal)
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('recording-share-account-changed', '账号已切换，请重新选择录音', false, 409)
    return result
  }

  private async recordingCommandSelection(itemRefs: readonly string[]) {
    if (itemRefs.length === 0 || itemRefs.length > RECORDING_FORWARD_MAX_SEGMENTS) throw new ArkmePluginError('recording-forward-selection-invalid', '请选择 1 至 150 个录音片段', false, 400)
    const session = await this.runtime.requireSession()
    const selected = await Promise.all(itemRefs.map(async ref => await this.openRecordingItemRef(ref)))
    const first = selected[0]!
    if (selected.some(item => item.viewerUserId !== session.userId || item.sessionId !== first.sessionId || item.dateStamp !== first.dateStamp || item.transcriptSource !== first.transcriptSource)) {
      throw new ArkmePluginError('recording-forward-selection-invalid', '请选择同一次录音、同一转写来源的片段', false, 400)
    }
    const seen = new Set<string>()
    for (const item of selected) {
      const identity = `${item.childId}:${String(item.asrItemIndex)}`
      if (seen.has(identity)) throw new ArkmePluginError('recording-forward-selection-invalid', '请勿重复选择同一录音片段', false, 400)
      seen.add(identity)
    }
    // The destination owner validates the current source after checking idempotent replay.
    // Re-reading Audio here would prevent confirming an already accepted send after source deletion.
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('recording-forward-account-changed', '账号已切换，请重新选择录音', false, 409)
    selected.sort((left, right) => left.startAtMillis - right.startAtMillis || left.childId.localeCompare(right.childId) || left.asrItemIndex - right.asrItemIndex)
    return { session, selection: { sessionId: first.sessionId, segments: selected.map(item => ({ childId: item.childId, asrItemIndex: item.asrItemIndex, transcriptSource: item.transcriptSource })) } }
  }

  async recordingStrategies(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    this.assertWorkbenchEnabled()
    if (input.action === 'recordings') {
      const start = input.startAtMillis, end = input.endAtMillis
      if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 || typeof end !== 'number'
        || !Number.isSafeInteger(end) || end <= start || end - start > 27 * 3600_000) {
        throw new ArkmePluginError('recording-strategy-invalid', '请选择一个录音日期', false, 400)
      }
      const session = await this.runtime.requireSession(), prefix = 'arkme-recording-choices-v1'
      let cursor = ''
      if (input.cursor !== undefined) {
        if (typeof input.cursor !== 'string') throw new ArkmePluginError('recording-cursor-invalid', '录音分页引用无效', false, 400)
        const previous = await this.openRecordingRef(prefix, input.cursor)
        if (previous.start !== start || previous.end !== end || typeof previous.cursor !== 'string') throw new ArkmePluginError('recording-cursor-invalid', '录音日期已变化，请刷新重试', false, 409)
        cursor = previous.cursor
      }
      const page = await this.readOwner.recordingChoices({ startAt: start, endAt: end }, session, cursor, signal)
      const items = await Promise.all(page.items.map(async row => ({
        sessionRef: await this.recordingImportSessionRef({ sessionId: row.id }, session.userId),
        startAtMillis: row.startAtMillis, endAtMillis: row.endAtMillis,
      })))
      await this.ensureRecordingSession(session, signal)
      return { items, ...(page.nextCursor ? { nextCursor: this.sealRecordingRefWithKey(prefix,
        { version: 1, viewerUserId: session.userId, start, end, cursor: page.nextCursor }, await this.recordingRefKey(prefix)) } : {}) }
    }
    if (input.action === 'sources' && typeof input.importRef === 'string') {
      if (input.sessionRef !== undefined) throw new ArkmePluginError('recording-strategy-invalid', '请提供一个录音引用', false, 400)
      const { userId, jobId } = await this.openRecordingImportRef(input.importRef)
      const job = await this.runtime.stateStore.getRecordingImportJob(userId, jobId)
      if (!job?.sessionId) throw new ArkmePluginError('recording-strategy-pending', '录音尚未上传完成', true, 409)
      input = { ...input, sessionRef: await this.recordingImportSessionRef({ sessionId: job.sessionId }, userId) }
    }
    const prefix = 'arkme-recording-strategy-v1'
    return new RecordingStrategyService(this.runtime, {
      openSession: ref => this.openRecordingImportSessionRef(ref),
      open: ref => this.openRecordingRef(prefix, ref),
      seal: async payload => this.sealRecordingRefWithKey(prefix, payload, await this.recordingRefKey(prefix)),
      playback: async (viewerUserId, locator, signal) => {
        if (!this.media) throw new ArkmePluginError('recording-playback-unavailable', '录音播放当前不可用', true, 503)
        return this.media.issueRecordingPlaybackMediaRef({ viewerUserId, locator }, signal)
      },
    }).request(input, signal)
  }

  async recordingPlayback(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingPlayback> {
    this.assertWorkbenchEnabled()
    if (this.media === undefined) throw new ArkmePluginError('recording-playback-unavailable', '录音播放当前不可用', true, 503)
    const session = await this.runtime.requireSession()
    const payload = await this.openRecordingCorrectionItemRef(itemRef)
    await this.ensureRecordingSession(session, signal)
    const playbackRef = await this.media.issueRecordingPlaybackMediaRef({
      viewerUserId: payload.viewerUserId, locator: this.itemLocator(payload),
    }, signal)
    await this.ensureRecordingSession(session, signal)
    return {
      playbackRef,
      mimeType: 'application/octet-stream',
      startOffsetMillis: 0,
      endOffsetMillis: Math.max(0, payload.endAtMillis - payload.startAtMillis),
    }
  }

  private async speakerCacheScope(): Promise<string> {
    const key = await this.recordingRefKey('arkme-recording-speaker-v1')
    return `${this.runtime.config.environment}:${createHash('sha256').update(key).digest('hex')}`
  }

  private async assertSpeakerReadCurrent(session: ArkmeSessionCredentials, revision: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (current.userId !== session.userId || current.refreshToken !== session.refreshToken || revision !== this.speakerCacheRevision) {
      throw new ArkmePluginError('recording-speaker-context-changed', '说话人目录已变化，请重新读取', true, 409)
    }
    signal?.throwIfAborted()
  }

  async cachedRecordingSpeakerOptions(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCandidate[] | null> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    const scope = await this.speakerCacheScope()
    let candidates: ArkmeRecordingSpeakerCandidate[] | undefined
    try { candidates = await this.runtime.stateStore.readRecordingSpeakerCache?.(scope, session.userId) }
    catch { /* A derived cache failure must fall through to the owner read. */ }
    await this.assertSpeakerReadCurrent(session, revision, signal)
    return candidates ?? null
  }

  private async invalidateSpeakerCache(userId: number): Promise<void> {
    this.speakerCacheRevision++
    try { await this.runtime.stateStore.clearRecordingSpeakerCache?.(await this.speakerCacheScope(), userId) }
    catch { /* Cache maintenance cannot change a business command outcome. */ }
  }

  async recordingSpeakerOptions(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCandidate[]> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-speaker-ls', {}, session, signal,
    )
    const rows = listValue(data.spk_ls)

    const userIds = speakerUserIds(rows)
    let complete = true
    const [profiles, candidateUsers] = await Promise.all([
      this.recordingSpeakerProfiles(userIds, session, signal),
      this.userCandidates?.listRecordingSpeakerUsers(session, signal).catch(() => { complete = false; return [] }) ?? [],
    ])
    const speakerRefKey = await this.recordingRefKey('arkme-recording-speaker-v1')
    const identities = new Set<string>()
    const speakerOptions = rows.flatMap(raw => {
      const speaker = objectValue(raw)
      const speakerId = stringValue(speaker.speaker_id ?? speaker.id ?? speaker.spk_id).trim()
      if (speakerId === '') return []
      const reference = stringValue(speaker.reference).trim()
      if (reference === '') throw new ArkmePluginError('recording-speaker-directory-invalid', '说话人目录缺少身份，请重试', true, 502)
      const userId = positiveUserId(speaker.ref_usr_id ?? speaker.ref_user_id ?? speaker.user_id)
      const profile = userId === undefined ? undefined : profiles.get(userId)
      const label = stringValue(speaker.nick_name ?? speaker.nickname ?? speaker.display_name ?? speaker.name).trim()
        || profile?.displayName || '未命名说话人'
      return [{ speakerId, reference, label, avatarRef: profile?.avatarRef, userId }]
    }).sort((left, right) => left.speakerId.localeCompare(right.speakerId)).filter(item => {
      // Multiple registry rows linked to the same user describe one identity.
      // Keep a stable assignment target without exposing internal IDs to UI.
      if (identities.has(item.reference)) return false
      identities.add(item.reference)
      return true
    }).map((item): ArkmeRecordingSpeakerCandidate => ({
      optionKey: this.recordingSpeakerOptionKey(speakerRefKey, session.userId, 'speaker', item.reference),

      personKey: item.userId === undefined
        ? this.recordingSpeakerOptionKey(speakerRefKey, session.userId, 'speaker', item.reference)
        : this.recordingSpeakerOptionKey(speakerRefKey, session.userId, 'arkme-user', item.userId),
      speakerRef: this.sealRecordingRefWithKey('arkme-recording-speaker-v1', {
        version: 1, viewerUserId: session.userId,
        target: { kind: 'speaker', speakerId: item.speakerId },
      }, speakerRefKey),
      label: item.label,
      ...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef }),
      kind: 'speaker',

      isCurrentUser: item.userId === session.userId,
    }))
    const representedUserIds = new Set(rows.flatMap(raw => {
      const speaker = objectValue(raw)
      const userId = positiveUserId(speaker.ref_usr_id ?? speaker.ref_user_id ?? speaker.user_id)
      return userId === undefined ? [] : [userId]
    }))
    const userOptions = candidateUsers.filter(candidate => !representedUserIds.has(candidate.userId)).map(
      (candidate): ArkmeRecordingSpeakerCandidate => ({
        optionKey: this.recordingSpeakerOptionKey(speakerRefKey, session.userId, 'arkme-user', candidate.userId),
        speakerRef: this.sealRecordingRefWithKey('arkme-recording-speaker-v1', {
          version: 1,
          viewerUserId: session.userId,
          target: { kind: 'arkme-user', userId: candidate.userId },
        }, speakerRefKey),
        label: candidate.label,
        ...(candidate.avatarRef === undefined ? {} : { avatarRef: candidate.avatarRef }),
        kind: 'arkme-user',
        isCurrentUser: candidate.userId === session.userId,
      }),
    )
    const candidates = [...speakerOptions, ...userOptions]
    const scope = await this.speakerCacheScope()
    await this.assertSpeakerReadCurrent(session, revision, signal)
    try { if (complete) await this.runtime.stateStore.writeRecordingSpeakerCache?.(scope, session.userId, candidates) }
    catch { /* The fresh owner result remains usable when local storage is unavailable. */ }
    await this.assertSpeakerReadCurrent(session, revision, signal)
    return candidates
  }

  async recordingSpeakerPresence(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerPresence> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/speaker-presence/list', {}, session, signal,
    )
    const rawState = stringValue(data.state)
    if (rawState !== 'building' && rawState !== 'fresh' && rawState !== 'stale' && rawState !== 'failed') {
      throw new ArkmePluginError('recording-speaker-presence-invalid', '说话人出现统计响应无效', true, 502)
    }
    if (!Array.isArray(data.items) || (rawState === 'fresh' && stringValue(data.version) === '')) {
      throw new ArkmePluginError('recording-speaker-presence-invalid', '说话人出现统计响应无效', true, 502)
    }
    const speakerRefKey = await this.recordingRefKey('arkme-recording-speaker-v1')
    const directory = await this.runtime.authenticatedAudioPost<Record<string, unknown>>('/api/v1/audio/get-speaker-ls', {}, session, signal)
    const references = new Map(listValue(directory.spk_ls).map(raw => { const row = objectValue(raw); return [stringValue(row.speaker_id ?? row.id ?? row.spk_id), stringValue(row.reference)] }))
    const items = listValue(data.items).flatMap(raw => {
      const item = objectValue(raw)
      const speakerId = stringValue(item.speaker_id).trim()
      const dayCount = numberValue(item.day_count)
      const lastSeenAt = numberValue(item.last_seen_at)
      if (speakerId === '' || !Number.isSafeInteger(dayCount) || dayCount <= 0 || !Number.isSafeInteger(lastSeenAt) || lastSeenAt <= 0) {
        throw new ArkmePluginError('recording-speaker-presence-invalid', '说话人出现统计响应无效', true, 502)
      }
      const reference = references.get(speakerId)
      if (!reference) throw new ArkmePluginError('recording-speaker-presence-invalid', '说话人目录已变化，请重试', true, 502)
      return [{ optionKey: this.recordingSpeakerOptionKey(speakerRefKey, session.userId, 'speaker', reference), dayCount, lastSeenAt }]
    })
    await this.assertSpeakerReadCurrent(session, revision, signal)
    return {
      state: rawState,
      scope: 'all-history',
      items: rawState === 'fresh' ? items : [],
      ...(stringValue(data.version) === '' ? {} : { version: stringValue(data.version) }),
      ...(numberValue(data.updated_at) > 0 ? { updatedAt: numberValue(data.updated_at) } : {}),
      ...(numberValue(data.retry_after_ms) > 0 ? { retryAfterMs: numberValue(data.retry_after_ms) } : {}),
    }
  }

  /** Called only for an authenticated, Host-verified directory detail_ref. */
  async directorySpeakerRef(speakerId: string, viewerUserId: number): Promise<string> {
    return this.sealRecordingRefWithKey('arkme-recording-speaker-v1', {
      version: 1, viewerUserId, target: { kind: 'speaker', speakerId },
    }, await this.recordingRefKey('arkme-recording-speaker-v1'))
  }
  /** Host verified contact candidate; assignment revalidates it against the current contact owner. */
  async directoryUserSpeakerRef(userId: number, viewerUserId: number): Promise<string> {
    return this.sealRecordingRefWithKey('arkme-recording-speaker-v1', {
      version: 1, viewerUserId, target: { kind: 'arkme-user', userId },
    }, await this.recordingRefKey('arkme-recording-speaker-v1'))
  }

  /** Enrich only verified directory speakers; do not load contact suggestions or presence stats. */
  async directorySpeakerAvatars(speakerIds: readonly string[], viewerUserId: number, signal?: AbortSignal): Promise<Map<string, string>> {
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    if (session.userId !== viewerUserId) throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换', false, 403)
    if (speakerIds.length === 0) return new Map()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-speaker-ls', {}, session, signal,
      { lane: 'background-read', key: 'directory-speaker-avatars', cacheMs: 10_000 },
    )
    if (!Array.isArray(data.spk_ls)) throw new ArkmePluginError('recording-speaker-contract-invalid', '说话人资料响应无效', true, 502)
    const wanted = new Set(speakerIds)
    const bindings = new Map<string, number>()
    for (const value of data.spk_ls) {
      const raw = objectValue(value)
      const id = stringValue(raw.speaker_id ?? raw.id ?? raw.spk_id).trim()
      const userId = positiveUserId(raw.ref_usr_id ?? raw.ref_user_id ?? raw.user_id)
      if (wanted.has(id) && userId !== undefined) bindings.set(id, userId)
    }
    const profiles = await this.recordingSpeakerProfiles([...new Set(bindings.values())], session, signal, true)
    await this.assertSpeakerReadCurrent(session, revision, signal)
    const result = new Map<string, string>()
    for (const [id, userId] of bindings) {
      const avatar = profiles.get(userId)?.avatarRef
      if (avatar) result.set(id, avatar)
    }
    return result
  }

  /** All-history source identities, authorized by the same account-bound speaker reference as the UI. */
  async recordingSpeakerMembers(speakerRef: string, signal?: AbortSignal, expectedVersion?: string): Promise<ArkmeRecordingSpeakerMembers> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    const reference = await this.openRecordingSpeakerRef(speakerRef)
    if (reference.viewerUserId !== session.userId || reference.target.kind !== 'speaker') {
      throw new ArkmePluginError('recording-speaker-ref-account-mismatch', '说话人引用与当前账号不匹配', false, 403)
    }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/speaker-presence/detail', {
        speaker_id: reference.target.speakerId,
        ...(expectedVersion === undefined ? {} : { expected_version: expectedVersion }),
      }, session, signal,
    )
    const state = stringValue(data.state)
    if (!['building', 'fresh', 'stale', 'failed'].includes(state)) {
      throw new ArkmePluginError('recording-speaker-presence-invalid', '说话人出现统计响应无效', true, 502)
    }
    if (state === 'fresh' && (stringValue(data.version) === '' || !Array.isArray(data.items) || (data.members !== undefined && !Array.isArray(data.members)))) {
      throw new ArkmePluginError('recording-speaker-presence-invalid', '说话人出现统计响应无效', true, 502)
    }
    const key = await this.recordingRefKey('arkme-recording-speaker-v1')
    const targetSpeakerId = reference.target.speakerId
    const stat = listValue(data.items).map(objectValue).find(item => item.speaker_id === targetSpeakerId)
    if (state === 'fresh' && stat !== undefined && (!Number.isSafeInteger(stat.day_count) || numberValue(stat.day_count) <= 0 || !Number.isSafeInteger(stat.last_seen_at) || numberValue(stat.last_seen_at) <= 0)) {
      throw new ArkmePluginError('recording-speaker-presence-invalid', '说话人出现统计响应无效', true, 502)
    }
    const items = state !== 'fresh' ? [] : listValue(data.members).map(raw => {
      const item = objectValue(raw)
      const identity = stringValue(item.identity_key)
      const token = stringValue(item.token)
      const dayCount = numberValue(item.day_count)
      const lastSeenAt = numberValue(item.last_seen_at)
      if (stat === undefined || dayCount > numberValue(stat.day_count) || lastSeenAt > numberValue(stat.last_seen_at) || identity === '' || token === '' || !Number.isSafeInteger(dayCount) || dayCount <= 0 || !Number.isSafeInteger(lastSeenAt) || lastSeenAt <= 0) {
        throw new ArkmePluginError('recording-speaker-members-invalid', '关联说话人响应无效', true, 502)
      }
      return { identityKey: this.recordingSpeakerOptionKey(key, session.userId, 'speaker', `presence:${identity}`), token, dayCount, lastSeenAt }
    })
    await this.assertSpeakerReadCurrent(session, revision, signal)
    return {
      state: state as ArkmeRecordingSpeakerMembers['state'], scope: 'all-history',
      dayCount: state === 'fresh' ? numberValue(stat?.day_count) : 0,
      lastSeenAt: state === 'fresh' ? numberValue(stat?.last_seen_at) : 0,
      items,
      ...(stringValue(data.version) === '' ? {} : { version: stringValue(data.version) }),
      ...(numberValue(data.retry_after_ms) > 0 ? { retryAfterMs: numberValue(data.retry_after_ms) } : {}),
    }
  }

  async recordingSpeakerRecommendation(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerRecommendation> {
    this.assertWorkbenchEnabled()
    const item = await this.openRecordingItemRef(itemRef)
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    if (session.userId !== item.viewerUserId) {
      throw new ArkmePluginError('recording-ref-account-mismatch', '录音引用与当前账号不匹配', false, 403)
    }
    // A detached interval has no independent verified embedding yet. Its former
    // acoustic track cannot supply a recommendation for this new identity.
    const groupItemCount = (await this.currentRecordingSpeakerItems(item, session, signal)).filter(candidate => this.sameRecordingSpeakerMutationTarget(candidate, item)).length
    if (item.speakerIdentity.startsWith('partition:')) return { groupItemCount }
    const similar = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/recordings/transcript/speaker/suggestion',
      { ...this.itemView(item), speaker_reference: item.speakerReference, clip_locator: this.itemLocator(item) }, session, signal,
    )
    const reference = stringValue(similar.speaker_reference).trim()
    const key = await this.recordingRefKey('arkme-recording-speaker-v1')
    await this.assertSpeakerReadCurrent(session, revision, signal)
    if (reference === '') return { groupItemCount }
    return { groupItemCount, optionKey: this.recordingSpeakerOptionKey(
      key, session.userId, 'speaker', reference,
    ) }
  }

  /** Group summaries are computed over the server's complete daily membership, never this UI page. */
  async recordingSpeakerConsistency(input: import('../types.js').ArkmeRecordingSpeakerConsistencyInput, signal?: AbortSignal): Promise<import('../types.js').ArkmeRecordingSpeakerConsistency> {
    this.assertWorkbenchEnabled()
    if ([input.anchorRefs, input.itemRefs].some(list => !Array.isArray(list) || list.some(ref => typeof ref !== 'string' || !ref) || new Set(list).size !== list.length)
      || input.anchorRefs.length < 1 || input.anchorRefs.length > 100 || input.itemRefs.length > 50 || (input.itemRefs.length > 0 && input.anchorRefs.length !== 1)) {
      throw new ArkmePluginError('recording-consistency-invalid', '一致性查询范围无效', false)
    }
    const session = await this.runtime.requireSession(), revision = this.speakerCacheRevision
    const refs = await Promise.all([...input.anchorRefs, ...input.itemRefs].map(ref => this.openRecordingItemRef(ref)))
    const anchor = refs[0]!
    if (refs.some(item => item.viewerUserId !== session.userId || item.dateStamp !== anchor.dateStamp || item.transcriptSource !== anchor.transcriptSource)) {
      throw new ArkmePluginError('recording-consistency-scope', '请在同一账号、日期和转写版本内核对一致性', false, 409)
    }
    let raw: unknown
    try {
      raw = await this.runtime.authenticatedAudioPost('/api/v1/audio/speaker-evidence/consistency', {
        schema_version: 1, date_stamp: anchor.dateStamp,
        groups: refs.slice(0, input.anchorRefs.length).map((ref, client_index) => ({ client_index, ...this.correctionLocator(ref) })),
        items: refs.slice(input.anchorRefs.length).map((ref, client_index) => ({ client_index, ...this.correctionLocator(ref) })),
      }, session, signal, { bypassCache: true, lane: 'interactive-read' })
    } catch (error) {
      await this.assertSpeakerReadCurrent(session, revision, signal)
      if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return { supported: false }
      throw error
    }
    await this.assertSpeakerReadCurrent(session, revision, signal)
    try { return parseRecordingSpeakerConsistency(raw, input) }
    catch { throw new ArkmePluginError('recording-consistency-contract-invalid', '一致性证据格式不完整，暂不能用于判断', true, 502) }
  }

  /** Proposed read-only API. Never fall back to a session aggregate for an interval score. */
  async recordingSpeakerEvidence(input: import('../types.js').ArkmeRecordingSpeakerEvidenceInput, signal?: AbortSignal): Promise<import('../types.js').ArkmeRecordingSpeakerEvidence> {
    this.assertWorkbenchEnabled()
    const lists = [input.itemRefs, input.referenceA, input.referenceB]
    if (lists.some(list => !Array.isArray(list) || list.some(ref => typeof ref !== 'string' || !ref) || new Set(list).size !== list.length)
      || input.itemRefs.length < 1 || input.itemRefs.length > 50 || input.referenceA.length < 1 || input.referenceA.length > 3
      || input.referenceB.length > 3 || input.referenceA.some(ref => input.referenceB.includes(ref))) {
      throw new ArkmePluginError('recording-evidence-invalid', '请选择不同的甲乙参照，每组最多 3 段，每次最多对比 50 段', false)
    }
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    const all = await Promise.all(lists.flat().map(ref => this.openRecordingItemRef(ref)))
    const anchor = all[0]!
    if (all.some(item => item.viewerUserId !== session.userId || item.dateStamp !== anchor.dateStamp || item.transcriptSource !== anchor.transcriptSource)) {
      throw new ArkmePluginError('recording-evidence-scope', '请在同一账号、日期和转写版本内对比声音', false, 409)
    }
    const rows = all.slice(0, input.itemRefs.length)
    const a = all.slice(input.itemRefs.length, input.itemRefs.length + input.referenceA.length)
    const b = all.slice(input.itemRefs.length + input.referenceA.length)
    let raw: unknown
    try {
      raw = await this.runtime.authenticatedAudioPost('/api/v1/audio/speaker-evidence/compare', {
        schema_version: 1, date_stamp: anchor.dateStamp,
        items: rows.map((item, client_index) => ({ client_index, ...this.correctionLocator(item) })),
        reference_a: a.map(item => this.correctionLocator(item)), reference_b: b.map(item => this.correctionLocator(item)),
      }, session, signal, { bypassCache: true, lane: 'interactive-read' })
    } catch (error) {
      await this.assertSpeakerReadCurrent(session, revision, signal)
      if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return { supported: false }
      throw error
    }
    await this.assertSpeakerReadCurrent(session, revision, signal)
    try { return parseRecordingSpeakerEvidence(raw, input) }
    catch { throw new ArkmePluginError('recording-evidence-contract-invalid', '声纹证据格式不完整，暂不能用于判断', true, 502) }
  }

  /** Explicit time selection creates opaque references; no inferred acoustic membership. */
  async recordingSpeakerCorrectionItems(query: { dateStamp: number; atMillis: number; transcriptSource: 'system' | 'doubao' }, signal?: AbortSignal): Promise<{ items: ArkmeRecordingWorkbenchItem[] }> {
    if (!Number.isSafeInteger(query.dateStamp) || !Number.isSafeInteger(query.atMillis) || !['system', 'doubao'].includes(query.transcriptSource)) {
      throw new ArkmePluginError('recording-correction-invalid', '请提供明确日期、时间和转写来源', false, 400)
    }
    const end = new Date(query.dateStamp); end.setDate(end.getDate() + 1)
    if (query.atMillis < query.dateStamp || query.atMillis >= end.getTime()) throw new ArkmePluginError('recording-correction-invalid', '片段时间不属于所选日期', false, 400)
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const window = { startAt: Math.max(query.dateStamp, query.atMillis - 600_000), endAt: Math.min(end.getTime(), query.atMillis + 600_001) }
    const page = await this.readOwner.completeDay(window, query.transcriptSource === 'system' ? 'primary' : 'enhanced', session, signal)
    const transcript = await this.projectWorkbenchPage(query.dateStamp, query.transcriptSource, page, session, signal)
    if (transcript.state === 'error') throw new ArkmePluginError('recording-correction-read-failed', '附近片段读取失败', true, 502)
    return { items: transcript.items.filter(item => Math.abs(item.startAtMillis - query.atMillis) <= 600_000).toSorted((a,b) => Math.abs(a.startAtMillis - query.atMillis) - Math.abs(b.startAtMillis - query.atMillis)).slice(0,100).toSorted((a,b) => a.startAtMillis - b.startAtMillis) }
  }

  /** Proposed v1 owner API. An absent route is explicitly unavailable, never a local-only correction. */
  async recordingSpeakerCorrectionContext(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionContext> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession(), revision = this.speakerCacheRevision
    const item = await this.openRecordingCorrectionItemRef(itemRef)
    if (item.viewerUserId !== session.userId) throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换', false, 403)
    await this.assertSpeakerReadCurrent(session, revision, signal)
    let raw: Record<string, unknown>
    try {
      raw = objectValue(await this.runtime.authenticatedAudioPost('/api/v1/audio/speaker-corrections/context',
        { item: this.correctionLocator(item), date_stamp: item.dateStamp }, session, signal, { bypassCache: true, lane: 'interactive-read' }))
    } catch (error) {
      await this.assertSpeakerReadCurrent(session, revision, signal)
      if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return { supported: false }
      throw error
    }
    await this.assertSpeakerReadCurrent(session, revision, signal)
    if (raw.supported === false) return { supported: false }
    if (raw.supported !== true || raw.schema_version !== 1 || !stringValue(raw.version).trim()
      || !Number.isInteger(raw.max_items) || Number(raw.max_items) < 1 || Number(raw.max_items) > 100
      || !['unknown', 'in_person', 'playback'].includes(String(raw.sound_source)) || !Array.isArray(raw.excluded_speakers)) {
      throw new ArkmePluginError('recording-correction-contract-invalid', '纠错信息暂不可用，请稍后重试', true, 502)
    }
    const key = await this.recordingRefKey('arkme-recording-speaker-v1')
    // Correction facts use database IDs; the refactored directory owns canonical identities.
    const directory = raw.excluded_speakers.length === 0 ? {} : await this.runtime.authenticatedAudioPost<Record<string, unknown>>('/api/v1/audio/get-speaker-ls', {}, session, signal)
    const references = new Map(listValue(directory.spk_ls).map(value => {
      const person = objectValue(value)
      return [stringValue(person.speaker_id ?? person.id ?? person.spk_id), stringValue(person.reference)]
    }))
    const excludedSpeakers = raw.excluded_speakers.map(value => {
      const person = objectValue(value), reference = references.get(stringValue(person.speaker_id))
      if (!stringValue(person.speaker_id).trim() || !stringValue(person.label).trim()) throw new ArkmePluginError('recording-correction-contract-invalid', '纠错人物信息无效', true, 502)
      return { optionKey: reference ? this.recordingSpeakerOptionKey(key, session.userId, 'speaker', reference) : '', label: stringValue(person.label) }
    })
    const last = objectValue(raw.last_correction)
    const undoRef = last.can_undo === true && stringValue(last.id) ? await this.sealCorrectionUndo(item, String(last.id)) : undefined
    await this.assertSpeakerReadCurrent(session, revision, signal)
    return { supported: true, version: String(raw.version), maxItems: Number(raw.max_items),
      soundSource: raw.sound_source as 'unknown' | 'in_person' | 'playback', excludedSpeakers,
      ...(undoRef ? { undoRef } : {}) }
  }

  /** Read and explicit computation share opaque account/day-bound references. */
  async recordingSpeakerEvidenceQuery(query: RecordingEvidenceQuery, signal?: AbortSignal): Promise<RecordingEvidenceResult> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession(), revision = this.speakerCacheRevision
    try { validateRecordingEvidenceQuery(query) }
    catch (cause) { throw new ArkmePluginError('recording-evidence-invalid', '证据查询范围无效', false, 400, { cause }) }
    const lists = [query.groupRefs ?? [], query.itemRefs ?? [], query.referenceA ?? [], query.referenceB ?? []]
    const refs = [...new Set(lists.flat())]
    if (query.action !== 'capabilities' && refs.length === 0) throw new ArkmePluginError('recording-evidence-invalid', '请选择证据片段', false, 400)
    const opened = await Promise.all(refs.map(async ref => [ref, await this.openRecordingCorrectionItemRef(ref)] as const))
    const byRef = new Map(opened), primary = opened[0]?.[1]
    for (const [, item] of opened) {
      if (item.viewerUserId !== session.userId || item.dateStamp !== primary!.dateStamp || item.transcriptSource !== primary!.transcriptSource || JSON.stringify(item.window) !== JSON.stringify(primary!.window)) throw new ArkmePluginError('recording-evidence-scope-invalid', '片段必须属于当前账号的同日同转写来源', false, 403)
      if (!item.speakerRevision) throw new ArkmePluginError('recording-evidence-refresh-required', '请刷新后重新选择片段', false, 409)
    }
    const selections = this.correctionSelections(query.selections, byRef)
    const locate = (ref: string) => ({ ...this.correctionLocator(byRef.get(ref)!), ...(selections.has(ref) ? { selection: selections.get(ref) } : {}) })
    const coordinates = lists.map(list => list.map(ref => {
      const loc = locate(ref), span = loc.selection ?? loc
      return `${loc.session_id}:${loc.child_id}:${loc.transcript_source}:${loc.item_index}:${span.start_at}:${span.end_at}`
    }))
    if (coordinates.some(list => new Set(list).size !== list.length) || coordinates[2]!.some(key => coordinates[3]!.includes(key))) {
      throw new ArkmePluginError('recording-evidence-invalid', '证据片段或甲乙参照重复', false, 400)
    }
    const body = { schema_version: 1, ...(primary ? { date_stamp: primary.dateStamp, day_end: primary.window?.endStamp ?? new Date(new Date(primary.dateStamp).setDate(new Date(primary.dateStamp).getDate() + 1)).getTime() } : {}),
      groups: lists[0]!.map((ref, client_index) => ({ ...locate(ref), client_index })), items: lists[1]!.map((ref, client_index) => ({ ...locate(ref), client_index })), reference_a: lists[2]!.map(locate), reference_b: lists[3]!.map(locate), version: query.version, cursor: query.cursor, sort: query.sort, limit: query.limit }
    await this.assertSpeakerReadCurrent(session, revision, signal)
    let raw: Record<string, unknown>
    try { raw = objectValue(await this.runtime.authenticatedAudioPost<Record<string, unknown>>(`/api/v1/audio/speaker-evidence/${query.action}`, body, session, signal, { bypassCache: true, lane: query.action === 'build' ? 'write' : 'interactive-read' })) }
    catch (error) { await this.assertSpeakerReadCurrent(session, revision, signal); if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus ?? 0)) return { supported: false }; throw error }
    await this.assertSpeakerReadCurrent(session, revision, signal)
    if (!['members', 'candidates'].includes(query.action) || raw.supported === false) {
      try { return parseRecordingEvidence(raw, query) }
      catch (cause) { throw new ArkmePluginError('recording-evidence-contract-invalid', '声纹证据格式不完整，暂不能用于判断', true, 502, { cause }) }
    }
    if (!primary || typeof raw.version !== 'string' || !raw.version || (query.version !== undefined && query.version !== '' && raw.version !== query.version) || !Array.isArray(raw.items) || raw.items.length > (query.limit ?? 50) || (!Number.isSafeInteger(raw.total_count) || Number(raw.total_count) < raw.items.length) || typeof raw.has_more !== 'boolean' || typeof raw.next_cursor !== 'string' || raw.next_cursor.length > 4096 || raw.has_more !== (raw.next_cursor.length > 0) || (raw.has_more && (raw.items.length === 0 || raw.next_cursor === query.cursor))) throw new ArkmePluginError('recording-evidence-contract-invalid', '成员响应无效', true, 502)
    const refKey = await this.recordingRefKey('arkme-recording-evidence-item-v1')
    await this.assertSpeakerReadCurrent(session, revision, signal)
    const seen = new Set<string>()
    const items = raw.items.map(value => {
      const row = objectValue(value), loc = objectValue(row.locator)
      if (loc.transcript_source !== primary.transcriptSource || ![loc.session_id, loc.child_id].every(value => typeof value === 'string' && /^(?!0{24}$)[a-f0-9]{24}$/.test(value)) || ![loc.session_id, loc.child_id, loc.revision, row.group].every(value => typeof value === 'string' && value.length > 0) || ![loc.item_index, loc.start_at, loc.end_at, row.start_at, row.source_number, row.assignment_number].every(Number.isSafeInteger) || Number(loc.end_at) <= Number(loc.start_at) || typeof row.text !== 'string' || !(row.deviation === null || (typeof row.deviation === 'number' && Number.isFinite(row.deviation) && row.deviation >= 0 && row.deviation <= 2))) throw new ArkmePluginError('recording-evidence-contract-invalid', '成员定位无效', true, 502)
      const identity = `${loc.session_id}:${loc.child_id}:${loc.transcript_source}:${loc.item_index}`
      if (seen.has(identity)) throw new ArkmePluginError('recording-evidence-contract-invalid', '成员定位重复', true, 502)
      seen.add(identity)
      const startAtMillis = Number(row.start_at), endAtMillis = startAtMillis + Number(loc.end_at) - Number(loc.start_at)
      if (!Number.isSafeInteger(endAtMillis) || startAtMillis < primary.dateStamp || startAtMillis >= body.day_end! || Number(loc.item_index) < 0 || Number(loc.start_at) < 0) throw new ArkmePluginError('recording-evidence-contract-invalid', '成员日期或定位无效', true, 502)
      const formal = stringValue(row.formal_speaker_id)
      if (formal && !/^[a-f0-9]{24}$/.test(formal)) throw new ArkmePluginError('recording-evidence-contract-invalid', '成员身份无效', true, 502)
      const payload: RecordingCorrectionItemRefPayload = { version: 1, viewerUserId: session.userId, dateStamp: primary.dateStamp, transcriptSource: primary.transcriptSource, ...(primary.window ? { window: primary.window } : {}), sessionId: String(loc.session_id), childId: String(loc.child_id), asrItemIndex: Number(loc.item_index), childAsrItemStartAt: Number(loc.start_at), childAsrItemEndAt: Number(loc.end_at), speakerRevision: String(loc.revision), sourceSpeakerNumber: Number(row.source_number), assignmentSpeakerNumber: Number(row.assignment_number), speakerIdentity: String(row.group), formalSpeakerId: /^0{24}$/.test(formal) ? '' : formal, startAtMillis, endAtMillis }
      return { itemRef: this.sealRecordingRefWithKey('arkme-recording-evidence-item-v1', payload, refKey), groupKey: createHmac('sha256', refKey).update(`speaker:${session.userId}:${row.group}`).digest('base64url'), startAtMillis, endAtMillis, text: row.text, deviation: row.deviation as number | null }
    })
    return { version: raw.version, totalCount: Number(raw.total_count), items, nextCursor: raw.next_cursor, hasMore: raw.has_more }
  }

  private correctionSelections(selections: RecordingEvidenceQuery['selections'], items: ReadonlyMap<string, RecordingCorrectionItemRefPayload>) {
    const selected = new Map<string, { start_at: number; end_at: number }>()
    if (selections === undefined) return selected
    if (!Array.isArray(selections) || selections.length > items.size) throw new ArkmePluginError('recording-correction-invalid', '区间选择无效', false, 400)
    for (const selection of selections) {
      if (!selection || typeof selection !== 'object') throw new ArkmePluginError('recording-correction-invalid', '区间选择无效', false, 400)
      const item = items.get(selection.itemRef)
      if (!item || selected.has(selection.itemRef) || !Number.isSafeInteger(selection.startOffsetMillis) || !Number.isSafeInteger(selection.endOffsetMillis)
        || selection.startOffsetMillis < 0 || selection.endOffsetMillis > item.childAsrItemEndAt - item.childAsrItemStartAt || selection.startOffsetMillis >= selection.endOffsetMillis) {
        throw new ArkmePluginError('recording-correction-invalid', '区间超出原转写片段', false, 400)
      }
      selected.set(selection.itemRef, { start_at: item.childAsrItemStartAt + selection.startOffsetMillis, end_at: item.childAsrItemStartAt + selection.endOffsetMillis })
    }
    return selected
  }

  private correctionLocator(item: RecordingCorrectionItemRefPayload) {
    if (!item.speakerRevision) throw new ArkmePluginError('recording-correction-unavailable', '请刷新录音后再纠错', true, 409)
    return { session_id: item.sessionId, child_id: item.childId, item_index: item.asrItemIndex,
      transcript_source: item.transcriptSource, start_at: item.childAsrItemStartAt, end_at: item.childAsrItemEndAt, revision: item.speakerRevision }
  }

  private async sealCorrectionUndo(item: RecordingCorrectionItemRefPayload, correctionId: string) {
    return this.sealRecordingRefWithKey('arkme-recording-correction-v1',
      { version: 1, viewerUserId: item.viewerUserId, dateStamp: item.dateStamp, childId: item.childId, sessionId: item.sessionId, transcriptSource: item.transcriptSource, itemIndex: item.asrItemIndex, correctionId },
      await this.recordingRefKey('arkme-recording-correction-v1'))
  }

  async previewRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionInput, signal?: AbortSignal): Promise<import('../types.js').ArkmeRecordingSpeakerCorrectionPreview> {
    const { body, session, revision } = await this.prepareRecordingSpeakerCorrection(input, signal)
    const raw = objectValue(await this.runtime.authenticatedAudioPost('/api/v1/audio/speaker-corrections/preview', body, session, signal, { lane: 'interactive-read', bypassCache: true }))
    await this.assertSpeakerReadCurrent(session, revision, signal)
    if (raw.schema_version !== 1 || raw.affected_count !== input.itemRefs.length || !stringValue(raw.intent_token) || !Number.isSafeInteger(raw.expires_at) || !stringValue(raw.selection_version) || !stringValue(raw.evidence_version)) throw new ArkmePluginError('recording-preview-invalid', '预检响应无效', false, 502)
    return { affectedCount: Number(raw.affected_count), intentToken: String(raw.intent_token), expiresAt: Number(raw.expires_at), selectionVersion: String(raw.selection_version), evidenceVersion: String(raw.evidence_version) }
  }

  async applyRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionInput, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult> {
    const { body, primary, session } = await this.prepareRecordingSpeakerCorrection(input, signal)
    return await this.writeRecordingCorrection('apply', primary, session, body, input.itemRefs.length, signal)
  }

  private async prepareRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionInput, signal?: AbortSignal) {
    this.assertWorkbenchEnabled()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ArkmePluginError('recording-correction-invalid', '纠错请求无效', false, 400)
    const session = await this.runtime.requireSession(), revision = this.speakerCacheRevision
    const primary = await this.openRecordingCorrectionItemRef(input.itemRef)
    this.assertCorrectionWrite(input.expectedVersion, input.idempotencyKey)
    if (!Array.isArray(input.itemRefs) || input.itemRefs.length < 1 || input.itemRefs.length > 100
      || input.itemRefs.some(ref => typeof ref !== 'string' || !ref || ref.length > 16384)
      || (input.intentToken !== undefined && (typeof input.intentToken !== 'string' || !input.intentToken || input.intentToken.length > 16384))
      || typeof input.detach !== 'boolean' || (input.rejectCurrent !== undefined && typeof input.rejectCurrent !== 'boolean') || (input.soundSource !== undefined && !['unknown', 'in_person', 'playback'].includes(input.soundSource))) {
      throw new ArkmePluginError('recording-correction-invalid', '请选择有效的纠错范围', false)
    }
    const items = await Promise.all(input.itemRefs.map(ref => this.openRecordingCorrectionItemRef(ref)))
    const key = (item: RecordingCorrectionItemRefPayload) => `${item.childId}:${item.asrItemIndex}:${item.transcriptSource}`
    if (primary.viewerUserId !== session.userId || items.some(item => item.viewerUserId !== session.userId
      || item.dateStamp !== primary.dateStamp || item.transcriptSource !== primary.transcriptSource
      || JSON.stringify(item.window) !== JSON.stringify(primary.window))
      || new Set(items.map(key)).size !== items.length) {
      throw new ArkmePluginError('recording-correction-scope-invalid', '纠错范围已变化，请重新选择', false, 409)
    }
    // The owner validates current facts after replaying an existing receipt.
    // Local semantic prechecks would reject a safe retry after a lost response.
    let rejectedSpeakerId = input.rejectCurrent ? primary.formalSpeakerId : ''
    if (input.rejectedSpeakerRef) {
      if (input.rejectCurrent) throw new ArkmePluginError('recording-correction-invalid', '只能指定一个排除人物', false)
      const person = await this.openRecordingSpeakerRef(input.rejectedSpeakerRef)
      if (person.viewerUserId !== session.userId || person.target.kind !== 'speaker') throw new ArkmePluginError('recording-correction-person-invalid', '纠错人物无效', false, 403)
      rejectedSpeakerId = person.target.speakerId
    }
    if ((input.rejectCurrent && !rejectedSpeakerId) || (!rejectedSpeakerId && input.soundSource === undefined && !input.detach && !input.target)) {
      throw new ArkmePluginError('recording-correction-empty', '请选择需要纠正的内容', false)
    }
    const selected = this.correctionSelections(input.selections, new Map(input.itemRefs.map((ref, index) => [ref, items[index]!])))
    let target: { kind: string; speaker_id?: string; name?: string } | undefined
    if (input.target !== undefined) {
      if (!input.target || typeof input.target !== 'object' || (input.detach && ['existing', 'new'].includes(input.target.kind))) throw new ArkmePluginError('recording-correction-invalid', '目标人物与取消归属不能同时指定', false, 400)
      if (input.target.kind === 'unknown') target = { kind: 'unknown' }
      else if (input.target.kind === 'new' && typeof input.target.name === 'string' && input.target.name.trim() && [...input.target.name.trim()].length <= 80) target = { kind: 'new', name: input.target.name.trim() }
      else if (input.target.kind === 'existing') {
        const person = await this.openRecordingSpeakerRef(input.target.speakerRef)
        if (person.viewerUserId !== session.userId || person.target.kind !== 'speaker') throw new ArkmePluginError('recording-correction-person-invalid', '目标人物无效', false, 403)
        target = { kind: 'existing', speaker_id: person.target.speakerId }
      } else throw new ArkmePluginError('recording-correction-invalid', '目标人物无效', false, 400)
    }
    await this.ensureRecordingSession(session, signal)
    return { primary, session, revision, body: {
      item: this.correctionLocator(primary), items: items.map((item, index) => ({ ...this.correctionLocator(item), ...(selected.has(input.itemRefs[index]!) ? { selection: selected.get(input.itemRefs[index]!) } : {}) })),
      ...(target ? { target } : {}),
      ...(input.intentToken ? { intent_token: input.intentToken } : {}),
      date_stamp: primary.dateStamp, day_end: primary.window?.endStamp ?? new Date(new Date(primary.dateStamp).setDate(new Date(primary.dateStamp).getDate() + 1)).getTime(), expected_version: input.expectedVersion, idempotency_key: input.idempotencyKey,
      ...(rejectedSpeakerId ? { rejected_speaker_id: rejectedSpeakerId } : {}),
      ...(input.soundSource === undefined ? {} : { sound_source: input.soundSource }), detach: input.detach,
    } }
  }

  async undoRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionUndoInput, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const primary = await this.openRecordingCorrectionItemRef(input.itemRef)
    const undo = await this.openRecordingRef('arkme-recording-correction-v1', input.undoRef)
    if (primary.viewerUserId !== session.userId || undo.viewerUserId !== session.userId || undo.dateStamp !== primary.dateStamp
      || undo.sessionId !== primary.sessionId || undo.transcriptSource !== primary.transcriptSource
      || undo.childId !== primary.childId || undo.itemIndex !== primary.asrItemIndex || !stringValue(undo.correctionId)) {
      throw new ArkmePluginError('recording-correction-undo-invalid', '撤销记录不属于当前片段', false, 403)
    }
    this.assertCorrectionWrite(input.expectedVersion, input.idempotencyKey)
    return await this.writeRecordingCorrection('undo', primary, session, { item: this.correctionLocator(primary),
      correction_id: undo.correctionId, expected_version: input.expectedVersion, idempotency_key: input.idempotencyKey }, undefined, signal)
  }

  private assertCorrectionWrite(version: string, key: string) {
    if (typeof version !== 'string' || !version.trim()) throw new ArkmePluginError('recording-correction-conflict', '请先读取纠错信息', false, 409)
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw new ArkmePluginError('recording-correction-invalid', '纠错请求编号无效', false)
  }

  private async writeRecordingCorrection(action: 'apply' | 'undo', item: RecordingCorrectionItemRefPayload, session: ArkmeSessionCredentials,
    body: Record<string, unknown>, expectedCount: number | undefined, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult> {
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换', false, 403)
    await this.invalidateSpeakerCache(session.userId)
    try {
      const raw = objectValue(await this.runtime.authenticatedAudioPost(`/api/v1/audio/speaker-corrections/${action}`, body,
        session, signal, { lane: 'write', bypassCache: true }))
      if (raw.schema_version !== 1 || raw.state !== (action === 'apply' ? 'applied' : 'undone') || !stringValue(raw.version)
        || !Number.isInteger(raw.affected_count) || Number(raw.affected_count) < 1 || Number(raw.affected_count) > 100
        || (expectedCount !== undefined && raw.affected_count !== expectedCount)
        || (action === 'apply' && !stringValue(raw.correction_id))) {
        throw new ArkmePluginError('recording-correction-outcome-unknown', '保存结果未能确认，请刷新查看，勿重复提交', false, 502)
      }
      return await this.readRecordingCorrectionResult(action, item, session, raw, signal)
    } catch (error) {
      // These owner responses definitively reject the command before commit.
      // Transport/server failures remain ambiguous and must replay the same key.
      if (error instanceof ArkmePluginError && [409, 410].includes(error.upstreamStatus ?? error.httpStatus)) {
        const status = error.upstreamStatus ?? error.httpStatus
        throw new ArkmePluginError('recording-correction-rejected', status === 410 ? '录音片段已不可用。' : '片段或纠错信息已变化，请重新打开录音后核对。', false, status, { cause: error })
      }
      throw error
    } finally { await this.invalidateSpeakerCache(session.userId) }
  }

  async recordingSpeakerCorrectionResult(query: ArkmeRecordingSpeakerCorrectionResultQuery, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult | null> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const item = await this.openRecordingCorrectionItemRef(query.itemRef)
    if (item.viewerUserId !== session.userId) throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换', false, 403)
    if (!['apply', 'undo'].includes(query.action) || !/^[a-zA-Z0-9-]{16,80}$/.test(query.idempotencyKey)) throw new ArkmePluginError('recording-correction-invalid', '纠错请求编号无效', false, 400)
    const raw = objectValue(await this.runtime.authenticatedAudioPost('/api/v1/audio/speaker-corrections/result',
      { item: this.correctionLocator(item), action: query.action, idempotency_key: query.idempotencyKey }, session, signal, { bypassCache: true, lane: 'interactive-read' }))
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换', false, 403)
    if (raw.schema_version !== 1 || !('receipt' in raw)) throw new ArkmePluginError('recording-correction-contract-invalid', '暂时无法读取保存结果', true, 502)
    // A missing receipt is only a read observation, not permission to retry a write.
    if (raw.receipt === null) return null
    const receipt = objectValue(raw.receipt)
    if (receipt.schema_version !== 1 || receipt.state !== (query.action === 'apply' ? 'applied' : 'undone') || !stringValue(receipt.version)
      || !Number.isInteger(receipt.affected_count) || Number(receipt.affected_count) < 1 || Number(receipt.affected_count) > 100
      || (query.action === 'apply' && !stringValue(receipt.correction_id))) throw new ArkmePluginError('recording-correction-contract-invalid', '保存回执无效', true, 502)
    return await this.readRecordingCorrectionResult(query.action, item, session, receipt, signal)
  }

  private async readRecordingCorrectionResult(action: 'apply' | 'undo', item: RecordingCorrectionItemRefPayload, session: ArkmeSessionCredentials,
    raw: Record<string, unknown>, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult> {
    const learning = raw.learning_state_at_commit
    if (learning !== undefined && (typeof learning !== 'string' || !(action === 'undo' ? ['reconciled'] : ['not_requested', 'ineligible', 'awaiting_evidence', 'reference_ready']).includes(learning))) throw new ArkmePluginError('recording-correction-contract-invalid', '保存回执无效', true, 502)
    const result: ArkmeRecordingSpeakerCorrectionResult = { ...(learning === undefined ? {} : { learningStateAtCommit: learning as NonNullable<ArkmeRecordingSpeakerCorrectionResult['learningStateAtCommit']> }), affectedCount: Number(raw.affected_count), version: String(raw.version),
      ...(action === 'apply' && raw.can_undo === true ? { undoRef: await this.sealCorrectionUndo(item, String(raw.correction_id)) } : {}) }
    try {
      // Enhanced utterance IDs cannot be looked up in the system transcript.
      // Keep the day contract unchanged and read back the selected source.
      const page = await this.recordingTranscriptPageWithSession(item.dateStamp, session, { source: item.transcriptSource, ...(item.window ? { window: item.window } : {}), signal })
      result.transcript = page
      // The UI refreshes its already loaded prefix. Do not require the edited
      // item to be on page one and never materialize a whole day for readback.
      if (item.transcriptSource === 'system') result.day = { ...(await this.recordingDayWithSession(item.dateStamp, session, signal, item.window, true)), transcript: page }

    } catch { result.warning = action === 'undo' ? '纠错已撤销，但转写暂未刷新，请重新打开录音查看。' : '纠错已保存，但转写暂未刷新，请重新打开录音查看。' }
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换', false, 403)
    return result
  }

  private recordingSpeakerOptionKey(key: Buffer, viewerUserId: number, kind: 'speaker' | 'arkme-user', id: string | number): string {
    return createHmac('sha256', key)
      .update(JSON.stringify([this.runtime.config.environment, viewerUserId, kind, id])).digest('base64url')

  }

  async assignRecordingSpeaker(input: {
    itemRef: string
    speakerRef?: string
    newSpeakerName?: string
    scope: 'item' | 'speaker'
  }, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerMutationResult> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    await this.invalidateSpeakerCache(session.userId)
    try { return await this.assignRecordingSpeakerToOwner(input, signal) }
    finally { await this.invalidateSpeakerCache(session.userId) }
  }

  private async assignRecordingSpeakerToOwner(input: {
    itemRef: string
    speakerRef?: string
    newSpeakerName?: string
    scope: 'item' | 'speaker'
  }, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerMutationResult> {
    this.assertWorkbenchEnabled()
    const item = await this.openRecordingItemRef(input.itemRef)
    const session = await this.runtime.requireSession()
    if (session.userId !== item.viewerUserId) {
      throw new ArkmePluginError('recording-ref-account-mismatch', '录音引用与当前账号不匹配', false, 403)
    }
    const speakerRef = input.speakerRef?.trim() ?? ''
    const newSpeakerName = input.newSpeakerName?.trim() ?? ''
    if ((speakerRef === '') === (newSpeakerName === '')) {
      throw new ArkmePluginError('recording-speaker-target-invalid', '请选择现有说话人或填写新名称', false)
    }
    if (input.scope === 'speaker' && item.speakerReference === '') {
      throw new ArkmePluginError('recording-speaker-batch-empty', '未知说话人只能逐句修改', false, 409)
    }
    let views = [this.itemView(item)]
    if (input.scope === 'speaker') {
      const dayStart = item.window ? new Date(item.window.dateStamp) : this.recordingDayStart(item.dateStamp)
      const dayEnd = new Date(dayStart); if(item.window) dayEnd.setTime(item.window.endStamp); else dayEnd.setDate(dayEnd.getDate() + 1)
      const page = await this.readOwner.dayPage({ startAt: Math.max(0, dayStart.getTime()), endAt: dayEnd.getTime() }, views[0]!.source, session, undefined, signal)
      if (!page.views.some(view => view.recording_uid === item.sessionId && view.revision === item.revision)) throw new ArkmePluginError('recording-speaker-conflict', '录音信息已变化，请刷新后重试', true, 409)
      // The selected item's original revision is the anchor. Other recordings
      // use their current owner views; no loaded-row list determines the scope.
      views = page.views
    } else {
      const dayStart = item.window?.dateStamp ?? item.dateStamp
      const dayEnd = new Date(dayStart); if(item.window) dayEnd.setTime(item.window.endStamp); else dayEnd.setDate(dayEnd.getDate() + 1)
      await this.readOwner.transcript(item.sessionId, views[0]!.source, { startAt: Math.max(0, dayStart), endAt: dayEnd.getTime() }, session, { limit: 1, revision: item.revision }, signal)
    }
    let speakerId = ''
    if (speakerRef !== '') {
      const target = (await this.openRecordingSpeakerRef(speakerRef)).target
      if (target.kind === 'speaker') {
        const current = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
          '/api/v1/audio/get-speaker-ls', {}, session, signal, { bypassCache: true },
        )
        if (!listValue(current.spk_ls).some(raw => {
          const speaker = objectValue(raw)
          return stringValue(speaker.speaker_id ?? speaker.id ?? speaker.spk_id).trim() === target.speakerId
        })) throw new ArkmePluginError('recording-speaker-target-missing', '该说话人已不存在，请重新选择', false, 409)
        speakerId = target.speakerId
      } else {
        const candidate = await this.currentRecordingSpeakerUser(target.userId, session, signal)
        speakerId = await this.recordingSpeakerIdForUser(target.userId, session, signal)
        if (speakerId === '') {
          const created = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
            '/api/v1/audio/create-speaker', { nick_name: candidate.label, ref_usr_id: target.userId }, session, signal,
            { lane: 'write', bypassCache: true },
          )
          const speaker = objectValue(created.speaker ?? created.spk)
          speakerId = stringValue(created.speaker_id ?? created.spk_id ?? speaker.speaker_id ?? speaker.id).trim()
          if (speakerId === '') throw new ArkmePluginError('recording-speaker-create-invalid', '创建说话人响应无效', true, 502)
        }
      }
    } else {
      if (newSpeakerName.length > 50) throw new ArkmePluginError('recording-speaker-name-invalid', '说话人名称不能超过 50 个字符', false)
      if (await this.recordingSpeakerNameExists(newSpeakerName, session, signal)) {
        throw new ArkmePluginError(
          'recording-speaker-name-conflict',
          '已存在同名说话人，请选择现有说话人',
          false,
          409,
        )
      }
      const created = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
        '/api/v1/audio/create-speaker', { nick_name: newSpeakerName, ref_usr_id: 0 }, session, signal,
        { lane: 'write', bypassCache: true },
      )
      const speaker = objectValue(created.speaker ?? created.spk)
      speakerId = stringValue(created.speaker_id ?? created.spk_id ?? speaker.speaker_id ?? speaker.id).trim()
      if (speakerId === '') throw new ArkmePluginError('recording-speaker-create-invalid', '创建说话人响应无效', true, 502)
    }
    if ((await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换，请重新选择录音', false, 403)
    const result = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      input.scope === 'speaker' ? '/api/v1/audio/recordings/speakers/bind' : '/api/v1/audio/recordings/transcript/speaker/assign',
      {
        ...(input.scope === 'speaker' ? { recordings: views } : { ...views[0], clip_locator: this.itemLocator(item) }),
        speaker_reference: item.speakerReference, target_speaker_uid: speakerId,
      }, session, signal, { lane: 'write', bypassCache: true },
    )
    if (!Number.isSafeInteger(result.changed_clusters) || numberValue(result.changed_clusters) < 0
      || !Number.isSafeInteger(result.changed_items) || numberValue(result.changed_items) < 0) {
      throw new ArkmePluginError('recording-speaker-response-invalid', '说话人修改已提交，请刷新确认', false, 502)
    }
    return { scope: input.scope, changedClusters: numberValue(result.changed_clusters), changedItems: numberValue(result.changed_items), day: await this.recordingDayWithSession(item.dateStamp, session, signal, item.window) }
  }

  async unassignRecordingSpeaker(input: {
    itemRef: string
    scope: 'item' | 'speaker'
    expectedCount: number
  }, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerMutationResult> {
    this.assertWorkbenchEnabled()
    const item = await this.openRecordingItemRef(input.itemRef)
    const session = await this.runtime.requireSession()
    if (session.userId !== item.viewerUserId) {
      throw new ArkmePluginError('recording-ref-account-mismatch', '录音引用与当前账号不匹配', false, 403)
    }
    if (item.formalSpeakerId === '') {
      throw new ArkmePluginError('recording-speaker-unassigned', '当前片段没有可取消的人物标记', false, 409)
    }
    const current = await this.currentRecordingSpeakerItems(item, session, signal, true)
    const targets = current.filter(candidate => candidate.transcriptSource === item.transcriptSource
      && (input.scope === 'speaker' ? this.sameRecordingSpeakerMutationTarget(candidate, item)
        : candidate.childId === item.childId && candidate.asrItemIndex === item.asrItemIndex))
    if (!Number.isSafeInteger(input.expectedCount) || input.expectedCount < 1 || targets.length !== input.expectedCount) {
      throw new ArkmePluginError('recording-speaker-conflict', '片段数量已变化，请关闭弹窗刷新后重试', true, 409)
    }
    // Use explicit item indices even for bulk removal. Session-level removal can
    // touch fragments outside the day/window or reveal an older inherited label.
    const groups = new Map<string, number[]>()
    for (const target of targets) {
      const indices = groups.get(target.childId) ?? []
      indices.push(target.asrItemIndex)
      groups.set(target.childId, indices)
    }
    let affectedCount = 0
    let conflicts = 0
    await this.invalidateSpeakerCache(session.userId)
    try {
      for (const [childId, indices] of groups) {
        for (let offset = 0; offset < indices.length; offset += 500) {
          if ((await this.runtime.requireSession()).userId !== session.userId) {
            throw new ArkmePluginError('recording-ref-account-mismatch', '账号已变化，请重新打开录音', false, 409)
          }
          const response = objectValue(await this.runtime.authenticatedAudioPost(
            '/api/v1/audio/unassign-asr-item-spk',
            { child_id: childId, expected_spk_id: item.formalSpeakerId,
              item_index_ls: indices.slice(offset, offset + 500), transcript_source: item.transcriptSource },
            session, signal, { lane: 'write', bypassCache: true },
          ))
          const counts = ['modified_count', 'already_unassigned_count', 'conflict_count'].map(key => response[key])
          if (!counts.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
            throw new ArkmePluginError('recording-speaker-unassign-invalid', '取消结果未能确认，请关闭弹窗刷新后查看', true, 502)
          }
          affectedCount += numberValue(response.modified_count)
          conflicts += numberValue(response.conflict_count)
        }
      }
      const day = await this.recordingDayWithSession(item.dateStamp, session, signal, item.window, true)
      const refreshed = await this.completeRecordingRows(item.dateStamp, item.transcriptSource, session, signal, item.window)
      const targetIds = new Set(targets.map(target => target.itemId))
      const confirmed = refreshed.filter(target => targetIds.has(target.itemId) && target.formalSpeakerId === '').length
      return { scope: input.scope, changedClusters: 0, changedItems: affectedCount, day,
        ...(conflicts > 0 || confirmed !== targets.length ? { warning: '部分片段的标记未取消或已变化，已刷新转写；请关闭弹窗后查看，其他新标记不会被覆盖。' } : {}),
      }
    } finally { await this.invalidateSpeakerCache(session.userId) }
  }

  async recordingImportUserId(): Promise<number> {
    this.assertWorkbenchEnabled()
    return (await this.runtime.requireSession()).userId
  }

  async recordingImportPreflight(fileNames: string[], signal?: AbortSignal): Promise<{ duplicateFileNames: string[] }> {
    this.assertWorkbenchEnabled()
    const candidatesByKey = new Map<string, string>()
    for (const value of fileNames) {
      const candidate = value.trim()
      const key = recordingImportFileNameKey(candidate)
      if (key !== '' && !candidatesByKey.has(key)) candidatesByKey.set(key, candidate)
    }
    const candidates = [...candidatesByKey.values()]
    if (candidates.length === 0 || candidates.some(value => value.length > 255)) {
      throw new ArkmePluginError('recording-import-preflight-invalid', '待检查录音文件名无效', false)
    }
    const session = await this.runtime.requireSession()
    const unresolvedLocalFileNameKeys = new Set(
      (await this.runtime.stateStore.listRecordingImportJobs(session.userId))
        .filter(isUnresolvedRecordingImportJob)
        .map(job => recordingImportFileNameKey(job.fileName)),
    )
    const audioOwnerFileNameKeys = new Set<string>()
    for (const value of await this.recordingImportOwnerGateway.findExistingFileNames({
      viewerUserId: session.userId,
      fileNames: candidates,
      ...(signal === undefined ? {} : { signal }),
    })) {
      const key = recordingImportFileNameKey(value)
      if (key !== '') audioOwnerFileNameKeys.add(key)
    }
    return {
      duplicateFileNames: candidates.filter(
        value => unresolvedLocalFileNameKeys.has(recordingImportFileNameKey(value))
          || audioOwnerFileNameKeys.has(recordingImportFileNameKey(value)),
      ),
    }
  }

  async recordingDirectorySnapshot(
    candidates: readonly RecordingDirectoryCandidate[], expectedUserId: number, signal?: AbortSignal,
  ): Promise<RecordingDirectorySnapshot> {
    this.assertWorkbenchEnabled()
    signal?.throwIfAborted()
    const session = await this.requireRecordingImportSession(expectedUserId)
    const jobs = (await this.runtime.stateStore.listRecordingImportJobs(session.userId))
      .filter(isUnresolvedRecordingImportJob)
    const existingFileNames = candidates.length === 0 ? [] : await this.recordingImportOwnerGateway.findExistingFileNames({
      viewerUserId: session.userId, fileNames: candidates.map(file => file.fileName),
      ...(signal === undefined ? {} : { signal }),
    })
    const existingKeys = new Set(existingFileNames.map(recordingImportFileNameKey))
    const duplicates = candidates.filter(file => existingKeys.has(recordingImportFileNameKey(file.fileName)))
    const owner = duplicates.length === 0 ? [] : await this.recordingImportOwnerGateway.findDirectoryImportSessions({
      viewerUserId: session.userId, fileNames: duplicates.map(file => file.fileName),
      fromMillis: Math.min(...duplicates.map(file => file.startAtMillis)),
      toMillis: Math.max(...duplicates.map(file => file.startAtMillis)) + 1,
      ...(signal === undefined ? {} : { signal }),
    })
    const local = await Promise.all(jobs.map(async job => ({
      identity: {
        userId: job.userId, fileName: job.fileName, fileSize: job.fileSize,
        sha256: job.sha256, startAtMillis: job.startAtMillis, belongUserId: job.belongUserId,
        strategy: recordingStrategy(job.strategy),
      },
      task: toPublicRecordingImportJob(job, await this.recordingImportRef(job)),
    })))
    await this.requireRecordingImportSession(expectedUserId)
    signal?.throwIfAborted()
    return { local, existingFileNames, owner }
  }

  async recordingImportReceipt(taskId: string, expectedUserId: number): Promise<PublicRecordingImportJob | null> {
    this.assertWorkbenchEnabled()
    const session = await this.requireRecordingImportSession(expectedUserId)
    const job = (await this.runtime.stateStore.listRecordingImportJobs(session.userId)).find(row => row.clientTaskId === taskId)
    return job ? toPublicRecordingImportJob(job, await this.recordingImportRef(job)) : null
  }

  async acceptRecordingImport(
    sourceHandle: string,
    metadata: {
      clientTaskId?: string
      batch?: RecordingImportBatch
      fileName: string
      mimeType: string
      fileSize: number
      sha256: string
      startAtMillis: number
      belongUserId: number
      strategy?: string
      recordingKind?: 0 | 1 | 3
    },
    expectedUserId: number,
    signal?: AbortSignal,
  ): Promise<PublicRecordingImportJob> {
    signal?.throwIfAborted()
    this.assertWorkbenchEnabled()
    let session = await this.requireRecordingImportSession(expectedUserId)
    if (!/^[a-f0-9]{64}$/.test(metadata.sha256)) {
      throw new ArkmePluginError('recording-import-hash-invalid', '录音文件摘要无效', false)
    }
    const startAtMillis = Math.trunc(metadata.startAtMillis)
    if (!isRecordingInstantOnOrAfterUnixEpoch(startAtMillis)) {
      throw new ArkmePluginError('recording-import-start-invalid', '录音开始时间无效', false)
    }
    const belongUserId = Math.trunc(metadata.belongUserId)
    if (belongUserId !== 0 && belongUserId !== session.userId) {
      throw new ArkmePluginError('recording-import-owner-invalid', '录音数据归属无效', false)
    }
    const currentJobs = await this.runtime.stateStore.listRecordingImportJobs(session.userId)
    const receipt = metadata.clientTaskId ? currentJobs.find(job => job.clientTaskId === metadata.clientTaskId) : undefined
    const selectedStrategy = metadata.strategy !== undefined ? recordingStrategy(metadata.strategy)
      : receipt ? recordingStrategy(receipt.strategy)
      : recordingStrategy((await this.recordingStrategies({ action: 'preference', expectedUserId }, signal) as { strategy: string }).strategy)
    const identity = {
      strategy: selectedStrategy,
      userId: session.userId,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      sha256: metadata.sha256,
      startAtMillis,
      belongUserId,
    }
    if (metadata.batch !== undefined && !validRecordingImportBatch(metadata.batch)) throw new ArkmePluginError('recording-import-batch-invalid', '录音导入批次无效', false, 400)
    const recordingKind = metadata.recordingKind ?? 0
    const unresolvedJobs = currentJobs.filter(isUnresolvedRecordingImportJob)
    if (receipt && (!sameRecordingImportIdentity(receipt, identity) || receipt.recordingKind !== recordingKind || !sameRecordingImportBatch(receipt.batch, metadata.batch))) {
      throw new ArkmePluginError('recording-import-task-conflict', '此导入任务的文件或参数已改变，请核对后重新选择', false, 409)
    }
    const existing = receipt ?? unresolvedJobs.find(job => sameRecordingImportIdentity(job, identity)
      && job.recordingKind === recordingKind && sameRecordingImportBatch(job.batch, metadata.batch))
    if (existing !== undefined) {
      const importRef = await this.recordingImportRef(existing)
      signal?.throwIfAborted()
      await this.recordingImportSource.discard(sourceHandle).catch(() => undefined)
      return toPublicRecordingImportJob(existing, importRef)
    }
    const fileNameKey = recordingImportFileNameKey(metadata.fileName)
    if (unresolvedJobs.some(job => recordingImportFileNameKey(job.fileName) === fileNameKey)) {
      throw new ArkmePluginError(
        'recording-import-duplicate-in-progress',
        '同名录音正在导入，请等待当前任务完成或取消后重试',
        false,
        409,
      )
    }
    signal?.throwIfAborted()
    const probe = await this.recordingImportSource.inspect(sourceHandle, metadata)
    const signingKey = await this.runtime.stateStore.uniqueCode()
    session = await this.requireRecordingImportSession(expectedUserId)
    signal?.throwIfAborted()
    if (startAtMillis + probe.durationMillis > Date.now()) {
      throw new ArkmePluginError('recording-import-end-invalid', '录音结束时间不能晚于当前时间', false)
    }
    const now = Date.now()
    const job: RecordingImportJob = {
      jobId: randomUUID(),
      ...(metadata.clientTaskId ? { clientTaskId: metadata.clientTaskId } : {}),
      ...(metadata.batch ? { batch: { ...metadata.batch }, createRequestUID: recordingCreateRequestUID(now) } : {}),
      userId: session.userId,
      revision: 1,
      phase: 'prepared',
      fileName: metadata.fileName,
      mimeType: recordingImportCanonicalMimeType(probe.kind),
      fileSize: metadata.fileSize,
      durationMillis: probe.durationMillis,
      sha256: metadata.sha256,
      startAtMillis,
      belongUserId,
      recordingKind,
      strategy: selectedStrategy,
      sourceHandle,
      uploadedBytes: 0,
      createdAtMillis: now,
      updatedAtMillis: now,
    }
    const importRef = sealRecordingImportRef({ jobId: job.jobId, userId: job.userId }, signingKey)
    const admission = await this.runtime.stateStore.admitRecordingImportJob(
      session.userId,
      job,
      signal,
    )
    if (admission.kind === 'existing') {
      await this.recordingImportSource.discard(sourceHandle).catch(() => undefined)
      return toPublicRecordingImportJob(admission.job, sealRecordingImportRef({ jobId: admission.job.jobId, userId: admission.job.userId }, signingKey))
    }
    if (admission.kind === 'duplicate-file-name') {
      throw new ArkmePluginError(
        'recording-import-duplicate-in-progress',
        '同名录音正在导入，请等待当前任务完成或取消后重试',
        false,
        409,
      )
    }
    const selected = admission.job
    this.runRecordingImport(selected)
    return toPublicRecordingImportJob(selected, importRef)
  }

  async recordingImportStatus(importRef: string): Promise<PublicRecordingImportJob> {
    this.assertWorkbenchEnabled()
    const { userId, jobId } = await this.openRecordingImportRef(importRef)
    const job = await this.runtime.stateStore.getRecordingImportJob(userId, jobId)
    if (job === undefined) throw new ArkmePluginError('recording-import-not-found', '录音导入任务不存在', false, 404)
    return toPublicRecordingImportJob(job, importRef)
  }

  async waitRecordingImport(importRef: string, signal?: AbortSignal): Promise<PublicRecordingImportJob> {
    this.assertWorkbenchEnabled()
    signal?.throwIfAborted()
    const { userId, jobId } = await this.openRecordingImportRef(importRef)
    const job = await this.runtime.stateStore.getRecordingImportJob(userId, jobId)
    if (job === undefined) throw new ArkmePluginError('recording-import-not-found', '录音导入任务不存在', false, 404)
    signal?.throwIfAborted()
    if (['prepared', 'uploading', 'finalizing'].includes(job.phase)) this.runRecordingImport(job)
    const run = this.importRuns.get(jobId)?.promise
    if (run !== undefined) {
      // Ending a directory invocation stops waiting, not its already admitted upload.
      await new Promise<void>((resolve, reject) => {
        const abort = () => { reject(signal?.reason) }
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        void run.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
      })
    }
    signal?.throwIfAborted()
    return await this.recordingImportStatus(importRef)
  }

  async recordingImportList(signal?: AbortSignal, page?: { toMillis: number; limit: number; offset: number }): Promise<PublicRecordingImportCurrentSnapshot> {
    this.assertWorkbenchEnabled()
    if (page && (!Number.isSafeInteger(page.toMillis) || page.toMillis <= 0
      || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > RECORDING_IMPORT_HISTORY_MAX_PAGE_SIZE
      || !Number.isSafeInteger(page.offset) || page.offset < 0)) {
      throw new ArkmePluginError('recording-import-list-invalid', '未完成任务查询参数无效', false)
    }
    const session = await this.runtime.requireSession()
    const jobs = await this.runtime.stateStore.listRecordingImportJobs(session.userId)
    for (const job of [...jobs].sort((a, b) => a.createdAtMillis - b.createdAtMillis)) {
      if (['prepared', 'uploading', 'finalizing'].includes(job.phase)) this.runRecordingImport(job)
    }
    const newestFirst = (left: RecordingImportJob, right: RecordingImportJob) => right.createdAtMillis - left.createdAtMillis
    const unresolved = jobs.filter(isUnresolvedRecordingImportJob).sort(newestFirst)
    let activeOwnerTasks: Awaited<ReturnType<RecordingImportOwnerGateway['listOwnerTasks']>>['tasks'] | undefined
    let owner: PublicRecordingImportCurrentSnapshot['owner'] = { state: 'available' }
    try {
      const ownerPage = await this.recordingImportOwnerGateway.listOwnerTasks({
        viewerUserId: session.userId,
        scope: 'active', toMillis: page?.toMillis ?? Date.now(), limit: page?.limit ?? RECORDING_IMPORT_VISIBLE_LIMIT, offset: page?.offset ?? 0,
        ...(signal === undefined ? {} : { signal }),
      })
      activeOwnerTasks = ownerPage.tasks
      if (page) owner = { state: 'available', hasMore: ownerPage.hasMore, nextOffset: page.offset + ownerPage.tasks.length }
    } catch (error) {
      if (signal?.aborted === true
        || recordingImportErrorCode(error) === 'recording-import-account-mismatch') throw error
      owner = { state: 'unavailable', message: 'Audio 上传任务读取失败，请稍后重试' }
      /* Unresolved local jobs remain actionable when the owner list is temporarily unavailable. */
    }
    const visibleLocal = unresolved
    const projectedLocal = await Promise.all(visibleLocal.map(async job =>
      toPublicRecordingImportJob(job, await this.recordingImportRef(job))))
    if (activeOwnerTasks === undefined) return { items: projectedLocal, owner }
    const ownerRefKey = await this.recordingRefKey(RECORDING_IMPORT_SESSION_REF_PREFIX)
    const unresolvedOwnerSessionIds = new Set(unresolved.flatMap(job => job.sessionId === undefined ? [] : [job.sessionId]))
    const acceptedByOwnerSessionId = new Map<string, RecordingImportJob>()
    for (const job of jobs) {
      if (job.phase !== 'accepted' || job.sessionId === undefined) continue
      const previous = acceptedByOwnerSessionId.get(job.sessionId)
      if (previous === undefined || job.updatedAtMillis > previous.updatedAtMillis) {
        acceptedByOwnerSessionId.set(job.sessionId, job)
      }
    }
    const projectedOwner = await Promise.all(activeOwnerTasks
      .filter(task => !unresolvedOwnerSessionIds.has(task.session.sessionId))
      .map(async task => await this.projectRecordingImportOwnerTask(
        task,
        session.userId,
        ownerRefKey,
        acceptedByOwnerSessionId.get(task.session.sessionId),
      )))
    return {
      items: [...projectedLocal, ...projectedOwner]
        .sort((left, right) => right.createdAtMillis - left.createdAtMillis),
      owner,
    }
  }

  async recordingImportHistory(input: {
    toMillis: number
    limit: number
    offset: number
  }, signal?: AbortSignal): Promise<PublicRecordingImportHistoryPage> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const toMillis = Math.trunc(input.toMillis)
    const limit = Math.trunc(input.limit)
    const offset = Math.trunc(input.offset)
    if (!Number.isSafeInteger(toMillis) || toMillis <= 0 || !Number.isSafeInteger(limit)
      || limit < 1 || limit > RECORDING_IMPORT_HISTORY_MAX_PAGE_SIZE
      || !Number.isSafeInteger(offset) || offset < 0) {
      throw new ArkmePluginError('recording-import-history-invalid', '已完成任务查询参数无效', false)
    }
    const page = await this.recordingImportOwnerGateway.listOwnerTasks({
      viewerUserId: session.userId,
      scope: 'completed', toMillis, limit, offset,
      ...(signal === undefined ? {} : { signal }),
    })
    if (page.tasks.some(task => !task.session.hasFinishedUpload || !task.processingCompleted)) {
      throw new ArkmePluginError(
        'recording-import-history-owner-invalid',
        '已完成任务数据暂不可用，请稍后重试',
        true,
        502,
      )
    }
    const ownerRefKey = await this.recordingRefKey(RECORDING_IMPORT_SESSION_REF_PREFIX)
    const items = await Promise.all(page.tasks.map(async task => await this.projectRecordingImportHistoryItem(
      task,
      session.userId,
      ownerRefKey,
    )))
    return {
      items,
      ...(page.total === undefined ? {} : { total: page.total }),
      offset,
      hasMore: page.hasMore,
    }
  }

  async updateRecordingImportSessionStart(
    sessionRef: string,
    startAtMillis: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertWorkbenchEnabled()
    const start = Math.trunc(startAtMillis)
    if (!isRecordingInstantOnOrAfterUnixEpoch(start) || start > Date.now()) {
      throw new ArkmePluginError('recording-import-start-invalid', '录音开始时间无效', false)
    }
    const session = await this.runtime.requireSession()
    const target = await this.openRecordingImportSessionRef(sessionRef)
    await this.assertRecordingImportOwnerMutationSafe(session.userId, target.sessionId)
    const owner = await this.recordingImportOwnerGateway.loadOwnerSession({
      viewerUserId: session.userId,
      sessionId: target.sessionId,
      ...(signal === undefined ? {} : { signal }),
    })
    if (start + owner.durationMillis > Date.now()) {
      throw new ArkmePluginError('recording-import-end-invalid', '录音结束时间不能晚于当前时间', false)
    }
    await this.recordingImportOwnerGateway.updateOwnerSessionStart({
      viewerUserId: session.userId,
      sessionId: target.sessionId,
      startAtMillis: start,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async updateRecordingImportSessionOwnership(
    sessionRef: string,
    ownership: 'self' | 'other',
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const target = await this.openRecordingImportSessionRef(sessionRef)
    const belongUserId = ownership === 'self' ? session.userId : 0
    await this.assertRecordingImportOwnerMutationSafe(session.userId, target.sessionId)
    await this.recordingImportOwnerGateway.updateOwnerSessionOwnership({
      viewerUserId: session.userId,
      sessionId: target.sessionId,
      belongUserId,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async retryRecordingTranscription(sessionRef: string, signal?: AbortSignal): Promise<void> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const target = await this.openRecordingImportSessionRef(sessionRef)
    await this.assertRecordingImportOwnerMutationSafe(session.userId, target.sessionId)
    await this.runtime.authenticatedAudioPost('/api/v1/audio/retry-transcription', { session_id: target.sessionId }, session, signal, { lane: 'write', bypassCache: true })
  }

  async deleteRecordingImportSession(sessionRef: string, signal?: AbortSignal): Promise<void> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const target = await this.openRecordingImportSessionRef(sessionRef)
    await this.assertRecordingImportOwnerMutationSafe(session.userId, target.sessionId)
    const jobs = await this.runtime.stateStore.listRecordingImportJobs(session.userId)
    await this.recordingImportOwnerGateway.deleteOwnerSession({
      viewerUserId: session.userId,
      sessionId: target.sessionId,
      ...(signal === undefined ? {} : { signal }),
    })
    await Promise.all(jobs.filter(job => job.sessionId === target.sessionId)
      .map(async job => await this.runtime.stateStore.removeRecordingImportJob(session.userId, job.jobId)))
  }

  async retryRecordingImport(importRef: string, expectedRevision: number, signal?: AbortSignal): Promise<PublicRecordingImportJob> {
    signal?.throwIfAborted()
    this.assertWorkbenchEnabled()
    const { userId, jobId } = await this.openRecordingImportRef(importRef)
    this.beginRecordingImportCommand(jobId)
    try {
      const resumed = await this.recordingImports.resumeRetry(userId, jobId, expectedRevision, signal)
      const priorRun = this.importRuns.get(jobId)?.promise
      const controller = new AbortController()
      const run = (priorRun ?? Promise.resolve())
        .then(async () => { await this.importQueue.run(async () => {
          const result = await this.recordingImports.run(userId, jobId, controller.signal)
          if (!controller.signal.aborted) this.scheduleRecordingImportRetry(result)
        }, controller.signal) })
      this.trackRecordingImportRun(jobId, resumed.revision, run, controller)
      return toPublicRecordingImportJob(resumed, importRef)
    } finally {
      this.importCommands.delete(jobId)
    }
  }

  async cancelRecordingImport(importRef: string, expectedRevision: number): Promise<PublicRecordingImportJob> {
    this.assertWorkbenchEnabled()
    const { userId, jobId } = await this.openRecordingImportRef(importRef)
    this.beginRecordingImportCommand(jobId)
    try {
      const active = this.importRuns.get(jobId)
      if (active !== undefined) {
        const observed = await this.runtime.stateStore.getRecordingImportJob(userId, jobId)
        if (observed === undefined || expectedRevision < active.startedRevision || expectedRevision > observed.revision) {
          throw new ArkmePluginError('recording-import-revision-conflict', '任务状态已变化，请刷新后重试', true, 409)
        }
      }
      active?.controller.abort()
      await active?.promise
      const current = active === undefined
        ? undefined
        : await this.runtime.stateStore.getRecordingImportJob(userId, jobId)
      const cancelled = await this.recordingImports.cancel(userId, jobId, current?.revision ?? expectedRevision)
      return toPublicRecordingImportJob(cancelled, importRef)
    } finally {
      this.importCommands.delete(jobId)
    }
  }

  async resumeRecordingImports(): Promise<void> {
    if (this.runtime.config.recordingWorkbenchEnabled === false) return
    const session = await this.runtime.requireSession()
    const jobs = await this.runtime.stateStore.listRecordingImportJobs(session.userId)
    for (const job of [...jobs].sort((a, b) => a.createdAtMillis - b.createdAtMillis)) {
      if (['prepared', 'uploading', 'finalizing'].includes(job.phase)) this.runRecordingImport(job)
      else this.scheduleRecordingImportRetry(job)
    }
  }

  private runRecordingImport(job: RecordingImportJob): void {
    if (this.importDisposed || this.importCommands.has(job.jobId) || this.importRuns.has(job.jobId)) return
    const controller = new AbortController()
    this.trackRecordingImportRun(
      job.jobId,
      job.revision,
      this.importQueue.run(async () => {
        const result = await this.recordingImports.run(job.userId, job.jobId, controller.signal)
        if (!controller.signal.aborted) this.scheduleRecordingImportRetry(result)
      }, controller.signal),
      controller,
    )
  }

  private scheduleRecordingImportRetry(job: RecordingImportJob): void {
    if (this.importDisposed || job.phase !== 'failed' || job.retryable !== true || job.errorCode === 'recording_storage_exhausted'
      || job.errorCode?.startsWith('login-') || job.errorCode?.includes('account-')) return
    if (this.importRetryTimers.has(job.jobId)) return
    const attempt = this.importRetryAttempts.get(job.jobId) ?? 0
    this.importRetryAttempts.set(job.jobId, attempt + 1)
    const timer = setTimeout(() => {
      this.importRetryTimers.delete(job.jobId)
      void (async () => {
        await this.requireRecordingImportSession(job.userId)
        const current = await this.runtime.stateStore.getRecordingImportJob(job.userId, job.jobId)
        if (current?.phase !== 'failed' || current.revision !== job.revision) return
        const resumed = await this.recordingImports.resumeRetry(job.userId, job.jobId, job.revision)
        this.runRecordingImport(resumed)
      })().catch(() => undefined)
    }, Math.min(60_000 * 2 ** Math.min(attempt, 6), 3_600_000))
    timer.unref?.()
    this.importRetryTimers.set(job.jobId, timer)
  }

  private beginRecordingImportCommand(jobId: string): void {
    if (this.importCommands.has(jobId)) {
      throw new ArkmePluginError(
        'recording-import-command-in-progress', '该录音任务正在执行重试或取消，请稍后重试', true, 409,
      )
    }
    this.importCommands.add(jobId)
  }

  private async requireRecordingImportSession(expectedUserId: number): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (session.userId !== expectedUserId) {
      throw new ArkmePluginError(
        'recording-import-account-mismatch',
        '登录账号已变化，已停止录音导入',
        true,
        403,
      )
    }
    return session
  }

  private assertWorkbenchEnabled(): void {
    if (this.runtime.config.recordingWorkbenchEnabled === false) {
      throw new ArkmePluginError('recording-workbench-disabled', '录音工作台当前已关闭', false, 503)
    }
  }

  private trackRecordingImportRun(
    jobId: string,
    startedRevision: number,
    run: Promise<void>,
    controller: AbortController,
  ): void {
    let tracked: Promise<void>
    tracked = run.catch(() => undefined).finally(() => {
      if (this.importRuns.get(jobId)?.promise === tracked) this.importRuns.delete(jobId)
    })
    this.importRuns.set(jobId, { controller, promise: tracked, startedRevision })
  }

  private async recordingImportRef(job: RecordingImportJob): Promise<string> {
    return sealRecordingImportRef(
      { jobId: job.jobId, userId: job.userId },
      await this.runtime.stateStore.uniqueCode(),
    )
  }

  private async openRecordingImportRef(importRef: string): Promise<{ jobId: string; userId: number }> {
    const session = await this.runtime.requireSession()
    try {
      return openRecordingImportRef(importRef, session.userId, await this.runtime.stateStore.uniqueCode())
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error) {
        const source = error as { code: string; message: string; retryable?: boolean }
        throw new ArkmePluginError(source.code, source.message, source.retryable === true)
      }
      throw error
    }
  }

  private async projectRecordingImportHistoryItem(
    task: RecordingImportOwnerTaskSnapshot,
    viewerUserId?: number,
    ownerRefKey?: Buffer,
  ): Promise<PublicRecordingImportHistoryItem> {
    const owner = task.session
    const ownerProgress = task.progress
    const status = recordingImportOwnerStatus(task)
    return {
      taskKey: await this.recordingImportTaskKey(owner.sessionId, viewerUserId, ownerRefKey),
      sessionRef: await this.recordingImportSessionRef(owner, viewerUserId, ownerRefKey),
      ownership: owner.ownership,
      fileName: owner.fileName,
      fileSize: owner.fileSize,
      parsedSize: owner.parsedSize,
      durationMillis: owner.durationMillis,
      startAtMillis: owner.startAtMillis,
      endAtMillis: owner.endAtMillis,
      progress: 1,
      status: status.status,
      statusDetail: status.statusDetail,
      createdAtMillis: owner.createdAtMillis,
      updatedAtMillis: owner.updatedAtMillis,
      ...(ownerProgress?.importProgress === undefined ? {} : { importProgress: ownerProgress.importProgress }),
    }
  }

  private async projectRecordingImportOwnerTask(
    task: RecordingImportOwnerTaskSnapshot,
    viewerUserId?: number,
    ownerRefKey?: Buffer,
    acceptedLocalJob?: RecordingImportJob,
  ): Promise<PublicRecordingImportOwnerTask> {
    const owner = task.session
    const ownerProgress = task.progress
    const status = recordingImportOwnerStatus(task)
    const localImportTiming = acceptedLocalJob !== undefined
      && Number.isSafeInteger(acceptedLocalJob.createdAtMillis)
      && Number.isSafeInteger(acceptedLocalJob.updatedAtMillis)
      && acceptedLocalJob.createdAtMillis > 0
      && acceptedLocalJob.updatedAtMillis >= acceptedLocalJob.createdAtMillis
      ? {
          startedAtMillis: acceptedLocalJob.createdAtMillis,
          acceptedAtMillis: acceptedLocalJob.updatedAtMillis,
        }
      : undefined
    return {
      kind: 'owner',
      taskKey: await this.recordingImportTaskKey(owner.sessionId, viewerUserId, ownerRefKey),
      sessionRef: await this.recordingImportSessionRef(owner, viewerUserId, ownerRefKey),
      ownership: owner.ownership,
      fileName: owner.fileName,
      fileSize: owner.fileSize,
      parsedSize: owner.parsedSize,
      durationMillis: owner.durationMillis,
      startAtMillis: owner.startAtMillis,
      endAtMillis: owner.endAtMillis,
      progress: owner.hasFinishedUpload ? 1 : owner.fileSize <= 0 ? 0 : Math.min(1, owner.parsedSize / owner.fileSize),
      status: status.status,
      statusDetail: status.statusDetail,
      createdAtMillis: owner.createdAtMillis,
      updatedAtMillis: owner.updatedAtMillis,
      ...(localImportTiming === undefined ? {} : { localImportTiming }),
      ...(ownerProgress?.importProgress === undefined ? {} : { importProgress: ownerProgress.importProgress }),
    }
  }

  private async recordingImportTaskKey(sessionId: string, viewerUserId?: number, refKey?: Buffer): Promise<string> {
    const userId = viewerUserId ?? (await this.runtime.requireSession()).userId
    return createHmac('sha256', refKey ?? await this.recordingRefKey(RECORDING_IMPORT_SESSION_REF_PREFIX))
      .update(`${String(userId)}\0${sessionId}`)
      .digest('base64url')
  }

  private async recordingImportSessionRef(
    owner: Pick<RecordingImportOwnerSession, 'sessionId'>,
    viewerUserId?: number,
    refKey?: Buffer,
  ): Promise<string> {
    const userId = viewerUserId ?? (await this.runtime.requireSession()).userId
    const payload: RecordingImportSessionRefPayload = {
      version: 1,
      viewerUserId: userId,
      sessionId: owner.sessionId,
    }
    return this.sealRecordingRefWithKey(
      RECORDING_IMPORT_SESSION_REF_PREFIX,
      payload,
      refKey ?? await this.recordingRefKey(RECORDING_IMPORT_SESSION_REF_PREFIX),
    )
  }

  private async openRecordingImportSessionRef(sessionRef: string): Promise<RecordingImportSessionRefPayload> {
    const raw = await this.openRecordingRef(RECORDING_IMPORT_SESSION_REF_PREFIX, sessionRef)
    const payload: RecordingImportSessionRefPayload = {
      version: 1,
      viewerUserId: numberValue(raw.viewerUserId),
      sessionId: stringValue(raw.sessionId).trim(),
    }
    if (payload.sessionId === '') {
      throw new ArkmePluginError('recording-import-session-ref-invalid', '录音导入任务引用无效', false)
    }
    return payload
  }

  private async assertRecordingImportOwnerMutationSafe(
    userId: number,
    sessionId: string,
  ): Promise<void> {
    const active = (await this.runtime.stateStore.listRecordingImportJobs(userId))
      .find(job => job.sessionId === sessionId && !['accepted', 'cancelled'].includes(job.phase))
    if (active === undefined) return
    throw new ArkmePluginError(
      'recording-import-owner-mutation-active',
      '录音仍在本机上传任务中，请先重试或取消当前任务',
      false,
      409,
    )
  }

  async recordingHistory(input: { cursor: string }, signal?: AbortSignal): Promise<RecordingHistoryPage> {
    this.assertWorkbenchEnabled()
    if (typeof input.cursor !== 'string' || input.cursor.length > 512) {
      throw new ArkmePluginError('recording-history-invalid', '录音记录查询参数无效', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<unknown>('/api/v1/audio/recording-presence/history', {
      cursor: input.cursor, limit: 20,
    }, session, signal, { bypassCache: true })
    return parseRecordingHistory(data)
  }

  async recordingPresence(signal?: AbortSignal): Promise<RecordingPresenceSnapshot> {
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<unknown>(
      '/api/v1/audio/recording-presence/list', {}, session, signal, { bypassCache: true },
    )
    return parseRecordingPresence(data)
  }

  async recordingTotalsIndex(account: string, toMillis: number, offset: number, signal?: AbortSignal): Promise<RecordingTotalsIndexPage> {
    this.assertWorkbenchEnabled()
    if (!Number.isSafeInteger(toMillis) || toMillis <= 0 || toMillis > Date.now() + 60_000
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 500_000) throw new ArkmePluginError('recording-range-invalid', '录音统计范围无效', false)
    const session = await this.runtime.requireSession()
    if (account !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('account-changed', '账号已切换', false)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>('/api/v1/audio/get-session-ls',
      { to_stamp: toMillis, offset, limit: 50, query_new: false }, session, signal, { lane: 'background-read', bypassCache: true })
    if (!Array.isArray(data.session_ls) || data.session_ls.length > 50) throw new ArkmePluginError('recording-totals-invalid', '录音列表不完整', true)
    const items: RecordingTotalsIndexPage['items'] = []
    for (const raw of data.session_ls) {
      const row = objectValue(raw)
      if (typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(row.start_at) || (row.start_at as number) < 0
        || (row.start_at as number) >= toMillis || !Number.isSafeInteger(row.user_id) || (row.user_id as number) <= 0) {
        throw new ArkmePluginError('recording-totals-invalid', '录音日期或归属不完整', true)
      }
      if (!recordingUploadedByViewer(row, session.userId)) continue
      const date = new Date(row.start_at as number); date.setHours(0, 0, 0, 0)
      const hash = (value: string) => createHash('sha256').update(value).digest('hex')
      items.push({ key: hash(`${session.userId}:${row.id}`), dateStamp: date.getTime(),
        revision: hash(JSON.stringify([row.id, row.update_at, row.start_at, row.end_at, row.duration, row.size, row.has_done_child, row.has_finish_spk])),
        pending: row.has_done_child !== true })
    }
    return { items, nextOffset: data.session_ls.length === 50 ? offset + 50 : null }
  }

  async recordingTotalsBucket(account: string, dateStamp: number, signal?: AbortSignal) {
    this.assertWorkbenchEnabled()
    const day = this.recordingDayStart(dateStamp), end = new Date(day); end.setDate(end.getDate() + 1)
    const session = await this.runtime.requireSession()
    if (account !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('account-changed', '账号已切换', false)
    const data = await new RecordingReadOwner(this.runtime, 'background-read').startDayMetrics(
      { startAt: day.getTime(), endAt: end.getTime() }, session, signal)
    return projectRecordingTotalsBucket(data)
  }

  async recordingCalendar(
    fromStamp: number,
    toStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingCalendarMonth> {
    const from = Math.trunc(fromStamp)
    const to = Math.trunc(toStamp)
    if (!isRecordingLocalDateOnOrAfterMinimum(from) || !Number.isSafeInteger(to) || to <= from
      || to - from > 33 * 24 * 60 * 60 * 1000) {
      throw new ArkmePluginError('recording-range-invalid', '录音日历范围无效', false)
    }
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-calender-summary',
      { from_stamp: from, to_stamp: to },
      session,
      signal,
    )
    const durations = listValue(data.duration_ls)
    const unreviewed = listValue(data.un_click_session_ids_per_day)
    const count = Math.max(durations.length, unreviewed.length)
    const cursor = new Date(from)
    const days = []
    for (let index = 0; index < count; index += 1) {
      const durationMillis = Math.max(0, numberValue(durations[index]))
      const unreviewedCount = listValue(unreviewed[index]).length
      days.push({
        dateStamp: cursor.getTime(),
        durationMillis,
        hasRecording: durationMillis > 0 || unreviewedCount > 0,
        unreviewedCount,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    const totals = parseRecordingTotalMetrics(data.recording_totals)
    return { fromStamp: from, toStamp: to, days, ...(totals ? { totals } : {}) }
  }

  async recordingTranscript(
    dateStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingTranscriptSection> {
    const section = await this.recordingTranscriptWithSession(dateStamp, await this.runtime.requireSession(), signal)
    return { ...section, items: section.items.map(item => this.recordingToolTranscriptItem(item)) }
  }

  private async recordingTranscriptWithSession(
    dateStamp: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    window?: ArkmeRecordingWindow,
  ): Promise<ArkmeRecordingPrivateTranscriptSection> {
    this.validateRecordingWindow(window)
    const dayStart = window ? new Date(window.dateStamp) : this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart); if(window) dayEnd.setTime(window.endStamp); else dayEnd.setDate(dayEnd.getDate() + 1)
    return await this.ownerTranscriptSection(await this.readOwner.completeDay({ startAt: Math.max(0, dayStart.getTime()), endAt: dayEnd.getTime() }, 'primary', session, signal), 'system', session, signal)
  }

  private async ownerTranscriptSection(page: RecordingOwnerDayPage, source: ArkmeRecordingTranscriptSource, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeRecordingPrivateTranscriptSection> {
    const profiles = await this.recordingSpeakerProfiles([...new Set(page.items.flatMap(item => item.speaker.userId === undefined ? [] : [item.speaker.userId]))], session, signal, false, 'interactive-read')
    await this.ensureRecordingSession(session, signal)
    const fragments: RecordingOwnerFragment[] = []
    for (const fragment of page.items) {
      const previous = fragments.at(-1)
      if (previous !== undefined && previous.recordingId === fragment.recordingId && previous.index === fragment.index) {
        if (previous.textEnd !== fragment.textStart) throw new ArkmePluginError('recording-owner-response-invalid', '转写片段不连续', true, 502)
        previous.text += fragment.text; previous.textEnd = fragment.textEnd
      } else fragments.push({ ...fragment })
    }
    const items = fragments.map(item => this.ownerTranscriptItem(item, session.userId, profiles))
    const processingCount = page.coverage.processing_count
    const state = items.length > 0 ? 'ready' : processingCount > 0 ? 'processing' : page.coverage.failed_count > 0 ? 'error' : 'empty'
    let message = ''
    if (state === 'processing') message = '音频文字正在导入&转写中'
    else if (state === 'error') message = source === 'doubao' ? '豆包转写失败，请稍后重试' : '转写失败，请稍后重试'
    else if (state === 'empty') {
      // Text availability is specific to the selected recognizer. Recording
      // duration comes from the owner metadata, independently of transcript
      // contents and the separately loaded physical timeline coverage.
      message = source === 'doubao' ? '暂无豆包转写内容'
        : page.totalDurationMillis > 0 ? '已有录音，暂无转写内容' : '当天无录音'
    }
    return {
      state, items, message,
      dailyMetrics: projectRecordingDailyMetrics(page.storage, items, page.asrInput),
      identityCoverage: 'complete', totalDurationMillis: page.totalDurationMillis, processingCount,
      ...(page.captureCoverage === undefined ? {} : { captureCoverage: page.captureCoverage }),
    }
  }

  private ownerTranscriptItem(item: RecordingOwnerFragment, viewerUserId: number, profiles: Map<number, { displayName: string; avatarRef?: string }>): ArkmeRecordingPrivateTranscriptItem {
    if (item.locator.source === 'comparison') throw new ArkmePluginError('recording-source-invalid', '对比结果不属于正式正文', false, 502)
    const identity = item.speakerEdit?.partitionId ? `partition:${item.speakerEdit.partitionId}` : item.speaker.reference || `unknown:${item.recordingId}:${item.locator.child_id}:${item.locator.source}:${String(item.locator.ordinal)}`
    const color = createHash('sha256').update(identity).digest().readUInt32BE(0)
    const profile = item.speaker.userId === undefined ? undefined : profiles.get(item.speaker.userId)
    return {
      itemId: createHash('sha256').update(`${String(viewerUserId)}:${item.recordingId}:${item.locator.child_id}:${item.locator.source}:${String(item.locator.ordinal)}`).digest('base64url'),
      sessionId: item.recordingId, childId: item.locator.child_id, asrItemIndex: item.locator.ordinal,
      transcriptSource: item.locator.source === 'primary' ? 'system' : 'doubao',
      startAtMillis: item.startAt, endAtMillis: item.endAt, text: item.text,
      speakerNumber: color, speakerColorIndex: color, speakerLabel: item.speaker.userId === viewerUserId ? profile?.displayName.trim() || item.speaker.label : item.speaker.label,
      ...(profile?.avatarRef === undefined ? {} : { speakerAvatarRef: profile.avatarRef }),
      isSelf: item.speaker.userId === viewerUserId, isBackground: item.isBackground,
      speakerReference: item.speaker.reference, speakerIdentity: identity,
      readView: { recording_uid: item.recordingId, revision: item.revision, source: item.locator.source === 'primary' ? 'primary' : 'enhanced' },
      sourceSpeakerNumber: item.speakerEdit?.sourceNumber ?? -1, assignmentSpeakerNumber: item.speakerEdit?.assignmentNumber ?? -1,
      formalSpeakerId: item.speakerEdit?.formalSpeakerId ?? '', childAsrItemStartAt: item.speakerEdit?.start ?? 0, childAsrItemEndAt: item.speakerEdit?.end ?? 0,
      ...(item.speakerEdit === undefined ? {} : { speakerRevision: item.speakerEdit.revision }),
      ...(item.soundSource === undefined ? {} : { soundSource: item.soundSource }), ...(item.containsPlayback === undefined ? {} : { containsPlayback: item.containsPlayback }),
      playbackLocator: item.locator, event: item.event, ...(item.searchVersion === undefined ? {} : { searchVersion: item.searchVersion }), ...(item.recordingBelongsToViewer === undefined ? {} : { recordingBelongsToViewer: item.recordingBelongsToViewer }),
      textStartOffset: item.textStart, textEndOffset: item.textEnd, textTotalLength: item.textTotal,
      generationText: `${item.isBackground ? '(背景音)' : ''}${item.text}`,
    }
  }

  async recordingTranscriptPage(dateStamp: number, options: ArkmeRecordingTranscriptPageOptions = {}): Promise<ArkmeRecordingTranscriptPage> {
    return await this.recordingTranscriptPageWithSession(dateStamp, await this.runtime.requireSession(), options)
  }

  private async readDayPage(dateStamp: number, session: ArkmeSessionCredentials, options: ArkmeRecordingTranscriptPageOptions) {
    this.validateRecordingWindow(options.window)
    let window = options.window
    const source = options.source ?? 'system'
    if (source !== 'system' && source !== 'doubao') throw new ArkmePluginError('recording-source-invalid', '转写来源无效', false, 400)
    let continuation: RecordingDayReadCursor | undefined
    if (options.cursor !== undefined && options.cursor !== '') {
      if (options.cursor.length > 8 * 1024 * 1024) throw new ArkmePluginError('recording-cursor-invalid', '录音分页引用无效', false, 400)
      // This authenticated ciphertext is only generated by this Host. Audio
      // revisions, account, date and source are checked again on every page.
      const raw = await this.openRecordingRef('arkme-recording-page-v1', options.cursor)
      if (raw.dateStamp !== dateStamp || raw.source !== source || raw.continuation === null
        || typeof raw.continuation !== 'object' || !Array.isArray((raw.continuation as RecordingDayReadCursor).positions)) {
        throw new ArkmePluginError('recording-cursor-invalid', '录音分页引用不匹配，请刷新后重试', false, 409)
      }
      const boundWindow = raw.window as ArkmeRecordingWindow | undefined
      this.validateRecordingWindow(boundWindow)
      if (window && (!boundWindow || window.dateStamp !== boundWindow.dateStamp || window.endStamp !== boundWindow.endStamp || window.timeZone !== boundWindow.timeZone || window.date !== boundWindow.date)) throw new ArkmePluginError('recording-cursor-invalid', '录音日期范围已变化', false, 409)
      window = boundWindow
      continuation = raw.continuation as RecordingDayReadCursor
    }
    const dayStart = window ? new Date(window.dateStamp) : this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart); if (window) dayEnd.setTime(window.endStamp); else dayEnd.setDate(dayEnd.getDate() + 1)
    const page = await this.readOwner.dayPage({ startAt: Math.max(0, dayStart.getTime()), endAt: dayEnd.getTime() }, source === 'system' ? 'primary' : 'enhanced', session, continuation, options.signal)
    return { ...page, window }
  }

  private async recordingTranscriptPageWithSession(dateStamp: number, session: ArkmeSessionCredentials, options: ArkmeRecordingTranscriptPageOptions): Promise<ArkmeRecordingTranscriptPage> {
    const date = options.window || options.cursor ? dateStamp : this.recordingDayStart(dateStamp).getTime()
    const source = options.source ?? 'system'
    const page = await this.readDayPage(date, session, options)
    return await this.projectWorkbenchPage(date, source, page, session, options.signal)
  }

  private async projectWorkbenchPage(dateStamp: number, source: ArkmeRecordingTranscriptSource, page: RecordingOwnerDayPage & { window?: ArkmeRecordingWindow | undefined }, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeRecordingTranscriptPage> {
    const section = await this.ownerTranscriptSection(page, source, session, signal)
    const [key, pageKey, speakerRefKey] = await Promise.all([this.recordingRefKey('arkme-recording-item-v1'), this.recordingRefKey('arkme-recording-page-v1'), this.recordingRefKey('arkme-recording-speaker-v1')])
    await this.ensureRecordingSession(session, signal)
    const viewRef = createHmac('sha256', pageKey).update(JSON.stringify({ viewer: session.userId, dateStamp, source, window: page.window, views: page.views })).digest('base64url')
    const nextCursor = page.next === undefined ? '' : this.sealRecordingRefWithKey('arkme-recording-page-v1', {
      version: 1, viewerUserId: session.userId, dateStamp, source, ...(page.window ? { window: page.window } : {}), continuation: page.next,
    }, pageKey)
    if (nextCursor.length > 8 * 1024 * 1024) throw new ArkmePluginError('recording-cursor-too-large', '当天录音数量超出分页读取范围', false, 413)
    return { ...section, dateStamp, transcriptSource: source, viewRef, nextCursor, ...(page.window ? {window:page.window} : {}),
      items: section.items.map(item => this.workbenchItem(dateStamp, item, session.userId, key, speakerRefKey, page.window)),
    }
  }

  async recordingComparison(dateStamp: number, signal?: AbortSignal): Promise<ArkmeRecordingComparison> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const date = this.recordingDayStart(dateStamp).getTime()
    const [system, doubao] = await Promise.all([
      this.readDayPage(date, session, { source: 'system', signal }), this.readDayPage(date, session, { source: 'doubao', signal }),
    ])
    const [primary, enhanced] = await Promise.all([
      this.projectWorkbenchPage(date, 'system', system, session, signal), this.projectWorkbenchPage(date, 'doubao', doubao, session, signal),
    ])
    await this.ensureRecordingSession(session, signal)
    return { dateStamp: date, system: primary, doubao: enhanced,
      candidateCount: doubao.coverage.candidate_count, failedCount: doubao.coverage.failed_count, silentCount: doubao.coverage.silent_count }

  }

  async startRecordingComparison(dateStamp: number, signal?: AbortSignal): Promise<{ queuedCount: number; inFlightCount: number; missingAudioCount: number }> {
    this.assertWorkbenchEnabled()
    const date = this.recordingDayStart(dateStamp).getTime()
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>('/api/v1/audio/doubao-asr/backfill-day', { start_at: date }, session, signal)
    return { queuedCount: numberValue(data.queued_child_count), inFlightCount: numberValue(data.in_flight_child_count), missingAudioCount: numberValue(data.missing_audio_child_count) }
  }

  async recordingProjection(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> {
    return await this.recordingProjectionWithSession(dateStamp, kind, await this.runtime.requireSession(), signal)
  }

  async generateRecordingProjection(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    routeKey = '',
    signal?: AbortSignal,
    window?: ArkmeRecordingWindow,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> {
    this.assertWorkbenchEnabled()
    this.validateRecordingWindow(window)
    const normalizedRouteKey = routeKey.trim()
    if (normalizedRouteKey.length > 256) {
      throw new ArkmePluginError('recording-summary-model-route-invalid', '录音总结模型无效', false, 400)
    }
    const dayStart = window ? new Date(window.dateStamp) : this.recordingDayStart(dateStamp)
    const session = await this.runtime.requireSession()
    const transcript = await this.recordingTranscriptWithSession(dayStart.getTime(), session, signal, window)
    if (transcript.state === 'processing') {
      throw new ArkmePluginError(
        'recording-generation-transcript-processing',
        '录音仍在转写，请完成后再生成',
        true,
        409,
      )
    }
    if (transcript.items.length === 0) {
      throw new ArkmePluginError(
        'recording-generation-transcript-empty',
        '当天没有可用于生成的已完成转写',
        false,
        409,
      )
    }
    const firstItem = transcript.items[0]!
    const endAt = transcript.items.reduce((end, item) => Math.max(end, item.endAtMillis), firstItem.endAtMillis)
    const response = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/summary/create',
      {
        date_stamp: dayStart.getTime(),
        ...(window ? { time_zone: window.timeZone, day_end_stamp: window.endStamp } : {}),
        tz_offset: window ? recordingBatchOffset(window.dateStamp, window.timeZone) : -dayStart.getTimezoneOffset() * 60_000,
        from_stamp: firstItem.startAtMillis,
        to_stamp: endAt,
        model_type: 1,
        prompt_ver: 1,
        transcripts: buildRecordingGenerationTranscript(transcript.items, kind, dayStart.getTime(), window?.timeZone),
        kind: kind === 'timeline' ? 1 : 2,
        ...(normalizedRouteKey === '' ? {} : { route_key: normalizedRouteKey }),
      },
      session,
      signal,
      { lane: 'write', bypassCache: true },
    )
    const flag = numberValue(response.flag)
    const summaryId = stringValue(response.summary_id).trim()
    if ((flag !== 1 && flag !== 2) || (flag === 1 && summaryId === '')) {
      throw new ArkmePluginError('recording-generation-response-invalid', '生成请求响应无效', true, 502)
    }
    try {
      const section = await this.recordingProjectionWithSession(dayStart.getTime(), kind, session, signal, window)
      return section.state === 'empty'
        ? { state: 'processing', items: section.items, message: '内容仍在生成' }
        : section
    } catch (reason) {
      if (signal?.aborted === true) throw reason
      // The owner accepted the write. A failed immediate read must not invite a duplicate retry.
      return { state: 'processing', items: [], message: '内容仍在生成' }
    }
  }

  async recordingSummaryModelConfig(signal?: AbortSignal): Promise<ArkmeRecordingSummaryModelConfig> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio-summary/model-config/list', {}, session, signal,
    )
    return projectRecordingSummaryModelConfig(data)
  }

  async setRecordingSummaryModelRoute(
    routeKey: string,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingSummaryModelRouteUpdate> {
    this.assertWorkbenchEnabled()
    const normalizedRouteKey = routeKey.trim()
    if (normalizedRouteKey === '' || normalizedRouteKey.length > 256) {
      throw new ArkmePluginError('recording-summary-model-route-invalid', '录音总结模型无效', false, 400)
    }
    const session = await this.runtime.requireSession()
    await this.runtime.authenticatedAudioPost(
      '/api/v1/audio-summary/model-config/set', { route_key: normalizedRouteKey }, session, signal,
      { lane: 'write', bypassCache: true },
    )
    return { effectiveRouteKey: normalizedRouteKey }
  }

  private async recordingProjectionWithSession(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    window?: ArkmeRecordingWindow,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> {
    const dayStart = window ? new Date(window.dateStamp) : this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart)
    if (window) dayEnd.setTime(window.endStamp); else dayEnd.setDate(dayEnd.getDate() + 1)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/summary/list-timeline-by-range',
      {
        from_stamp: dayStart.getTime(),
        to_stamp: dayEnd.getTime(),
        date_stamp: dayStart.getTime(),
        kind: kind === 'timeline' ? 1 : 2,
      },
      session,
      signal,
    )
    return this.recordingVersionSection(projectRecordingVersions(data, kind))
  }

  /** Resolve an Explore audio anchor against the owned original ASR version, including historical Doubao sources. */
  async exploreRecordingEvidence(owner: Record<string, unknown>, quote: string, signal?: AbortSignal, window?: ArkmeRecordingWindow): Promise<Extract<import('../explore-contract.js').ExploreSource, {kind:'recording'}>> {
    const session = await this.runtime.requireSession()
    const start = Number(owner.start_at)
    const source = owner.transcript_source
    if (!Number.isFinite(start) || start <= 0 || !['system', 'doubao'].includes(String(source)) || typeof owner.container_id !== 'string' || typeof owner.child_id !== 'string' || !Number.isSafeInteger(owner.item_ordinal)) {
      throw new ArkmePluginError('explore-source-unavailable', '这条录音缺少精确定位信息', false, 404)
    }
    const dayStart = new Date(start)
    dayStart.setHours(0, 0, 0, 0)
    this.validateRecordingWindow(window)
    const date = window?.dateStamp ?? this.recordingDayStart(dayStart.getTime()).getTime()
    const rows = await this.completeRecordingRows(date, source as ArkmeRecordingTranscriptSource, session, signal, window)
    const index = rows.findIndex(row => row.sessionId === owner.container_id && row.childId === owner.child_id && row.asrItemIndex === owner.item_ordinal)
    const row = rows[index]
    if (!row || Math.abs(row.startAtMillis - start) > 2000 || quote.trim() && ![row.text, row.rawTranscriptText ?? ''].some(value => value.includes(quote.trim()))) {
      throw new ArkmePluginError('explore-source-changed', '原转写已更新或不可访问，未跳转到其他相似内容', false, 409)
    }
    const refKey = await this.recordingRefKey('arkme-recording-item-v1'), speakerKey = await this.recordingRefKey('arkme-recording-speaker-v1')
    const context = rows.slice(Math.max(0, index - 2), index + 3).filter(item => item.sessionId === row.sessionId)
    // Doubao timestamps do not name the physical FLAC slices. Only use a system
    // slice from the same child that actually contains this source instant.
    const primary = source === 'system' ? rows : await this.completeRecordingRows(date, 'system', session, signal, window)
    const playbackTargets = context.flatMap(item => {
      const target = source === 'system' ? item : primary.find(candidate =>
        candidate.sessionId === item.sessionId && candidate.childId === item.childId
        && candidate.startAtMillis <= item.startAtMillis && candidate.endAtMillis > item.startAtMillis)
      return target ? [{itemId:item.itemId,item:this.workbenchItem(date,target,session.userId,refKey,speakerKey,window)}] : []
    })
    return { kind: 'recording', dateStamp: date, focusItemId: row.itemId,
      items: context.map(item => this.workbenchItem(date, item, session.userId, refKey, speakerKey, window)),
      playbackTargets,
      ...(source === 'system' ? { segment: { sessionId: row.sessionId, childId: row.childId, itemIndex: row.asrItemIndex, transcriptSource: 'system' as const, transcriptVersion: recordingSearchVersion({...row, text:row.rawTranscriptText ?? row.text}) } } : {}),
    }
  }

  /** Host-only evidence reader: never expose Audio owner IDs through a consumer DTO. */
  async entityTranscriptRows(dateStamp: number, source: ArkmeRecordingTranscriptSource, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeRecordingPrivateTranscriptItem[]> {
    const dayStart = this.recordingDayStart(dateStamp), dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const page = await this.readOwner.completeSelectedRecordings({ startAt: Math.max(0, dayStart.getTime()), endAt: dayEnd.getTime() }, source === 'system' ? 'primary' : 'enhanced', session, signal)
    await this.ensureRecordingSession(session, signal)
    // The semantic owner preserves raw text, source coordinates and its version.
    // Entity evidence needs neither profile requests nor legacy whole-day reads.
    return page.items.map(item => this.ownerTranscriptItem(item, session.userId, new Map()))
  }

  private validateRecordingWindow(window?: ArkmeRecordingWindow): void {
    if (!window) return
    try {
      if (!Number.isSafeInteger(window.dateStamp) || !Number.isSafeInteger(window.endStamp) || window.dateStamp < -26 * 3600_000 || window.endStamp <= 0 || window.endStamp <= window.dateStamp || window.endStamp - window.dateStamp > 26 * 3600_000) throw new Error()
      const civil = new Date(window.dateStamp + recordingBatchOffset(window.dateStamp, window.timeZone))
      const end = new Date(window.endStamp + recordingBatchOffset(window.endStamp, window.timeZone))
      if (civil.toISOString() !== `${window.date}T00:00:00.000Z` || end.getTime() - civil.getTime() !== 86400_000) throw new Error()
    } catch { throw new ArkmePluginError('recording-window-invalid', '录音日期范围无效', false, 400) }
  }

  async recordingDay(dateStamp: number, signal?: AbortSignal, window?: ArkmeRecordingWindow): Promise<ArkmeRecordingDay> {
    this.validateRecordingWindow(window)
    if (window && (!Number.isSafeInteger(dateStamp) || dateStamp < -26 * 3600_000)) throw new ArkmePluginError('recording-date-invalid', '录音日期无效', false, 400)
    return await this.recordingDayWithSession(dateStamp, await this.runtime.requireSession(), signal, window)
  }

  private async recordingDayWithSession(
    dateStamp: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    window?: ArkmeRecordingWindow,
    fresh = false,
  ): Promise<ArkmeRecordingDay> {
    const date = window ? dateStamp : this.recordingDayStart(dateStamp).getTime()
    const dayStart = window ? window.dateStamp : date
    const dayEnd = new Date(dayStart); if (window) dayEnd.setTime(window.endStamp); else dayEnd.setDate(dayEnd.getDate() + 1)
    const [transcriptResult, summaryResult, timelineResult, coverageResult] = await Promise.allSettled([
      this.recordingTranscriptPageWithSession(date, session, { signal, ...(window ? {window}: {}) }),
      this.recordingProjectionWithSession(date, 'summary', session, signal, window),
      this.recordingProjectionWithSession(date, 'timeline', session, signal, window),
      this.readOwner.physicalCoverage({ startAt: Math.max(0, dayStart), endAt: dayEnd.getTime() }, session, signal),
    ])
    await this.ensureRecordingSession(session, signal)
    let transcript: ArkmeRecordingDay['transcript']
    if (transcriptResult.status === 'fulfilled') transcript = transcriptResult.value
    else transcript = {
      dateStamp: date, transcriptSource: 'system', viewRef: '', nextCursor: '',
      state: 'error', items: [], message: safeFailureMessage(transcriptResult.reason),
      totalDurationMillis: 0, processingCount: 0,

    }
    return {
      dateStamp: date,
      coverage: coverageResult.status === 'fulfilled' ? coverageResult.value : { state: 'error', intervals: [] },
      totalDurationMillis: transcriptResult.status === 'fulfilled'
        ? transcript.totalDurationMillis
        : 0,
      transcript,
      summary: summaryResult.status === 'fulfilled' ? summaryResult.value : {
        state: 'error', items: [], message: safeFailureMessage(summaryResult.reason),
      },
      timeline: timelineResult.status === 'fulfilled' ? timelineResult.value : {
        state: 'error', items: [], message: safeFailureMessage(timelineResult.reason),
      },
    }
  }

  private workbenchItem(
    dateStamp: number,
    item: ArkmeRecordingPrivateTranscriptItem,
    viewerUserId: number,
    refKey: Buffer,
    speakerRefKey: Buffer,
    window?: ArkmeRecordingWindow,
  ): ArkmeRecordingWorkbenchItem {
    const payload: RecordingItemRefPayload = {
      version: 1,
      viewerUserId,
      dateStamp,
      ...(window ? { window } : {}),
      sessionId: item.sessionId,
      childId: item.childId,
      asrItemIndex: item.asrItemIndex,
      transcriptSource: item.transcriptSource,
      startAtMillis: item.startAtMillis,
      endAtMillis: item.endAtMillis,
      speakerReference: item.speakerReference,
      revision: item.readView.revision,
      sourceSpeakerNumber: item.sourceSpeakerNumber,
      assignmentSpeakerNumber: item.assignmentSpeakerNumber,
      speakerIdentity: item.speakerIdentity,
      formalSpeakerId: item.formalSpeakerId,
      childAsrItemStartAt: item.childAsrItemStartAt,
      childAsrItemEndAt: item.childAsrItemEndAt,
      ...(item.speakerRevision === undefined ? {} : { speakerRevision: item.speakerRevision }),
    }
    return {
      itemId: item.itemId,
      recordingBelongsToViewer: item.recordingBelongsToViewer === true,
      itemRef: this.sealRecordingRefWithKey('arkme-recording-item-v1', payload, refKey),
      ...(item.transcriptSource !== 'system' || !item.searchVersion && (item.textStartOffset !== 0 || item.textEndOffset !== item.textTotalLength) ? {} : {
        searchIdentityHash: recordingSearchIdentityHash({sessionId:item.sessionId,childId:item.childId,itemIndex:item.asrItemIndex,transcriptSource:item.transcriptSource}),
        searchVersion: item.searchVersion ?? recordingSearchVersion(item),
      }),
      transcriptSource: item.transcriptSource,
      sessionKey: createHmac('sha256', refKey).update(`recording-session:${String(viewerUserId)}:${item.sessionId}`).digest('base64url'),
      startAtMillis: item.startAtMillis,
      endAtMillis: item.endAtMillis,
      speakerNumber: item.speakerNumber,
      speakerKey: createHmac('sha256', refKey).update(`speaker:${item.speakerIdentity}`).digest('base64url'),
      ...(item.formalSpeakerId === '' ? {} : { assignedSpeakerOptionKey: this.recordingSpeakerOptionKey(speakerRefKey, viewerUserId, 'speaker', item.speakerReference) }),
      speakerColorIndex: item.speakerColorIndex,
      speakerLabel: item.speakerLabel,
      ...(item.speakerAvatarRef === undefined ? {} : { speakerAvatarRef: item.speakerAvatarRef }),
      canBindSpeaker: item.speakerReference !== '',
      ...(item.soundSource === undefined ? {} : { soundSource: item.soundSource }),
      ...(item.containsPlayback ? { containsPlayback: true } : {}),
      isSelf: item.isSelf,
      isBackground: item.isBackground,
      text: item.text,
      textStartOffset: item.textStartOffset, textEndOffset: item.textEndOffset, textTotalLength: item.textTotalLength,
    }
  }

  private recordingToolTranscriptItem(item: ArkmeRecordingPrivateTranscriptItem): ArkmeRecordingTranscriptItem {
    return {
      itemId: item.itemId,
      sessionId: item.sessionId,
      childId: item.childId,
      asrItemIndex: item.asrItemIndex,
      transcriptSource: item.transcriptSource,
      startAtMillis: item.startAtMillis,
      endAtMillis: item.endAtMillis,
      speakerNumber: item.speakerNumber,
      speakerColorIndex: item.speakerColorIndex,
      speakerLabel: item.speakerLabel,
      ...(item.speakerAvatarRef === undefined ? {} : { speakerAvatarRef: item.speakerAvatarRef }),
      isSelf: item.isSelf,
      isBackground: item.isBackground,
      text: item.text,
      ...(item.soundSource === undefined ? {} : { soundSource: item.soundSource }),
      ...(item.containsPlayback ? { containsPlayback: true } : {}),
    }
  }

  private sealRecordingRefWithKey(prefix: string, payload: object, key: Buffer): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    return `${prefix}.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
  }

  private async ensureRecordingSession(session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId) {
      throw new ArkmePluginError('recording-ref-account-mismatch', '账号已切换，请重新选择录音', false, 403)
    }
  }

  private itemView(item: RecordingItemRefPayload): RecordingReadView {
    return { recording_uid: item.sessionId, revision: item.revision, source: item.transcriptSource === 'system' ? 'primary' : 'enhanced' }
  }

  private itemLocator(item: RecordingCorrectionItemRefPayload): RecordingPlaybackLocator {
    return { child_id: item.childId, ordinal: item.asrItemIndex, source: item.transcriptSource === 'system' ? 'primary' : 'enhanced' }
  }

  private async completeRecordingRows(date: number, source: ArkmeRecordingTranscriptSource, session: ArkmeSessionCredentials, signal?: AbortSignal, window?: ArkmeRecordingWindow): Promise<ArkmeRecordingPrivateTranscriptItem[]> {
    const start = window ? new Date(window.dateStamp) : this.recordingDayStart(date)
    const end = new Date(start); if (window) end.setTime(window.endStamp); else end.setDate(end.getDate() + 1)
    const page = await this.readOwner.completeDay({ startAt: Math.max(0, start.getTime()), endAt: end.getTime() }, source === 'system' ? 'primary' : 'enhanced', session, signal)
    return (await this.ownerTranscriptSection(page, source, session, signal)).items
  }

  private async currentRecordingSpeakerItems(item: RecordingItemRefPayload, session: ArkmeSessionCredentials, signal?: AbortSignal, _fresh = true): Promise<ArkmeRecordingPrivateTranscriptItem[]> {
    const rows = await this.completeRecordingRows(item.dateStamp, item.transcriptSource, session, signal, item.window)
    const selected = rows.find(row => row.sessionId === item.sessionId && row.childId === item.childId && row.asrItemIndex === item.asrItemIndex)
    if (!selected || selected.readView.revision !== item.revision || selected.speakerIdentity !== item.speakerIdentity || selected.formalSpeakerId !== item.formalSpeakerId)
      throw new ArkmePluginError('recording-speaker-conflict', '说话人信息已变化，请刷新后重试', true, 409)
    return rows
  }

  private sameRecordingSpeakerMutationTarget(candidate: ArkmeRecordingPrivateTranscriptItem, selected: RecordingItemRefPayload): boolean {
    return candidate.speakerIdentity === selected.speakerIdentity && candidate.transcriptSource === selected.transcriptSource
  }

  private async openRecordingCorrectionItemRef(itemRef: string): Promise<RecordingCorrectionItemRefPayload> {
    if (typeof itemRef !== 'string' || itemRef.length > 16384) throw new ArkmePluginError('recording-item-ref-invalid', '录音片段引用无效', false, 400)
    if (!itemRef.startsWith('arkme-recording-evidence-item-v1.')) return this.openRecordingItemRef(itemRef)
    const raw = await this.openRecordingRef('arkme-recording-evidence-item-v1', itemRef)
    this.validateRecordingWindow(raw.window as ArkmeRecordingWindow | undefined)
    if (!['system', 'doubao'].includes(String(raw.transcriptSource)) || !isRecordingLocalDateOnOrAfterMinimum(Number(raw.dateStamp))
      || ![raw.sessionId, raw.childId].every(value => typeof value === 'string' && /^(?!0{24}$)[a-f0-9]{24}$/.test(value))
      || ![raw.asrItemIndex, raw.childAsrItemStartAt, raw.childAsrItemEndAt, raw.startAtMillis, raw.endAtMillis].every(value => Number.isSafeInteger(value) && Number(value) >= 0)
      || Number(raw.childAsrItemEndAt) <= Number(raw.childAsrItemStartAt) || Number(raw.endAtMillis) <= Number(raw.startAtMillis)
      || !stringValue(raw.speakerRevision) || typeof raw.formalSpeakerId !== 'string' || typeof raw.speakerIdentity !== 'string') {
      throw new ArkmePluginError('recording-item-ref-invalid', '录音片段引用已失效，请刷新后重试', false, 409)
    }
    return raw as unknown as RecordingCorrectionItemRefPayload
  }

  private async openRecordingItemRef(itemRef: string): Promise<RecordingItemRefPayload> {
    const raw = await this.openRecordingRef('arkme-recording-item-v1', itemRef)
    const window = raw.window as ArkmeRecordingWindow | undefined
    this.validateRecordingWindow(window)
    const payload: RecordingItemRefPayload = {
      version: 1,
      viewerUserId: numberValue(raw.viewerUserId),
      dateStamp: numberValue(raw.dateStamp),
      ...(window ? { window } : {}),
      sessionId: stringValue(raw.sessionId).trim(),
      childId: stringValue(raw.childId).trim(),
      asrItemIndex: Math.trunc(numberValue(raw.asrItemIndex)),
      transcriptSource: raw.transcriptSource === 'doubao' ? 'doubao' : 'system',
      startAtMillis: numberValue(raw.startAtMillis), endAtMillis: numberValue(raw.endAtMillis),
      speakerReference: stringValue(raw.speakerReference), revision: stringValue(raw.revision),
      sourceSpeakerNumber: numberValue(raw.sourceSpeakerNumber),
      assignmentSpeakerNumber: numberValue(raw.assignmentSpeakerNumber),
      speakerIdentity: stringValue(raw.speakerIdentity).trim(),
      formalSpeakerId: stringValue(raw.formalSpeakerId).trim(),
      childAsrItemStartAt: numberValue(raw.childAsrItemStartAt),
      childAsrItemEndAt: numberValue(raw.childAsrItemEndAt),
      speakerRevision: stringValue(raw.speakerRevision),
    }
    if (!/^(?!0{24}$)[a-f0-9]{24}$/.test(payload.sessionId) || !/^[a-f0-9]{64}$/.test(payload.revision)
      || !isRecordingLocalDateOnOrAfterMinimum(payload.dateStamp) || !Number.isSafeInteger(raw.asrItemIndex)
      || !Number.isSafeInteger(raw.startAtMillis) || !Number.isSafeInteger(raw.endAtMillis) || payload.endAtMillis <= payload.startAtMillis
      || raw.transcriptSource !== 'system' && raw.transcriptSource !== 'doubao'
      || typeof raw.speakerReference !== 'string' || payload.speakerReference !== '' && !/^speaker:[a-f0-9]{16}$/.test(payload.speakerReference)) {
      throw new ArkmePluginError('recording-item-ref-invalid', '录音片段引用已失效，请刷新后重试', false, 409)
    }
    recordingPlaybackLocator(this.itemLocator(payload))
    return payload
  }

  private async openRecordingSpeakerRef(speakerRef: string): Promise<RecordingSpeakerRefPayload> {
    const raw = await this.openRecordingRef('arkme-recording-speaker-v1', speakerRef)
    const target = objectValue(raw.target)
    if (target.kind === 'speaker') {
      const speakerId = stringValue(target.speakerId).trim()
      if (speakerId !== '') return {
        version: 1, viewerUserId: numberValue(raw.viewerUserId), target: { kind: 'speaker', speakerId },
      }
    }
    if (target.kind === 'arkme-user') {
      const userId = positiveUserId(target.userId)
      if (userId !== undefined) return {
        version: 1, viewerUserId: numberValue(raw.viewerUserId), target: { kind: 'arkme-user', userId },
      }
    }
    throw new ArkmePluginError('recording-speaker-ref-invalid', '说话人引用无效', false)
  }

  private async recordingSpeakerIdForUser(
    userId: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<string> {
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-speaker-ls', {}, session, signal,
    )
    for (const raw of listValue(data.spk_ls)) {
      const speaker = objectValue(raw)
      if (positiveUserId(speaker.ref_usr_id ?? speaker.ref_user_id ?? speaker.user_id) !== userId) continue
      const speakerId = stringValue(speaker.speaker_id ?? speaker.id ?? speaker.spk_id).trim()
      if (speakerId !== '') return speakerId
    }
    return ''
  }

  private async currentRecordingSpeakerUser(
    userId: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<{ label: string }> {
    if (this.userCandidates === undefined) {
      throw new ArkmePluginError('recording-speaker-user-unavailable', 'Arkme 用户候选当前不可用，请刷新后重试', true, 503)
    }
    const candidate = (await this.userCandidates.listRecordingSpeakerUsers(session, signal))
      .find(value => value.userId === userId)
    const label = candidate?.label.trim() ?? ''
    if (label === '') {
      throw new ArkmePluginError('recording-speaker-user-unavailable', '该 Arkme 用户已不可用，请刷新后重试', true, 409)
    }
    return { label }
  }

  private async recordingSpeakerNameExists(
    name: string,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const normalized = name.trim().toLocaleLowerCase('zh-CN')
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-speaker-ls', {}, session, signal,
    )
    return listValue(data.spk_ls).some(raw => {
      const speaker = objectValue(raw)
      const label = stringValue(
        speaker.nick_name ?? speaker.nickname ?? speaker.display_name ?? speaker.name,
      ).trim().toLocaleLowerCase('zh-CN')
      return label === normalized
    })
  }

  private async openRecordingRef(prefix: string, ref: string): Promise<Record<string, unknown>> {
    const session = await this.runtime.requireSession()
    const [actualPrefix, ivText, encryptedText, tagText, ...extra] = ref.trim().split('.')
    if (actualPrefix !== prefix || ivText === undefined || encryptedText === undefined || tagText === undefined || extra.length > 0) {
      throw new ArkmePluginError('recording-ref-invalid', '录音引用无效', false)
    }
    let raw: Record<string, unknown>
    try {
      const decipher = createDecipheriv('aes-256-gcm', await this.recordingRefKey(prefix), Buffer.from(ivText, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
      const encoded = Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
      raw = objectValue(JSON.parse(encoded))
    } catch (error) {
      throw new ArkmePluginError('recording-ref-invalid', '录音引用无效', false, 400, { cause: error })
    }
    if (raw.version !== 1 || numberValue(raw.viewerUserId) !== session.userId) {
      throw new ArkmePluginError('recording-ref-account-mismatch', '录音引用与当前账号不匹配', false, 403)
    }
    return raw
  }

  private async recordingRefKey(prefix: string): Promise<Buffer> {
    return createHash('sha256')
      .update(await this.runtime.stateStore.uniqueCode())
      .update(`\0${prefix}`)
      .digest()
  }

  private async recordingSpeakerProfiles(
    userIds: readonly number[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    propagateFailure = false,
    lane: 'interactive-read' | 'background-read' = 'background-read',
  ): Promise<Map<number, { displayName: string; avatarRef?: string }>> {
    if (this.profile === undefined) return new Map()
    if (userIds.length === 0) return new Map()
    try {
      const publicProfiles = await this.profile.publicProfileSummariesByUserIds(userIds, session, signal, undefined, lane)
      const entries = await Promise.all([...publicProfiles].map(async ([userId, profile]) => {
        const displayName = profile.displayName.trim() || profile.nickname.trim()
        const avatarRef = profile.avatarUrl === undefined
          ? undefined
          : await this.profile!.sealProfileImageRef(session.userId, userId)
        return [userId, {
          displayName,
          ...(avatarRef === undefined ? {} : { avatarRef }),
        }] as const
      }))
      return new Map(entries)
    } catch (error) {
      if (propagateFailure) throw error
      // Optional identity enrichment must never hide a readable transcript.
      return new Map()
    }
  }


  private recordingDayStart(dateStamp: number): Date {
    const date = Math.trunc(dateStamp)
    const dayStart = new Date(date)
    if (!isRecordingLocalDateOnOrAfterMinimum(date) || dayStart.getTime() !== date
      || dayStart.getHours() !== 0 || dayStart.getMinutes() !== 0
      || dayStart.getSeconds() !== 0 || dayStart.getMilliseconds() !== 0) {
      throw new ArkmePluginError('recording-date-invalid', '录音日期必须是本地零点', false)
    }
    return dayStart
  }

  private recordingVersionSection(
    items: ArkmeRecordingVersion[],
  ): ArkmeRecordingSection<ArkmeRecordingVersion> {
    if (items[0]?.status === 'processing') {
      return { state: 'processing', items, message: '内容仍在生成' }
    }
    if (items[0]?.status === 'failed') {
      return { state: 'failed', items, message: '最近一次生成失败' }
    }
    if (items.some(item => item.selectable)) return { state: 'ready', items, message: '' }
    return { state: 'empty', items, message: '暂无已生成内容' }
  }
}
