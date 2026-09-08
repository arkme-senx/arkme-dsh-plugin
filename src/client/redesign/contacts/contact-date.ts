/** Shared date-only presentation; missing timestamps must never appear as January 1970. */
export function formatContactDate(value: number | undefined, fallback = '暂无记录'): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
