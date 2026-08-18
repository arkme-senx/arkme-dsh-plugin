import { JotmoPluginError } from './jotmo-service.js'
import type {
  JotmoCallDetail,
  JotmoCallDirection,
  JotmoCallList,
  JotmoCallListItem,
  JotmoCallMediaType,
  JotmoCallParticipant,
  JotmoCallSectionState,
  JotmoCallTranscriptItem,
} from './types.js'

export interface JotmoCallListProjectionContext {
  viewerUserId: number
  displayNamesByUserId: ReadonlyMap<number, string>
  callRefByRoomId: ReadonlyMap<string, string>
  avatarRefsByUserId?: ReadonlyMap<number, string>
}

interface TrtcAggregateRow {
  aggregate: Record<string, unknown>
  trtc: Record<string, unknown>
  roomId: string
}

const UNCONNECTED_RESULTS = new Set([
  'cancel', 'canceled', 'cancelled', 'reject', 'rejected', 'notanswer', 'noanswer',
  'missed', 'callbusy', 'busy', 'offline',
])

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function positiveUserId(value: unknown): number | undefined {
  const userId = numberValue(value)
  return Number.isSafeInteger(userId) && userId > 0 ? userId : undefined
}

function uniquePositiveUserIds(values: readonly unknown[]): number[] {
  const result: number[] = []
  const known = new Set<number>()
  for (const value of values) {
    const userId = positiveUserId(value)
    if (userId === undefined || known.has(userId)) continue
    known.add(userId)
    result.push(userId)
  }
  return result
}

function trtcRows(raw: unknown): TrtcAggregateRow[] {
  const page = objectValue(raw)
  const rows: TrtcAggregateRow[] = []
  for (const value of listValue(page.items)) {
    const aggregate = objectValue(value)
    if (aggregate.source !== 'trtc') continue
    const trtc = objectValue(aggregate.trtc)
    const roomId = stringValue(trtc.room_id).trim()
    if (roomId === '') continue
    rows.push({ aggregate, trtc, roomId })
  }
  return rows
}

function participantUserIds(trtc: Record<string, unknown>): number[] {
  return uniquePositiveUserIds([trtc.caller_user_id, ...listValue(trtc.callee_user_ids)])
}

function normalizedEpochMillis(value: unknown): number {
  const numeric = numberValue(value)
  if (numeric <= 0) return 0
  const millis = numeric < 10_000_000_000 ? numeric * 1_000 : numeric
  return Math.max(0, Math.trunc(millis))
}

function normalizedOffsetMillis(value: unknown): number {
  return Math.max(0, Math.trunc(numberValue(value)))
}

function normalizedTranscriptOffsetMillis(value: unknown, callStartedAtMillis: number): number {
  const rawOffset = normalizedOffsetMillis(value)
  if (rawOffset === 0 || callStartedAtMillis <= 0) return rawOffset
  const possibleEpochMillis = normalizedEpochMillis(value)
  if (Math.abs(possibleEpochMillis - callStartedAtMillis) <= 86_400_000) {
    return Math.max(0, possibleEpochMillis - callStartedAtMillis)
  }
  return rawOffset
}

function mediaType(value: unknown): JotmoCallMediaType {
  if (value === 0) return 'audio'
  if (value === 1) return 'video'
  return 'unknown'
}

function callDirection(participants: readonly number[], callerUserId: number, viewerUserId: number): JotmoCallDirection {
  if (participants.length > 2) return 'group'
  if (callerUserId === viewerUserId) return 'outgoing'
  if (participants.includes(viewerUserId)) return 'incoming'
  return 'unknown'
}

function normalizedCallResult(value: unknown): string {
  return stringValue(value).trim().toLowerCase().replace(/[\s_-]/g, '')
}

