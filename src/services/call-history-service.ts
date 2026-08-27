import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type {
  ArkmeCallDetail,
  ArkmeCallHistoryItem,
  ArkmeCallHistoryOptions,
  ArkmeCallHistoryPage,
  ArkmeCallMediaType,
  ArkmeCallParticipant,
  ArkmeCallRecentContact,
  ArkmeCallSummaryRetryResult,
  ArkmeCallSummaryStatus,
  ArkmeCallTranscriptSegment,
  ArkmeCallVideoPerspective,
  ArkmeCallVideoRecord,
} from '../types.js'
import { ArkmePluginError, ServiceRuntime, clippedText, objectValue, stringValue } from './service.js'
import { ProfileService } from './profile-service.js'

interface ArkmeCallRefPayload {
  version: 1
  userId: number
  roomId: string
  stableId: string
  issuedAtMillis: number
}

function listValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function booleanValue(value: unknown): boolean { return value === true }

function firstValue(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key]
  }
  return undefined
}

function firstString(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringValue(source[key]).trim()
    if (value !== '') return value
  }
  return ''
}

function firstNumber(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = numberValue(source[key])
    if (value !== 0) return value
  }
  return 0
}

function epochMillis(value: unknown): number {
  const raw = numberValue(value)
  if (raw <= 0) return 0
  return raw < 10_000_000_000 ? Math.trunc(raw * 1000) : Math.trunc(raw)
}

function firstEpochMillis(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = epochMillis(source[key])
    if (value > 0) return value
  }
  return 0
}

function numberList(value: unknown): number[] {
  return listValue(value)
    .map(item => Math.trunc(numberValue(item)))
    .filter(item => Number.isSafeInteger(item) && item > 0)
}

function callMediaType(value: unknown): ArkmeCallMediaType {
  if (value === 0 || value === '0') return 'audio'
  if (value === 1 || value === '1') return 'video'
  const text = stringValue(value).trim().toLowerCase()
  if (text === 'audio' || text === 'voice') return 'audio'
  if (text === 'video') return 'video'
  return 'unknown'
}

function summaryStatus(value: unknown): ArkmeCallSummaryStatus {
  switch (stringValue(value).trim().toLowerCase()) {
    case 'pending':
    case 'processing':
    case 'generating':
      return 'pending'
    case 'done':
    case 'success':
    case 'finished':
      return 'done'
    case 'failed':
    case 'error':
      return 'failed'
    default:
      return 'idle'
  }
}

function resultLabel(result: string, acceptedAtMillis: number, durationSeconds: number): string {
  const normalized = result.trim().toLowerCase()
  if (['normalend', 'normal_end', 'completed', 'success'].includes(normalized)) return '已接通'
  if (['cancel', 'canceled', 'cancelled'].includes(normalized)) return '已取消'
  if (['reject', 'rejected'].includes(normalized)) return '已拒绝'
  if (['timeout', 'noanswer', 'no_answer', 'offline', 'missed'].includes(normalized)) return '未接通'
  if (acceptedAtMillis > 0 || durationSeconds > 0) return '已接通'
  return result.trim() === '' ? '未知状态' : result.trim()
}

function safeSummary(raw: string): string {
  const text = raw.trim()
  if (text === '' || text.includes('{{')) return ''
  return clippedText(text, 800)
}

function safeMediaUrl(value: unknown): string {
  const text = stringValue(value).trim()
  if (text === '') return ''
  if (text.startsWith('/') && !text.startsWith('//') && !text.includes('\\')) return text
  try {
    const url = new URL(text)
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'blob:') return url.toString()
  } catch {
    return ''
  }
  return ''
}

function firstSafeMediaUrl(source: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = safeMediaUrl(source[key])
    if (value !== '') return value
  }
  return ''
}

