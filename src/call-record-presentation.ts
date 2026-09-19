import type { ArkmeTimelineItem } from './types.js'

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)) } catch { return {} }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function first(source: Record<string, unknown>, keys: string[]): unknown {
  return keys.map(key => source[key]).find(value => value !== undefined && value !== null && value !== '')
}

/** Only explicit template identities, never names inferred from summary prose. */
export function callSummaryUserIds(source: Record<string, unknown>): number[] {
  const template = String(first(source, ['smt', 'call_summary_template', 'callSummaryTemplate', 'summary_template', 'summaryTemplate']) ?? '')
  const users = object(first(source, ['ssu', 'summary_speaker_user_ids', 'call_summary_speaker_user_ids']))
  const ids = new Set<number>()
  for (const match of template.matchAll(/\{\{(user|speaker):([^{}]+)\}\}/g)) {
    const userId = Number(match[1] === 'user' ? match[2] : users[match[0]] ?? users[match[2]!])
    if (Number.isSafeInteger(userId) && userId > 0) ids.add(userId)
  }
  return [...ids]
}

/** Flutter-compatible summary templates, resolved on the host before projection. */
export function renderCallRecordSummary(source: Record<string, unknown>, viewerUserId: number, displayNames: ReadonlyMap<number, string> = new Map()): string {
  const fallback = String(first(source, ['sm', 'call_summary', 'callSummary', 'summary_text', 'summaryText', 'summary']) ?? '').trim()
  const template = String(first(source, ['smt', 'call_summary_template', 'callSummaryTemplate', 'summary_template', 'summaryTemplate']) ?? '').trim()
  const labels = object(first(source, ['ssl', 'summary_speaker_labels', 'call_summary_speaker_labels']))
  const users = object(first(source, ['ssu', 'summary_speaker_user_ids', 'call_summary_speaker_user_ids']))
  const rendered = template.replace(/\{\{(user|speaker):([^{}]+)\}\}/g, (token: string, kind: string, key: string) => {
    const userId = Number(kind === 'user' ? key : users[token] ?? users[key])
    if (userId > 0 && userId === viewerUserId) return '我'
    const name = displayNames.get(userId)
    if (name?.trim()) return name.trim()
    const label = kind === 'speaker' ? labels[token] ?? labels[key] : undefined
    return typeof label === 'string' && label.trim() ? label.trim() : token
  })
  const text = rendered && !rendered.includes('{{') ? rendered : fallback
  return text.includes('{{') ? '' : text
}

function callRecordCandidates(raw: unknown): Record<string, unknown>[] {
  const root = object(raw)
  const record = object(root.record)
  const core = object(root.record_core)
  const payload = object(record.payload ?? root.payload)
  const candidates: Record<string, unknown>[] = []
  const seen = new Set<Record<string, unknown>>()
  const visit = (value: Record<string, unknown>, depth: number) => {
    if (depth > 4 || seen.has(value)) return
    seen.add(value)
    candidates.push(value)
    for (const key of ['content_payload', 'contentPayload', 'record_payload', 'recordPayload', 'payload', 'record', 'record_core']) {
      if (value[key] != null) visit(object(value[key]), depth + 1)
    }
  }
  for (const value of [payload, record, root, core]) visit(value, 0)
  return candidates
}

/** Host-only metadata used by the existing call-history owner to seal a detail reference. */
export function callRecordSource(raw: unknown): Record<string, unknown> | undefined {
  const candidates = callRecordCandidates(raw)
  const details = (value: Record<string, unknown>, depth = 0): Record<string, unknown> | undefined => {
    if (depth > 3) return undefined
    for (const key of ['crd', 'call_record', 'callRecord', 'call', 'call_detail', 'callDetail']) {
      const nested = object(value[key])
      if (Object.keys(nested).length > 0) return nested
    }
    const extra = value.extra == null ? undefined : details(object(value.extra), depth + 1)
    if (extra) return extra
    if (first(value, ['mt', 'media_type', 'mediaType', 'call_media_type', 'callMediaType']) !== undefined
      && first(value, ['rs', 'call_result', 'callResult', 'caller_id', 'callerId', 'cr']) !== undefined) return value
    return undefined
  }
  return candidates.map(value => details(value)).find(value => value !== undefined)
}

export function callRecordRoomId(raw: unknown): string {
  const source = callRecordSource(raw)
  const room = source && first(source, ['ri', 'room_id', 'roomId', 'room_uid', 'roomUid'])
  if (typeof room === 'string' && room.trim()) return room.trim()
  // New Record payloads use the call structured anchor as the room locator.
  for (const candidate of callRecordCandidates(raw)) {
    const anchor = object(candidate.structured_anchor ?? candidate.structuredAnchor ?? candidate)
    if (Number(anchor.anchor_kind ?? anchor.anchorKind) !== 2) continue
    const uid = anchor.anchor_uid ?? anchor.anchorUid
    if (typeof uid === 'string' && uid.trim()) return uid.trim()
  }
  return ''
}