function connectedState(
  trtc: Record<string, unknown>,
  startedAtMillis: number,
  acceptedAtMillis: number,
  endedAtMillis: number,
): boolean {
  if (UNCONNECTED_RESULTS.has(normalizedCallResult(trtc.call_result))) return false
  if (acceptedAtMillis > 0) return true
  if (endedAtMillis > startedAtMillis) return true
  return uniquePositiveUserIds(listValue(trtc.connected_user_ids)).length > 0
}

function durationMillis(startedAtMillis: number, acceptedAtMillis: number, endedAtMillis: number): number {
  if (endedAtMillis <= 0) return 0
  return Math.max(0, endedAtMillis - (acceptedAtMillis || startedAtMillis))
}

function summaryState(statusValue: unknown, content: string): JotmoCallSectionState {
  const status = stringValue(statusValue).trim().toLowerCase()
  if (status === 'pending' || status === 'processing') return 'processing'
  if (status === 'failed') return 'failed'
  if (status === 'done' && content !== '') return 'ready'
  return 'empty'
}

function collapsedText(value: unknown): string {
  return stringValue(value).trim().replace(/\s+/g, ' ')
}

function summaryPreview(value: unknown): string {
  return [...collapsedText(value)].slice(0, 160).join('')
}

function displayNameForUser(userId: number, names: ReadonlyMap<number, string>): string {
  return stringValue(names.get(userId)).trim()
}

function peerDisplayOrder(trtc: Record<string, unknown>, viewerUserId: number): number[] {
  const callees = uniquePositiveUserIds(listValue(trtc.callee_user_ids)).filter(userId => userId !== viewerUserId)
  const caller = positiveUserId(trtc.caller_user_id)
  if (caller !== undefined && caller !== viewerUserId && !callees.includes(caller)) callees.push(caller)
  return callees
}

function callDisplayName(
  trtc: Record<string, unknown>,
  participants: readonly number[],
  viewerUserId: number,
  names: ReadonlyMap<number, string>,
): string {
  const peers = peerDisplayOrder(trtc, viewerUserId)
  if (participants.length > 2) {
    const known = peers.map(userId => displayNameForUser(userId, names)).filter(name => name !== '').slice(0, 2)
    return known.length === 0 ? `群通话（${String(participants.length)}人）` : `${known.join('、')}（${String(participants.length)}人）`
  }
  const peerName = peers.map(userId => displayNameForUser(userId, names)).find(name => name !== '')
  return peerName ?? '即我用户'
}

function callTimes(trtc: Record<string, unknown>, aggregate?: Record<string, unknown>) {
  const startedAtMillis = normalizedEpochMillis(trtc.start_time)
    || normalizedEpochMillis(aggregate?.sort_time_ms)
    || normalizedEpochMillis(trtc.create_at)
  const acceptedAtMillis = normalizedEpochMillis(trtc.accept_time)
  const endedAtMillis = normalizedEpochMillis(trtc.end_time)
  return {
    startedAtMillis,
    acceptedAtMillis,
    endedAtMillis,
    durationMillis: durationMillis(startedAtMillis, acceptedAtMillis, endedAtMillis),
  }
}

function projectListItem(
  row: TrtcAggregateRow,
  context: JotmoCallListProjectionContext,
): JotmoCallListItem | undefined {
  const callRef = stringValue(context.callRefByRoomId.get(row.roomId)).trim()
  if (callRef === '') return undefined
  const participants = participantUserIds(row.trtc)
  const primaryPeerUserId = peerDisplayOrder(row.trtc, context.viewerUserId)[0]
  const avatarRef = primaryPeerUserId === undefined
    ? ''
    : stringValue(context.avatarRefsByUserId?.get(primaryPeerUserId)).trim()
  const callerUserId = positiveUserId(row.trtc.caller_user_id) ?? 0
  const times = callTimes(row.trtc, row.aggregate)
  const preview = summaryPreview(row.trtc.call_summary)
  return {
    callRef,
    displayName: callDisplayName(row.trtc, participants, context.viewerUserId, context.displayNamesByUserId),
    ...(avatarRef === '' ? {} : { avatarRef }),
    participantCount: participants.length,
    mediaType: mediaType(row.trtc.call_media_type ?? row.aggregate.call_media_type),
    direction: callDirection(participants, callerUserId, context.viewerUserId),
    connected: connectedState(
      row.trtc,
      times.startedAtMillis,
      times.acceptedAtMillis,
      times.endedAtMillis,
    ),
    ...times,
    summaryState: summaryState(row.trtc.call_summary_status, preview),
    summaryPreview: preview,
  }
}

