/** Audio owns these receipt facts. Unknown totals/times stay null and never
 * become upload percentages or physical capture identities in a client. */
export interface RecordingDelivery {
  registeredSources: number
  receivedSources: number
  receivedBytes: number
  expectedSources: number | null
  expectedBytes: number | null
  endReceived: boolean | null
  intakeClosed: boolean
  coverage: 'receiving' | 'complete' | 'interrupted'
  captureStartAt: number | null
  captureEndAt: number | null
  displayEndAt: number | null
  audioDurationMs: number | null
  durationFinal: boolean
}

export function parseRecordingDelivery(value: unknown): RecordingDelivery | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('录音接收信息无效')
  const row = value as Record<string, unknown>
  const number = (key: string): number => {
    const n = row[key]
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new Error('录音接收信息无效')
    return n
  }
  const optional = (key: string): number | null => row[key] === null ? null : number(key)
  const boolean = (key: string): boolean => {
    if (typeof row[key] !== 'boolean') throw new Error('录音接收信息无效')
    return row[key]
  }
  const coverage = row.coverage
  if (coverage !== 'receiving' && coverage !== 'complete' && coverage !== 'interrupted') throw new Error('录音接收信息无效')
  return {
    registeredSources: number('registered_sources'), receivedSources: number('received_sources'), receivedBytes: number('received_bytes'),
    expectedSources: optional('expected_sources'), expectedBytes: optional('expected_bytes'),
    endReceived: row.end_received === null ? null : boolean('end_received'), intakeClosed: boolean('intake_closed'), coverage,
    captureStartAt: optional('capture_start_at'), captureEndAt: optional('capture_end_at'), displayEndAt: optional('display_end_at'),
    audioDurationMs: optional('audio_duration_ms'), durationFinal: boolean('duration_final'),
  }
}

export function recordingReceiptLabel(value: RecordingDelivery): string {
  const received = `已接收 ${String(value.receivedSources)} 个文件`
  if (value.coverage === 'interrupted') return `${received} · 部分录音未收齐`
  if (value.coverage === 'complete') return '已接收完整'
  if (value.endReceived === false) return `${received} · 录音结束信息待确认`
  if (value.expectedSources !== null) return `${received} / 共 ${String(value.expectedSources)} 个`
  return `${received} · 总量待确认`
}

export interface RecordingDeliveryQuery {
  scope: 'active' | 'completed'
  toMillis: number
  limit: number
  offset: number
}
export interface RecordingDeliveryPage {
  items: import('./recording-import-shared.js').PublicRecordingImportOwnerTask[]
  offset: number
  hasMore: boolean
  total?: number
}
export function recordingDeliveryQuery(input: unknown): RecordingDeliveryQuery {
  const row = input as Record<string, unknown> | null
  if (!row || (row.scope !== 'active' && row.scope !== 'completed')
    || typeof row.toMillis !== 'number' || !Number.isSafeInteger(row.toMillis) || row.toMillis <= 0
    || typeof row.limit !== 'number' || !Number.isSafeInteger(row.limit) || row.limit < 1 || row.limit > 100
    || typeof row.offset !== 'number' || !Number.isSafeInteger(row.offset) || row.offset < 0) {
    throw new Error('录音接收查询参数无效')
  }
  return { scope: row.scope, toMillis: row.toMillis, limit: row.limit, offset: row.offset }
}
