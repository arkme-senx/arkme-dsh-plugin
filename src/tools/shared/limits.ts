export function boundedRecordLimit(value: number | undefined): number {
  if (value === undefined) return 10
  if (!Number.isSafeInteger(value)) throw new Error('limit 必须是整数')
  return Math.min(30, Math.max(1, value))
}

export function boundedSourceLimit(value: number | undefined): number {
  if (value === undefined) return 30
  if (!Number.isSafeInteger(value)) throw new Error('limit 必须是整数')
  return Math.min(50, Math.max(1, value))
}

export function optionalBeforeMillis(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('before_millis 必须是正整数时间戳')
  return value
}
