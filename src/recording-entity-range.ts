/** Convert owner Unicode offsets through the recording presenter's exact, prefix-only cleanup. */
export function recordingEntityDisplayRange(raw: string, visible: string, start: number, end: number, observed: string): { start: number; length: number } | undefined {
  const chars = Array.from(raw)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > chars.length
    || chars.slice(start, end).join('') !== observed) return undefined
  const trimmed = raw.trim()
  const cleaned = trimmed.replace(/^\(背景音\)\s*/, '')
  if (visible !== trimmed && visible !== cleaned) return undefined
  const leading = Array.from(raw).length - Array.from(raw.trimStart()).length
    + (visible === trimmed ? 0 : Array.from(trimmed).length - Array.from(cleaned).length)
  const mapped = start - leading
  if (mapped < 0 || mapped + end - start > Array.from(visible).length
    || Array.from(visible).slice(mapped, mapped + end - start).join('') !== observed) return undefined
  return { start: mapped, length: end - start }
}
