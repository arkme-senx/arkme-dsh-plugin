import { parseRecordingPresence, type RecordingPresenceItem } from './recording-presence.js'
export interface RecordingHistoryItem extends RecordingPresenceItem {
  lastConfirmedAt: number
  stoppedAt: number
}
export interface RecordingHistoryPage {
  items: RecordingHistoryItem[]
  nextCursor: string
  hasMore: boolean
  serverNow: number
}
/** History has no visibility deadline: expired and terminal captures remain visible. */
export function parseRecordingHistory(value: unknown): RecordingHistoryPage {
  if (!value || typeof value !== 'object') throw new Error('录音记录响应无效')
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.items) || typeof data.next_cursor !== 'string' || typeof data.has_more !== 'boolean'
    || (data.has_more && (!data.next_cursor || data.items.length === 0))) throw new Error('录音记录响应无效')
  const snapshot = parseRecordingPresence({ ...data, poll_interval_ms: 10000,
    items: data.items.map(row => ({ ...row, visible_until: Number.MAX_SAFE_INTEGER })) })
  const metadata = new Map(data.items.map(row => {
    if (!Number.isSafeInteger(row.last_confirmed_at) || row.last_confirmed_at < 0
      || !Number.isSafeInteger(row.stopped_at) || row.stopped_at < 0) throw new Error('录音记录响应无效')
    return [row.recording_id, { lastConfirmedAt: row.last_confirmed_at as number, stoppedAt: row.stopped_at as number }]
  }))
  const items = snapshot.items.map(item => ({ ...item, ...metadata.get(item.recordingId)! }))
    .sort((a, b) => b.startedAt - a.startedAt || b.recordingId.localeCompare(a.recordingId))
  return { items, nextCursor: data.next_cursor, hasMore: data.has_more, serverNow: snapshot.serverNow }
}
