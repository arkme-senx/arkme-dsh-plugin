import { randomUUID } from 'node:crypto'

import { unmarkedSpeakerDisplayName } from '../contact-directory-presentation.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeDirectoryItem,
  ArkmeDirectoryPage,
  ArkmeUnmarkedSpeakerInference,
  ArkmeUnmarkedSpeakerInferenceRetry,
  ArkmeUnmarkedSpeakerMarkResult,
  ArkmeUnmarkedSpeakerOptions,
  ArkmeUnmarkedSpeakerSegment,
  ArkmeUnmarkedSpeakerSegmentPage,
} from '../types.js'
import {
  ArkmePluginError,
  clippedText,
  knownStringValue,
  objectValue,
  stringValue,
  type ServiceRuntime,
} from './service.js'
import type { ArkmeUnmarkedSpeakerSegmentResolver, MediaService } from './media-service.js'

type CandidateStatus = 'cross_day' | 'single_day'
type ProjectionState = NonNullable<ArkmeDirectoryPage['projectionState']>
type InferenceState = ArkmeUnmarkedSpeakerInference['state']
type MarkOutcome = ArkmeUnmarkedSpeakerMarkResult['outcome']

interface CandidateRefEntry {
  viewerUserId: number
  candidateId: string
  candidateVersion?: string
  status: CandidateStatus
  speakerToken: string
  appearanceDays: number
  validAudioDurationMillis: number
  segmentCount: number
  firstSeenAtMillis: number
  latestAtMillis: number
  expiresAtMillis: number
}

interface SpeakerRefEntry {
  viewerUserId: number
  candidateRef: string
  candidateId: string
  speakerId: string
  expiresAtMillis: number
}

/** Provider-private seam retained for Task 4's controlled media resolver. */
interface SegmentRefEntry {
  viewerUserId: number
  candidateRef: string
  candidateId: string
  segmentId: string
  sessionId: string
  childId: string
  audioFileName: string
  expiresAtMillis: number
}

interface CursorRefEntry {
  viewerUserId: number
  kind: 'candidate' | 'segment'
  upstreamCursor: string
  candidateRef?: string
  expiresAtMillis: number
}

const REF_TTL_MS = 30 * 60_000
const REF_CAP = 2_000
const LIST_CAP = 50
const SPEAKER_CHOICE_CAP = 100
const SEGMENT_CAP = 50
const CANDIDATE_REF_PATTERN = /^arkme-unmarked-candidate-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SPEAKER_REF_PATTERN = /^arkme-unmarked-speaker-choice-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SEGMENT_REF_PATTERN = /^arkme-unmarked-segment-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CANDIDATE_CURSOR_PATTERN = /^arkme-unmarked-candidate-cursor-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SEGMENT_CURSOR_PATTERN = /^arkme-unmarked-segment-cursor-v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECTION_STATES = new Set<ProjectionState>(['fresh', 'stale', 'building', 'failed'])
const INFERENCE_STATES = new Set<InferenceState>(['ready', 'pending', 'failed', 'unavailable'])
const CONVERSATION_SUMMARY_STATES = new Set(['ready', 'pending', 'unavailable'] as const)
const RECOMMENDATION_STATES = new Set(['recommended', 'ambiguous', 'none'] as const)
const RETRY_OUTCOMES = new Set([
  'created', 'retried', 'pending', 'ready', 'retry_exhausted', 'stale', 'candidate_not_found', 'invalid',
])
const MARK_OUTCOMES = new Set<MarkOutcome>([
  'marked', 'stale', 'conflict', 'candidate_not_found', 'speaker_not_found',
])

function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function boundedInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(maximum, Math.trunc(parsed))
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return LIST_CAP
  return Math.min(LIST_CAP, Math.max(1, Math.trunc(value)))
}