function callPreviewDuration(source: Record<string, unknown>): number {
  const seconds = Number(first(source, ['du', 'duration', 'duration_sec', 'durationSec']) ?? 0)
  if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds)
  const accepted = Number(first(source, ['at', 'accept_time', 'acceptTime', 'call_accept_time', 'callAcceptTime']) ?? 0)
  const started = Number(first(source, ['st', 'start_time', 'startTime', 'call_start_time', 'callStartTime']) ?? 0)
  const end = Number(first(source, ['et', 'end_time', 'endTime', 'call_end_time', 'callEndTime']) ?? 0)
  const begin = accepted > 0 ? accepted : started
  if (!Number.isFinite(begin) || !Number.isFinite(end) || begin <= 0 || end <= begin) return 0
  const delta = end - begin
  // Historical payloads contain both epoch seconds and milliseconds. Recognize
  // millisecond epochs even for short calls, before Flutter's legacy delta fallback.
  return Math.floor(begin >= 1e11 && end >= 1e11 || delta > 12 * 60 * 60 ? delta / 1000 : delta)
}

function callPreviewDurationText(seconds: number): string {
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60]
  if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600))
  return parts.map(part => String(part).padStart(2, '0')).join(':')
}

/** Flutter chat_record_preview_formatter parity. Shared by directory and live
 * message previews; this reads the message payload only, never call details. */
export function callRecordConversationPreview(raw: unknown, viewerUserId = 0): string | undefined {
  const source = callRecordSource(raw)
  const isCall = source !== undefined || callRecordCandidates(raw).some(value => {
    const template = Number(first(value, ['template_kind', 'templateKind', 'payload_kind', 'payloadKind']))
    const anchor = object(value.structured_anchor ?? value.structuredAnchor ?? value)
    return template === 9 || ((!Number.isFinite(template) || template === 5)
      && Number(anchor.anchor_kind ?? anchor.anchorKind) === 2)
  })
  if (!isCall) return undefined
  if (!source) return '[通话]'
  const media = String(first(source, ['mt', 'media_type', 'mediaType', 'call_media_type', 'callMediaType']) ?? '').trim().toLowerCase()
  if (!['audio', 'video', '1', '2'].includes(media)) return '[通话]'
  const typeText = media === 'video' || media === '2' ? '视频通话' : '语音通话'
  const result = String(first(source, ['rs', 'call_result', 'callResult', 'result']) ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  const duration = callPreviewDuration(source)
  if (!result && duration <= 0) return '[通话]'
  const isCaller = viewerUserId > 0 && Number(first(source, ['cr', 'caller_id', 'callerId', 'caller_user_id', 'callerUserId'])) === viewerUserId
  let status: string
  switch (result) {
    case 'cancel': case 'canceled': case 'cancelled': status = isCaller ? '已取消' : '对方已取消'; break
    case 'reject': case 'rejected': status = isCaller ? '对方已拒绝' : '已拒绝'; break
    case 'notanswer': case 'noanswer': case 'missed': status = isCaller ? '对方无应答' : '未接听'; break
    case 'callbusy': case 'busy': status = isCaller ? '对方忙线中' : '未接听'; break
    case 'offline': status = isCaller ? '对方离线' : '未接听'; break
    default: status = duration > 0 ? '已接听' : '未接通'
  }
  return `${typeText} ${status}${status === '已接听' ? ` ${callPreviewDurationText(duration)}` : ''}`
}

/** Port of desktop call_record.dart; identifiers remain on the host. */
export function projectCallRecord(raw: unknown, viewerUserId: number): ArkmeTimelineItem['callRecord'] {
  const source = callRecordSource(raw)
  // Do not manufacture a cancelled state for a structured anchor with no result.
  if (!source) return undefined
  const media = String(first(source, ['mt', 'media_type', 'mediaType', 'call_media_type', 'callMediaType']) ?? '').trim().toLowerCase()
  if (!['audio', 'video', '1', '2'].includes(media)) return undefined
  const mediaType = media === 'video' || media === '2' ? 'video' : 'audio'
  const result = String(first(source, ['rs', 'call_result', 'callResult', 'result']) ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  const isCaller = viewerUserId > 0 && Number(first(source, ['cr', 'caller_id', 'callerId', 'caller_user_id', 'callerUserId'])) === viewerUserId
  const seconds = Number(first(source, ['du', 'duration', 'duration_sec', 'durationSec']) ?? 0)
  const duration = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const typeText = mediaType === 'video' ? '视频通话' : '语音通话'
  let text = typeText
  switch (result) {
    case 'normalend': case 'accepted': case 'connected': case 'answered':
      text = duration > 0 ? `${typeText} ${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}` : `${typeText}，未接通`
      break
    case 'cancel': case 'canceled': case 'cancelled': text = isCaller ? '已取消' : '对方已取消'; break
    case 'reject': case 'rejected': text = isCaller ? '对方已拒绝' : '已拒绝'; break
    case 'notanswer': case 'noanswer': case 'missed': text = isCaller ? '对方无应答' : '未接听'; break
    case 'callbusy': case 'busy': text = isCaller ? '对方忙线中' : '未接听(忙线)'; break
    case 'offline': text = isCaller ? '对方离线' : '未接听(离线)'; break
  }
  const summary = renderCallRecordSummary(source, viewerUserId)
  const rawStatus = String(first(source, ['ss', 'call_summary_status', 'summary_status', 'summaryStatus']) ?? '').toLowerCase()
  const summaryStatus = ['pending', 'processing', 'generating'].includes(rawStatus) ? 'pending'
    : ['done', 'success', 'finished'].includes(rawStatus) ? 'done'
      : ['failed', 'error'].includes(rawStatus) ? 'failed' : undefined
  return { mediaType, text,
    ...(summary && !summary.includes('{{') ? { summaryText: summary } : {}),
    ...(summaryStatus ? { summaryStatus } : {}),
  }
}