function videoRecordCandidateObjects(raw: Record<string, unknown>): Record<string, unknown>[] {
  const directKeys = [
    'video_record', 'videoRecord', 'video_recording', 'videoRecording',
    'recording', 'media_record', 'mediaRecord', 'call_video', 'callVideo', 'video',
  ]
  const arrayKeys = [
    'video_records', 'videoRecords', 'video_clips', 'videoClips',
    'videos', 'recordings', 'media_records', 'mediaRecords',
  ]
  const values: Record<string, unknown>[] = [raw]
  for (const key of directKeys) {
    const item = objectValue(raw[key])
    if (Object.keys(item).length > 0) values.push(item)
  }
  for (const key of arrayKeys) {
    for (const item of listValue(raw[key])) {
      const value = objectValue(item)
      if (Object.keys(value).length > 0) values.push(value)
    }
  }
  return values
}

function perspectiveFromText(value: string): ArkmeCallVideoPerspective['perspective'] {
  const text = value.trim().toLowerCase()
  if (['self', 'local', 'mine', 'me', 'current_user', 'currentuser', 'my'].includes(text)) return 'self'
  if (['peer', 'remote', 'other', 'opposite', 'callee', 'caller'].includes(text)) return 'peer'
  if (['main', 'primary', 'host'].includes(text)) return 'main'
  return 'unknown'
}

function perspectiveFromItem(item: Record<string, unknown>, viewerUserId: number): ArkmeCallVideoPerspective['perspective'] {
  const userId = Math.trunc(firstNumber(item, ['user_id', 'userId', 'owner_user_id', 'ownerUserId', 'view_user_id', 'viewUserId']))
  if (userId > 0) return userId === viewerUserId ? 'self' : 'peer'
  const text = firstString(item, ['perspective', 'view', 'viewType', 'view_type', 'viewpoint', 'role', 'stream_type', 'streamType'])
  return perspectiveFromText(text)
}

function pushVideoPerspective(
  target: ArkmeCallVideoPerspective[],
  perspective: ArkmeCallVideoPerspective['perspective'],
  videoUrl: string,
  posterUrl: string,
  label: string,
): void {
  if (videoUrl === '' && posterUrl === '') return
  const duplicate = target.some(item => item.videoUrl === videoUrl && item.posterUrl === posterUrl && videoUrl !== '')
  if (duplicate) return
  target.push({
    perspective,
    ...(label.trim() === '' ? {} : { label: label.trim() }),
    ...(videoUrl === '' ? {} : { videoUrl }),
    ...(posterUrl === '' ? {} : { posterUrl }),
  })
}

function videoPerspectiveFromItem(item: Record<string, unknown>, viewerUserId: number): ArkmeCallVideoPerspective | undefined {
  const videoUrl = firstSafeMediaUrl(item, [
    'video_url', 'videoUrl', 'url', 'record_url', 'recordUrl',
    'download_url', 'downloadUrl', 'play_url', 'playUrl',
    'media_url', 'mediaUrl', 'signed_url', 'signedUrl',
  ])
  const posterUrl = firstSafeMediaUrl(item, [
    'poster_url', 'posterUrl', 'preview_url', 'previewUrl',
    'cover_url', 'coverUrl', 'thumbnail_url', 'thumbnailUrl',
    'snapshot_url', 'snapshotUrl', 'image_url', 'imageUrl',
  ])
  if (videoUrl === '' && posterUrl === '') return undefined
  return {
    perspective: perspectiveFromItem(item, viewerUserId),
    ...(firstString(item, ['label', 'display_name', 'displayName', 'name']) === '' ? {} : {
      label: firstString(item, ['label', 'display_name', 'displayName', 'name']),
    }),
    ...(videoUrl === '' ? {} : { videoUrl }),
    ...(posterUrl === '' ? {} : { posterUrl }),
  }
}

