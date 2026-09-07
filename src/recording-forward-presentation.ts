import type { ArkmeForwardRecordsPreview, ArkmeForwardTranscriptSegment } from './types.js'
import { RECORDING_FORWARD_MAX_SEGMENTS } from './recording-forward-contract.js'

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function milliseconds(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** A frozen Audio segment uses recording-local speaker numbers and millisecond offsets. */
export function projectForwardRecordingSegment(raw: unknown, fallbackSpeakerName: string): ArkmeForwardTranscriptSegment {
  const segment = objectValue(raw)
  const number = segment.speaker_number ?? segment.speakerNumber
  const speakerNumber = typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : undefined
  const startMillis = milliseconds(segment.start_millis ?? segment.startMillis)
  return {
    ...(speakerNumber === undefined ? {} : { speakerNumber }),
    speakerName: stringValue(segment.speaker_label ?? segment.speakerLabel).trim()
      || (speakerNumber === undefined ? fallbackSpeakerName : `说话人 ${String(speakerNumber)}`),
    textContent: stringValue(segment.text),
    startMillis,
    endMillis: Math.max(startMillis, milliseconds(segment.end_millis ?? segment.endMillis)),
  }
}

/** Projects the Record owner's frozen single-recording forward snapshot. */
export function projectRecordRecordingForward(raw: unknown): ArkmeForwardRecordsPreview | undefined {
  const payload = objectValue(objectValue(raw).forward_records)
  if (payload.render_kind !== 'forward_records' || payload.source_type !== 'long_recording_segments'
    || !Array.isArray(payload.items) || payload.items.length !== 1) return undefined
  const item = objectValue(payload.items[0])
  if (!Array.isArray(item.long_recording_segments) || item.long_recording_segments.length === 0) return undefined
  const senderName = stringValue(item.owner_name).trim() || 'Arkme用户'
  return {
    title: stringValue(payload.title).trim() || '录音片段',
    createdAtMillis: milliseconds(payload.created_at),
    summaryLines: Array.isArray(payload.summary_lines) ? payload.summary_lines.filter((value): value is string => typeof value === 'string' && value.trim() !== '') : [],
    items: [{
      sourceType: 'long_recording_segments',
      senderName,
      sendAtMillis: milliseconds(item.send_at),
      title: stringValue(item.title),
      textContent: stringValue(item.text),
      segments: item.long_recording_segments.slice(0, RECORDING_FORWARD_MAX_SEGMENTS).map(segment => projectForwardRecordingSegment(segment, senderName)),
      ...(item.long_recording_segments.length > RECORDING_FORWARD_MAX_SEGMENTS ? { truncated: true } : {}),
    }],
  }
}
