export function teamHistoryDate(at: number): string {
  const d = new Date(at)
  return Number.isFinite(at) && at > 0 && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
}