export function callListRoomIds(raw: unknown): string[] {
  const result: string[] = []
  const known = new Set<string>()
  for (const row of trtcRows(raw)) {
    if (known.has(row.roomId)) continue
    known.add(row.roomId)
    result.push(row.roomId)
  }
  return result
}

export function callListParticipantUserIds(raw: unknown): number[] {
  const values: unknown[] = []
  for (const row of trtcRows(raw)) values.push(...participantUserIds(row.trtc))
  return uniquePositiveUserIds(values)
}

export function callDetailParticipantUserIds(raw: unknown): number[] {
  return participantUserIds(objectValue(raw))
}

export function projectCallListPage(raw: unknown, context: JotmoCallListProjectionContext): JotmoCallList {
  const page = objectValue(raw)
  const hasMore = page.has_more === true
  const nextCursor = stringValue(page.next_cursor).trim()
  if (hasMore && nextCursor === '') {
    throw new JotmoPluginError(
      'call-list-contract-invalid',
      '即我通话记录分页响应缺少下一页游标',
      true,
      502,
    )
  }
  const items = trtcRows(page)
    .map(row => projectListItem(row, context))
    .filter((item): item is JotmoCallListItem => item !== undefined)
  return {
    items,
    hasMore,
    ...(nextCursor === '' ? {} : { nextCursor }),
  }
}

function detailDisplayNames(raw: Record<string, unknown>): Map<number, string> {
  const result = new Map<number, string>()
  for (const value of listValue(raw.participant_profiles)) {
    const profile = objectValue(value)
    const userId = positiveUserId(profile.user_id)
    const displayName = stringValue(profile.display_name).trim()
    if (userId !== undefined && displayName !== '' && !result.has(userId)) result.set(userId, displayName)
  }
  return result
}

function detailParticipants(
  raw: Record<string, unknown>,
  participantIds: readonly number[],
  viewerUserId: number,
  names: ReadonlyMap<number, string>,
  avatarRefsByUserId?: ReadonlyMap<number, string>,
): JotmoCallParticipant[] {
  const connected = new Set(uniquePositiveUserIds(listValue(raw.connected_user_ids)))
  return participantIds.map(userId => {
    const avatarRef = stringValue(avatarRefsByUserId?.get(userId)).trim()
    return {
      displayName: userId === viewerUserId ? '我' : displayNameForUser(userId, names) || '即我用户',
      ...(avatarRef === '' ? {} : { avatarRef }),
      isSelf: userId === viewerUserId,
      connected: connected.has(userId),
    }
  })
}

function sectionMessage(
  kind: 'summary' | 'transcript',
  state: JotmoCallSectionState,
  hasContent = false,
): string {
  if (state === 'ready') return ''
  if (kind === 'summary') {
    if (state === 'processing') return 'AI 摘要生成中'
    if (state === 'failed') return 'AI 摘要生成失败'
    return '暂无 AI 摘要'
  }
  if (state === 'processing') return hasContent ? '录音文本转写中，已展示部分内容' : '通话转录处理中'
  if (state === 'failed') return '通话转录失败'
  return '暂无转录内容'
}