function callVideoRecord(raw: Record<string, unknown>, mediaType: ArkmeCallMediaType, viewerUserId: number): ArkmeCallVideoRecord | undefined {
  if (mediaType !== 'video') return undefined
  const perspectives: ArkmeCallVideoPerspective[] = []
  pushVideoPerspective(
    perspectives,
    'self',
    firstSafeMediaUrl(raw, ['self_video_url', 'selfVideoUrl', 'local_video_url', 'localVideoUrl', 'my_video_url', 'myVideoUrl']),
    firstSafeMediaUrl(raw, ['self_poster_url', 'selfPosterUrl', 'local_poster_url', 'localPosterUrl', 'my_poster_url', 'myPosterUrl']),
    '你的视角',
  )
  pushVideoPerspective(
    perspectives,
    'peer',
    firstSafeMediaUrl(raw, ['peer_video_url', 'peerVideoUrl', 'remote_video_url', 'remoteVideoUrl', 'other_video_url', 'otherVideoUrl']),
    firstSafeMediaUrl(raw, ['peer_poster_url', 'peerPosterUrl', 'remote_poster_url', 'remotePosterUrl', 'other_poster_url', 'otherPosterUrl']),
    '对方视角',
  )
  pushVideoPerspective(
    perspectives,
    'main',
    firstSafeMediaUrl(raw, ['main_video_url', 'mainVideoUrl', 'primary_video_url', 'primaryVideoUrl']),
    firstSafeMediaUrl(raw, ['main_poster_url', 'mainPosterUrl', 'primary_poster_url', 'primaryPosterUrl']),
    '主视角',
  )
  pushVideoPerspective(
    perspectives,
    'peer',
    firstSafeMediaUrl(raw, ['inset_video_url', 'insetVideoUrl', 'secondary_video_url', 'secondaryVideoUrl']),
    firstSafeMediaUrl(raw, ['inset_poster_url', 'insetPosterUrl', 'secondary_poster_url', 'secondaryPosterUrl']),
    '对方视角',
  )
  for (const item of videoRecordCandidateObjects(raw)) {
    const perspective = videoPerspectiveFromItem(item, viewerUserId)
    if (perspective !== undefined) perspectives.push(perspective)
  }
  const unique = perspectives.filter((item, index) => perspectives.findIndex(candidate =>
    candidate.videoUrl === item.videoUrl && candidate.posterUrl === item.posterUrl && candidate.perspective === item.perspective
  ) === index)
  const firstPlayable = unique.find(item => item.videoUrl !== undefined) ?? unique.find(item => item.posterUrl !== undefined)
  if (firstPlayable !== undefined) return {
    available: true,
    source: 'real',
    ...(firstPlayable.videoUrl === undefined ? {} : { videoUrl: firstPlayable.videoUrl }),
    ...(firstPlayable.posterUrl === undefined ? {} : { posterUrl: firstPlayable.posterUrl }),
    perspectives: unique.slice(0, 4),
  }
  return undefined
}

