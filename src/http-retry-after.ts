/** HTTP delta-seconds and HTTP-date share one parser; never shorten a server hint. */
export function retryAfterMillis(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const seconds = Number(value.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2_147_483_647, Math.ceil(seconds * 1000))
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.min(2_147_483_647, Math.max(0, date - Date.now()))
}
