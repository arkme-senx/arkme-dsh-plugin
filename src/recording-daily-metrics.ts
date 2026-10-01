import type { ArkmeRecordingDailyMetrics } from './types.js'
import { recordingBelongsToViewer } from './recording-coverage.js'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : NaN
const id = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

/** Count Unicode characters, not UTF-16 units, words or generated speaker labels. */
export function recordingTextCount(text: string): number {
  return Array.from(text.replace(/[\p{White_Space}\uFEFF]/gu, '')).length
}

/** Caller supplies the final deduplicated transcript. Only metrics, never raw identity, cross the UI bridge. */
export function projectRecordingDailyMetrics(response: unknown, items: readonly {sessionId:string;text:string}[],
  viewerUserId: number, dayStart: number, dayEnd: number): ArkmeRecordingDailyMetrics {
  const data = object(response), rawSessions = data.session_ls ?? data.sessions, rawChildren = data.child_ls ?? data.children
  const sessions = new Map(list(rawSessions).map(raw => { const s = object(raw); return [id(s.id ?? s.session_id),s] as const }))
  const children = new Map<string,Record<string,unknown>>()
  let unknownCount = Array.isArray(rawSessions) && Array.isArray(rawChildren)
    && Number.isSafeInteger(viewerUserId) && viewerUserId > 0 ? 0 : 1
  let archiveBytes = 0, confirmedCount = 0, pendingCount = 0
  const representedSessions = new Set<string>()
  for (const raw of list(rawChildren)) {
    const child = object(raw), childId = id(child.id ?? child.child_id)
    if (!childId) { unknownCount++; continue }
    const previous = children.get(childId)
    if (!previous || (number(child.upload_at) || -Infinity) > (number(previous.upload_at) || -Infinity)) children.set(childId,child)
  }
  for (const child of children.values()) {
    const sessionId = id(child.session_id), session = sessions.get(sessionId)
    if (!session || !Number.isSafeInteger(session.belong_usr) || number(session.belong_usr) < 0) { unknownCount++; continue }
    if (!recordingBelongsToViewer(session,viewerUserId)) continue
    representedSessions.add(sessionId)
    const offset = number(child.start_at), start = offset >= 100_000_000_000 ? offset : number(session.start_at) + offset
    const duration = number(child.duration), end = start + duration
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || !(duration > 0)) { unknownCount++; continue }
    if (end <= dayStart || start >= dayEnd) continue
    if (child.has_asr === false) { pendingCount++; continue }
    const bytes = child.archive_size
    // A file crossing midnight has no per-day byte allocation. Do not estimate or double count it.
    if (start < dayStart || end > dayEnd || child.has_asr !== true || typeof bytes !== 'number'
      || !Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(archiveBytes + bytes)) { unknownCount++; continue }
    const hasText = [...list(child.asr),...list(child.doubao_asr)].some(raw => {
      const row = object(raw), text = row.t ?? row.text
      return typeof text === 'string' && recordingTextCount(text) > 0
    })
    if (bytes === 0 && hasText) { unknownCount++; continue }
    archiveBytes += bytes
    confirmedCount++
  }
  for (const [sessionId,session] of sessions) {
    if (!Number.isSafeInteger(session.belong_usr) || number(session.belong_usr) < 0) { unknownCount++; continue }
    if (!recordingBelongsToViewer(session,viewerUserId) || representedSessions.has(sessionId)) continue
    const start = number(session.start_at), end = Number.isFinite(number(session.end_at))
      ? number(session.end_at) : start + number(session.duration)
    if (!Number.isFinite(start) || !Number.isFinite(end) || (start < dayEnd && end > dayStart)) unknownCount++
  }
  return {
    archiveBytes, confirmedCount, pendingCount, unknownCount,
    archiveState: unknownCount > 0 ? confirmedCount > 0 ? 'partial' : 'unavailable' : pendingCount > 0 ? 'processing' : 'ready',
    // Text matches the visible final transcript, including unassigned recordings;
    // storage follows explicit ownership, just like the physical coverage rail.
    textCount: items.reduce((sum,item) => sum + recordingTextCount(item.text),0),
  }
}