function transcriptItems(
  raw: Record<string, unknown>,
  viewerUserId: number,
  names: ReadonlyMap<number, string>,
  callStartedAtMillis: number,
  avatarRefsByUserId?: ReadonlyMap<number, string>,
): JotmoCallTranscriptItem[] {
  const result: JotmoCallTranscriptItem[] = []
  for (const value of listValue(raw.room_transcript_segments)) {
    const segment = objectValue(value)
    const text = stringValue(segment.text).trim()
    if (text === '') continue
    const startOffsetMillis = normalizedTranscriptOffsetMillis(segment.start_ms, callStartedAtMillis)
    const endOffsetMillis = Math.max(
      startOffsetMillis,
      normalizedTranscriptOffsetMillis(segment.end_ms, callStartedAtMillis),
    )
    const speakerUserId = positiveUserId(segment.speaker_user_id)
    const isSelf = speakerUserId === viewerUserId
    const participantName = speakerUserId === undefined ? '' : displayNameForUser(speakerUserId, names)
    const remark = stringValue(segment.inner_spk_remark).trim()
    const speakerNumber = Math.max(0, Math.trunc(numberValue(segment.speaker_num)))
    const speakerLabel = isSelf
      ? '我'
      : participantName || remark || (speakerNumber > 0 ? `说话人 ${String(speakerNumber)}` : '说话人')
    const avatarRef = speakerUserId === undefined
      ? ''
      : stringValue(avatarRefsByUserId?.get(speakerUserId)).trim()
    result.push({
      itemId: `segment-${String(result.length + 1)}-${String(startOffsetMillis)}-${String(endOffsetMillis)}`,
      startOffsetMillis,
      endOffsetMillis,
      speakerLabel,
      ...(avatarRef === '' ? {} : { avatarRef }),
      isSelf,
      text,
    })
  }
  return result
}

function transcriptState(raw: Record<string, unknown>, itemCount: number): JotmoCallSectionState {
  const progress = objectValue(raw.call_transcription_progress)
  const status = stringValue(progress.overall_status).trim().toLowerCase()
  if (status === 'processing') return 'processing'
  if (status === 'failed') return 'failed'
  return itemCount > 0 ? 'ready' : 'empty'
}

export function projectCallDetail(
  raw: unknown,
  context: {
    viewerUserId: number
    expectedRoomId: string
    callRef: string
    avatarRefsByUserId?: ReadonlyMap<number, string>
  },
): JotmoCallDetail {
  const detail = objectValue(raw)
  const roomId = stringValue(detail.room_id).trim()
  if (roomId === '' || roomId !== context.expectedRoomId) {
    throw new JotmoPluginError(
      'call-detail-contract-invalid',
      '即我通话详情与请求的通话记录不匹配',
      false,
      502,
    )
  }
  const participantIds = participantUserIds(detail)
  const callerUserId = positiveUserId(detail.caller_user_id) ?? 0
  const names = detailDisplayNames(detail)
  const participants = detailParticipants(
    detail,
    participantIds,
    context.viewerUserId,
    names,
    context.avatarRefsByUserId,
  )
  const times = callTimes(detail)
  const summaryContent = stringValue(detail.call_summary).trim()
  const projectedSummaryState = summaryState(detail.call_summary_status, summaryContent)
  const visibleTranscriptItems = transcriptItems(
    detail,
    context.viewerUserId,
    names,
    times.startedAtMillis,
    context.avatarRefsByUserId,
  )
  const projectedTranscriptState = transcriptState(detail, visibleTranscriptItems.length)
  return {
    callRef: context.callRef,
    displayName: callDisplayName(detail, participantIds, context.viewerUserId, names),
    participants,
    mediaType: mediaType(detail.call_media_type),
    direction: callDirection(participantIds, callerUserId, context.viewerUserId),
    connected: connectedState(detail, times.startedAtMillis, times.acceptedAtMillis, times.endedAtMillis),
    ...times,
    summary: {
      state: projectedSummaryState,
      content: projectedSummaryState === 'ready' ? summaryContent : '',
      message: sectionMessage('summary', projectedSummaryState),
    },
    transcript: {
      state: projectedTranscriptState,
      items: projectedTranscriptState === 'ready' || projectedTranscriptState === 'processing'
        ? visibleTranscriptItems
        : [],
      message: sectionMessage('transcript', projectedTranscriptState, visibleTranscriptItems.length > 0),
    },
  }
}
