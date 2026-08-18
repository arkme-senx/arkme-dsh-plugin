import type { JotmoSelfRecordItem } from '../types.js'

export function chronologicalRecords(items: readonly JotmoSelfRecordItem[]): JotmoSelfRecordItem[] {
  return [...items].sort((left, right) => {
    if (left.sendAtMillis !== right.sendAtMillis) return left.sendAtMillis - right.sendAtMillis
    return left.recordUid.localeCompare(right.recordUid)
  })
}

export function mergeRecordPages(
  existing: readonly JotmoSelfRecordItem[],
  incoming: readonly JotmoSelfRecordItem[],
): JotmoSelfRecordItem[] {
  const byUid = new Map(existing.map(item => [item.recordUid, item]))
  for (const item of incoming) byUid.set(item.recordUid, item)
  return [...byUid.values()]
}

export function recordDayKey(millis: number): string {
  if (millis <= 0) return 'unknown'
  const date = new Date(millis)
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function recordDayLabel(millis: number): string {
  if (millis <= 0) return '时间未知'
  return new Date(millis).toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

export function recordTimeLabel(millis: number): string {
  if (millis <= 0) return ''
  return new Date(millis).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