function positiveTimestamp(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '日期未知'
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function candidateSubtitle(appearanceDays: number, latestAtMillis: number): string {
  return latestAtMillis > 0
    ? `出现 ${String(appearanceDays)} 天 · 最近 ${localDate(latestAtMillis)} ${localTime(latestAtMillis).slice(0, 5)}`
    : `出现 ${String(appearanceDays)} 天 · 最近时间未知`
}

function candidateKey(viewerUserId: number, candidateId: string): string {
  return `${String(viewerUserId)}\u0000${candidateId}`
}

export class UnmarkedSpeakerService implements ArkmeUnmarkedSpeakerSegmentResolver {
  private readonly candidateRefs = new Map<string, CandidateRefEntry>()
  private readonly candidateRefByKey = new Map<string, string>()
  private readonly speakerRefs = new Map<string, SpeakerRefEntry>()
  private readonly segmentRefs = new Map<string, SegmentRefEntry>()
  private readonly cursorRefs = new Map<string, CursorRefEntry>()

  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly media?: Pick<MediaService, 'issueUnmarkedSpeakerMediaRef'>,
  ) {}

  dispose(): void {
    this.candidateRefs.clear()
    this.candidateRefByKey.clear()
    this.speakerRefs.clear()
    this.segmentRefs.clear()
    this.cursorRefs.clear()
  }

  async list(
    options: { limit?: number; cursor?: string; countOnly?: boolean; signal?: AbortSignal } = {},
  ): Promise<ArkmeDirectoryPage> {
    const session = await this.runtime.requireSession()
    const limit = options.countOnly === true ? 0 : boundedLimit(options.limit)
    const upstreamCursor = await this.openCursor('candidate', options.cursor, session)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/unmarked-speakers/list',
      { limit, cursor: upstreamCursor, status: '' },
      session,
      options.signal,
      {
        lane: 'interactive-read', key: `unmarked-speakers:list:${String(limit)}:${upstreamCursor}`,
        cacheMs: 10_000, failureCooldownMs: 2_000,
      },
    )
    const crossDayCount = boundedInteger(data.cross_day_count)
    const singleDayCount = boundedInteger(data.single_day_count)
    if (options.countOnly === true) {
      return {
        section: 'unmarked-speakers', items: [], total: crossDayCount + singleDayCount, hasMore: false,
      }
    }
    const projectionState = data.projection_state === undefined
      ? undefined
      : knownStringValue(data.projection_state, PROJECTION_STATES)
    if (data.projection_state !== undefined && projectionState === undefined) {
      throw new ArkmePluginError('unmarked-list-contract-invalid', '未标记说话人列表投影状态无效', true, 502)
    }
    const items: ArkmeDirectoryItem[] = []
    for (const value of listValue(data.items).slice(0, LIST_CAP)) {
      const raw = objectValue(value)
      const candidateId = stringValue(raw.candidate_id).trim()
      const status = raw.status === 'cross_day' || raw.status === 'single_day' ? raw.status : undefined
      const label = stringValue(raw.label).trim()
      const displayNumber = boundedInteger(raw.speaker_display_number)
      const speakerToken = displayNumber > 0 ? String(displayNumber) : label
      if (candidateId === '' || status === undefined || speakerToken === '') continue
      const appearanceDays = boundedInteger(raw.day_count)
      const validAudioDurationMillis = boundedInteger(raw.total_speech_duration_ms)
      const segmentCount = boundedInteger(raw.segment_count)
      const firstSeenAtMillis = positiveTimestamp(raw.first_seen_at)
      const latestAtMillis = positiveTimestamp(raw.latest_day_end_at)
        || positiveTimestamp(raw.latest_day_start_at)
        || positiveTimestamp(raw.last_seen_at)
      const candidateRef = this.sealCandidateRef(session.userId, {
        candidateId, status, speakerToken, appearanceDays, validAudioDurationMillis,
        segmentCount, firstSeenAtMillis, latestAtMillis,
      })
      items.push({
        kind: 'unmarked-speaker', candidateRef, speakerToken,
        displayName: unmarkedSpeakerDisplayName({
          speakerToken,
          firstSeenDate: localDate(status === 'single_day' ? latestAtMillis : firstSeenAtMillis),
          lastSeenDate: localDate(latestAtMillis),
        }),
        subtitle: candidateSubtitle(appearanceDays, latestAtMillis),
      })
    }
    this.pruneRefs()
    const hasMore = data.has_more === true
    const nextUpstreamCursor = stringValue(data.next_cursor).trim()
    return {
      section: 'unmarked-speakers', items,
      total: Math.max(items.length, crossDayCount + singleDayCount),
      hasMore,
      ...(hasMore && nextUpstreamCursor !== ''
        ? { nextCursor: this.sealCursor('candidate', nextUpstreamCursor, session.userId) }
        : {}),
      ...(projectionState === undefined ? {} : { projectionState }),
      ...(boundedInteger(data.retry_after_ms, 60_000) > 0
        ? { retryAfterMillis: boundedInteger(data.retry_after_ms, 60_000) }
        : {}),
      ...(typeof data.cursor_stale === 'boolean' ? { cursorStale: data.cursor_stale } : {}),
    }
  }

  async markOptions(candidateRef: string, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerOptions> {
    const { session, entry, normalizedRef } = await this.resolveCandidateRef(candidateRef)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/unmarked-speakers/mark-options',
      { candidate_id: entry.candidateId },
      session,
      signal,
      {
        lane: 'interactive-read', key: `unmarked-speakers:options:${entry.candidateId}`,
        cacheMs: 10_000, failureCooldownMs: 2_000,
      },
    )
    if (data.outcome === 'candidate_not_found') {
      this.handleCandidateNotFound(session.userId, normalizedRef)
      throw new ArkmePluginError('unmarked-candidate-not-found', '未标记说话人候选已不存在，请刷新列表', false, 404)
    }
    if (stringValue(data.candidate_id).trim() !== entry.candidateId) {
      throw new ArkmePluginError('unmarked-options-contract-invalid', '未标记说话人详情响应与候选不匹配', true, 502)
    }
    const candidateVersion = stringValue(data.candidate_version).trim()
    if (candidateVersion === '') {
      throw new ArkmePluginError('unmarked-options-contract-invalid', '未标记说话人详情缺少候选版本', true, 502)
    }
    const recommendationState = knownStringValue(data.recommendation_state, RECOMMENDATION_STATES)
    if (recommendationState === undefined) {
      throw new ArkmePluginError('unmarked-options-contract-invalid', '未标记说话人推荐状态无效', true, 502)
    }
    const inferredDisplayName = clippedText(data.speaker_inference, 200)
    const conversationSummary = clippedText(data.conversation_summary, 600)
    const conversationSummaryState = data.conversation_summary_status === undefined
      ? undefined
      : knownStringValue(data.conversation_summary_status, CONVERSATION_SUMMARY_STATES)
    if (data.conversation_summary_status !== undefined && conversationSummaryState === undefined) {
      throw new ArkmePluginError('unmarked-options-contract-invalid', '未标记说话人对话摘要状态无效', true, 502)
    }
    const inferenceState = data.speaker_inference_status === undefined
      ? conversationSummaryState === 'pending'
        ? 'pending'
        : inferredDisplayName === '' ? 'unavailable' : 'ready'
      : knownStringValue(data.speaker_inference_status, INFERENCE_STATES)
    if (inferenceState === undefined) {
      throw new ArkmePluginError('unmarked-options-contract-invalid', '未标记说话人推测状态无效', true, 502)
    }
    entry.candidateVersion = candidateVersion
    entry.appearanceDays = boundedInteger(data.day_count)
    entry.segmentCount = boundedInteger(data.segment_count)
    entry.expiresAtMillis = Date.now() + REF_TTL_MS

    const rawSpeakers = listValue(data.speakers).slice(0, SPEAKER_CHOICE_CAP)
    const validSpeakers: Array<{ speakerId: string; displayName: string }> = []
    for (const value of rawSpeakers) {
      const raw = objectValue(value)
      const speakerId = stringValue(raw.speaker_id).trim()
      const displayName = stringValue(raw.nick_name).trim()
      if (speakerId === '' || displayName === '' || displayName === '未命名说话人') continue
      validSpeakers.push({ speakerId, displayName })
    }
    this.deleteSpeakerRefsForCandidate(normalizedRef)
    const recommendedSpeakerId = recommendationState === 'recommended'
      ? stringValue(data.recommended_speaker_id).trim()
      : ''
    let recommendedSpeakerRef: string | undefined
    let recommendedChoiceName = ''
    const speakerChoices = validSpeakers.map(speaker => {
      const speakerRef = this.sealSpeakerRef(session.userId, normalizedRef, entry.candidateId, speaker.speakerId)
      const recommended = speaker.speakerId === recommendedSpeakerId
      if (recommended) {
        recommendedSpeakerRef = speakerRef
        recommendedChoiceName = speaker.displayName
      }
      return { speakerRef, displayName: speaker.displayName, source: recommended ? 'recommended' as const : 'manual' as const }
    })
    const recommendedDisplayName = inferredDisplayName || recommendedChoiceName
    const inference: ArkmeUnmarkedSpeakerInference = {
      state: inferenceState,
      ...(recommendedSpeakerRef === undefined ? {} : { recommendedSpeakerRef }),
      ...(recommendedDisplayName === '' ? {} : { recommendedDisplayName }),
      ...(typeof data.speaker_inference_can_retry === 'boolean'
        ? { retryable: data.speaker_inference_can_retry }
        : {}),
    }
    this.pruneRefs()
    return {
      candidateRef: normalizedRef,
      candidateVersion,
      speakerToken: entry.speakerToken,
      appearanceDays: entry.appearanceDays,
      validAudioDurationMillis: entry.validAudioDurationMillis,
      segmentCount: entry.segmentCount,
      latestAtMillis: entry.latestAtMillis,
      ...(conversationSummaryState === undefined ? {} : { conversationSummaryState }),
      ...(conversationSummary === '' ? {} : { conversationSummary }),
      inference,
      speakerChoices,
    }
  }

  async retryInference(candidateRef: string, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerInferenceRetry> {
    const { session, entry, normalizedRef } = await this.resolveCandidateRef(candidateRef)
    const candidateVersion = entry.candidateVersion?.trim() ?? ''
    if (candidateVersion === '') {
      throw new ArkmePluginError('unmarked-candidate-version-required', '请先刷新候选详情以获取当前版本', false)
    }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/unmarked-speakers/speaker-inference/retry',
      { candidate_id: entry.candidateId, candidate_version: candidateVersion },
      session,
      signal,
      { lane: 'write', bypassCache: true },
    )
    const outcome = stringValue(data.outcome)
    const state = knownStringValue(data.speaker_inference_status, INFERENCE_STATES)
    if (!RETRY_OUTCOMES.has(outcome) || state === undefined) {
      throw new ArkmePluginError('unmarked-inference-contract-invalid', '说话人推测重试响应无效', true, 502)
    }
    if (outcome === 'candidate_not_found') this.handleCandidateNotFound(session.userId, normalizedRef)
    else this.invalidateCandidateReads(session.userId, entry.candidateId, { options: true })
    return {
      candidateRef: normalizedRef,
      inference: {
        state,
        ...(typeof data.speaker_inference_can_retry === 'boolean'
          ? { retryable: data.speaker_inference_can_retry }
          : {}),
      },
    }
  }

  async segments(
    candidateRef: string,
    options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
  ): Promise<ArkmeUnmarkedSpeakerSegmentPage> {
    const { session, entry, normalizedRef } = await this.resolveCandidateRef(candidateRef)
    const limit = boundedLimit(options.limit)
    const upstreamCursor = await this.openCursor('segment', options.cursor, session, normalizedRef)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/unmarked-speakers/segments',
      { candidate_id: entry.candidateId, cursor: upstreamCursor, limit, date_stamp: 0 },
      session,
      options.signal,
      {
        lane: 'interactive-read', key: `unmarked-speakers:segments:${entry.candidateId}:${String(limit)}:${upstreamCursor}`,
        cacheMs: 10_000, failureCooldownMs: 2_000,
      },
    )
    if (data.outcome === 'candidate_not_found') {
      this.handleCandidateNotFound(session.userId, normalizedRef)
      throw new ArkmePluginError('unmarked-candidate-not-found', '未标记说话人候选已不存在，请刷新列表', false, 404)
    }
    const responseCandidate = objectValue(data.candidate)
    if (stringValue(responseCandidate.candidate_id).trim() !== entry.candidateId) {
      throw new ArkmePluginError('unmarked-segments-contract-invalid', '未标记说话人片段响应与候选不匹配', true, 502)
    }
    const candidateVersion = stringValue(data.candidate_version).trim()
    if (candidateVersion === '') {
      throw new ArkmePluginError('unmarked-segments-contract-invalid', '未标记说话人片段响应缺少候选版本', true, 502)
    }
    entry.expiresAtMillis = Date.now() + REF_TTL_MS
    const sessionLabels = new Map<string, string>()
    for (const value of listValue(data.sessions)) {
      const raw = objectValue(value)
      const sessionId = stringValue(raw.session_id).trim()
      const title = clippedText(raw.title, 200)
      if (sessionId !== '' && title !== '') sessionLabels.set(sessionId, title)
    }
    const items: ArkmeUnmarkedSpeakerSegment[] = []
    for (const value of listValue(data.segments).slice(0, SEGMENT_CAP)) {
      const raw = objectValue(value)
      const segmentId = stringValue(raw.segment_id).trim()
      const sessionId = stringValue(raw.session_id).trim()
      const childId = stringValue(raw.child_id).trim()
      const audioFileName = stringValue(raw.audio_file_name).trim()
      const occurredAt = positiveTimestamp(raw.occurred_at)
      const startMillis = boundedInteger(raw.start_ms)
      const endMillis = boundedInteger(raw.end_ms)
      if (segmentId === '' || sessionId === '' || childId === '' || audioFileName === ''
        || occurredAt === 0 || endMillis <= startMillis) continue
      const durationMillis = endMillis - startMillis
      const segmentRef = this.sealSegmentRef(session.userId, normalizedRef, entry.candidateId, {
        segmentId, sessionId, childId, audioFileName,
      })
      const mediaRef = this.media === undefined
        ? undefined
        : await this.media.issueUnmarkedSpeakerMediaRef(this, normalizedRef, segmentRef, options.signal)
      const serverDate = stringValue(raw.date_key).trim()
      items.push({
        segmentRef,
        date: /^\d{4}-\d{2}-\d{2}$/.test(serverDate) ? serverDate : localDate(occurredAt),
        sessionLabel: sessionLabels.get(sessionId) ?? '录音',
        timeRange: `${localTime(occurredAt)}–${localTime(occurredAt + durationMillis)}`,
        durationMillis,
        transcript: clippedText(raw.transcript, 2_000),
        ...(mediaRef === undefined ? {} : { mediaRef }),
      })
    }
    this.pruneRefs()
    const hasMore = data.has_more === true
    const nextUpstreamCursor = stringValue(data.next_cursor).trim()
    return {
      items,
      total: Math.max(items.length, boundedInteger(data.total_count)),
      hasMore,
      ...(hasMore && nextUpstreamCursor !== ''
        ? { nextCursor: this.sealCursor('segment', nextUpstreamCursor, session.userId, normalizedRef) }
        : {}),
      ...(typeof data.cursor_stale === 'boolean' ? { cursorStale: data.cursor_stale } : {}),
    }
  }

  async mark(input: {
    candidateRef: string
    candidateVersion: string
    speakerRef?: string
    newSpeakerName?: string
  }, signal?: AbortSignal): Promise<ArkmeUnmarkedSpeakerMarkResult> {
    const { session, entry, normalizedRef } = await this.resolveCandidateRef(input.candidateRef)
    const candidateVersion = input.candidateVersion.trim()
    if (candidateVersion === '') {
      throw new ArkmePluginError('unmarked-candidate-version-required', '标记说话人必须携带候选版本', false)
    }
    if (entry.candidateVersion === undefined || entry.candidateVersion !== candidateVersion) {
      throw new ArkmePluginError('unmarked-candidate-version-stale', '候选版本已变化，请刷新后重试', false, 409)
    }
    const normalizedSpeakerRef = input.speakerRef?.trim() ?? ''
    const newSpeakerName = input.newSpeakerName?.trim() ?? ''
    if ((normalizedSpeakerRef === '') === (newSpeakerName === '')) {
      throw new ArkmePluginError('unmarked-mark-target-invalid', '请选择现有说话人或填写一个新名称', false)
    }
    let speakerId = ''
    if (normalizedSpeakerRef !== '') {
      const speaker = await this.resolveSpeakerRef(normalizedSpeakerRef, session, normalizedRef, entry.candidateId)
      speakerId = speaker.speakerId
    }
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/unmarked-speakers/mark',
      {
        candidate_id: entry.candidateId,
        candidate_version: candidateVersion,
        speaker_id: speakerId,
        new_nick_name: newSpeakerName,
      },
      session,
      signal,
      { lane: 'write', bypassCache: true },
    )
    const outcome = knownStringValue(data.outcome, MARK_OUTCOMES)
    if (outcome === undefined) {
      throw new ArkmePluginError('unmarked-mark-contract-invalid', '标记说话人响应无效', true, 502)
    }
    switch (outcome) {
      case 'marked':
        this.runtime.invalidateKey(this.runtime.requestScope(session.userId), 'unmarked-speakers:list')
        this.invalidateCandidateReads(session.userId, entry.candidateId, { options: true })
        delete entry.candidateVersion
        this.deleteSpeakerRefsForCandidate(normalizedRef)
        break
      case 'stale':
        this.invalidateCandidateReads(session.userId, entry.candidateId, { options: true, segments: true })
        delete entry.candidateVersion
        this.deleteSpeakerRefsForCandidate(normalizedRef)
        this.deleteSegmentRefsForCandidate(normalizedRef)
        break
      case 'conflict':
        this.runtime.invalidateKey(this.runtime.requestScope(session.userId), 'unmarked-speakers:list')
        this.invalidateCandidateReads(session.userId, entry.candidateId, { options: true, segments: true })
        delete entry.candidateVersion
        this.deleteSpeakerRefsForCandidate(normalizedRef)
        this.deleteSegmentRefsForCandidate(normalizedRef)
        break
      case 'candidate_not_found':
        this.handleCandidateNotFound(session.userId, normalizedRef)
        break
      case 'speaker_not_found':
        this.invalidateCandidateReads(session.userId, entry.candidateId, { options: true })
        this.deleteSpeakerRefsForCandidate(normalizedRef)
        break
    }
    return { outcome }
  }

  /** Provider-only seam for Task 4. Host code must exchange this tuple for a controlled media ref. */
  async resolveSegmentForMedia(segmentRef: string, candidateRef: string): Promise<{
    viewerUserId: number
    candidateId: string
    segmentId: string
    sessionId: string
    childId: string
    audioFileName: string
  }> {
    const session = await this.runtime.requireSession()
    this.pruneRefs()
    const normalizedSegmentRef = segmentRef.trim()
    const normalizedCandidateRef = candidateRef.trim()
    if (!SEGMENT_REF_PATTERN.test(normalizedSegmentRef)) {
      throw new ArkmePluginError('unmarked-segment-ref-invalid', '说话片段引用无效', false)
    }
    const entry = this.segmentRefs.get(normalizedSegmentRef)
    if (entry === undefined) {
      throw new ArkmePluginError('unmarked-segment-ref-expired', '说话片段引用已过期，请刷新片段', false, 410)
    }
    if (entry.viewerUserId !== session.userId) {
      throw new ArkmePluginError('unmarked-segment-ref-account-mismatch', '说话片段引用与当前账号不匹配', false, 403)
    }
    if (!CANDIDATE_REF_PATTERN.test(normalizedCandidateRef)
      || entry.candidateRef !== normalizedCandidateRef) {
      throw new ArkmePluginError('unmarked-segment-ref-candidate-mismatch', '说话片段不属于当前候选', false, 409)
    }
    const candidate = this.candidateRefs.get(normalizedCandidateRef)
    if (candidate === undefined || candidate.viewerUserId !== session.userId
      || candidate.candidateId !== entry.candidateId) {
      throw new ArkmePluginError('unmarked-segment-ref-candidate-mismatch', '说话片段不属于当前候选', false, 409)
    }
    return {
      viewerUserId: entry.viewerUserId,
      candidateId: entry.candidateId,
      segmentId: entry.segmentId,
      sessionId: entry.sessionId,
      childId: entry.childId,
      audioFileName: entry.audioFileName,
    }
  }

  private sealCandidateRef(
    viewerUserId: number,
    candidate: Omit<CandidateRefEntry, 'viewerUserId' | 'candidateVersion' | 'expiresAtMillis'>,
  ): string {
    const key = candidateKey(viewerUserId, candidate.candidateId)
    const existingRef = this.candidateRefByKey.get(key)
    const existing = existingRef === undefined ? undefined : this.candidateRefs.get(existingRef)
    if (existing !== undefined && existing.expiresAtMillis > Date.now()) {
      this.candidateRefs.set(existingRef!, {
        ...existing, ...candidate, viewerUserId, expiresAtMillis: Date.now() + REF_TTL_MS,
      })
      return existingRef!
    }
    const ref = `arkme-unmarked-candidate-v1.${randomUUID()}`
    this.candidateRefs.set(ref, {
      viewerUserId, ...candidate, expiresAtMillis: Date.now() + REF_TTL_MS,
    })
    this.candidateRefByKey.set(key, ref)
    return ref
  }

  private sealSpeakerRef(
    viewerUserId: number, candidateRef: string, candidateId: string, speakerId: string,
  ): string {
    const ref = `arkme-unmarked-speaker-choice-v1.${randomUUID()}`
    this.speakerRefs.set(ref, {
      viewerUserId, candidateRef, candidateId, speakerId, expiresAtMillis: Date.now() + REF_TTL_MS,
    })
    return ref
  }

  private sealSegmentRef(
    viewerUserId: number,
    candidateRef: string,
    candidateId: string,
    tuple: Pick<SegmentRefEntry, 'segmentId' | 'sessionId' | 'childId' | 'audioFileName'>,
  ): string {
    const ref = `arkme-unmarked-segment-v1.${randomUUID()}`
    this.segmentRefs.set(ref, {
      viewerUserId, candidateRef, candidateId, ...tuple, expiresAtMillis: Date.now() + REF_TTL_MS,
    })
    return ref
  }

  private sealCursor(
    kind: CursorRefEntry['kind'], upstreamCursor: string, viewerUserId: number, candidateRef?: string,
  ): string {
    const prefix = kind === 'candidate' ? 'arkme-unmarked-candidate-cursor-v1' : 'arkme-unmarked-segment-cursor-v1'
    const ref = `${prefix}.${randomUUID()}`
    this.cursorRefs.set(ref, {
      viewerUserId, kind, upstreamCursor,
      ...(candidateRef === undefined ? {} : { candidateRef }),
      expiresAtMillis: Date.now() + REF_TTL_MS,
    })
    return ref
  }

  private async resolveCandidateRef(candidateRef: string): Promise<{
    session: ArkmeSessionCredentials; entry: CandidateRefEntry; normalizedRef: string
  }> {
    const session = await this.runtime.requireSession()
    this.pruneRefs()
    const normalizedRef = candidateRef.trim()
    if (!CANDIDATE_REF_PATTERN.test(normalizedRef)) {
      throw new ArkmePluginError('unmarked-candidate-ref-invalid', '未标记说话人候选引用无效', false)
    }
    const entry = this.candidateRefs.get(normalizedRef)
    if (entry === undefined) {
      throw new ArkmePluginError('unmarked-candidate-ref-expired', '未标记说话人候选引用已过期，请刷新列表', false, 410)
    }
    if (entry.viewerUserId !== session.userId) {
      throw new ArkmePluginError('unmarked-candidate-ref-account-mismatch', '候选引用与当前账号不匹配', false, 403)
    }
    return { session, entry, normalizedRef }
  }

  private async resolveSpeakerRef(
    speakerRef: string,
    session: ArkmeSessionCredentials,
    candidateRef: string,
    candidateId: string,
  ): Promise<SpeakerRefEntry> {
    this.pruneRefs()
    if (!SPEAKER_REF_PATTERN.test(speakerRef)) {
      throw new ArkmePluginError('unmarked-speaker-ref-invalid', '说话人选项引用无效', false)
    }
    const entry = this.speakerRefs.get(speakerRef)
    if (entry === undefined) {
      throw new ArkmePluginError('unmarked-speaker-ref-expired', '说话人选项引用已过期，请刷新详情', false, 410)
    }
    if (entry.viewerUserId !== session.userId) {
      throw new ArkmePluginError('unmarked-speaker-ref-account-mismatch', '说话人选项引用与当前账号不匹配', false, 403)
    }
    if (entry.candidateRef !== candidateRef || entry.candidateId !== candidateId) {
      throw new ArkmePluginError('unmarked-speaker-ref-candidate-mismatch', '说话人选项不属于当前候选', false, 409)
    }
    return entry
  }

  private async openCursor(
    kind: CursorRefEntry['kind'],
    cursor: string | undefined,
    session: ArkmeSessionCredentials,
    candidateRef?: string,
  ): Promise<string> {
    const normalized = cursor?.trim() ?? ''
    if (normalized === '') return ''
    this.pruneRefs()
    const pattern = kind === 'candidate' ? CANDIDATE_CURSOR_PATTERN : SEGMENT_CURSOR_PATTERN
    if (!pattern.test(normalized)) {
      throw new ArkmePluginError('unmarked-cursor-invalid', '未标记说话人分页游标无效', false)
    }
    const entry = this.cursorRefs.get(normalized)
    if (entry === undefined) {
      throw new ArkmePluginError('unmarked-cursor-expired', '未标记说话人分页游标已过期', false, 410)
    }
    if (entry.viewerUserId !== session.userId) {
      throw new ArkmePluginError('unmarked-cursor-account-mismatch', '分页游标与当前账号不匹配', false, 403)
    }
    if (entry.kind !== kind || entry.candidateRef !== candidateRef) {
      throw new ArkmePluginError('unmarked-cursor-type-mismatch', '分页游标不属于当前候选或列表', false)
    }
    return entry.upstreamCursor
  }

  private invalidateCandidateReads(
    viewerUserId: number,
    candidateId: string,
    targets: { options?: boolean; segments?: boolean },
  ): void {
    const scope = this.runtime.requestScope(viewerUserId)
    if (targets.options === true) this.runtime.invalidateKey(scope, `unmarked-speakers:options:${candidateId}`)
    if (targets.segments === true) this.runtime.invalidateKey(scope, `unmarked-speakers:segments:${candidateId}`)
  }

  private handleCandidateNotFound(viewerUserId: number, candidateRef: string): void {
    this.runtime.invalidateKey(this.runtime.requestScope(viewerUserId), 'unmarked-speakers:list')
    this.deleteCandidateRef(candidateRef)
  }

  private deleteCandidateRef(candidateRef: string): void {
    const entry = this.candidateRefs.get(candidateRef)
    if (entry !== undefined) this.candidateRefByKey.delete(candidateKey(entry.viewerUserId, entry.candidateId))
    this.candidateRefs.delete(candidateRef)
    this.deleteSpeakerRefsForCandidate(candidateRef)
    this.deleteSegmentRefsForCandidate(candidateRef)
  }

  private deleteSpeakerRefsForCandidate(candidateRef: string): void {
    for (const [ref, speaker] of this.speakerRefs) {
      if (speaker.candidateRef === candidateRef) this.speakerRefs.delete(ref)
    }
  }

  private deleteSegmentRefsForCandidate(candidateRef: string): void {
    for (const [ref, segment] of this.segmentRefs) {
      if (segment.candidateRef === candidateRef) this.segmentRefs.delete(ref)
    }
    for (const [ref, cursor] of this.cursorRefs) {
      if (cursor.candidateRef === candidateRef) this.cursorRefs.delete(ref)
    }
  }

  private pruneRefs(): void {
    const now = Date.now()
    for (const [ref, entry] of this.candidateRefs) {
      if (entry.expiresAtMillis <= now) this.deleteCandidateRef(ref)
    }
    for (const [ref, entry] of this.speakerRefs) if (entry.expiresAtMillis <= now) this.speakerRefs.delete(ref)
    for (const [ref, entry] of this.segmentRefs) if (entry.expiresAtMillis <= now) this.segmentRefs.delete(ref)
    for (const [ref, entry] of this.cursorRefs) if (entry.expiresAtMillis <= now) this.cursorRefs.delete(ref)
    while (this.candidateRefs.size > REF_CAP) {
      const oldest = this.candidateRefs.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.deleteCandidateRef(oldest)
    }
    for (const refs of [this.speakerRefs, this.segmentRefs, this.cursorRefs]) {
      while (refs.size > REF_CAP) {
        const oldest = refs.keys().next().value
        if (oldest === undefined) break
        refs.delete(oldest)
      }
    }
  }
}
