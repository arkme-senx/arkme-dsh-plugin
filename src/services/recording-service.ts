import { recordingPlaybackLocator, type RecordingPlaybackLocator } from '../recording-playback-ref.js'
import { RecordingReadOwner, type RecordingReadView, type RecordingDayReadCursor, type RecordingOwnerFragment, type RecordingOwnerDayPage } from './recording-read-owner.js'
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
  ArkmeRecordingSpeakerRecommendation,
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

interface RecordingItemRefPayload {
  version: 1
  viewerUserId: number
  dateStamp: number
  sessionId: string
  childId: string
  asrItemIndex: number
  transcriptSource: 'system' | 'doubao'
  startAtMillis: number
  endAtMillis: number
  speakerReference: string
  revision: string
}
interface ArkmeRecordingPrivateTranscriptItem extends ArkmeRecordingTranscriptItem {
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
const RECORDING_IMPORT_UNRESOLVED_LIMIT = 20
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
  private readonly importCommands = new Set<string>()
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
    this.unsubscribeSpeakerAccount = runtime.subscribeAccountScope(() => { this.speakerCacheRevision++ })

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
    this.speakerCacheRevision++
    this.unsubscribeSpeakerAccount()
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
    if (input.itemRefs.length === 0 || input.itemRefs.length > RECORDING_FORWARD_MAX_SEGMENTS) throw new ArkmePluginError('recording-forward-selection-invalid', '请选择 1 至 150 个录音片段', false, 400)
    const session = await this.runtime.requireSession()
    const selected = await Promise.all(input.itemRefs.map(async ref => await this.openRecordingItemRef(ref)))
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
    return await this.forwardGateway.forward({ sessionId: first.sessionId, segments: selected.map(item => ({ childId: item.childId, asrItemIndex: item.asrItemIndex, transcriptSource: item.transcriptSource })) }, input, session, signal)
  }

  async recordingPlayback(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingPlayback> {
    this.assertWorkbenchEnabled()
    if (this.media === undefined) throw new ArkmePluginError('recording-playback-unavailable', '录音播放当前不可用', true, 503)
    const payload = await this.openRecordingItemRef(itemRef)
    return {
      playbackRef: await this.media.issueRecordingPlaybackMediaRef({
        viewerUserId: payload.viewerUserId,
        locator: this.itemLocator(payload),
      }, signal),
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

  async recordingSpeakerRecommendation(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerRecommendation> {
    this.assertWorkbenchEnabled()
    const item = await this.openRecordingItemRef(itemRef)
    const session = await this.runtime.requireSession()
    const revision = this.speakerCacheRevision
    if (session.userId !== item.viewerUserId) {
      throw new ArkmePluginError('recording-ref-account-mismatch', '录音引用与当前账号不匹配', false, 403)
    }
    const similar = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/recordings/transcript/speaker/suggestion',
      { ...this.itemView(item), speaker_reference: item.speakerReference, clip_locator: this.itemLocator(item) }, session, signal,
    )
    const reference = stringValue(similar.speaker_reference).trim()
    const key = await this.recordingRefKey('arkme-recording-speaker-v1')
    await this.assertSpeakerReadCurrent(session, revision, signal)
    if (reference === '') return {}
    return { optionKey: this.recordingSpeakerOptionKey(
      key, session.userId, 'speaker', reference,
    ) }
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
      const dayStart = this.recordingDayStart(item.dateStamp)
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
      const page = await this.readOwner.dayPage({ startAt: Math.max(0, dayStart.getTime()), endAt: dayEnd.getTime() }, views[0]!.source, session, undefined, signal)
      if (!page.views.some(view => view.recording_uid === item.sessionId && view.revision === item.revision)) throw new ArkmePluginError('recording-speaker-conflict', '录音信息已变化，请刷新后重试', true, 409)
      // The selected item's original revision is the anchor. Other recordings
      // use their current owner views; no loaded-row list determines the scope.
      views = page.views
    } else {
      const dayEnd = new Date(item.dateStamp); dayEnd.setDate(dayEnd.getDate() + 1)
      await this.readOwner.transcript(item.sessionId, views[0]!.source, { startAt: Math.max(0, item.dateStamp), endAt: dayEnd.getTime() }, session, { limit: 1, revision: item.revision }, signal)
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
    return { scope: input.scope, changedClusters: numberValue(result.changed_clusters), changedItems: numberValue(result.changed_items), day: await this.recordingDayWithSession(item.dateStamp, session, signal) }
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
      },
      task: toPublicRecordingImportJob(job, await this.recordingImportRef(job)),
    })))
    await this.requireRecordingImportSession(expectedUserId)
    signal?.throwIfAborted()
    return { local, existingFileNames, owner }
  }

  async acceptRecordingImport(
    sourceHandle: string,
    metadata: {
      fileName: string
      mimeType: string
      fileSize: number
      sha256: string
      startAtMillis: number
      belongUserId: number
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
    const identity = {
      userId: session.userId,
      fileName: metadata.fileName,
      fileSize: metadata.fileSize,
      sha256: metadata.sha256,
      startAtMillis,
      belongUserId,
    }
    const currentJobs = await this.runtime.stateStore.listRecordingImportJobs(session.userId)
    const unresolvedJobs = currentJobs.filter(isUnresolvedRecordingImportJob)
    const existing = unresolvedJobs.find(job => sameRecordingImportIdentity(job, identity))
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
    if (unresolvedJobs.length >= RECORDING_IMPORT_UNRESOLVED_LIMIT) {
      throw new ArkmePluginError(
        'recording-import-pending-limit',
        '待处理录音过多，请先重试或取消现有任务',
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
      sourceHandle,
      uploadedBytes: 0,
      createdAtMillis: now,
      updatedAtMillis: now,
    }
    const importRef = sealRecordingImportRef({ jobId: job.jobId, userId: job.userId }, signingKey)
    const admission = await this.runtime.stateStore.admitRecordingImportJob(
      session.userId,
      job,
      RECORDING_IMPORT_UNRESOLVED_LIMIT,
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
    if (admission.kind === 'limit') {
      throw new ArkmePluginError(
        'recording-import-pending-limit',
        '待处理录音过多，请先重试或取消现有任务',
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

  async recordingImportList(signal?: AbortSignal): Promise<PublicRecordingImportCurrentSnapshot> {
    this.assertWorkbenchEnabled()
    const session = await this.runtime.requireSession()
    const jobs = await this.runtime.stateStore.listRecordingImportJobs(session.userId)
    for (const job of jobs) {
      if (['prepared', 'uploading', 'finalizing'].includes(job.phase)) this.runRecordingImport(job)
    }
    const newestFirst = (left: RecordingImportJob, right: RecordingImportJob) => right.createdAtMillis - left.createdAtMillis
    const unresolved = jobs.filter(isUnresolvedRecordingImportJob).sort(newestFirst)
    let activeOwnerTasks: Awaited<ReturnType<RecordingImportOwnerGateway['listOwnerTasks']>>['tasks'] | undefined
    let owner: PublicRecordingImportCurrentSnapshot['owner'] = { state: 'available' }
    try {
      activeOwnerTasks = (await this.recordingImportOwnerGateway.listOwnerTasks({
        viewerUserId: session.userId,
        scope: 'active', toMillis: Date.now(), limit: RECORDING_IMPORT_VISIBLE_LIMIT, offset: 0,
        ...(signal === undefined ? {} : { signal }),
      })).tasks
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
        .then(async () => { await this.recordingImports.run(userId, jobId, controller.signal) })
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
    for (const job of jobs) {
      if (['prepared', 'uploading', 'finalizing'].includes(job.phase)) this.runRecordingImport(job)
    }
  }

  private runRecordingImport(job: RecordingImportJob): void {
    if (this.importCommands.has(job.jobId) || this.importRuns.has(job.jobId)) return
    const controller = new AbortController()
    this.trackRecordingImportRun(
      job.jobId,
      job.revision,
      this.recordingImports.run(job.userId, job.jobId, controller.signal).then(() => undefined),
      controller,
    )
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
    return { fromStamp: from, toStamp: to, days }
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
  ): Promise<ArkmeRecordingPrivateTranscriptSection> {
    const dayStart = this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
    return await this.ownerTranscriptSection(await this.readOwner.completeDay({ startAt: Math.max(0, dayStart.getTime()), endAt: dayEnd.getTime() }, 'primary', session, signal), session, signal)
  }

  private async ownerTranscriptSection(page: RecordingOwnerDayPage, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeRecordingPrivateTranscriptSection> {
    const profiles = await this.recordingSpeakerProfiles([...new Set(page.items.flatMap(item => item.speaker.userId === undefined ? [] : [item.speaker.userId]))], session, signal)
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
    return {
      state: items.length > 0 ? 'ready' : processingCount > 0 ? 'processing' : page.coverage.failed_count > 0 ? 'error' : 'empty',
      items, message: items.length > 0 ? '' : processingCount > 0 ? '音频文字正在导入&转写中' : page.coverage.failed_count > 0 ? '转写失败，请稍后重试' : '当天无录音',
      identityCoverage: 'complete', totalDurationMillis: page.totalDurationMillis, processingCount,
      ...(page.captureCoverage === undefined ? {} : { captureCoverage: page.captureCoverage }),
    }
  }

  private ownerTranscriptItem(item: RecordingOwnerFragment, viewerUserId: number, profiles: Map<number, { displayName: string; avatarRef?: string }>): ArkmeRecordingPrivateTranscriptItem {
    const identity = item.speaker.reference || `unknown:${item.recordingId}:${item.locator.child_id}:${item.locator.source}:${String(item.locator.ordinal)}`
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
      readView: { recording_uid: item.recordingId, revision: item.revision, source: item.locator.source },
      playbackLocator: item.locator, event: item.event,
      textStartOffset: item.textStart, textEndOffset: item.textEnd, textTotalLength: item.textTotal,
      generationText: `${item.isBackground ? '(背景音)' : ''}${item.text}`,
    }
  }

  async recordingTranscriptPage(dateStamp: number, options: ArkmeRecordingTranscriptPageOptions = {}): Promise<ArkmeRecordingTranscriptPage> {
    return await this.recordingTranscriptPageWithSession(dateStamp, await this.runtime.requireSession(), options)
  }

  private async readDayPage(dateStamp: number, session: ArkmeSessionCredentials, options: ArkmeRecordingTranscriptPageOptions) {
    const dayStart = this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
    const source = options.source ?? 'system'
    if (source !== 'system' && source !== 'doubao') throw new ArkmePluginError('recording-source-invalid', '转写来源无效', false, 400)
    let continuation: RecordingDayReadCursor | undefined
    if (options.cursor !== undefined && options.cursor !== '') {
      if (options.cursor.length > 8 * 1024 * 1024) throw new ArkmePluginError('recording-cursor-invalid', '录音分页引用无效', false, 400)
      // This authenticated ciphertext is only generated by this Host. Audio
      // revisions, account, date and source are checked again on every page.
      const raw = await this.openRecordingRef('arkme-recording-page-v1', options.cursor)
      if (raw.dateStamp !== dayStart.getTime() || raw.source !== source || raw.continuation === null
        || typeof raw.continuation !== 'object' || !Array.isArray((raw.continuation as RecordingDayReadCursor).positions)) {
        throw new ArkmePluginError('recording-cursor-invalid', '录音分页引用不匹配，请刷新后重试', false, 409)
      }
      continuation = raw.continuation as RecordingDayReadCursor
    }
    return await this.readOwner.dayPage({ startAt: Math.max(0, dayStart.getTime()), endAt: dayEnd.getTime() }, source === 'system' ? 'primary' : 'enhanced', session, continuation, options.signal)
  }

  private async recordingTranscriptPageWithSession(dateStamp: number, session: ArkmeSessionCredentials, options: ArkmeRecordingTranscriptPageOptions): Promise<ArkmeRecordingTranscriptPage> {
    const date = this.recordingDayStart(dateStamp).getTime()
    const source = options.source ?? 'system'
    const page = await this.readDayPage(date, session, options)
    return await this.projectWorkbenchPage(date, source, page, session, options.signal)
  }

  private async projectWorkbenchPage(dateStamp: number, source: ArkmeRecordingTranscriptSource, page: RecordingOwnerDayPage, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<ArkmeRecordingTranscriptPage> {
    const section = await this.ownerTranscriptSection(page, session, signal)
    const [key, pageKey, speakerRefKey] = await Promise.all([this.recordingRefKey('arkme-recording-item-v1'), this.recordingRefKey('arkme-recording-page-v1'), this.recordingRefKey('arkme-recording-speaker-v1')])
    await this.ensureRecordingSession(session, signal)
    const viewRef = createHmac('sha256', pageKey).update(JSON.stringify({ viewer: session.userId, dateStamp, source, views: page.views })).digest('base64url')
    const nextCursor = page.next === undefined ? '' : this.sealRecordingRefWithKey('arkme-recording-page-v1', {
      version: 1, viewerUserId: session.userId, dateStamp, source, continuation: page.next,
    }, pageKey)
    if (nextCursor.length > 8 * 1024 * 1024) throw new ArkmePluginError('recording-cursor-too-large', '当天录音数量超出分页读取范围', false, 413)
    return { ...section, dateStamp, transcriptSource: source, viewRef, nextCursor,
      items: section.items.map(item => this.workbenchItem(dateStamp, item, session.userId, key, speakerRefKey)),
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
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> {
    this.assertWorkbenchEnabled()
    const normalizedRouteKey = routeKey.trim()
    if (normalizedRouteKey.length > 256) {
      throw new ArkmePluginError('recording-summary-model-route-invalid', '录音总结模型无效', false, 400)
    }
    const dayStart = this.recordingDayStart(dateStamp)
    const session = await this.runtime.requireSession()
    const transcript = await this.recordingTranscriptWithSession(dayStart.getTime(), session, signal)
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
        tz_offset: -dayStart.getTimezoneOffset() * 60_000,
        from_stamp: firstItem.startAtMillis,
        to_stamp: endAt,
        model_type: 1,
        prompt_ver: 1,
        transcripts: buildRecordingGenerationTranscript(transcript.items, kind, dayStart.getTime()),
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
      const section = await this.recordingProjectionWithSession(dayStart.getTime(), kind, session, signal)
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
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>> {
    const dayStart = this.recordingDayStart(dateStamp)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
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

  async recordingDay(dateStamp: number, signal?: AbortSignal): Promise<ArkmeRecordingDay> {
    return await this.recordingDayWithSession(dateStamp, await this.runtime.requireSession(), signal)
  }

  private async recordingDayWithSession(
    dateStamp: number,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingDay> {
    const date = this.recordingDayStart(dateStamp).getTime()
    const [transcriptResult, summaryResult, timelineResult] = await Promise.allSettled([
      this.recordingTranscriptPageWithSession(date, session, { signal }),
      this.recordingProjectionWithSession(date, 'summary', session, signal),
      this.recordingProjectionWithSession(date, 'timeline', session, signal),
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
      totalDurationMillis: transcriptResult.status === 'fulfilled'
        ? transcriptResult.value.totalDurationMillis
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
  ): ArkmeRecordingWorkbenchItem {
    const payload: RecordingItemRefPayload = {
      version: 1,
      viewerUserId,
      dateStamp,
      sessionId: item.sessionId,
      childId: item.childId,
      asrItemIndex: item.asrItemIndex,
      transcriptSource: item.transcriptSource,
      startAtMillis: item.startAtMillis,
      endAtMillis: item.endAtMillis,
      speakerReference: item.speakerReference,
      revision: item.readView.revision,
    }
    return {
      itemId: item.itemId,
      itemRef: this.sealRecordingRefWithKey('arkme-recording-item-v1', payload, refKey),
      transcriptSource: item.transcriptSource,
      sessionKey: createHmac('sha256', refKey).update(`recording-session:${String(viewerUserId)}:${item.sessionId}`).digest('base64url'),
      startAtMillis: item.startAtMillis,
      endAtMillis: item.endAtMillis,
      speakerNumber: item.speakerNumber,
      speakerKey: createHmac('sha256', refKey).update(`speaker:${item.speakerIdentity}`).digest('base64url'),
      ...(item.speakerReference === '' ? {} : { assignedSpeakerOptionKey: this.recordingSpeakerOptionKey(speakerRefKey, viewerUserId, 'speaker', item.speakerReference) }),
      speakerColorIndex: item.speakerColorIndex,
      speakerLabel: item.speakerLabel,
      ...(item.speakerAvatarRef === undefined ? {} : { speakerAvatarRef: item.speakerAvatarRef }),
      canBindSpeaker: item.speakerReference !== '',
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

  private itemLocator(item: RecordingItemRefPayload): RecordingPlaybackLocator {
    return { child_id: item.childId, ordinal: item.asrItemIndex, source: item.transcriptSource === 'system' ? 'primary' : 'enhanced' }
  }

  private async openRecordingItemRef(itemRef: string): Promise<RecordingItemRefPayload> {
    const raw = await this.openRecordingRef('arkme-recording-item-v1', itemRef)
    const payload: RecordingItemRefPayload = {
      version: 1, viewerUserId: numberValue(raw.viewerUserId), dateStamp: numberValue(raw.dateStamp),
      sessionId: stringValue(raw.sessionId), childId: stringValue(raw.childId), asrItemIndex: numberValue(raw.asrItemIndex),
      transcriptSource: raw.transcriptSource === 'doubao' ? 'doubao' : 'system',
      startAtMillis: numberValue(raw.startAtMillis), endAtMillis: numberValue(raw.endAtMillis),
      speakerReference: stringValue(raw.speakerReference), revision: stringValue(raw.revision),
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
  ): Promise<Map<number, { displayName: string; avatarRef?: string }>> {
    if (this.profile === undefined) return new Map()
    if (userIds.length === 0) return new Map()
    try {
      const publicProfiles = await this.profile.publicProfileSummariesByUserIds(userIds, session, signal)
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
    } catch {
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
