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

/** Port of desktop call_record.dart; identifiers remain on the host. */
export function projectCallRecord(raw: unknown, viewerUserId: number): ArkmeTimelineItem['callRecord'] {
  const root = object(raw)
  const record = object(root.record)
  const core = object(root.record_core)
  const payload = object(record.payload ?? root.payload)
  const candidates = [payload, record, root, core].flatMap(value => [value, object(value.content_payload ?? value.contentPayload)])
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
  const source = candidates.map(value => details(value)).find(value => value !== undefined)
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
  return { mediaType, text }
}
