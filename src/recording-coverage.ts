import type { ArkmeRecordingCoverage, ArkmeRecordingCoverageInterval } from './types.js'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : NaN

/** Upload ownership and speaker identity are not the recording's explicit memory attribution. */
export function recordingBelongsToViewer(session: unknown, viewerUserId: number): boolean {
  return Number.isSafeInteger(viewerUserId) && viewerUserId > 0 && number(object(session).belong_usr) === viewerUserId
}

/** Adjacent physical children may jointly cover one uploaded file; never bridge a gap. */
export function recordingCoverageContains(intervals: readonly { startAtMillis: number; endAtMillis: number }[], start: number, end: number): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false
  let coveredTo = start
  for (const interval of [...intervals].sort((a, b) => a.startAtMillis - b.startAtMillis)) {
    if (!Number.isFinite(interval.startAtMillis) || !Number.isFinite(interval.endAtMillis) || interval.endAtMillis <= coveredTo) continue
    if (interval.startAtMillis > coveredTo) return false
    coveredTo = interval.endAtMillis
    if (coveredTo >= end) return true
  }
  return false
}

export function clipRecordingCoverage(interval: ArkmeRecordingCoverageInterval, start: number, end: number): ArkmeRecordingCoverageInterval | undefined {
  const from = Math.max(start, interval.startAtMillis)
  const to = Math.min(end, interval.endAtMillis)
  return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from
    ? { ...interval, startAtMillis: from, endAtMillis: to } : undefined
}

/** Use physical audio children, never first/last speech or a session envelope spanning gaps. */
export function projectRecordingCoverage(response: unknown, dayStart: number, dayEnd: number, viewerUserId: number): ArkmeRecordingCoverage {
  const data = object(response)
  const rawSessions = data.session_ls ?? data.sessions
  const rawChildren = data.child_ls ?? data.children
  const sessions = new Map(list(rawSessions).map(value => {
    const session = object(value)
    return [String(session.id ?? session.session_id ?? ''), session] as const
  }))
  let incomplete = !Array.isArray(rawSessions) || !Array.isArray(rawChildren) || !Number.isSafeInteger(viewerUserId) || viewerUserId <= 0
    || [...sessions.values()].some(session => !Number.isSafeInteger(session.belong_usr) || number(session.belong_usr) < 0)
  const childrenBySession = new Set<string>()
  const intervals: ArkmeRecordingCoverageInterval[] = []
  const add = (interval: ArkmeRecordingCoverageInterval) => {
    const clipped = clipRecordingCoverage(interval, dayStart, dayEnd)
    if (clipped) intervals.push(clipped)
  }
  for (const raw of list(rawChildren)) {
    const child = object(raw)
    const id = String(child.session_id ?? '')
    childrenBySession.add(id)
    const session = sessions.get(id)
    if (session === undefined) { incomplete = true; continue }
    if (!recordingBelongsToViewer(session, viewerUserId)) continue
    const start = number(child.start_at)
    // Legacy children contain session-relative offsets; current owner uses absolute milliseconds.
    const absoluteStart = start >= 100_000_000_000 ? start : number(session?.start_at) + start
    const duration = number(child.duration)
    if (!Number.isFinite(absoluteStart) || absoluteStart < 0 || !(duration > 0)) { incomplete = true; continue }
    add({ startAtMillis: absoluteStart, endAtMillis: absoluteStart + duration,
      sourceLabel: typeof session?.orig_name === 'string' && session.orig_name.trim() ? session.orig_name : '已同步录音',
      status: child.has_asr === false ? 'processing' : 'saved' })
  }
  for (const [id, session] of sessions) {
    if (!recordingBelongsToViewer(session, viewerUserId)) continue
    if (childrenBySession.has(id)) continue
    const start = number(session.start_at), end = number(session.end_at), duration = number(session.duration)
    // Only a completed, continuous file can safely stand in for absent legacy children.
    if (session.has_finish_spk === true && duration > 0 && end > start && Math.abs(end - start - duration) < 1) {
      add({ startAtMillis: start, endAtMillis: end, sourceLabel: typeof session.orig_name === 'string' && session.orig_name ? session.orig_name : '已同步录音', status: 'saved' })
    } else incomplete = true
  }
  return { state: incomplete ? 'partial' : 'ready', intervals: intervals.sort((a, b) => a.startAtMillis - b.startAtMillis) }
}
