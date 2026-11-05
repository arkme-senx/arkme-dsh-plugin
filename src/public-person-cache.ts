import type { ArkmeGroupAvatarFallback } from './types.js'
export const PUBLIC_PERSON_FRESH_MS = 60_000
export const PUBLIC_PERSON_RETAIN_MS = 14 * 24 * 60 * 60_000
export const PUBLIC_PERSON_MAX_ENTRIES = 4096
export interface ArkmePublicProfile {
  userId: number; displayName: string; nickname: string; accountName?: string; arkmeId?: string
  avatarUrl?: string; avatarFallback?: ArkmeGroupAvatarFallback
}
export interface PublicPersonSnapshot { profile: ArkmePublicProfile; updatedAtMillis: number }
/** Only public fields enter this cache. Group labels, remarks and permissions are never copied. */
export function publicPersonSnapshot(value: unknown, target: number, now = Date.now()): PublicPersonSnapshot | undefined {
  if (!value || typeof value !== 'object') return
  const entry = value as PublicPersonSnapshot, p = entry.profile
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.userId !== target || !Number.isSafeInteger(target) || target <= 0 || !Number.isSafeInteger(entry.updatedAtMillis)
    || entry.updatedAtMillis > now + 60_000 || entry.updatedAtMillis < now - PUBLIC_PERSON_RETAIN_MS
    || typeof p.displayName !== 'string' || p.displayName.length > 512 || typeof p.nickname !== 'string' || p.nickname.length > 512) return
  const profile: ArkmePublicProfile = { userId: target, displayName: p.displayName, nickname: p.nickname }
  for (const field of ['accountName', 'arkmeId', 'avatarUrl'] as const) {
    if (p[field] === undefined) continue
    if (typeof p[field] !== 'string' || p[field].length > (field === 'avatarUrl' ? 4096 : 512)) return
    profile[field] = p[field]
  }
  if (p.avatarFallback !== undefined) {
    const f = p.avatarFallback
    if (!f || typeof f !== 'object' || Array.isArray(f) || f.kind !== 'phone_default' || typeof f.label !== 'string' || f.label.length > 32 || !Number.isSafeInteger(f.colorIndex) || f.colorIndex < 0 || f.colorIndex >= 12) return
    profile.avatarFallback = { kind: 'phone_default', label: f.label, colorIndex: f.colorIndex }
  }
  return { profile, updatedAtMillis: entry.updatedAtMillis }
}
