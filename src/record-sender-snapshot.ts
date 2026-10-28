import type { ArkmeTimelineItem, ArkmeUserProfile } from './types.js'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}
function text(...values: unknown[]): string {
  return values.find(value => typeof value === 'string' && value.trim() !== '')?.toString().trim() ?? ''
}

/** Keep the recorded actor, never resolve a historical record through today's profile. */
export function recordSenderSnapshot(raw: unknown): Pick<ArkmeTimelineItem, 'avatarRef' | 'avatarSnapshot' | 'senderName' | 'senderNameSnapshot'> {
  const item = object(raw)
  const core = object(item.record_core)
  const snapshot = object(core.sender_snapshot ?? item.sender_snapshot)
  const extra = object(core.extra ?? item.extra)
  const avatar = text(snapshot.avatar, core.avatar, item.avatar, extra.sender_avatar_ref)
  const nickname = text(snapshot.nickname, core.nickname, item.nickname, extra.sender_nickname_snapshot)
  return {
    avatarSnapshot: true,
    senderName: nickname || '我',
    ...(nickname === '' ? {} : { senderNameSnapshot: true }),
    // A profile reference identifies a person, not an immutable avatar. It cannot represent a snapshot.
    ...(avatar === '' || avatar.startsWith('arkme-profile-image-v1.') ? {} : { avatarRef: avatar }),
  }
}

/** Persist a creation-time value, never the profile lookup token that follows future profile edits. */
export function currentProfileRecordSnapshot(profile: ArkmeUserProfile | null | undefined): { avatar?: string; nickname?: string } | undefined {
  if (profile === null || profile === undefined) return undefined
  const avatar = profile.avatarAssetRef?.trim() || profile.avatarUrl?.trim() || ''
  const nickname = profile.nickname.trim() || profile.displayName.trim()
  if (avatar === '' && nickname === '') return undefined
  return {
    ...(avatar === '' ? {} : { avatar }),
    ...(nickname === '' ? {} : { nickname }),
  }
}
