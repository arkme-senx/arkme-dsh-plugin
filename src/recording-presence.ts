/** Read-only projection of Audio's capture presence contract; upload state is unrelated. */
export interface RecordingPresenceItem {
  recordingId: string
  deviceId: string
  deviceName: string
  clientType: string
  platform: string
  recordingMode: 'manual' | 'all_day'
  state: 'recording' | 'paused' | 'interrupted' | 'error' | 'stopped'
  freshness: 'fresh' | 'stale'
  elapsedMillis: number
  startedAt: number
  durationAnchorAt: number
  expiresAt: number
  visibleUntil: number
}
export interface RecordingPresenceSnapshot {
  items: RecordingPresenceItem[]
  serverNow: number
  pollIntervalMillis: number
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('录音状态响应无效')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('录音状态字段无效')
  return value
}
function millis(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('录音状态时间无效')
  return value
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T)) throw new Error('录音状态字段无效')
  return value as T
}
export function parseRecordingPresence(value: unknown): RecordingPresenceSnapshot {
  const data = object(value)
  if (!Array.isArray(data.items)) throw new Error('录音状态列表无效')
  const serverNow = millis(data.server_now)
  const pollIntervalMillis = millis(data.poll_interval_ms)
  if (serverNow === 0 || pollIntervalMillis < 1000 || pollIntervalMillis > 300000) throw new Error('录音状态轮询时间无效')
  const ids = new Set<string>()
  const items = data.items.map(value => {
    const row = object(value)
    const recordingId = text(row.recording_id)
    if (ids.has(recordingId)) throw new Error('录音状态列表重复')
    ids.add(recordingId)
    return {
      recordingId, deviceId: text(row.device_id), deviceName: text(row.device_name),
      clientType: text(row.client_type), platform: text(row.platform),
      recordingMode: choice(row.recording_mode, ['manual', 'all_day'] as const),
      state: choice(row.state, ['recording', 'paused', 'interrupted', 'error', 'stopped'] as const),
      freshness: choice(row.freshness, ['fresh', 'stale'] as const),
      elapsedMillis: millis(row.elapsed_ms), startedAt: millis(row.started_at),
      durationAnchorAt: millis(row.duration_anchor_at), expiresAt: millis(row.expires_at), visibleUntil: millis(row.visible_until),
    }
  })
  items.sort((a, b) => a.startedAt - b.startedAt || a.recordingId.localeCompare(b.recordingId))
  return { items, serverNow, pollIntervalMillis }
}
export function recordingPresenceDisplay(item: RecordingPresenceItem, serverNow: number) {
  const stale = item.freshness === 'stale' || serverNow >= item.expiresAt
  return {
    state: stale ? 'stale' as const : item.state,
    elapsedMillis: item.elapsedMillis + (!stale && item.state === 'recording' ? Math.max(0, serverNow - item.durationAnchorAt) : 0),
    visible: item.state !== 'stopped' && serverNow < item.visibleUntil,
  }
}
