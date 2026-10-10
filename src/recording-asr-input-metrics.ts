import { recordingBelongsToViewer } from './recording-coverage.js'
import type { ArkmeRecordingDailyMetrics } from './types.js'

type AsrInputMetrics = Pick<ArkmeRecordingDailyMetrics, 'asrInputEstimatedCount' | 'asrInputDurationMillis' | 'asrInputState' | 'asrInputConfirmedCount' | 'asrInputPendingCount' | 'asrInputUnknownCount'>
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const id = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

/** Count model input windows separately, including overlap/retries. The API
 * distinguishes observed input from historical reconstruction; missing telemetry
 * is never inferred from transcript text, bytes or the recording envelope. */
function clippedInputDuration(child: Record<string, unknown>, duration: number, from: number, to: number): number | undefined {
  const input = object(child.asr_input_metrics)
  if (!['ready', 'partial', 'processing'].includes(String(input.state)) || !['observed', 'estimated'].includes(String(input.basis))
    || (input.state === 'processing' && input.basis !== 'observed')
    || !validTime(input.duration_ms) || !Array.isArray(input.spans)) return undefined
  let total = 0, clipped = 0
  for (const raw of input.spans) {
    if (!Array.isArray(raw) || raw.length !== 2 || !validTime(raw[0]) || !validTime(raw[1]) || raw[1] <= raw[0] || raw[1] > duration) return undefined
    total += raw[1] - raw[0]
    clipped += Math.max(0, Math.min(raw[1], to) - Math.max(raw[0], from))
  }
  return Number.isSafeInteger(total) && total === input.duration_ms && Number.isSafeInteger(clipped) ? clipped : undefined
}

export function projectRecordingAsrInputMetrics(response: unknown, viewerUserId: number, dayStart: number, dayEnd: number): AsrInputMetrics {
  let asrInputEstimatedCount = 0, asrInputDurationMillis = 0, asrInputConfirmedCount = 0, asrInputPendingCount = 0, asrInputUnknownCount = 0
  const result = (): AsrInputMetrics => ({ asrInputEstimatedCount, asrInputDurationMillis, asrInputConfirmedCount, asrInputPendingCount, asrInputUnknownCount,
    asrInputState: asrInputUnknownCount > 0 ? asrInputConfirmedCount > 0 ? 'partial' : 'unavailable' : asrInputPendingCount > 0 ? 'processing' : 'ready' })
  const data = object(response), rawSessions = data.session_ls ?? data.sessions, rawChildren = data.child_ls ?? data.children
  if (!Array.isArray(rawSessions) || !Array.isArray(rawChildren) || !Number.isSafeInteger(viewerUserId) || viewerUserId <= 0
    || !validTime(dayStart) || !validTime(dayEnd) || dayEnd <= dayStart) {
    asrInputUnknownCount++
    return result()
  }
  const sessions = new Map(rawSessions.map(raw => { const session = object(raw); return [id(session.id ?? session.session_id), session] as const }))
  const children = new Map<string, Record<string, unknown>>()
  for (const raw of rawChildren) {
    const child = object(raw), childId = id(child.id ?? child.child_id)
    if (!childId) { asrInputUnknownCount++; continue }
    const previous = children.get(childId)
    if (!previous || (validTime(child.upload_at) ? child.upload_at : -1) > (validTime(previous.upload_at) ? previous.upload_at : -1)) children.set(childId, child)
  }
  const represented = new Set<string>()
  for (const child of children.values()) {
    const sessionId = id(child.session_id), session = sessions.get(sessionId)
    if (!session || !validTime(session.belong_usr)) { asrInputUnknownCount++; continue }
    if (!recordingBelongsToViewer(session, viewerUserId)) continue
    represented.add(sessionId)
    const offset = child.start_at, duration = child.duration
    if (!validTime(offset) || (offset < 100_000_000_000 && !validTime(session.start_at))) { asrInputUnknownCount++; continue }
    const start = offset >= 100_000_000_000 ? offset : (session.start_at as number) + offset
    if (!validTime(start)) { asrInputUnknownCount++; continue }
    const input = object(child.asr_input_metrics), state = input.state
    // The upload hint locates pending work on the calendar only; it never
    // validates observed model-input windows or supplies their duration.
    const rangeDuration = validTime(duration) && duration > 0 ? duration
      : state === 'processing' && validTime(child.duration_hint) && child.duration_hint > 0 ? child.duration_hint : undefined
    if (rangeDuration === undefined) {
      if (start >= dayEnd) continue
      // Before SD confirms the media duration, the API can already know that
      // work is pending. Keep polling without inventing a range or a zero total.
      asrInputUnknownCount++
      if (state === 'processing') asrInputPendingCount++
      continue
    }
    const end = start + rangeDuration
    if (!validTime(end)) { asrInputUnknownCount++; continue }
    if (end <= dayStart || start >= dayEnd) continue
    if (state === 'processing') {
      asrInputPendingCount++
      // A new attempt can be pending while previous attempts already have
      // observed input. Keep that known total visible until the receipt arrives.
      if (input.basis == null && input.duration_ms == null && input.spans == null) continue
    }
    const value = validTime(duration) && duration > 0 ? clippedInputDuration(child, duration, dayStart - start, dayEnd - start) : undefined
    if (value === undefined || !Number.isSafeInteger(asrInputDurationMillis + value)) { asrInputUnknownCount++; continue }
    asrInputDurationMillis += value
    asrInputConfirmedCount++
    if (object(child.asr_input_metrics).basis === 'estimated') asrInputEstimatedCount++
    if (state === 'partial') asrInputUnknownCount++
  }
  for (const [sessionId, session] of sessions) {
    if (!sessionId || !validTime(session.belong_usr)) { asrInputUnknownCount++; continue }
    if (!recordingBelongsToViewer(session, viewerUserId) || represented.has(sessionId)) continue
    const start = session.start_at
    const end = validTime(session.end_at) ? session.end_at : validTime(start) && validTime(session.duration) ? start + session.duration : undefined
    if (!validTime(start) || !validTime(end) || end <= start || (start < dayEnd && end > dayStart)) asrInputUnknownCount++
  }
  return result()
}
