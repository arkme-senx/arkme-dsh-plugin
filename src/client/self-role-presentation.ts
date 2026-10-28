import type { ArkmeGroupAvatarFallback, ArkmeSelfRoleSnapshot, ArkmeSourceKind, ArkmeTimelineItem, ArkmeUserProfile } from '../types.js'

/** Personal views only: local roles keep their identity; the real self uses today's account avatar.
 * A device without a local role binding must use its own profile reference, not a historical
 * asset or another device's local avatar. This never mutates the snapshot kept for later sync.
 */
export function arkmePersonalAvatarRef(
  item: Pick<ArkmeTimelineItem, 'isMe' | 'selfRole' | 'avatarRef'>,
  profile?: Pick<ArkmeUserProfile, 'avatarRef'>,
): string | undefined {
  const recordedAvatar = item.avatarRef?.trim() || undefined
  if (!item.isMe) return recordedAvatar
  if (item.selfRole !== undefined) return item.selfRole.avatarRef?.trim() || undefined
  return profile?.avatarRef.trim() || recordedAvatar
}

/** Role identity is a local display layer, never a replacement for record ownership. */
export function arkmeSelfRoleForPresentation(
  item: Pick<ArkmeTimelineItem, 'isMe' | 'selfRole'>,
  sourceKind: ArkmeSourceKind,
): ArkmeSelfRoleSnapshot | undefined {
  if (!item.isMe) return undefined
  if (sourceKind !== 'send_to_self' && sourceKind !== 'default_category' && sourceKind !== 'topic') return undefined
  return item.selfRole
}

export function arkmeSelfRoleAvatarFallback(
  role: Pick<ArkmeSelfRoleSnapshot, 'roleId' | 'name'>,
): ArkmeGroupAvatarFallback {
  return {
    kind: 'phone_default',
    colorIndex: [...role.roleId].reduce((sum, character) => sum + character.charCodeAt(0), 0),
    label: [...role.name.trim()][0] ?? '•',
  }
}
