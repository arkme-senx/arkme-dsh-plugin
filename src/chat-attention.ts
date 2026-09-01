/**
 * Canonical projection shared by every Arkme attention consumer.
 *
 * `unreadCount` remains the server-owned read state. Badge and notification
 * consumers must use the derived fields so a muted conversation never leaks
 * back into a red dot, Dock badge, or system notification.
 */
export interface ArkmeChatAttentionProjection {
  unreadCount: number
  badgeUnreadCount: number
  notificationAllowed: boolean
  isMuted: boolean
}

function integerLikeValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

export function arkmeChatPolicyNotificationDisabled(policy: unknown): boolean | undefined {
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) return undefined
  const value = policy as Record<string, unknown>
  const muteState = integerLikeValue(value.mute_state ?? value.muteState)
  const notifyState = integerLikeValue(value.notify_state ?? value.notifyState)
  if (muteState === 2 || notifyState === 2) return true
  if (muteState === 1 || notifyState === 1) return false
  return undefined
}

export function projectArkmeChatAttention(
  rawUnreadCount: unknown,
  policy: unknown,
  fallbackMuted = false,
): ArkmeChatAttentionProjection {
  const unreadCount = Math.max(0, integerLikeValue(rawUnreadCount) ?? 0)
  const isMuted = arkmeChatPolicyNotificationDisabled(policy) ?? fallbackMuted
  const notificationAllowed = !isMuted
  return {
    unreadCount,
    badgeUnreadCount: notificationAllowed ? unreadCount : 0,
    notificationAllowed,
    isMuted,
  }
}

export function projectArkmeChatAttentionFromMuted(
  rawUnreadCount: unknown,
  isMuted: boolean,
): ArkmeChatAttentionProjection {
  return projectArkmeChatAttention(rawUnreadCount, undefined, isMuted)
}

export function arkmeBadgeUnreadCount(value: {
  unreadCount?: number
  badgeUnreadCount?: number
  isMuted?: boolean
  notificationAllowed?: boolean
}): number {
  if (value.notificationAllowed === false || value.isMuted === true) return 0
  if (typeof value.badgeUnreadCount === 'number' && Number.isFinite(value.badgeUnreadCount)) {
    return Math.max(0, Math.trunc(value.badgeUnreadCount))
  }
  const allowed = value.notificationAllowed ?? true
  return allowed ? Math.max(0, Math.trunc(value.unreadCount ?? 0)) : 0
}

export function arkmeNotificationAllowed(value: {
  isMuted?: boolean
  notificationAllowed?: boolean
}): boolean {
  return value.notificationAllowed ?? value.isMuted !== true
}
