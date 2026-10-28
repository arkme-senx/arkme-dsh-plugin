import type { ArkmeRecordingSearchItem, ArkmeRecordingSearchSegment } from './types.js'
import { ArkmePluginError, objectValue, stringValue } from './services/service.js'
function invalid(): never { throw new ArkmePluginError('recording-search-invalid', '录音搜索结果已失效，请重试', true) }
function segment(raw: unknown): ArkmeRecordingSearchSegment {
  const value = objectValue(raw)
  if (!stringValue(value.session_id).trim() || !stringValue(value.child_id).trim()
    || !Number.isSafeInteger(value.item_index) || Number(value.item_index) < 0
    || value.transcript_source !== 'system' || !stringValue(value.transcript_version).trim()
    || typeof value.text !== 'string' || !Number.isSafeInteger(value.start_at) || !Number.isSafeInteger(value.end_at)) invalid()
  const speaker = objectValue(value.speaker)
  return {
    sessionId: String(value.session_id), childId: String(value.child_id), itemIndex: Number(value.item_index),
    transcriptSource: 'system', transcriptVersion: String(value.transcript_version),
    startAtMillis: Number(value.start_at), endAtMillis: Number(value.end_at), text: String(value.text),
    ...(value.speaker === undefined ? {} : { speaker: {
      speakerId: stringValue(speaker.speaker_id), label: stringValue(speaker.label) || '未知说话人',
      ...(typeof speaker.user_id === 'number' && speaker.user_id > 0 ? {userId: speaker.user_id} : {}),
      ...(typeof speaker.color_index === 'number' ? {colorIndex: speaker.color_index} : {}),
    } }),
  }
}
export function parseRecordingSearchItem(raw: unknown): ArkmeRecordingSearchItem {
  const value = objectValue(raw)
  const match = segment(value.match)
  const previous = value.previous == null ? undefined : segment(value.previous)
  const next = value.next == null ? undefined : segment(value.next)
  if (match.sessionId !== value.session_id) invalid()
  const day = Number(value.date_stamp)
  if ([previous, next].some(item => item && item.sessionId !== match.sessionId
    && (!Number.isSafeInteger(day) || day <= 0 || item.startAtMillis < day || item.startAtMillis >= day + 86_400_000))) invalid()
  if ((previous && previous.startAtMillis > match.startAtMillis) || (next && next.startAtMillis < match.startAtMillis)) invalid()
  const ranges = Array.isArray(value.highlight_ranges) ? value.highlight_ranges : []
  const length = Array.from(match.text).length
  const highlightRanges = ranges.map(objectValue).map(range => ({start: Number(range.start_index), length: Number(range.length)}))
    .filter(range => Number.isSafeInteger(range.start) && Number.isSafeInteger(range.length) && range.start >= 0 && range.length > 0 && range.start + range.length <= length)
    .sort((a,b) => a.start - b.start).filter((range,index,all) => index === 0 || range.start >= all[index-1]!.start + all[index-1]!.length)
  return {sessionId: match.sessionId, dateStamp: Number(value.date_stamp) || 0, startAtMillis: match.startAtMillis,
    snippet: match.text, score: Number(value.score) || 0, match, highlightRanges,
    ...(stringValue(value.record_uid) ? {recordUid: String(value.record_uid)} : {}),
    ...(previous ? {previous} : {}), ...(next ? {next} : {})}
}
