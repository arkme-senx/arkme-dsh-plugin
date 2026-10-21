/** Stable local presentation state. False pins remain stored so migration cannot resurrect them. */
export interface LocalDirectoryPreference {
  pinned: boolean
  pinnedAt: number
  removal?: { at: number; sequences: Record<string, number> }
}
export type LocalDirectoryPreferences = Record<string, LocalDirectoryPreference>
export function validDirectoryPreferenceKey(key: string): boolean {
  if (['builtin:self', 'builtin:arko', 'builtin:harness', 'notification'].includes(key)) return true
  if (!key.startsWith('team:') || key.length > 4096) return false
  try {
    const parts = JSON.parse(key.slice(5))
    return Array.isArray(parts) && parts.every(p => typeof p === 'string' && p.length > 0)
      && (parts.length === 2 && parts[0] === 'folder' || parts.length === 4 && parts[0] === 'conversation' && ['team', 'external'].includes(parts[1]))
  } catch { return false }
}
export function normalizeLocalDirectoryPreferences(input: unknown): LocalDirectoryPreferences {
  const result: LocalDirectoryPreferences = Object.create(null)
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  for (const [key, raw] of Object.entries(input).slice(0, 10_000)) {
    const value = raw as LocalDirectoryPreference
    if (!validDirectoryPreferenceKey(key) || !value || typeof value.pinned !== 'boolean' || !Number.isSafeInteger(value.pinnedAt) || value.pinnedAt < 0) continue
    const removal = value.removal
    const sequences = Object.fromEntries(Object.entries(removal?.sequences ?? {}).filter(([k, v]) => validDirectoryPreferenceKey(`team:${k}`) && Number.isSafeInteger(v) && v >= 0).slice(0, 10_000))
    result[key] = { pinned: value.pinned, pinnedAt: value.pinnedAt,
      ...(key.startsWith('team:') && removal && Number.isSafeInteger(removal.at) && removal.at > 0 ? { removal: { at: removal.at, sequences } } : {}) }
  }
  return result
}