function durationSeconds(acceptedAtMillis: number, startedAtMillis: number, endedAtMillis: number): number {
  const start = acceptedAtMillis > 0 ? acceptedAtMillis : startedAtMillis
  if (start <= 0 || endedAtMillis <= start) return 0
  return Math.max(0, Math.round((endedAtMillis - start) / 1000))
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

export class CallHistoryService {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly profile: ProfileService,
  ) {}

  async listCallHistory(options: ArkmeCallHistoryOptions = {}, signal?: AbortSignal): Promise<ArkmeCallHistoryPage> {
    const session = await this.runtime.requireSession()
    const limit = this.normalizedLimit(options.limit)
    const cursor = options.cursor?.trim() ?? ''
    const body: Record<string, unknown> = { limit }
    if (cursor !== '') body.cursor = cursor
    const scope = this.runtime.requestScope(session.userId)
    const raw = await this.runtime.authenticatedDataPost<Record<string, unknown>>(
      '/api/v1/call/history-aggregate',
      body,
      session,
      signal,
      {
        scope,
        key: `call-history:${String(limit)}:${cursor}`,
        cacheMs: 2_000,
        failureCooldownMs: 2_000,
      },
    )
    const items = await Promise.all(this.historyItems(raw)
      .map(async item => await this.normalizeHistoryItem(item, session.userId)))
    const validItems = items.filter((item): item is ArkmeCallHistoryItem => item !== undefined)
    await this.attachPeerAvatars(validItems, session, signal)
    const hasMore = booleanValue(raw.has_more ?? raw.hasMore)
    const nextCursor = firstString(raw, ['next_cursor', 'nextCursor', 'cursor'])
    const includeRecentContacts = options.includeRecentContacts !== false && cursor === ''
    const recentContacts = includeRecentContacts
      ? await this.recentContacts(raw, session, signal)
      : []
    return {
      items: validItems,
      ...(recentContacts.length === 0 ? {} : { recentContacts }),
      hasMore,
      ...(nextCursor === '' ? {} : { nextCursor }),
    }
  }

  async callDetail(callRef: string, signal?: AbortSignal): Promise<ArkmeCallDetail> {
    const session = await this.runtime.requireSession()
    const payload = await this.openCallRef(callRef, session.userId)
    return await this.detailByRoomId(payload.roomId, payload, session, signal)
  }

  async retryCallSummary(callRef: string, signal?: AbortSignal): Promise<ArkmeCallSummaryRetryResult> {
    const session = await this.runtime.requireSession()
    const payload = await this.openCallRef(callRef, session.userId)
    await this.runtime.authenticatedWebrtcPost<Record<string, unknown>>(
      '/api/v1/trtc/retry-call-summary',
      { room_id: payload.roomId },
      session,
      signal,
      {
        scope: this.runtime.requestScope(session.userId),
        lane: 'write',
        service: 'webrtc',
        failureCooldownMs: 2_000,
      },
    )
    return { status: 'submitted', detail: await this.detailByRoomId(payload.roomId, payload, session, signal, true) }
  }

  private normalizedLimit(value: number | undefined): number {
    const raw = value === undefined ? 20 : Math.trunc(value)
    if (!Number.isSafeInteger(raw) || raw <= 0) {
      throw new ArkmePluginError('call-history-limit-invalid', '通话记录数量参数无效', false, 400)
    }
    return Math.min(50, raw)
  }

  private historyItems(raw: Record<string, unknown>): Record<string, unknown>[] {
    const values = firstValue(raw, ['items', 'records', 'histories', 'call_history_items'])
    return listValue(values).map(item => objectValue(item))
  }

  private async normalizeHistoryItem(
    raw: Record<string, unknown>,
    viewerUserId: number,
  ): Promise<ArkmeCallHistoryItem | undefined> {
    const trtc = objectValue(raw.trtc ?? raw.call ?? raw.call_record)
    const item = { ...raw, ...trtc }
    const roomId = firstString(item, ['room_id', 'roomId'])
    if (roomId === '') return undefined
    const stableId = firstString(raw, ['stable_id', 'stableId']) || `trtc:${roomId}`
    const startedAtMillis = firstEpochMillis(item, ['started_at_millis', 'startedAtMillis', 'start_time', 'startTime', 'create_at', 'createAt'])
    const acceptedAtMillis = firstEpochMillis(item, ['accepted_at_millis', 'acceptedAtMillis', 'accept_time', 'acceptTime'])
    const endedAtMillis = firstEpochMillis(item, ['ended_at_millis', 'endedAtMillis', 'end_time', 'endTime'])
    const duration = durationSeconds(acceptedAtMillis, startedAtMillis, endedAtMillis)
    const callResult = firstString(item, ['call_result', 'callResult', 'result'])
    const callerUserId = Math.trunc(firstNumber(item, ['caller_user_id', 'callerUserId']))
    const calleeUserIds = numberList(item.callee_user_ids ?? item.calleeUserIds)
    const connectedUserIds = numberList(item.connected_user_ids ?? item.connectedUserIds)
    const peerUserId = this.resolvePeerUserId(viewerUserId, callerUserId, calleeUserIds, connectedUserIds, item)
    const summaryText = safeSummary(firstString(item, ['call_summary', 'callSummary', 'summary_text', 'summaryText', 'summary']))
    const summaryUpdatedAtMillis = firstEpochMillis(item, [
      'call_summary_updated_at', 'callSummaryUpdatedAt', 'summary_updated_at', 'summaryUpdatedAt',
    ])
    const displayName = firstString(item, [
      'peer_display_name', 'peerDisplayName', 'display_name', 'displayName', 'name', 'nickname',
    ]) || (peerUserId > 0 ? `Arkme 用户 ${String(peerUserId)}` : 'Arkme 用户')
    const callRef = await this.sealCallRef({
        version: 1,
        userId: viewerUserId,
        roomId,
        stableId,
        issuedAtMillis: Date.now(),
      })
    return {
      callRef,
      stableId: await this.publicStableId(stableId),
      peerDisplayName: displayName,
      ...(peerUserId > 0 ? { peerUserId } : {}),
      mediaType: callMediaType(firstValue(item, ['call_media_type', 'callMediaType', 'media_type', 'mediaType'])),
      startedAtMillis,
      acceptedAtMillis,
      endedAtMillis,
      durationSeconds: duration,
      callResult,
      resultLabel: resultLabel(callResult, acceptedAtMillis, duration),
      summaryStatus: summaryStatus(firstValue(item, ['call_summary_status', 'callSummaryStatus', 'summary_status', 'summaryStatus'])),
      ...(summaryText === '' ? {} : { summaryPreview: summaryText }),
      ...(summaryUpdatedAtMillis > 0 ? { summaryUpdatedAtMillis } : {}),
      canOpenDetail: true,
      canRedial: peerUserId > 0,
      ...(firstString(item, ['chat_session_uid', 'chatSessionUid', 'resolved_chat_session_uid', 'resolvedChatSessionUid']) === ''
        ? {}
        : { chatSessionUid: firstString(item, ['chat_session_uid', 'chatSessionUid', 'resolved_chat_session_uid', 'resolvedChatSessionUid']) }),
      ...(Math.trunc(firstNumber(item, ['shared_topic_id', 'sharedTopicId', 'resolved_shared_topic_id', 'resolvedSharedTopicId'])) > 0
        ? { sharedTopicId: Math.trunc(firstNumber(item, ['shared_topic_id', 'sharedTopicId', 'resolved_shared_topic_id', 'resolvedSharedTopicId'])) }
        : {}),
    }
  }

  private resolvePeerUserId(
    viewerUserId: number,
    callerUserId: number,
    calleeUserIds: readonly number[],
    connectedUserIds: readonly number[],
    item: Record<string, unknown>,
  ): number {
    const direct = Math.trunc(firstNumber(item, ['peer_user_id', 'peerUserId', 'user_id', 'userId']))
    if (direct > 0 && direct !== viewerUserId) return direct
    if (callerUserId > 0 && callerUserId !== viewerUserId) return callerUserId
    return [...calleeUserIds, ...connectedUserIds].find(userId => userId > 0 && userId !== viewerUserId) ?? 0
  }

  private async recentContacts(
    raw: Record<string, unknown>,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeCallRecentContact[]> {
    const rawContacts = listValue(firstValue(raw, ['recent_contacts', 'recentContacts']))
    if (rawContacts.length > 0) {
      const contacts = rawContacts.map(item => this.recentContactFromRaw(objectValue(item)))
        .filter((item): item is ArkmeCallRecentContact => item !== undefined)
      if (contacts.length > 0) return await this.attachRecentContactAvatars(contacts, session, signal)
    }
    try {
      const data = await this.runtime.authenticatedWebrtcPost<Record<string, unknown>>(
        '/api/v1/trtc/recent-call-contacts',
        {},
        session,
        signal,
        {
          scope: this.runtime.requestScope(session.userId),
          lane: 'interactive-read',
          service: 'webrtc',
          key: 'recent-call-contacts',
          cacheMs: 5_000,
          failureCooldownMs: 5_000,
        },
      )
      const ids = numberList(data.contact_user_ids ?? data.contactUserIds)
        .filter(userId => userId !== session.userId)
        .slice(0, 20)
      if (ids.length === 0) return []
      const profiles = await this.profile.publicProfilesByUserIds(ids, session, signal).catch(() => new Map())
      const contacts = ids.map(userId => {
        const profile = profiles.get(userId)
        return {
          userId,
          displayName: profile?.displayName?.trim() || `Arkme 用户 ${String(userId)}`,
        }
      })
      return await this.attachRecentContactAvatars(contacts, session, signal, profiles)
    } catch {
      return []
    }
  }

  private async attachPeerAvatars(
    items: ArkmeCallHistoryItem[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<void> {
    const ids = [...new Set(items.flatMap(item => item.peerUserId === undefined ? [] : [item.peerUserId]))]
    if (ids.length === 0) return
    const profiles = await this.profile.publicProfilesByUserIds(ids, session, signal).catch(() => new Map())
    await Promise.all(items.map(async item => {
      const peerUserId = item.peerUserId
      if (peerUserId === undefined) return
      const profile = profiles.get(peerUserId)
      const displayName = profile?.displayName?.trim() ?? ''
      if (displayName !== '' && /^Arkme 用户 \d+$/.test(item.peerDisplayName.trim())) {
        item.peerDisplayName = displayName
      }
      if (profile?.avatarUrl === undefined) return
      item.peerAvatarRef = await this.profile.sealProfileImageRef(session.userId, peerUserId)
    }))
  }

  private async attachRecentContactAvatars(
    contacts: ArkmeCallRecentContact[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    knownProfiles?: Map<number, { avatarUrl?: string }>,
  ): Promise<ArkmeCallRecentContact[]> {
    const ids = [...new Set(contacts.map(contact => contact.userId).filter(userId => Number.isSafeInteger(userId) && userId > 0))]
    if (ids.length === 0) return contacts
    const profiles = knownProfiles ?? await this.profile.publicProfilesByUserIds(ids, session, signal).catch(() => new Map())
    return await Promise.all(contacts.map(async contact => {
      if (profiles.get(contact.userId)?.avatarUrl === undefined) return contact
      return { ...contact, avatarRef: await this.profile.sealProfileImageRef(session.userId, contact.userId) }
    }))
  }

  private recentContactFromRaw(raw: Record<string, unknown>): ArkmeCallRecentContact | undefined {
    const userId = Math.trunc(firstNumber(raw, ['user_id', 'userId', 'peer_user_id', 'peerUserId']))
    if (userId <= 0) return undefined
    const displayName = firstString(raw, ['display_name', 'displayName', 'peer_display_name', 'peerDisplayName', 'name'])
    const sharedTopicId = Math.trunc(firstNumber(raw, ['shared_topic_id', 'sharedTopicId']))
    return {
      userId,
      displayName: displayName || `Arkme 用户 ${String(userId)}`,
      ...(sharedTopicId > 0 ? { sharedTopicId } : {}),
    }
  }

  private async detailByRoomId(
    roomId: string,
    payload: ArkmeCallRefPayload,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
    bypassCache = false,
  ): Promise<ArkmeCallDetail> {
    const raw = await this.runtime.authenticatedWebrtcPost<Record<string, unknown>>(
      '/api/v1/trtc/call-detail',
      { room_id: roomId },
      session,
      signal,
      {
        scope: this.runtime.requestScope(session.userId),
        lane: 'interactive-read',
        service: 'webrtc',
        key: `call-detail:${roomId}`,
        cacheMs: 2_000,
        failureCooldownMs: 2_000,
        ...(bypassCache ? { bypassCache: true } : {}),
      },
    )
    const startedAtMillis = firstEpochMillis(raw, ['started_at_millis', 'startedAtMillis', 'start_time', 'startTime', 'create_at', 'createAt'])
    const acceptedAtMillis = firstEpochMillis(raw, ['accepted_at_millis', 'acceptedAtMillis', 'accept_time', 'acceptTime'])
    const endedAtMillis = firstEpochMillis(raw, ['ended_at_millis', 'endedAtMillis', 'end_time', 'endTime'])
    const duration = durationSeconds(acceptedAtMillis, startedAtMillis, endedAtMillis)
    const callResult = firstString(raw, ['call_result', 'callResult', 'result'])
    const summaryText = safeSummary(firstString(raw, ['call_summary', 'callSummary', 'summary_text', 'summaryText', 'summary']))
    const summaryUpdatedAtMillis = firstEpochMillis(raw, [
      'call_summary_updated_at', 'callSummaryUpdatedAt', 'summary_updated_at', 'summaryUpdatedAt',
    ])
    const mediaType = callMediaType(firstValue(raw, ['call_media_type', 'callMediaType', 'media_type', 'mediaType']))
    const videoRecord = callVideoRecord(raw, mediaType, session.userId)
    const participants = await this.attachParticipantAvatars(this.participants(raw, session.userId), session, signal)
    return {
      callRef: await this.sealCallRef({ ...payload, issuedAtMillis: Date.now() }),
      title: firstString(raw, ['title', 'display_name', 'displayName', 'peer_display_name', 'peerDisplayName']) || '通话详情',
      mediaType,
      startedAtMillis,
      acceptedAtMillis,
      endedAtMillis,
      durationSeconds: duration,
      callResult,
      resultLabel: resultLabel(callResult, acceptedAtMillis, duration),
      summaryStatus: summaryStatus(firstValue(raw, ['call_summary_status', 'callSummaryStatus', 'summary_status', 'summaryStatus'])),
      ...(summaryText === '' ? {} : { summaryText }),
      ...(summaryUpdatedAtMillis > 0 ? { summaryUpdatedAtMillis } : {}),
      transcriptPending: booleanValue(raw.transcript_pending ?? raw.transcriptPending),
      transcriptFailed: booleanValue(raw.transcript_failed ?? raw.transcriptFailed),
      ...(videoRecord === undefined ? {} : { videoRecord }),
      participants,
      transcriptSegments: this.transcriptSegments(raw).slice(0, 200),
    }
  }

  private async attachParticipantAvatars(
    participants: ArkmeCallParticipant[],
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<ArkmeCallParticipant[]> {
    const ids = [...new Set(participants.flatMap(participant => participant.userId === undefined ? [] : [participant.userId]))]
    if (ids.length === 0) return participants
    const profiles = await this.profile.publicProfilesByUserIds(ids, session, signal).catch(() => new Map())
    return await Promise.all(participants.map(async participant => {
      const userId = participant.userId
      if (userId === undefined || profiles.get(userId)?.avatarUrl === undefined) return participant
      return { ...participant, avatarRef: await this.profile.sealProfileImageRef(session.userId, userId) }
    }))
  }

  private participants(raw: Record<string, unknown>, viewerUserId: number): ArkmeCallParticipant[] {
    const participants = listValue(firstValue(raw, ['participants', 'participant_profiles', 'participantProfiles']))
      .map((item): ArkmeCallParticipant | undefined => {
        const rawItem = objectValue(item)
        const userId = Math.trunc(firstNumber(rawItem, ['user_id', 'userId']))
        const displayName = firstString(rawItem, ['display_name', 'displayName', 'name', 'nick_name', 'nickName'])
        if (userId <= 0 && displayName === '') return undefined
        return {
          ...(userId > 0 ? { userId } : {}),
          displayName: displayName || `Arkme 用户 ${String(userId)}`,
          ...(userId > 0 && userId === viewerUserId ? { isCurrentUser: true } : {}),
        } satisfies ArkmeCallParticipant
      })
      .filter((item): item is ArkmeCallParticipant => item !== undefined)
    return participants.slice(0, 50)
  }

  private transcriptSegments(raw: Record<string, unknown>): ArkmeCallTranscriptSegment[] {
    return listValue(firstValue(raw, ['segments', 'transcript_segments', 'room_transcript_segments']))
      .map((item, index) => {
        const rawItem = objectValue(item)
        const text = clippedText(firstString(rawItem, ['text', 'transcript', 'content']), 2_000)
        if (text === '') return undefined
        const segmentId = firstString(rawItem, ['segment_id', 'segmentId', 'id']) || `segment-${String(index + 1)}`
        const speakerUserId = Math.trunc(firstNumber(rawItem, ['speaker_user_id', 'speakerUserId', 'user_id', 'userId']))
        return {
          segmentId,
          speakerDisplayName: firstString(rawItem, ['speaker_display_name', 'speakerDisplayName', 'speaker_name', 'speakerName'])
            || (speakerUserId > 0 ? `Arkme 用户 ${String(speakerUserId)}` : '说话人'),
          ...(speakerUserId > 0 ? { speakerUserId } : {}),
          text,
          startMillis: firstEpochMillis(rawItem, ['start_millis', 'startMillis', 'start_time_ms', 'startTimeMs']),
          endMillis: firstEpochMillis(rawItem, ['end_millis', 'endMillis', 'end_time_ms', 'endTimeMs']),
        } satisfies ArkmeCallTranscriptSegment
      })
      .filter((item): item is ArkmeCallTranscriptSegment => item !== undefined)
  }

  private async sealCallRef(payload: ArkmeCallRefPayload): Promise<string> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', await this.callRefKey(), iv)
    const encrypted = Buffer.concat([cipher.update(encodeJson(payload), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `arkme-call-v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`
  }

  private async publicStableId(stableId: string): Promise<string> {
    const signature = createHmac('sha256', await this.runtime.stateStore.uniqueCode())
      .update(stableId)
      .digest('base64url')
    return `call-${signature.slice(0, 16)}`
  }

  private async openCallRef(callRef: string, expectedUserId: number): Promise<ArkmeCallRefPayload> {
    const parts = callRef.trim().split('.')
    if (parts.length !== 4 || parts[0] !== 'arkme-call-v1') {
      throw new ArkmePluginError('call-ref-invalid', '通话记录引用无效，请重新查询通话记录', false, 400)
    }
    let payload: unknown
    try {
      const iv = Buffer.from(parts[1] ?? '', 'base64url')
      const encrypted = Buffer.from(parts[2] ?? '', 'base64url')
      const tag = Buffer.from(parts[3] ?? '', 'base64url')
      const decipher = createDecipheriv('aes-256-gcm', await this.callRefKey(), iv)
      decipher.setAuthTag(tag)
      const encoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
      payload = decodeJson(encoded)
    } catch (error) {
      throw new ArkmePluginError('call-ref-invalid', '通话记录引用无效，请重新查询通话记录', false, 400, { cause: error })
    }
    const value = objectValue(payload)
    const parsed = {
      version: numberValue(value.version),
      userId: numberValue(value.userId),
      roomId: stringValue(value.roomId).trim(),
      stableId: stringValue(value.stableId).trim(),
      issuedAtMillis: numberValue(value.issuedAtMillis),
    }
    if (parsed.version !== 1 || parsed.userId !== expectedUserId || parsed.roomId === '' || parsed.stableId === '') {
      throw new ArkmePluginError('call-ref-invalid', '通话记录引用无效，请重新查询通话记录', false, 400)
    }
    return parsed as ArkmeCallRefPayload
  }

  private async callRefKey(): Promise<Buffer> {
    return createHash('sha256')
      .update(await this.runtime.stateStore.uniqueCode())
      .update('\0arkme-call-ref-v1')
      .digest()
  }
}
